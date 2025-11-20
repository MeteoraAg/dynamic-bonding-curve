use anchor_lang::{prelude::*, solana_program::clock::SECONDS_PER_DAY};
use num_enum::{IntoPrimitive, TryFromPrimitive};
use ruint::aliases::U256;
use static_assertions::const_assert_eq;

use crate::{
    base_fee::{get_base_fee_handler, BaseFeeHandler, FeeRateLimiter},
    constants::{
        fee::{FEE_DENOMINATOR, HOST_FEE_PERCENT, MAX_FEE_NUMERATOR, PROTOCOL_FEE_PERCENT},
        MAX_CURVE_POINT_CONFIG, MAX_SQRT_PRICE, SWAP_BUFFER_PERCENTAGE,
    },
    params::{
        fee_parameters::PoolFeeParameters,
        liquidity_distribution::{get_base_token_for_swap, LiquidityDistributionParameters},
        swap::TradeDirection,
    },
    safe_math::SafeMath,
    u128x128_math::Rounding,
    utils_math::{safe_mul_div_cast_u128, safe_mul_div_cast_u64},
    LockedVestingParams, MigrationFee, PoolError,
};

use super::fee::{FeeOnAmountResult, VolatilityTracker};

/// base fee mode
#[repr(u8)]
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    IntoPrimitive,
    TryFromPrimitive,
    AnchorDeserialize,
    AnchorSerialize,
)]
// https://www.desmos.com/calculator/oxdndn2xdx
pub enum BaseFeeMode {
    // fee = cliff_fee_numerator - passed_period * reduction_factor
    FeeSchedulerLinear,
    // fee = cliff_fee_numerator * (1-reduction_factor/10_000)^passed_period
    FeeSchedulerExponential,
    // TODO
    RateLimiter,
}

#[zero_copy]
#[derive(Debug, InitSpace, Default)]
pub struct PoolFeesConfig {
    pub base_fee: BaseFeeConfig,
    pub dynamic_fee: DynamicFeeConfig,
}

const_assert_eq!(PoolFeesConfig::INIT_SPACE, 80);

impl PoolFeesConfig {
    /// Calculates the total trading fee numerator by combining base fee and dynamic fee.
    /// The base fee is determined by the fee scheduler mode (linear or exponential) and time period.
    /// The dynamic fee is based on price volatility and is only applied if dynamic fees are enabled.
    /// The total fee is capped at MAX_FEE_NUMERATOR (99%) to ensure reasonable trading costs.
    ///
    /// Returns the total fee numerator that will be used to calculate actual trading fees.
    pub fn get_total_fee_numerator_from_included_fee_amount(
        &self,
        volatility_tracker: &VolatilityTracker,
        current_point: u64,
        activation_point: u64,
        included_fee_amount: u64,
        trade_direction: TradeDirection,
    ) -> Result<u64> {
        let base_fee_handler = self.base_fee.get_base_fee_handler()?;

        let base_fee_numerator = base_fee_handler.get_base_fee_numerator_from_included_fee_amount(
            current_point,
            activation_point,
            trade_direction,
            included_fee_amount,
        )?;

        self.get_total_fee_numerator(base_fee_numerator, volatility_tracker)
    }

    pub fn get_total_fee_numerator_from_excluded_fee_amount(
        &self,
        volatility_tracker: &VolatilityTracker,
        current_point: u64,
        activation_point: u64,
        excluded_fee_amount: u64,
        trade_direction: TradeDirection,
    ) -> Result<u64> {
        let base_fee_handler = self.base_fee.get_base_fee_handler()?;

        let base_fee_numerator = base_fee_handler.get_base_fee_numerator_from_excluded_fee_amount(
            current_point,
            activation_point,
            trade_direction,
            excluded_fee_amount,
        )?;

        self.get_total_fee_numerator(base_fee_numerator, volatility_tracker)
    }

    fn get_total_fee_numerator(
        &self,
        base_fee_numerator: u64,
        volatility_tracker: &VolatilityTracker,
    ) -> Result<u64> {
        let total_fee_numerator = self
            .dynamic_fee
            .get_variable_fee_numerator(volatility_tracker)?
            .safe_add(base_fee_numerator.into())?;

        // Cap the total fee at MAX_FEE_NUMERATOR
        let total_fee_numerator = if total_fee_numerator > MAX_FEE_NUMERATOR.into() {
            MAX_FEE_NUMERATOR
        } else {
            total_fee_numerator.try_into().unwrap()
        };

        Ok(total_fee_numerator)
    }

