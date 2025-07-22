use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use locker::types::CreateVestingEscrowParameters;
use static_assertions::const_assert_eq;

use crate::{
    activation_handler::ActivationType,
    constants::{
        MAX_CURVE_POINT, MAX_MIGRATED_POOL_FEE_BPS, MAX_SQRT_PRICE, MIN_MIGRATED_POOL_FEE_BPS,
        MIN_SQRT_PRICE,
    },
    params::{
        fee_parameters::PoolFeeParameters,
        liquidity_distribution::{
            get_base_token_for_swap, get_migration_base_token, get_migration_threshold_price,
            LiquidityDistributionParameters,
        },
    },
    safe_math::SafeMath,
    state::{
        CollectFeeMode, LockedVestingConfig, MigrationFeeOption, MigrationOption, PoolConfig,
        TokenAuthorityOption, TokenType,
    },
    token::{get_token_program_flags, is_supported_quote_mint},
    DammV2DynamicFee, EvtCreateConfig, EvtCreateConfigV2, PoolError,
};

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct ConfigParameters {
    pub pool_fees: PoolFeeParameters,
    pub collect_fee_mode: u8,
    pub migration_option: u8,
    pub activation_type: u8,
    pub token_type: u8,
    pub token_decimal: u8,
    pub partner_lp_percentage: u8,
    pub partner_locked_lp_percentage: u8,
    pub creator_lp_percentage: u8,
    pub creator_locked_lp_percentage: u8,
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

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, InitSpace)]
pub struct MigrationFee {
    pub fee_percentage: u8,
    pub creator_fee_percentage: u8,
}
const_assert_eq!(MigrationFee::INIT_SPACE, 2);

impl MigrationFee {
    pub fn validate(&self) -> Result<()> {
        require!(
            self.fee_percentage <= 50,
            PoolError::InvalidMigratorFeePercentage
        );
        if self.fee_percentage == 0 {
            require!(
                self.creator_fee_percentage == 0,
                PoolError::InvalidMigratorFeePercentage
            );
        } else {
            require!(
                self.creator_fee_percentage <= 100,
                PoolError::InvalidMigratorFeePercentage
            );
        }
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, InitSpace)]
pub struct MigratedPoolFee {
    pub collect_fee_mode: u8,
    pub dynamic_fee: u8,
    pub pool_fee_bps: u16,
}
const_assert_eq!(MigratedPoolFee::INIT_SPACE, 4);

impl MigratedPoolFee {
    pub fn is_none(&self) -> bool {
        self.collect_fee_mode == 0 && self.dynamic_fee == 0 && self.pool_fee_bps == 0
    }
    pub fn validate(&self) -> Result<()> {
        require!(
            self.pool_fee_bps >= MIN_MIGRATED_POOL_FEE_BPS
                && self.pool_fee_bps <= MAX_MIGRATED_POOL_FEE_BPS,
            PoolError::InvalidMigratedPoolFee
        );

        // validate collect fee mode
        require!(
            CollectFeeMode::try_from(self.collect_fee_mode).is_ok(),
            PoolError::InvalidMigratedPoolFee
        );
        // validate migrated dynamic fee option
        require!(
            DammV2DynamicFee::try_from(self.dynamic_fee).is_ok(),
            PoolError::InvalidMigratedPoolFee
        );
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq)]
pub struct TokenSupplyParams {
    /// pre migration token supply
    pub pre_migration_token_supply: u64,
    /// post migration token supply
    /// becase DBC allow user to swap over the migration quote threshold, so in extreme case user may swap more than allowed buffer on curve
    /// that result the total supply in post migration may be increased a bit (between pre_migration_token_supply and post_migration_token_supply)
    pub post_migration_token_supply: u64,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq)]
pub struct LockedVestingParams {
    pub amount_per_period: u64,
    pub cliff_duration_from_migration_time: u64,
    pub frequency: u64,
    pub number_of_period: u64,
    pub cliff_unlock_amount: u64,
}

impl LockedVestingParams {
    pub fn to_locked_vesting_config(&self) -> LockedVestingConfig {
        LockedVestingConfig {
            amount_per_period: self.amount_per_period,
            cliff_duration_from_migration_time: self.cliff_duration_from_migration_time,
            frequency: self.frequency,
            number_of_period: self.number_of_period,
            cliff_unlock_amount: self.cliff_unlock_amount,
            ..Default::default()
        }
    }

