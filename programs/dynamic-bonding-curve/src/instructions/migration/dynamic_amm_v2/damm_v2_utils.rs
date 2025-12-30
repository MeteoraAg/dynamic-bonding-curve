use anchor_lang::prelude::*;
use damm_v2::types::{DynamicFeeParameters, VestingParameters};
use num_enum::{IntoPrimitive, TryFromPrimitive};

use crate::{constants::dynamic_fee::*, safe_math::SafeMath, PoolError};

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
// https://github.com/MeteoraAg/damm-v2/blob/main/programs/cp-amm/src/state/pool.rs#L41-L46
pub fn convert_collect_fee_mode_to_dammv2(dbc_collect_fee_mode: u8) -> Result<u8> {
    match dbc_collect_fee_mode {
        0 => Ok(1),
        1 => Ok(0),
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