    pub fn get_fee_on_amount(
        &self,
        trade_fee_numerator: u64,
        amount: u64,
        has_referral: bool,
    ) -> Result<FeeOnAmountResult> {
        let (amount, trading_fee) =
            PoolFeesConfig::get_excluded_fee_amount(trade_fee_numerator, amount)?;

        let protocol_fee = safe_mul_div_cast_u64(
            trading_fee,
            PROTOCOL_FEE_PERCENT.into(),
            100,
            Rounding::Down,
        )?;

        // update trading fee
        let trading_fee: u64 = trading_fee.safe_sub(protocol_fee)?;

        let referral_fee = if has_referral {
            safe_mul_div_cast_u64(protocol_fee, HOST_FEE_PERCENT.into(), 100, Rounding::Down)?
        } else {
            0
        };

        let protocol_fee = protocol_fee.safe_sub(referral_fee)?;

        Ok(FeeOnAmountResult {
            amount,
            protocol_fee,
            referral_fee,
            trading_fee,
        })
    }

    pub fn get_excluded_fee_amount(
        trade_fee_numerator: u64,
        included_fee_amount: u64,
    ) -> Result<(u64, u64)> {
        let trading_fee: u64 = safe_mul_div_cast_u64(
            included_fee_amount,
            trade_fee_numerator,
            FEE_DENOMINATOR,
            Rounding::Up,
        )?;
        // update amount
        let excluded_fee_amount = included_fee_amount.safe_sub(trading_fee)?;
        Ok((excluded_fee_amount, trading_fee))
    }

    pub fn get_included_fee_amount(
        trade_fee_numerator: u64,
        excluded_fee_amount: u64,
    ) -> Result<(u64, u64)> {
        let included_fee_amount: u64 = safe_mul_div_cast_u64(
            excluded_fee_amount,
            FEE_DENOMINATOR,
            FEE_DENOMINATOR.safe_sub(trade_fee_numerator)?,
            Rounding::Up,
        )?;
        let fee_amount = included_fee_amount.safe_sub(excluded_fee_amount)?;
        Ok((included_fee_amount, fee_amount))
    }

    pub fn split_fees(&self, fee_amount: u64, has_referral: bool) -> Result<(u64, u64, u64)> {
        let protocol_fee =
            safe_mul_div_cast_u64(fee_amount, PROTOCOL_FEE_PERCENT.into(), 100, Rounding::Down)?;

        // update trading fee
        let trading_fee: u64 = fee_amount.safe_sub(protocol_fee)?;

        let referral_fee = if has_referral {
            safe_mul_div_cast_u64(protocol_fee, HOST_FEE_PERCENT.into(), 100, Rounding::Down)?
        } else {
            0
        };

        let protocol_fee = protocol_fee.safe_sub(referral_fee)?;

        Ok((trading_fee, protocol_fee, referral_fee))
    }
}

#[zero_copy]
#[derive(Debug, InitSpace, Default)]
pub struct BaseFeeConfig {
    pub cliff_fee_numerator: u64,
    // reverse order to ensure it is backward-compatible on fee scheduler
    // first_factor: number_of_period, period_frequency: second_factor, reduction_factor: third_factor
    pub second_factor: u64,
    pub third_factor: u64,
    pub first_factor: u16,
    pub base_fee_mode: u8,
    pub padding_0: [u8; 5],
}

const_assert_eq!(BaseFeeConfig::INIT_SPACE, 32);

impl BaseFeeConfig {
    pub fn get_fee_rate_limiter(&self) -> Result<FeeRateLimiter> {
        let base_fee_mode =
            BaseFeeMode::try_from(self.base_fee_mode).map_err(|_| PoolError::InvalidBaseFeeMode)?;
        if base_fee_mode == BaseFeeMode::RateLimiter {
            Ok(FeeRateLimiter {
                cliff_fee_numerator: self.cliff_fee_numerator,
                reference_amount: self.third_factor,
                max_limiter_duration: self.second_factor,
                fee_increment_bps: self.first_factor,
            })
        } else {
            Err(PoolError::InvalidFeeRateLimiter.into())
        }
    }

    pub fn get_base_fee_handler(&self) -> Result<Box<dyn BaseFeeHandler>> {
        get_base_fee_handler(
            self.cliff_fee_numerator,
            self.first_factor,
            self.second_factor,
            self.third_factor,
            self.base_fee_mode,
        )
    }

    pub fn is_fee_rate_limiter_applied(&self, trade_fee_numerator: u64) -> Result<bool> {
        let base_fee_mode =
            BaseFeeMode::try_from(self.base_fee_mode).map_err(|_| PoolError::InvalidBaseFeeMode)?;

        if base_fee_mode == BaseFeeMode::RateLimiter {
            return Ok(trade_fee_numerator > self.cliff_fee_numerator);
        }

        Ok(false)
    }

    pub fn validate_min_base_fee(&self) -> Result<()> {
        let base_fee_handler = self.get_base_fee_handler()?;
        base_fee_handler.validate_min_base_fee()?;

        Ok(())
    }
}

