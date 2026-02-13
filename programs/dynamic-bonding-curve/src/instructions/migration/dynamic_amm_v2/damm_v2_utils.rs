use std::ops::Deref;

use anchor_lang::prelude::*;
use damm_v2::types::{DynamicFeeParameters, VestingParameters};
use num_enum::{IntoPrimitive, TryFromPrimitive};

use crate::{
    constants::dynamic_fee::*, fee_math::get_fee_in_period,
    params::fee_parameters::validate_fee_fraction, safe_math::SafeMath, PoolError,
};

/// DammV2 DynamicFee
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
pub enum DammV2DynamicFee {
    Disable,
    Enable,
}

/// Collect fee mode for migrated DAMM v2 pools.
/// Separate from DBC's own CollectFeeMode (which only supports QuoteToken/OutputToken)
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
pub enum MigratedCollectFeeMode {
    QuoteToken,
    OutputToken,
    Compounding, // Compounding mode is only supported in DAMM v2, not in DBC collect fee mode
}

// https://github.com/MeteoraAg/damm-v2-sdk/blob/main/src/helpers/fee.ts#L344C23-L344C25
pub fn calculate_dynamic_fee_params(base_fee_numerator: u64) -> Result<DynamicFeeParameters> {
    let max_dynamic_fee_numerator = u128::from(base_fee_numerator)
        .safe_mul(MAX_DYNAMIC_FEE_PERCENT.into())?
        .safe_div(100)?;

    let v_fee = max_dynamic_fee_numerator
        .safe_mul(100_000_000_000)?
        .safe_sub(99_999_999_999)?;
    let variable_fee_control = v_fee.safe_div(SQUARE_VFA_BIN.into())?;

    Ok(DynamicFeeParameters {
        bin_step: BIN_STEP_BPS_DEFAULT,
        bin_step_u128: BIN_STEP_BPS_U128_DEFAULT,
        filter_period: FILTER_PERIOD_DEFAULT,
        decay_period: DECAY_PERIOD_DEFAULT,
        reduction_factor: REDUCTION_FACTOR_DEFAULT,
        max_volatility_accumulator: MAX_VOLATILITY_ACCUMULATOR,
        variable_fee_control: u32::try_from(variable_fee_control)
            .map_err(|_| PoolError::TypeCastFailed)?,
    })
}

// collect_fee_mode in damm v2 is reverse with collect_fee_mode in DBC
// DBC: 0 | QuoteToken is as the same as Damm v2: 1 : OnlyB
// DBC: 1 | OutputToken is as the same as Damm v2: 0 : BothToken
// DBC: 2 | Compounding is as the same as Damm v2: 2 : Compounding
// https://github.com/MeteoraAg/damm-v2/blob/main/programs/cp-amm/src/state/pool.rs#L41-L46
pub fn convert_migrated_collect_fee_mode_to_dammv2(dbc_collect_fee_mode: u8) -> Result<u8> {
    match dbc_collect_fee_mode {
        0 => Ok(1),
        1 => Ok(0),
        2 => Ok(2),
        _ => return Err(PoolError::InvalidCollectFeeMode.into()),
    }
}

// refer damm v2 code
// https://github.com/MeteoraAg/damm-v2/blob/main/programs/cp-amm/src/state/vesting.rs#L49
pub fn get_max_unlocked_liquidity_at_current_point(
    vesting_parameters: &VestingParameters,
    current_point: u64,
) -> Result<u128> {
    let cliff_point = get_vesting_cliff_point(vesting_parameters, current_point);
    if current_point < cliff_point {
        return Ok(0);
    }

    if vesting_parameters.period_frequency == 0 {
        return Ok(vesting_parameters.cliff_unlock_liquidity);
    }

    let period = current_point
        .safe_sub(cliff_point)?
        .safe_div(vesting_parameters.period_frequency)?;

    let period: u128 = period
        .min(vesting_parameters.number_of_period.into())
        .into();

    let unlocked_liquidity = vesting_parameters
        .cliff_unlock_liquidity
        .safe_add(period.safe_mul(vesting_parameters.liquidity_per_period)?)?;

    Ok(unlocked_liquidity)
}

fn get_vesting_cliff_point(vesting_parameters: &VestingParameters, current_point: u64) -> u64 {
    vesting_parameters.cliff_point.unwrap_or(current_point)
}

fn get_vesting_total_lock_amount(vesting_parameters: &VestingParameters) -> Result<u128> {
    let total_amount = vesting_parameters.cliff_unlock_liquidity.safe_add(
        vesting_parameters
            .liquidity_per_period
            .safe_mul(vesting_parameters.number_of_period.into())?,
    )?;

    Ok(total_amount)
}

