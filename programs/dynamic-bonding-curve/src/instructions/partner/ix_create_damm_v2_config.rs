use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::{
    constants::{
        MAX_LOCK_DURATION_IN_SECONDS, MAX_LOCK_DURATION_IN_SLOTS, MIN_LOCKED_LP_PERCENTAGE,
    },
    params::{
        fee_parameters::PoolFeeParameters, liquidity_distribution::LiquidityDistributionParameters,
    },
    process_create_config,
    safe_math::SafeMath,
    state::{LpVestingInfo, MigrationFeeOption, MigrationOption},
    utils_math::time_to_slot,
    validate_common_config_parameters, CreateConfigCtx, EvtCreateDammV2Config, LockedVestingParams,
    MigratedPoolFee, MigrationFee, PoolError, ProcessCreateConfigAccounts, ProcessCreateConfigArgs,
    TokenSupplyParams, ValidateCommonConfigParametersArgs,
};

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct LpDistributionInfo {
    pub lp_percentage: u8,
    pub lp_permanent_lock_percentage: u8,
    pub lp_vesting_info: LpVestingInfoParams,
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone, Copy)]
pub struct LpVestingInfoParams {
    pub vesting_percentage: u8,
    pub cliff_duration_from_migration_time: u32,
    pub bps_per_period: u16,
    pub frequency: u64,
    pub number_of_periods: u16,
}

impl LpVestingInfoParams {
    pub fn validate(&self) -> Result<()> {
        if self.to_lp_vesting_info().is_none() {
            return Ok(());
        }

        require!(
            self.vesting_percentage > 0 && self.vesting_percentage <= 100,
            PoolError::InvalidVestingParameters
        );

        if self.number_of_periods > 0 {
            require!(
                self.frequency > 0 && self.bps_per_period > 0,
                PoolError::InvalidVestingParameters
            );
        }

        let total_bps_after_cliff =
            u64::from(self.bps_per_period).safe_mul(self.number_of_periods.into())?;

        require!(
            total_bps_after_cliff <= 10_000,
            PoolError::InvalidVestingParameters
        );

        // We not sure the damm v2 config will be in slot / time activation. Therefore, we validate both time + slot based to ensure that later during migration we won't have issue.
        // There's 1 config is using slot activation. Thus, we need some estimation conversion here.
        // https://solscan.io/account/A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck
        let vesting_duration_in_seconds = u64::from(self.cliff_duration_from_migration_time)
            .safe_add(self.frequency.safe_mul(self.number_of_periods.into())?)?;

        require!(
            vesting_duration_in_seconds <= MAX_LOCK_DURATION_IN_SECONDS,
            PoolError::InvalidVestingParameters
        );

        let cliff_duration_from_migration_in_slots = time_to_slot(vesting_duration_in_seconds)?;
        let frequency_in_slots = time_to_slot(self.frequency)?;
        let vesting_duration_in_slots = cliff_duration_from_migration_in_slots
            .safe_add(frequency_in_slots.safe_mul(self.number_of_periods.into())?)?;

        require!(
            vesting_duration_in_slots <= MAX_LOCK_DURATION_IN_SLOTS,
            PoolError::InvalidVestingParameters
        );

        Ok(())
    }