#[zero_copy]
#[derive(Debug, InitSpace, Default)]
pub struct DynamicFeeConfig {
    pub initialized: u8, // 0, ignore for dynamic fee
    pub padding: [u8; 7],
    pub max_volatility_accumulator: u32,
    pub variable_fee_control: u32,
    pub bin_step: u16,
    pub filter_period: u16,
    pub decay_period: u16,
    pub reduction_factor: u16,
    pub padding2: [u8; 8], // Add padding for u128 alignment
    pub bin_step_u128: u128,
}

const_assert_eq!(DynamicFeeConfig::INIT_SPACE, 48);

impl DynamicFeeConfig {
    pub fn is_dynamic_fee_enable(&self) -> bool {
        self.initialized != 0
    }

    pub fn get_variable_fee_numerator(
        &self,
        volatility_tracker: &VolatilityTracker,
    ) -> Result<u128> {
        if !self.is_dynamic_fee_enable() {
            return Ok(0);
        }

        // 1. Computing the squared price movement (volatility_accumulator * bin_step)^2
        let square_vfa_bin: u128 = volatility_tracker
            .volatility_accumulator
            .safe_mul(self.bin_step.into())?
            .checked_pow(2)
            .ok_or_else(|| PoolError::MathOverflow)?;

        // 2. Multiplying by the fee control factor
        let v_fee = square_vfa_bin.safe_mul(self.variable_fee_control.into())?;

        // 3. Scaling down the result to fit within u64 range (dividing by 1e11 and rounding up)
        let scaled_v_fee = v_fee.safe_add(99_999_999_999)?.safe_div(100_000_000_000)?;

        Ok(scaled_v_fee)
    }
}

#[zero_copy]
#[derive(Debug, InitSpace, Default)]
pub struct LockedVestingConfig {
    pub amount_per_period: u64,
    pub cliff_duration_from_migration_time: u64,
    pub frequency: u64,
    pub number_of_period: u64,
    pub cliff_unlock_amount: u64,
    pub _padding: u64,
}

const_assert_eq!(LockedVestingConfig::INIT_SPACE, 48);

impl LockedVestingConfig {
    pub fn to_locked_vesting_params(&self) -> LockedVestingParams {
        LockedVestingParams {
            amount_per_period: self.amount_per_period,
            cliff_duration_from_migration_time: self.cliff_duration_from_migration_time,
            frequency: self.frequency,
            number_of_period: self.number_of_period,
            cliff_unlock_amount: self.cliff_unlock_amount,
        }
    }
}

#[repr(u8)]
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    IntoPrimitive,
    TryFromPrimitive,
    AnchorDeserialize,
    AnchorSerialize,
    Default,
)]
pub enum TokenAuthorityOption {
    // Creator has permission to update update_authority
    #[default]
    CreatorUpdateAuthority,
    // No one has permission to update the authority
    Immutable,
    // Partner has permission to update update_authority
    PartnerUpdateAuthority,
    // Creator has permission as mint_authority and update_authority
    CreatorUpdateAndMintAuthority,
    // Partner has permission as mint_authority and update_authority
    PartnerUpdateAndMintAuthority,
}

impl TokenAuthorityOption {
    pub fn get_update_authority(&self, creator: Pubkey, partner: Pubkey) -> Option<Pubkey> {
        match *self {
            TokenAuthorityOption::CreatorUpdateAndMintAuthority
            | TokenAuthorityOption::CreatorUpdateAuthority => Some(creator),

            TokenAuthorityOption::PartnerUpdateAndMintAuthority
            | TokenAuthorityOption::PartnerUpdateAuthority => Some(partner),
            TokenAuthorityOption::Immutable => None,
        }
    }

    pub fn get_mint_authority(&self, creator: Pubkey, partner: Pubkey) -> Option<Pubkey> {
        match *self {
            TokenAuthorityOption::CreatorUpdateAndMintAuthority => Some(creator),
            TokenAuthorityOption::PartnerUpdateAndMintAuthority => Some(partner),
            _ => None,
        }
    }
}

#[repr(u8)]
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    IntoPrimitive,
    TryFromPrimitive,
    AnchorDeserialize,
    AnchorSerialize,
)]
pub enum MigrationOption {
    MeteoraDamm,
    DammV2,
}

#[repr(u8)]
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    IntoPrimitive,
    TryFromPrimitive,
    AnchorDeserialize,
    AnchorSerialize,
)]
pub enum TokenType {
    SplToken,
    Token2022,
}

#[repr(u8)]
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    IntoPrimitive,
    TryFromPrimitive,
    AnchorDeserialize,
    AnchorSerialize,
)]
pub enum MigrationFeeOption {
    FixedBps25,   // 0.25% (0)
    FixedBps30,   // 0.3%  (1)
    FixedBps100,  // 1%    (2)
    FixedBps200,  // 2%    (3)
    FixedBps400,  // 4%    (4)
    FixedBps600,  // 6%    (5)
    Customizable, // Migration with customizable pool (6)
}