    pub fn to_create_vesting_escrow_params(
        &self,
        finish_curve_timestamp: u64,
    ) -> Result<CreateVestingEscrowParameters> {
        let cliff_time =
            finish_curve_timestamp.safe_add(self.cliff_duration_from_migration_time)?;
        Ok(CreateVestingEscrowParameters {
            vesting_start_time: finish_curve_timestamp,
            cliff_time,
            frequency: self.frequency,
            cliff_unlock_amount: self.cliff_unlock_amount,
            amount_per_period: self.amount_per_period,
            number_of_period: self.number_of_period,
            update_recipient_mode: 2, // only recipient
            cancel_mode: 1,           // only creator
        })
    }

    pub fn get_total_amount(&self) -> Result<u64> {
        let total_amount = self
            .cliff_unlock_amount
            .safe_add(self.amount_per_period.safe_mul(self.number_of_period)?)?;
        Ok(total_amount)
    }

    pub fn has_vesting(&self) -> bool {
        *self != LockedVestingParams::default()
    }
    pub fn validate(&self) -> Result<()> {
        if self.has_vesting() {
            let total_amount = self.get_total_amount()?;
            require!(
                self.frequency != 0 && total_amount != 0,
                PoolError::InvalidVestingParameters
            );
        }
        Ok(())
    }
}

impl ConfigParameters {
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
        // validate migration option and token type
        let migration_option_value = MigrationOption::try_from(self.migration_option)
            .map_err(|_| PoolError::InvalidMigrationOption)?;

        // validate migrate fee option
        let migration_fee_option = MigrationFeeOption::try_from(self.migration_fee_option)
            .map_err(|_| PoolError::InvalidMigrationFeeOption)?;

        let token_type_value =
            TokenType::try_from(self.token_type).map_err(|_| PoolError::InvalidTokenType)?;