    fn to_lp_vesting_info(self) -> LpVestingInfo {
        LpVestingInfo {
            vesting_percentage: self.vesting_percentage,
            cliff_duration_from_migration_time: self
                .cliff_duration_from_migration_time
                .to_le_bytes(),
            bps_per_period: self.bps_per_period.to_le_bytes(),
            frequency: self.frequency.to_le_bytes(),
            number_of_periods: self.number_of_periods.to_le_bytes(),
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct DammV2ConfigParameters {
    pub pool_fees: PoolFeeParameters,
    pub collect_fee_mode: u8,
    pub activation_type: u8,
    pub token_type: u8,
    pub token_decimal: u8,
    pub partner_lp_info: LpDistributionInfo,
    pub creator_lp_info: LpDistributionInfo,
    pub migration_quote_threshold: u64,
    pub sqrt_start_price: u128,
    pub locked_vesting: LockedVestingParams,
    pub migration_fee_option: u8,
    pub token_supply: Option<TokenSupplyParams>,
    pub creator_trading_fee_percentage: u8, // percentage of trading fee creator can share with partner
    pub token_update_authority: u8,
    pub migration_fee: MigrationFee,
    pub migrated_pool_fee: MigratedPoolFee,
    /// padding for future use
    pub padding: [u64; 7],
    pub curve: Vec<LiquidityDistributionParameters>,
}

impl DammV2ConfigParameters {
    pub fn validate<'info>(&self, quote_mint: &InterfaceAccount<'info, Mint>) -> Result<()> {
        validate_common_config_parameters(ValidateCommonConfigParametersArgs {
            quote_mint,
            pool_fees: &self.pool_fees,
            migration_fee: &self.migration_fee,
            activation_type: self.activation_type,
            collect_fee_mode: self.collect_fee_mode,
            creator_trading_fee_percentage: self.creator_trading_fee_percentage,
            token_type: self.token_type,
            token_update_authority: self.token_update_authority,
            token_decimal: self.token_decimal,
            migration_quote_threshold: self.migration_quote_threshold,
            locked_vesting: &self.locked_vesting,
            sqrt_start_price: self.sqrt_start_price,
            curve: &self.curve,
        })?;

        // validate migrate fee option
        let migration_fee_option = MigrationFeeOption::try_from(self.migration_fee_option)
            .map_err(|_| PoolError::InvalidMigrationFeeOption)?;

        if migration_fee_option == MigrationFeeOption::Customizable {
            self.migrated_pool_fee.validate()?;
        } else {
            require!(
                self.migrated_pool_fee.is_none(),
                PoolError::InvalidMigratedPoolFee
            );
        }

        let LpDistributionInfo {
            lp_percentage: creator_lp_percentage,
            lp_permanent_lock_percentage: creator_permanent_lock_percentage,
            lp_vesting_info: creator_lp_vesting_info,
        } = self.creator_lp_info;

        creator_lp_vesting_info.validate()?;

        let LpDistributionInfo {
            lp_percentage: partner_lp_percentage,
            lp_permanent_lock_percentage: partner_permanent_lock_percentage,
            lp_vesting_info: partner_lp_vesting_info,
        } = self.partner_lp_info;

        partner_lp_vesting_info.validate()?;

        let lp_sum_percentage = creator_lp_percentage
            .safe_add(partner_lp_percentage)?
            .safe_add(creator_permanent_lock_percentage)?
            .safe_add(partner_permanent_lock_percentage)?
            .safe_add(creator_lp_vesting_info.vesting_percentage)?
            .safe_add(partner_lp_vesting_info.vesting_percentage)?;

        require!(lp_sum_percentage == 100, PoolError::InvalidFeePercentage);

        let creator_lp_vesting_info: LpVestingInfo = creator_lp_vesting_info.to_lp_vesting_info();
        let partner_lp_vesting_info: LpVestingInfo = partner_lp_vesting_info.to_lp_vesting_info();

        let locked_percentage_at_day_one = creator_lp_vesting_info
            .get_locked_percentage_at_day_one()?
            .safe_add(partner_lp_vesting_info.get_locked_percentage_at_day_one()?)?
            .safe_add(creator_permanent_lock_percentage)?
            .safe_add(partner_permanent_lock_percentage)?;

        require!(
            locked_percentage_at_day_one >= MIN_LOCKED_LP_PERCENTAGE,
            PoolError::InvalidVestingParameters
        );

        require!(
            self.migration_quote_threshold > 0,
            PoolError::InvalidQuoteThreshold
        );

        Ok(())
    }
}

pub fn handle_create_config_for_dammv2_migration(
    ctx: Context<CreateConfigCtx>,
    config_parameters: DammV2ConfigParameters,
) -> Result<()> {
    config_parameters.validate(&ctx.accounts.quote_mint)?;

    let DammV2ConfigParameters {
        pool_fees,
        collect_fee_mode,
        activation_type,
        token_type,
        token_decimal,
        migration_quote_threshold,
        sqrt_start_price,
        locked_vesting,
        migration_fee_option,
        token_supply,
        curve,
        creator_trading_fee_percentage,
        token_update_authority,
        migration_fee,
        migrated_pool_fee,
        creator_lp_info,
        partner_lp_info,
        ..
    } = config_parameters.clone();

    let evt_create_config = process_create_config(
        ProcessCreateConfigArgs {
            pool_fees,
            collect_fee_mode,
            activation_type,
            token_type,
            migrated_pool_fee,
            migration_fee,
            migration_fee_option,
            migration_option: MigrationOption::DammV2.into(),
            migration_quote_threshold,
            token_decimal,
            sqrt_start_price,
            locked_vesting,
            token_supply,
            creator_trading_fee_percentage,
            token_update_authority,
            creator_locked_lp_percentage: creator_lp_info.lp_permanent_lock_percentage,
            creator_lp_percentage: creator_lp_info.lp_percentage,
            partner_locked_lp_percentage: partner_lp_info.lp_permanent_lock_percentage,
            partner_lp_percentage: partner_lp_info.lp_percentage,
            partner_lp_vesting_info: partner_lp_info.lp_vesting_info.to_lp_vesting_info(),
            creator_lp_vesting_info: creator_lp_info.lp_vesting_info.to_lp_vesting_info(),
            curve,
        },
        ProcessCreateConfigAccounts {
            config: &ctx.accounts.config,
            quote_mint: &ctx.accounts.quote_mint,
            fee_claimer: &ctx.accounts.fee_claimer,
            leftover_receiver: &ctx.accounts.leftover_receiver,
        },
    )?;

    emit_cpi!(evt_create_config);
    emit_cpi!(EvtCreateDammV2Config {
        config: ctx.accounts.config.key(),
        quote_mint: ctx.accounts.quote_mint.key(),
        fee_claimer: ctx.accounts.fee_claimer.key(),
        leftover_receiver: ctx.accounts.leftover_receiver.key(),
        config_parameters,
    });

    Ok(())
}