impl MigrationFeeOption {
    pub fn validate_base_fee(&self, base_fee_bps: u64) -> Result<()> {
        match *self {
            MigrationFeeOption::FixedBps25 => {
                require!(base_fee_bps == 25, PoolError::InvalidMigrationFeeOption);
            }
            MigrationFeeOption::FixedBps30 => {
                require!(base_fee_bps == 30, PoolError::InvalidMigrationFeeOption);
            }
            MigrationFeeOption::FixedBps100 => {
                require!(base_fee_bps == 100, PoolError::InvalidMigrationFeeOption);
            }
            MigrationFeeOption::FixedBps200 => {
                require!(base_fee_bps == 200, PoolError::InvalidMigrationFeeOption);
            }
            MigrationFeeOption::FixedBps400 => {
                require!(base_fee_bps == 400, PoolError::InvalidMigrationFeeOption);
            }
            MigrationFeeOption::FixedBps600 => {
                require!(base_fee_bps == 600, PoolError::InvalidMigrationFeeOption);
            }
            MigrationFeeOption::Customizable => {
                // nothing to check
            }
        }
        Ok(())
    }
}

#[account(zero_copy)]
#[derive(InitSpace, Debug, Default)]
pub struct PoolConfig {
    /// quote mint
    pub quote_mint: Pubkey,
    /// Address to get the fee
    pub fee_claimer: Pubkey,
    /// Address to receive extra base token after migration, in case token is fixed supply
    pub leftover_receiver: Pubkey,
    /// Pool fee
    pub pool_fees: PoolFeesConfig,
    // Only available for DAMM v2 migration
    pub creator_lp_vesting_info: LpVestingInfo,
    // Only available for DAMM v2 migration
    pub partner_lp_vesting_info: LpVestingInfo,
    pub padding_0: [u8; 12],
    /// Previously was protocol and referral fee percent. Beware of tombstone.
    pub padding_1: u16,
    /// Collect fee mode
    pub collect_fee_mode: u8,
    /// migration option
    pub migration_option: u8,
    /// whether mode slot or timestamp
    pub activation_type: u8,
    /// token decimals
    pub token_decimal: u8,
    /// version
    pub version: u8,
    /// token type of base token
    pub token_type: u8,
    /// quote token flag
    pub quote_token_flag: u8,
    /// partner locked lp percentage
    pub partner_locked_lp_percentage: u8,
    /// partner lp percentage
    pub partner_lp_percentage: u8,
    /// creator post migration fee percentage
    pub creator_locked_lp_percentage: u8,
    /// creator lp percentage
    pub creator_lp_percentage: u8,
    /// migration fee option
    pub migration_fee_option: u8,
    /// flag to indicate whether token is dynamic supply (0) or fixed supply (1)
    pub fixed_token_supply_flag: u8,
    /// creator trading fee percentage
    pub creator_trading_fee_percentage: u8,
    /// token update authority
    pub token_update_authority: u8,
    /// migration fee percentage
    pub migration_fee_percentage: u8,
    /// creator migration fee percentage
    pub creator_migration_fee_percentage: u8,
    pub padding_2: [u8; 7],
    /// swap base amount
    pub swap_base_amount: u64,
    /// migration quote threshold (in quote token)
    pub migration_quote_threshold: u64,
    /// migration base threshold (in base token)
    pub migration_base_threshold: u64,
    /// migration sqrt price
    pub migration_sqrt_price: u128,
    /// locked vesting config
    pub locked_vesting_config: LockedVestingConfig,
    /// pre migration token supply
    pub pre_migration_token_supply: u64,
    /// post migration token supply
    pub post_migration_token_supply: u64,
    /// migrated pool collect fee mode
    pub migrated_collect_fee_mode: u8,
    /// migrated dynamic fee option.
    pub migrated_dynamic_fee: u8,
    /// migrated pool fee in bps
    pub migrated_pool_fee_bps: u16,
    pub padding_3: [u8; 12],
    pub padding_4: u128,
    /// minimum price
    pub sqrt_start_price: u128,
    /// curve, only use 20 point firstly, we can extend that latter
    // each distribution will include curve[i].sqrt_price + curve[i+1].sqrt_price + curve[i+1].liquidity
    // for the first: sqrt_start_price + curve[0].sqrt_price + curve[0].liquidity
    pub curve: [LiquidityDistributionConfig; MAX_CURVE_POINT_CONFIG],
}

const_assert_eq!(PoolConfig::INIT_SPACE, 1040);

#[zero_copy]
#[derive(Debug, Default, InitSpace)]
pub struct LpVestingInfo {
    pub vesting_percentage: u8,
    pub cliff_duration_from_migration_time: [u8; 4], // Use [u8; N] ensure no padding
    pub bps_per_period: [u8; 2],
    pub frequency: [u8; 8],
    pub number_of_periods: [u8; 2],
}

