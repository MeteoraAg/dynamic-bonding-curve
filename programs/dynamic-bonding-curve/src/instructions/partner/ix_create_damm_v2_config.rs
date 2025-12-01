use anchor_lang::{prelude::*, solana_program::clock::SECONDS_PER_DAY};
use anchor_spl::token_interface::Mint;

use crate::{
    constants::{MAX_LOCK_DURATION_IN_SECONDS, MIN_LOCKED_LP_BPS},
    params::{
        fee_parameters::{BaseFeeParameters, DynamicFeeParameters, PoolFeeParameters},
        liquidity_distribution::LiquidityDistributionParameters,
    },
    process_create_config,
    safe_math::SafeMath,
    state::{LpVestingInfo, MigrationFeeOption, MigrationOption},
    validate_common_config_parameters, ConfigParameters, CreateConfigCtx, EvtCreateConfigV2,
    EvtCreateDammV2Config, LockedVestingParams, MigratedPoolFee, MigrationFee, PoolError,
    ProcessCreateConfigAccounts, ProcessCreateConfigArgs, TokenSupplyParams,
    ValidateCommonConfigParametersArgs,
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

        // Currently, all damm v2 config use time based activation. Creation of config in damm v2 is permissioned.
        let vesting_duration_in_seconds = u64::from(self.cliff_duration_from_migration_time)
            .safe_add(self.frequency.safe_mul(self.number_of_periods.into())?)?;

        require!(
            vesting_duration_in_seconds <= MAX_LOCK_DURATION_IN_SECONDS,
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
pub struct VirtualPoolFeesConfiguration {
    pub base_fee: BaseFeeParameters,
    pub dynamic_fee: Option<DynamicFeeParameters>,
    pub collect_fee_mode: u8,
    pub creator_trading_fee_percentage: u8, // percentage of trading fee creator can share with partner
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct VirtualPoolConfiguration {
    pub activation_type: u8,
    pub migration_quote_threshold: u64,
    pub sqrt_start_price: u128,
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct DammV2MigrationConfiguration {
    pub migration_fee: MigrationFee,
    pub migrated_pool_fee: MigratedPoolFee,
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct MintConfiguration {
    pub token_type: u8,
    pub token_decimal: u8,
    pub token_update_authority: u8,
    pub token_supply: TokenSupplyParams,
    pub locked_vesting: LockedVestingParams,
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct LiquidityDistributionConfiguration {
    pub partner_lp_info: LpDistributionInfo,
    pub creator_lp_info: LpDistributionInfo,
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct DammV2ConfigParameters {
    pub virtual_pool_fees_configuration: VirtualPoolFeesConfiguration,
    pub virtual_pool_configuration: VirtualPoolConfiguration,
    pub damm_v2_migration_configuration: DammV2MigrationConfiguration,
    pub liquidity_distribution_configuration: LiquidityDistributionConfiguration,
    pub mint_configuration: MintConfiguration,
    /// padding for future use
    pub padding: [u64; 7],
    pub curve: Vec<LiquidityDistributionParameters>,
}

impl DammV2ConfigParameters {
    pub fn validate<'info>(&self, quote_mint: &InterfaceAccount<'info, Mint>) -> Result<()> {
        let DammV2ConfigParameters {
            virtual_pool_fees_configuration,
            virtual_pool_configuration,
            damm_v2_migration_configuration,
            liquidity_distribution_configuration,
            mint_configuration,
            curve,
            ..
        } = self;

        let VirtualPoolFeesConfiguration {
            base_fee,
            dynamic_fee,
            collect_fee_mode,
            creator_trading_fee_percentage,
        } = virtual_pool_fees_configuration;

        let VirtualPoolConfiguration {
            activation_type,
            sqrt_start_price,
            migration_quote_threshold,
        } = virtual_pool_configuration;

        let DammV2MigrationConfiguration {
            migration_fee,
            migrated_pool_fee,
        } = damm_v2_migration_configuration;

        let MintConfiguration {
            token_type,
            token_decimal,
            token_update_authority,
            locked_vesting,
            ..
        } = mint_configuration;

        validate_common_config_parameters(ValidateCommonConfigParametersArgs {
            quote_mint,
            base_fee,
            dynamic_fee: dynamic_fee.as_ref(),
            migration_fee,
            activation_type: *activation_type,
            collect_fee_mode: *collect_fee_mode,
            creator_trading_fee_percentage: *creator_trading_fee_percentage,
            token_type: *token_type,
            token_update_authority: *token_update_authority,
            token_decimal: *token_decimal,
            migration_quote_threshold: *migration_quote_threshold,
            locked_vesting,
            sqrt_start_price: *sqrt_start_price,
            curve,
        })?;

        require!(
            !migrated_pool_fee.is_none(),
            PoolError::InvalidMigratedPoolFee
        );

        let LiquidityDistributionConfiguration {
            partner_lp_info,
            creator_lp_info,
        } = liquidity_distribution_configuration;

        let &LpDistributionInfo {
            lp_percentage: creator_lp_percentage,
            lp_permanent_lock_percentage: creator_permanent_lock_percentage,
            lp_vesting_info: creator_lp_vesting_info,
        } = creator_lp_info;

        creator_lp_vesting_info.validate()?;

        let &LpDistributionInfo {
            lp_percentage: partner_lp_percentage,
            lp_permanent_lock_percentage: partner_permanent_lock_percentage,
            lp_vesting_info: partner_lp_vesting_info,
        } = partner_lp_info;

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

        let creator_permanent_lock_bps =
            u16::from(creator_permanent_lock_percentage).safe_mul(100)?;
        let partner_permanent_lock_bps =
            u16::from(partner_permanent_lock_percentage).safe_mul(100)?;

        let locked_bps_at_day_one = creator_lp_vesting_info
            .get_locked_bps_at_n_seconds(SECONDS_PER_DAY)?
            .safe_add(partner_lp_vesting_info.get_locked_bps_at_n_seconds(SECONDS_PER_DAY)?)?
            .safe_add(creator_permanent_lock_bps)?
            .safe_add(partner_permanent_lock_bps)?;

        require!(
            locked_bps_at_day_one >= MIN_LOCKED_LP_BPS,
            PoolError::InvalidVestingParameters
        );

        Ok(())
    }
}

impl From<DammV2ConfigParameters> for ConfigParameters {
    fn from(value: DammV2ConfigParameters) -> Self {
        let DammV2ConfigParameters {
            virtual_pool_fees_configuration,
            virtual_pool_configuration,
            damm_v2_migration_configuration,
            mint_configuration,
            liquidity_distribution_configuration,
            curve,
            ..
        } = value;

        let VirtualPoolFeesConfiguration {
            base_fee,
            dynamic_fee,
            collect_fee_mode,
            creator_trading_fee_percentage,
        } = virtual_pool_fees_configuration;

        let VirtualPoolConfiguration {
            activation_type,
            migration_quote_threshold,
            sqrt_start_price,
        } = virtual_pool_configuration;

        let DammV2MigrationConfiguration {
            migration_fee,
            migrated_pool_fee,
        } = damm_v2_migration_configuration;

        let MintConfiguration {
            token_type,
            token_decimal,
            token_update_authority,
            token_supply,
            locked_vesting,
        } = mint_configuration;

        let LiquidityDistributionConfiguration {
            partner_lp_info,
            creator_lp_info,
        } = liquidity_distribution_configuration;

        ConfigParameters {
            pool_fees: PoolFeeParameters {
                base_fee,
                dynamic_fee,
            },
            collect_fee_mode,
            migration_option: MigrationOption::DammV2.into(),
            activation_type,
            token_decimal,
            token_type,
            partner_locked_lp_percentage: partner_lp_info.lp_permanent_lock_percentage,
            partner_lp_percentage: partner_lp_info.lp_percentage,
            creator_locked_lp_percentage: creator_lp_info.lp_permanent_lock_percentage,
            creator_lp_percentage: creator_lp_info.lp_percentage,
            migration_quote_threshold,
            sqrt_start_price,
            locked_vesting,
            migration_fee_option: MigrationFeeOption::Customizable.into(),
            curve,
            token_supply: Some(token_supply),
            creator_trading_fee_percentage,
            token_update_authority,
            migrated_pool_fee,
            migration_fee,
            ..Default::default()
        }
    }
}

pub fn handle_create_config_for_dammv2_migration(
    ctx: Context<CreateConfigCtx>,
    config_parameters: DammV2ConfigParameters,
) -> Result<()> {
    config_parameters.validate(&ctx.accounts.quote_mint)?;

    let DammV2ConfigParameters {
        virtual_pool_fees_configuration,
        virtual_pool_configuration,
        damm_v2_migration_configuration,
        liquidity_distribution_configuration,
        mint_configuration,
        curve,
        ..
    } = config_parameters.clone();

    let VirtualPoolFeesConfiguration {
        base_fee,
        dynamic_fee,
        collect_fee_mode,
        creator_trading_fee_percentage,
    } = virtual_pool_fees_configuration;

    let VirtualPoolConfiguration {
        activation_type,
        migration_quote_threshold,
        sqrt_start_price,
    } = virtual_pool_configuration;

    let MintConfiguration {
        token_type,
        token_decimal,
        token_update_authority,
        token_supply,
        locked_vesting,
    } = mint_configuration;

    let LiquidityDistributionConfiguration {
        partner_lp_info,
        creator_lp_info,
    } = liquidity_distribution_configuration;

    let DammV2MigrationConfiguration {
        migration_fee,
        migrated_pool_fee,
    } = damm_v2_migration_configuration;

    let evt_create_config = process_create_config(
        ProcessCreateConfigArgs {
            pool_fees: PoolFeeParameters {
                base_fee,
                dynamic_fee,
            },
            collect_fee_mode,
            activation_type,
            token_type,
            migrated_pool_fee,
            migration_fee,
            migration_fee_option: MigrationFeeOption::Customizable.into(),
            migration_option: MigrationOption::DammV2.into(),
            migration_quote_threshold,
            token_decimal,
            sqrt_start_price,
            locked_vesting,
            token_supply: Some(token_supply),
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
    emit_cpi!(EvtCreateConfigV2 {
        config: ctx.accounts.config.key(),
        fee_claimer: ctx.accounts.fee_claimer.key(),
        quote_mint: ctx.accounts.quote_mint.key(),
        leftover_receiver: ctx.accounts.leftover_receiver.key(),
        config_parameters: config_parameters.clone().into()
    });

    emit_cpi!(EvtCreateDammV2Config {
        config: ctx.accounts.config.key(),
        quote_mint: ctx.accounts.quote_mint.key(),
        fee_claimer: ctx.accounts.fee_claimer.key(),
        leftover_receiver: ctx.accounts.leftover_receiver.key(),
        config_parameters,
    });

    Ok(())
}