// refer dammv2 code
// https://github.com/MeteoraAg/damm-v2/blob/main/programs/cp-amm/src/instructions/ix_lock_position.rs#L36
pub fn validate_vesting_parameters(
    vesting_parameters: &VestingParameters,
    current_point: u64,
    max_vesting_duration: u64,
) -> Result<()> {
    let cliff_point = get_vesting_cliff_point(vesting_parameters, current_point);

    require!(
        cliff_point >= current_point,
        PoolError::InvalidVestingParameters
    );

    if cliff_point == current_point {
        require!(
            vesting_parameters.number_of_period > 0,
            PoolError::InvalidVestingParameters
        );
    }

    if vesting_parameters.number_of_period > 0 {
        require!(
            vesting_parameters.period_frequency > 0 && vesting_parameters.liquidity_per_period > 0,
            PoolError::InvalidVestingParameters
        );
    }

    let vesting_duration = cliff_point.safe_sub(current_point)?.safe_add(
        vesting_parameters
            .period_frequency
            .safe_mul(vesting_parameters.number_of_period.into())?,
    )?;

    require!(
        vesting_duration <= max_vesting_duration,
        PoolError::InvalidVestingParameters
    );

    require!(
        get_vesting_total_lock_amount(vesting_parameters)? > 0,
        PoolError::InvalidVestingParameters
    );

    Ok(())
}

// https://github.com/MeteoraAg/damm-v2/blob/f36db1b7ae2b465bf3fd773594bd62528c3d51cd/programs/cp-amm/src/constants.rs#L151
pub fn get_max_fee_numerator(pool_version: u8) -> Result<u64> {
    match pool_version {
        0 => Ok(damm_v2::constants::MAX_FEE_NUMERATOR_V0),
        1 => Ok(damm_v2::constants::MAX_FEE_NUMERATOR_V1),
        // Shall not happen because pool version is retrieved from on-chain data
        _ => Err(anchor_lang::error::ErrorCode::RequireViolated.into()),
    }
}

// https://github.com/MeteoraAg/damm-v2/blob/f36db1b7ae2b465bf3fd773594bd62528c3d51cd/programs/cp-amm/src/state/fee.rs#L46
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
pub enum BaseFeeMode {
    // fee = cliff_fee_numerator - passed_period * reduction_factor
    // passed_period = (current_point - activation_point) / period_frequency
    FeeTimeSchedulerLinear,
    // fee = cliff_fee_numerator * (1-reduction_factor/10_000)^passed_period
    FeeTimeSchedulerExponential,
    // rate limiter
    RateLimiter,
    // fee = cliff_fee_numerator - passed_period * reduction_factor
    // passed_period = changed_price / sqrt_price_step_bps
    // passed_period = (current_sqrt_price - init_sqrt_price) * 10_000 / init_sqrt_price / sqrt_price_step_bps
    FeeMarketCapSchedulerLinear,
    // fee = cliff_fee_numerator * (1-reduction_factor/10_000)^passed_period
    FeeMarketCapSchedulerExponential,
}

pub struct DammV2PodAlignedFeeMarketCapScheduler(
    pub(crate) damm_v2::accounts::PodAlignedFeeMarketCapScheduler,
);

impl Deref for DammV2PodAlignedFeeMarketCapScheduler {
    type Target = damm_v2::accounts::PodAlignedFeeMarketCapScheduler;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

// https://github.com/MeteoraAg/damm-v2/blob/f36db1b7ae2b465bf3fd773594bd62528c3d51cd/programs/cp-amm/src/base_fee/fee_market_cap_scheduler.rs#L167
impl DammV2PodAlignedFeeMarketCapScheduler {
    pub fn validate(&self) -> Result<()> {
        // doesn't allow zero fee marketcap scheduler
        require!(
            self.reduction_factor > 0,
            PoolError::InvalidFeeMarketCapScheduler
        );

        require!(
            self.sqrt_price_step_bps > 0,
            PoolError::InvalidFeeMarketCapScheduler
        );

        require!(
            self.scheduler_expiration_duration > 0,
            PoolError::InvalidFeeMarketCapScheduler
        );

        require!(
            self.number_of_period > 0,
            PoolError::InvalidFeeMarketCapScheduler
        );

        let min_fee_numerator = self.get_min_base_fee_numerator()?;
        let max_fee_numerator = self.cliff_fee_numerator;
        validate_fee_fraction(min_fee_numerator, damm_v2::constants::FEE_DENOMINATOR)?;
        validate_fee_fraction(max_fee_numerator, damm_v2::constants::FEE_DENOMINATOR)?;

        require!(
            min_fee_numerator >= damm_v2::constants::MIN_FEE_NUMERATOR
                && max_fee_numerator
                    <= get_max_fee_numerator(damm_v2::constants::CURRENT_POOL_VERSION)?,
            PoolError::ExceedMaxFeeBps
        );

        Ok(())
    }

    pub fn get_min_base_fee_numerator(&self) -> Result<u64> {
        self.get_base_fee_numerator_by_period(self.number_of_period.into())
    }

    fn get_base_fee_numerator_by_period(&self, period: u64) -> Result<u64> {
        let period = period.min(self.number_of_period.into());

        let base_fee_mode =
            BaseFeeMode::try_from(self.base_fee_mode).map_err(|_| PoolError::TypeCastFailed)?;

        match base_fee_mode {
            BaseFeeMode::FeeMarketCapSchedulerLinear => {
                let fee_numerator = self
                    .cliff_fee_numerator
                    .safe_sub(self.reduction_factor.safe_mul(period)?)?;
                Ok(fee_numerator)
            }
            BaseFeeMode::FeeMarketCapSchedulerExponential => {
                let period = u16::try_from(period).map_err(|_| PoolError::MathOverflow)?;
                let fee_numerator =
                    get_fee_in_period(self.cliff_fee_numerator, self.reduction_factor, period)?;
                Ok(fee_numerator)
            }
            _ => Err(PoolError::UndeterminedError.into()),
        }
    }
}