impl LpVestingInfo {
    #[inline(always)]
    pub fn get_cliff_duration_from_migration_time(&self) -> u32 {
        u32::from_le_bytes(self.cliff_duration_from_migration_time)
    }

    #[inline(always)]
    pub fn get_bps_per_period(&self) -> u16 {
        u16::from_le_bytes(self.bps_per_period)
    }

    #[inline(always)]
    pub fn get_frequency(&self) -> u64 {
        u64::from_le_bytes(self.frequency)
    }

    #[inline(always)]
    pub fn get_number_of_periods(&self) -> u16 {
        u16::from_le_bytes(self.number_of_periods)
    }

    pub fn get_locked_percentage_at_day_one(&self) -> Result<u8> {
        let vest_bps_at_day_one = self.vest_bps_locked_at_day_one()?;
        let vesting_bps = u32::from(self.vesting_percentage).safe_mul(100)?;

        let vest_bps_at_day_one = u32::from(vest_bps_at_day_one)
            .safe_mul(vesting_bps)?
            .safe_div(10_000)?;

        let locked_percentage_at_day_one = vest_bps_at_day_one.safe_div(100)?;

        Ok(locked_percentage_at_day_one
            .try_into()
            .map_err(|_| PoolError::TypeCastFailed)?)
    }

    fn calculate_cliff_unlock_bps(&self) -> Result<u16> {
        let total_bps_after_cliff =
            u64::from(self.get_bps_per_period()).safe_mul(self.get_number_of_periods().into())?;

        let cliff_unlock_bps = 10_000u64.safe_sub(total_bps_after_cliff)?;
        Ok(cliff_unlock_bps
            .try_into()
            .map_err(|_| PoolError::TypeCastFailed)?)
    }

    fn vest_bps_locked_at_day_one(&self) -> Result<u16> {
        if self.is_none() {
            return Ok(0);
        }

        // Everything released after one day. All liquidities are locked at day one.
        if u64::from(self.get_cliff_duration_from_migration_time()) > SECONDS_PER_DAY {
            return Ok(10_000);
        }

        let period = SECONDS_PER_DAY
            .safe_sub(self.get_cliff_duration_from_migration_time().into())?
            .safe_div(self.get_frequency())?;

        let period = period.min(self.get_number_of_periods().into());

        let cliff_unlock_bps = self.calculate_cliff_unlock_bps()?;

        let bps_unlocked_at_day_one = u64::from(cliff_unlock_bps)
            .safe_add(u64::from(self.get_bps_per_period()).safe_mul(period)?)?;

        let bps_locked_at_day_one = 10_000u64.safe_sub(bps_unlocked_at_day_one)?;

        Ok(bps_locked_at_day_one
            .try_into()
            .map_err(|_| PoolError::TypeCastFailed)?)
    }

    pub fn is_none(&self) -> bool {
        self.vesting_percentage == 0
            && self.get_cliff_duration_from_migration_time() == 0
            && self.get_bps_per_period() == 0
            && self.get_frequency() == 0
            && self.get_number_of_periods() == 0
    }
}

#[zero_copy]
#[derive(InitSpace, Debug, Default)]
pub struct LiquidityDistributionConfig {
    pub sqrt_price: u128,
    pub liquidity: u128,
}

impl LiquidityDistributionConfig {
    pub fn to_liquidity_distribution_parameters(&self) -> LiquidityDistributionParameters {
        LiquidityDistributionParameters {
            sqrt_price: self.sqrt_price,
            liquidity: self.liquidity,
        }
    }
}

