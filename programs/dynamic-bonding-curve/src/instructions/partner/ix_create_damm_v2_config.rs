use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::{
    activation_handler::ActivationType,
    constants::{
        MAX_CURVE_POINT, MAX_LOCK_DURATION_IN_SECONDS, MAX_SQRT_PRICE, MIN_LOCKED_LP_PERCENTAGE,
        MIN_LOCK_DURATION_IN_SECONDS, MIN_SQRT_PRICE,
    },
    params::{
        fee_parameters::PoolFeeParameters, liquidity_distribution::LiquidityDistributionParameters,
    },
    process_create_config,
    safe_math::SafeMath,
    state::{
        CollectFeeMode, LpImpermanentLockInfo, MigrationFeeOption, MigrationOption,
        TokenAuthorityOption, TokenType,
    },
    token::is_supported_quote_mint,
    CreateConfigCtx, EvtCreateDammV2Config, LockedVestingParams, MigratedPoolFee, MigrationFee,
    PoolError, ProcessCreateConfigAccounts, ProcessCreateConfigArgs, TokenSupplyParams,
};

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct LpDistributionInfo {
    pub lp_percentage: u8,
    pub lp_permanent_lock_percentage: u8,
    pub lp_impermanent_lock_percentage: u8,
    pub lock_duration: u32,
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
    pub padding1: u8,
    pub curve: Vec<LiquidityDistributionParameters>,
}

impl DammV2ConfigParameters {
    pub fn validate<'info>(&self, quote_mint: &InterfaceAccount<'info, Mint>) -> Result<()> {
        // validate quote mint
        require!(
            is_supported_quote_mint(quote_mint)?,
            PoolError::InvalidQuoteMint
        );

        let activation_type = ActivationType::try_from(self.activation_type)
            .map_err(|_| PoolError::TypeCastFailed)?;

        // validate fee
        self.pool_fees
            .validate(self.collect_fee_mode, activation_type)?;

        // validate creator trading fee percentage
        require!(
            self.creator_trading_fee_percentage <= 100,
            PoolError::InvalidCreatorTradingFeePercentage
        );

        self.migration_fee.validate()?;

        // validate collect fee mode
        require!(
            CollectFeeMode::try_from(self.collect_fee_mode).is_ok(),
            PoolError::InvalidCollectFeeMode
        );

        // validate migrate fee option
        let migration_fee_option = MigrationFeeOption::try_from(self.migration_fee_option)
            .map_err(|_| PoolError::InvalidMigrationFeeOption)?;

        let maybe_token_type = TokenType::try_from(self.token_type);
        require!(maybe_token_type.is_ok(), PoolError::InvalidTokenType);

        if migration_fee_option == MigrationFeeOption::Customizable {
            self.migrated_pool_fee.validate()?;
        } else {
            require!(
                self.migrated_pool_fee.is_none(),
                PoolError::InvalidMigratedPoolFee
            );
        }

        // validate token update authority
        require!(
            TokenAuthorityOption::try_from(self.token_update_authority).is_ok(),
            PoolError::InvalidTokenAuthorityOption
        );

        // validate token decimals
        require!(
            self.token_decimal >= 6 && self.token_decimal <= 9,
            PoolError::InvalidTokenDecimals
        );

        let LpDistributionInfo {
            lp_percentage: creator_lp_percentage,
            lp_permanent_lock_percentage: creator_permanent_lock_percentage,
            lp_impermanent_lock_percentage: creator_lp_impermanent_lock_percentage,
            lock_duration: creator_lock_duration,
        } = self.creator_lp_info;

        let LpDistributionInfo {
            lp_percentage: partner_lp_percentage,
            lp_permanent_lock_percentage: partner_permanent_lock_percentage,
            lp_impermanent_lock_percentage: partner_lp_impermanent_lock_percentage,
            lock_duration: partner_lock_duration,
        } = self.partner_lp_info;

        if creator_lp_impermanent_lock_percentage == 0 {
            require!(
                creator_lock_duration == 0,
                PoolError::InvalidVestingParameters
            );
        } else {
            require!(
                u64::from(creator_lock_duration) >= MIN_LOCK_DURATION_IN_SECONDS
                    && u64::from(creator_lock_duration) <= MAX_LOCK_DURATION_IN_SECONDS,
                PoolError::InvalidVestingParameters
            );
        }

        if partner_lp_impermanent_lock_percentage == 0 {
            require!(
                partner_lock_duration == 0,
                PoolError::InvalidVestingParameters
            );
        } else {
            require!(
                u64::from(partner_lock_duration) >= MIN_LOCK_DURATION_IN_SECONDS
                    && u64::from(partner_lock_duration) <= MAX_LOCK_DURATION_IN_SECONDS,
                PoolError::InvalidVestingParameters
            );
        }

        let lp_sum_percentage = creator_lp_percentage
            .safe_add(partner_lp_percentage)?
            .safe_add(creator_permanent_lock_percentage)?
            .safe_add(partner_permanent_lock_percentage)?
            .safe_add(creator_lp_impermanent_lock_percentage)?
            .safe_add(partner_lp_impermanent_lock_percentage)?;

        require!(lp_sum_percentage == 100, PoolError::InvalidFeePercentage);

        let locked_lp_sum_percentage = creator_permanent_lock_percentage
            .safe_add(partner_permanent_lock_percentage)?
            .safe_add(creator_lp_impermanent_lock_percentage)?
            .safe_add(partner_lp_impermanent_lock_percentage)?;

        require!(
            locked_lp_sum_percentage >= MIN_LOCKED_LP_PERCENTAGE,
            PoolError::InvalidVestingParameters
        );

        require!(
            self.migration_quote_threshold > 0,
            PoolError::InvalidQuoteThreshold
        );

        // validate vesting params
        self.locked_vesting.validate()?;

        // validate price and liquidity
        require!(
            self.sqrt_start_price >= MIN_SQRT_PRICE && self.sqrt_start_price < MAX_SQRT_PRICE,
            PoolError::InvalidCurve
        );
        let curve_length = self.curve.len();
        require!(
            curve_length > 0 && curve_length <= MAX_CURVE_POINT,
            PoolError::InvalidCurve
        );
        require!(
            self.curve[0].sqrt_price > self.sqrt_start_price
                && self.curve[0].liquidity > 0
                && self.curve[0].sqrt_price <= MAX_SQRT_PRICE,
            PoolError::InvalidCurve
        );

        for i in 1..curve_length {
            require!(
                self.curve[i].sqrt_price > self.curve[i - 1].sqrt_price
                    && self.curve[i].liquidity > 0,
                PoolError::InvalidCurve
            );
        }

        // the last price in curve must be smaller than or equal max price
        require!(
            self.curve[curve_length - 1].sqrt_price <= MAX_SQRT_PRICE,
            PoolError::InvalidCurve
        );

        Ok(())
    }
}

pub fn handle_create_damm_v2_config(
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
            creator_lp_impermanent_lock_info: LpImpermanentLockInfo {
                lock_percentage: creator_lp_info.lp_impermanent_lock_percentage,
                lp_lock_duration_bytes: creator_lp_info.lock_duration.to_le_bytes(),
            },
            partner_locked_lp_percentage: partner_lp_info.lp_permanent_lock_percentage,
            partner_lp_percentage: partner_lp_info.lp_percentage,
            partner_lp_impermanent_lock_info: LpImpermanentLockInfo {
                lock_percentage: partner_lp_info.lp_impermanent_lock_percentage,
                lp_lock_duration_bytes: partner_lp_info.lock_duration.to_le_bytes(),
            },
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