        match migration_option_value {
            MigrationOption::MeteoraDamm => {
                require!(
                    token_type_value == TokenType::SplToken,
                    PoolError::InvalidTokenType
                );
                require!(
                    *quote_mint.to_account_info().owner == anchor_spl::token::Token::id(),
                    PoolError::InvalidQuoteMint
                );

                require!(
                    migration_fee_option != MigrationFeeOption::Customizable
                        && self.migrated_pool_fee.is_none(),
                    PoolError::InvalidMigrationFeeOption
                );
            }
            MigrationOption::DammV2 => {
                if migration_fee_option == MigrationFeeOption::Customizable {
                    self.migrated_pool_fee.validate()?;
                } else {
                    require!(
                        self.migrated_pool_fee.is_none(),
                        PoolError::InvalidMigratedPoolFee
                    );
                }
            }
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

        let sum_lp_percentage = self
            .partner_lp_percentage
            .safe_add(self.partner_locked_lp_percentage)?
            .safe_add(self.creator_lp_percentage)?
            .safe_add(self.creator_locked_lp_percentage)?;
        require!(sum_lp_percentage == 100, PoolError::InvalidFeePercentage);

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

#[event_cpi]
#[derive(Accounts)]
pub struct CreateConfigCtx<'info> {
    #[account(
        init,
        signer,
        payer = payer,
        space = 8 + PoolConfig::INIT_SPACE
    )]
    pub config: AccountLoader<'info, PoolConfig>,

    /// CHECK: fee_claimer
    pub fee_claimer: UncheckedAccount<'info>,
    /// CHECK: owner extra base token in case token is fixed supply
    pub leftover_receiver: UncheckedAccount<'info>,
    /// quote mint
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create_config(
    ctx: Context<CreateConfigCtx>,
    config_parameters: ConfigParameters,
) -> Result<()> {
    config_parameters.validate(&ctx.accounts.quote_mint)?;

    let ConfigParameters {
        pool_fees,
        collect_fee_mode,
        migration_option,
        activation_type,
        token_type,
        token_decimal,
        partner_lp_percentage,
        partner_locked_lp_percentage,
        creator_lp_percentage,
        creator_locked_lp_percentage,
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
        ..
    } = config_parameters.clone();

    let sqrt_migration_price =
        get_migration_threshold_price(migration_quote_threshold, sqrt_start_price, &curve)?;
    // migration price must be smaller than max sqrt price
    require!(
        sqrt_migration_price < MAX_SQRT_PRICE,
        PoolError::InvalidCurve
    );

    let swap_base_amount_256 =
        get_base_token_for_swap(sqrt_start_price, sqrt_migration_price, &curve)?;
    let swap_base_amount: u64 = swap_base_amount_256
        .try_into()
        .map_err(|_| PoolError::TypeCastFailed)?;

    let migration_base_amount = get_migration_base_token(
        migration_quote_threshold,
        migration_fee.fee_percentage,
        sqrt_migration_price,
        MigrationOption::try_from(migration_option)
            .map_err(|_| PoolError::InvalidMigrationOption)?,
    )?;

    require!(
        // this is fine to add redundant check
        migration_base_amount > 0 && swap_base_amount > 0,
        PoolError::InvalidCurve
    );

    let (fixed_token_supply_flag, pre_migration_token_supply, post_migration_token_supply) =
        if let Some(TokenSupplyParams {
            pre_migration_token_supply,
            post_migration_token_supply,
        }) = token_supply
        {
            let swap_base_amount_buffer = PoolConfig::get_swap_amount_with_buffer(
                swap_base_amount,
                sqrt_start_price,
                &curve,
            )?;

            let minimum_base_supply_with_buffer = PoolConfig::get_total_token_supply(
                swap_base_amount_buffer,
                migration_base_amount,
                &locked_vesting,
            )?;

            let minimum_base_supply_without_buffer = PoolConfig::get_total_token_supply(
                swap_base_amount,
                migration_base_amount,
                &locked_vesting,
            )?;

            require!(
                ctx.accounts.leftover_receiver.key() != Pubkey::default(),
                PoolError::InvalidLeftoverAddress
            );
            require!(
                minimum_base_supply_without_buffer <= post_migration_token_supply
                    && post_migration_token_supply <= pre_migration_token_supply
                    && minimum_base_supply_with_buffer <= pre_migration_token_supply,
                PoolError::InvalidTokenSupply
            );
            (1, pre_migration_token_supply, post_migration_token_supply)
        } else {
            (0, 0, 0)
        };

    let MigratedPoolFee {
        pool_fee_bps: migrated_pool_fee_bps,
        collect_fee_mode: migrated_collect_fee_mode,
        dynamic_fee: migrated_dynamic_fee,
    } = migrated_pool_fee;

    let mut config = ctx.accounts.config.load_init()?;
    config.init(
        &ctx.accounts.quote_mint.key(),
        ctx.accounts.fee_claimer.key,
        ctx.accounts.leftover_receiver.key,
        &pool_fees,
        creator_trading_fee_percentage,
        token_update_authority,
        migration_fee,
        collect_fee_mode,
        migration_option,
        activation_type,
        token_decimal,
        token_type,
        get_token_program_flags(&ctx.accounts.quote_mint).into(),
        partner_locked_lp_percentage,
        partner_lp_percentage,
        creator_locked_lp_percentage,
        creator_lp_percentage,
        &locked_vesting,
        migration_fee_option,
        swap_base_amount,
        migration_quote_threshold,
        migration_base_amount,
        sqrt_migration_price,
        sqrt_start_price,
        fixed_token_supply_flag,
        pre_migration_token_supply,
        post_migration_token_supply,
        migrated_pool_fee_bps,
        migrated_collect_fee_mode,
        migrated_dynamic_fee,
        &curve,
    );

    emit_cpi!(EvtCreateConfig {
        config: ctx.accounts.config.key(),
        fee_claimer: ctx.accounts.fee_claimer.key(),
        quote_mint: ctx.accounts.quote_mint.key(),
        owner: ctx.accounts.leftover_receiver.key(),
        pool_fees,
        collect_fee_mode,
        migration_option,
        activation_type,
        token_decimal,
        token_type,
        partner_locked_lp_percentage,
        partner_lp_percentage,
        creator_locked_lp_percentage,
        creator_lp_percentage,
        swap_base_amount,
        migration_quote_threshold,
        migration_base_amount,
        sqrt_start_price,
        fixed_token_supply_flag,
        pre_migration_token_supply,
        post_migration_token_supply,
        locked_vesting,
        migration_fee_option,
        curve
    });

    emit_cpi!(EvtCreateConfigV2 {
        config: ctx.accounts.config.key(),
        fee_claimer: ctx.accounts.fee_claimer.key(),
        quote_mint: ctx.accounts.quote_mint.key(),
        leftover_receiver: ctx.accounts.leftover_receiver.key(),
        config_parameters: config_parameters
    });

    Ok(())
}