impl PoolConfig {
    pub fn init(
        &mut self,
        quote_mint: &Pubkey,
        fee_claimer: &Pubkey,
        leftover_receiver: &Pubkey,
        pool_fees: &PoolFeeParameters,
        creator_trading_fee_percentage: u8,
        token_update_authority: u8,
        migration_fee: MigrationFee,
        collect_fee_mode: u8,
        migration_option: u8,
        activation_type: u8,
        token_decimal: u8,
        token_type: u8,
        quote_token_flag: u8,
        partner_locked_lp_percentage: u8,
        partner_lp_percentage: u8,
        creator_locked_lp_percentage: u8,
        creator_lp_percentage: u8,
        locked_vesting_params: &LockedVestingParams,
        migration_fee_option: u8,
        swap_base_amount: u64,
        migration_quote_threshold: u64,
        migration_base_threshold: u64,
        migration_sqrt_price: u128,
        sqrt_start_price: u128,
        fixed_token_supply_flag: u8,
        pre_migration_token_supply: u64,
        post_migration_token_supply: u64,
        migrated_pool_fee_bps: u16,
        migrated_collect_fee_mode: u8,
        migrated_dynamic_fee: u8,
        partner_lp_vesting_info: LpVestingInfo,
        creator_lp_vesting_info: LpVestingInfo,
        curve: &[LiquidityDistributionParameters],
    ) {
        self.version = 0;
        self.quote_mint = *quote_mint;
        self.fee_claimer = *fee_claimer;
        self.leftover_receiver = *leftover_receiver;
        self.pool_fees = pool_fees.to_pool_fees_config();
        self.creator_trading_fee_percentage = creator_trading_fee_percentage;
        self.token_update_authority = token_update_authority;
        self.migration_fee_percentage = migration_fee.fee_percentage;
        self.creator_migration_fee_percentage = migration_fee.creator_fee_percentage;
        self.collect_fee_mode = collect_fee_mode;
        self.migration_option = migration_option;
        self.activation_type = activation_type;
        self.token_decimal = token_decimal;
        self.swap_base_amount = swap_base_amount;
        self.migration_quote_threshold = migration_quote_threshold;
        self.migration_base_threshold = migration_base_threshold;
        self.migration_sqrt_price = migration_sqrt_price;
        self.sqrt_start_price = sqrt_start_price;
        self.token_type = token_type;
        self.quote_token_flag = quote_token_flag;

        self.partner_lp_percentage = partner_lp_percentage;
        self.partner_locked_lp_percentage = partner_locked_lp_percentage;

        self.creator_lp_percentage = creator_lp_percentage;
        self.creator_locked_lp_percentage = creator_locked_lp_percentage;

        self.locked_vesting_config = locked_vesting_params.to_locked_vesting_config();
        self.migration_fee_option = migration_fee_option;
        self.fixed_token_supply_flag = fixed_token_supply_flag;
        self.pre_migration_token_supply = pre_migration_token_supply;
        self.post_migration_token_supply = post_migration_token_supply;
        self.migrated_pool_fee_bps = migrated_pool_fee_bps;
        self.migrated_collect_fee_mode = migrated_collect_fee_mode;
        self.migrated_dynamic_fee = migrated_dynamic_fee;

        for i in 0..curve.len() {
            self.curve[i] = curve[i].to_liquidity_distribution_config();
        }

        self.creator_lp_vesting_info = creator_lp_vesting_info;
        self.partner_lp_vesting_info = partner_lp_vesting_info;
    }

    pub fn get_token_authority(&self) -> Result<TokenAuthorityOption> {
        let token_authority = TokenAuthorityOption::try_from(self.token_update_authority)
            .map_err(|_| PoolError::InvalidTokenAuthorityOption)?;
        Ok(token_authority)
    }

    pub fn get_migration_quote_amount_for_config(&self) -> Result<MigrationAmount> {
        PoolConfig::get_migration_quote_amount(
            self.migration_quote_threshold,
            self.migration_fee_percentage,
        )
    }
    pub fn get_migration_quote_amount(
        migration_quote_threshold: u64,
        migration_fee_percentage: u8,
    ) -> Result<MigrationAmount> {
        let quote_amount: u64 = safe_mul_div_cast_u64(
            migration_quote_threshold,
            100.safe_sub(migration_fee_percentage.into())?,
            100,
            Rounding::Up,
        )?;
        let fee = migration_quote_threshold.safe_sub(quote_amount)?;
        Ok(MigrationAmount { quote_amount, fee })
    }

    pub fn get_migration_fee_distribution(&self) -> Result<MigrationFeeDistribution> {
        let MigrationAmount { fee, .. } = self.get_migration_quote_amount_for_config()?;

        let creator_migration_fee = safe_mul_div_cast_u64(
            fee,
            self.creator_migration_fee_percentage.into(),
            100,
            Rounding::Down,
        )?;
        let partner_migration_fee = fee.safe_sub(creator_migration_fee)?;
        Ok(MigrationFeeDistribution {
            partner_migration_fee,
            creator_migration_fee,
        })
    }

    pub fn get_swap_amount_with_buffer(
        swap_base_amount: u64,
        sqrt_start_price: u128,
        curve: &[LiquidityDistributionParameters],
    ) -> Result<u64> {
        let swap_amount_buffer = u128::from(swap_base_amount)
            .safe_mul(SWAP_BUFFER_PERCENTAGE.into())?
            .safe_div(100)?
            .safe_add(swap_base_amount.into())?;
        let max_base_amount_on_curve =
            get_base_token_for_swap(sqrt_start_price, MAX_SQRT_PRICE, &curve)?;

        if U256::from(swap_amount_buffer) < max_base_amount_on_curve {
            Ok(u64::try_from(swap_amount_buffer).map_err(|_| PoolError::MathOverflow)?)
        } else {
            Ok(max_base_amount_on_curve
                .try_into()
                .map_err(|_| PoolError::MathOverflow)?)
        }
    }
    pub fn get_total_token_supply(
        swap_base_amount: u64,
        migration_base_threshold: u64,
        locked_vesting_params: &LockedVestingParams,
    ) -> Result<u64> {
        let total_circulating_amount = swap_base_amount.safe_add(migration_base_threshold)?;
        let total_locked_vesting_amount = locked_vesting_params.get_total_amount()?;
        let total_amount = total_circulating_amount.safe_add(total_locked_vesting_amount)?;
        Ok(total_amount)
    }

    pub fn get_initial_base_supply(&self) -> Result<u64> {
        if self.is_fixed_token_supply() {
            Ok(self.pre_migration_token_supply)
        } else {
            let mut curve = vec![];
            for i in 0..MAX_CURVE_POINT_CONFIG {
                if self.curve[i].liquidity == 0 {
                    break;
                }
                curve.push(self.curve[i].to_liquidity_distribution_parameters());
            }
            let swap_amount_with_buffer = PoolConfig::get_swap_amount_with_buffer(
                self.swap_base_amount,
                self.sqrt_start_price,
                &curve,
            )?;
            PoolConfig::get_total_token_supply(
                swap_amount_with_buffer,
                self.migration_base_threshold,
                &self.locked_vesting_config.to_locked_vesting_params(),
            )
        }
    }

    fn get_max_burnable_amount_post_migration(&self) -> Result<u64> {
        if self.is_fixed_token_supply() {
            Ok(self
                .pre_migration_token_supply
                .safe_sub(self.post_migration_token_supply)?)
        } else {
            Ok(u64::MAX)
        }
    }

    /// leftover is extra base token in base vault after curve is completed
    pub fn get_burnable_amount_post_migration(&self, leftover: u64) -> Result<u64> {
        let max_burnable_amount = self.get_max_burnable_amount_post_migration()?;
        Ok(max_burnable_amount.min(leftover))
    }

    pub fn is_fixed_token_supply(&self) -> bool {
        self.fixed_token_supply_flag == 1
    }

    pub fn get_lp_distribution(&self, lp_amount: u64) -> Result<LiquidityDistributionU64> {
        let partner_locked_lp = safe_mul_div_cast_u64(
            lp_amount,
            self.partner_locked_lp_percentage.into(),
            100,
            Rounding::Down,
        )?;
        let partner_lp = safe_mul_div_cast_u64(
            lp_amount,
            self.partner_lp_percentage.into(),
            100,
            Rounding::Down,
        )?;
        let creator_locked_lp = safe_mul_div_cast_u64(
            lp_amount,
            self.creator_locked_lp_percentage.into(),
            100,
            Rounding::Down,
        )?;

        let creator_lp = lp_amount
            .safe_sub(partner_locked_lp)?
            .safe_sub(partner_lp)?
            .safe_sub(creator_locked_lp)?;
        Ok(LiquidityDistributionU64 {
            partner_locked_lp,
            partner_lp,
            creator_locked_lp,
            creator_lp,
        })
    }

    pub fn get_liquidity_distribution(&self, liquidity: u128) -> Result<LiquidityDistribution> {
        let partner_locked_lp = safe_mul_div_cast_u128(
            liquidity,
            self.partner_locked_lp_percentage.into(),
            100,
            Rounding::Down,
        )?;
        let partner_vested_lp = safe_mul_div_cast_u128(
            liquidity,
            self.partner_lp_vesting_info.vesting_percentage.into(),
            100,
            Rounding::Down,
        )?;
        let partner_lp = safe_mul_div_cast_u128(
            liquidity,
            self.partner_lp_percentage.into(),
            100,
            Rounding::Down,
        )?;
        let creator_locked_lp = safe_mul_div_cast_u128(
            liquidity,
            self.creator_locked_lp_percentage.into(),
            100,
            Rounding::Down,
        )?;
        let creator_vested_lp = safe_mul_div_cast_u128(
            liquidity,
            self.creator_lp_vesting_info.vesting_percentage.into(),
            100,
            Rounding::Down,
        )?;

        let creator_lp = liquidity
            .safe_sub(partner_locked_lp)?
            .safe_sub(partner_vested_lp)?
            .safe_sub(partner_lp)?
            .safe_sub(creator_locked_lp)?
            .safe_sub(creator_vested_lp)?;

        Ok(LiquidityDistribution {
            partner: LiquidityDistributionItem {
                unlocked_liquidity: partner_lp,
                locked_liquidity: partner_locked_lp,
                locked_lp_percentage: self.partner_locked_lp_percentage,
                vested_liquidity: partner_vested_lp,
                lp_vesting_info: self.partner_lp_vesting_info,
            },
            creator: LiquidityDistributionItem {
                unlocked_liquidity: creator_lp,
                locked_liquidity: creator_locked_lp,
                locked_lp_percentage: self.creator_locked_lp_percentage,
                vested_liquidity: creator_vested_lp,
                lp_vesting_info: self.creator_lp_vesting_info,
            },
        })
    }

    pub fn split_partner_and_creator_fee(&self, fee: u64) -> Result<PartnerAndCreatorSplitFee> {
        // early return
        if self.creator_trading_fee_percentage == 0 {
            return Ok(PartnerAndCreatorSplitFee {
                partner_fee: fee,
                creator_fee: 0,
            });
        }
        let creator_fee = safe_mul_div_cast_u64(
            fee,
            self.creator_trading_fee_percentage.into(),
            100,
            Rounding::Down,
        )?;
        let partner_fee = fee.safe_sub(creator_fee)?;
        Ok(PartnerAndCreatorSplitFee {
            partner_fee,
            creator_fee,
        })
    }

    pub fn get_total_locked_lp_percentage_at_day_one(&self) -> Result<u8> {
        let partner_locked_percentage_at_day_one = self
            .partner_lp_vesting_info
            .get_locked_percentage_at_day_one()?;
        let creator_locked_percentage_at_day_one = self
            .creator_lp_vesting_info
            .get_locked_percentage_at_day_one()?;

        let total_locked_lp_percentage_at_day_one = self
            .partner_locked_lp_percentage
            .safe_add(partner_locked_percentage_at_day_one)?
            .safe_add(self.creator_locked_lp_percentage)?
            .safe_add(creator_locked_percentage_at_day_one)?;

        Ok(total_locked_lp_percentage_at_day_one)
    }
}

pub struct PartnerAndCreatorSplitFee {
    pub partner_fee: u64,
    pub creator_fee: u64,
}

pub struct LiquidityDistributionU64 {
    pub partner_locked_lp: u64,
    pub partner_lp: u64,
    pub creator_locked_lp: u64,
    pub creator_lp: u64,
}

pub struct LiquidityDistribution {
    pub partner: LiquidityDistributionItem,
    pub creator: LiquidityDistributionItem,
}

pub struct LiquidityDistributionItem {
    pub unlocked_liquidity: u128,
    pub locked_liquidity: u128,
    pub locked_lp_percentage: u8,
    pub vested_liquidity: u128,
    pub lp_vesting_info: LpVestingInfo,
}

impl LiquidityDistributionItem {
    pub fn get_total_liquidity(&self) -> Result<u128> {
        Ok(self
            .unlocked_liquidity
            .safe_add(self.locked_liquidity)?
            .safe_add(self.vested_liquidity)?)
    }
}

pub struct MigrationAmount {
    pub quote_amount: u64,
    pub fee: u64,
}

// TODO, do we need a haircut for protocol?
pub struct MigrationFeeDistribution {
    pub partner_migration_fee: u64,
    pub creator_migration_fee: u64,
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_locked_percentage_at_day_one() {
        let cliff_duration_from_migration_time = SECONDS_PER_DAY as u32 / 2;
        let bps_per_period: u16 = 100;
        let frequency: u64 = 3600; // 1 hour

        // Total bps = 10_000
        // We want cliff to unlock 5_000 bps (50%) at day one
        let bps_after_cliff = 10_000 - 5_000;
        let number_of_periods = bps_after_cliff / bps_per_period;

        // Total unlock bps at day one = 5000 + (12 * 100) = 6200
        // Locked percentage at day one = 10000 - 6200 = 3800
        // Expected locked percentage at day one = 38%
        // Creator lock 38% of 40% at day one = 15.2% -> 15%
        let creator_lp_vesting_info = LpVestingInfo {
            vesting_percentage: 40,
            cliff_duration_from_migration_time: cliff_duration_from_migration_time.to_le_bytes(),
            bps_per_period: bps_per_period.to_le_bytes(),
            frequency: frequency.to_le_bytes(),
            number_of_periods: number_of_periods.to_le_bytes(),
        };

        let creator_lp_locked_at_day_one = creator_lp_vesting_info
            .get_locked_percentage_at_day_one()
            .unwrap();

        assert_eq!(creator_lp_locked_at_day_one, 15);

        let partner_lp_vesting_info = creator_lp_vesting_info.clone();

        let mut config = PoolConfig::default();
        config.partner_locked_lp_percentage = 1;
        config.creator_locked_lp_percentage = 1;

        config.partner_lp_vesting_info = partner_lp_vesting_info;
        config.creator_lp_vesting_info = creator_lp_vesting_info;

        let total_locked_lp_percentage_at_day_one =
            config.get_total_locked_lp_percentage_at_day_one().unwrap();

        assert_eq!(32, total_locked_lp_percentage_at_day_one);
        assert_eq!(
            creator_lp_locked_at_day_one
                + partner_lp_vesting_info
                    .get_locked_percentage_at_day_one()
                    .unwrap()
                + config.partner_locked_lp_percentage
                + config.creator_locked_lp_percentage,
            total_locked_lp_percentage_at_day_one
        );
    }
}
