use anchor_lang::prelude::*;
use damm_v2::types::DynamicFeeParameters;
use num_enum::{IntoPrimitive, TryFromPrimitive};

use crate::{constants::dynamic_fee::*, safe_math::SafeMath, PoolError};
/// damm v2 collect fee mode
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
pub enum Dammv2CollectFeeMode {
    BothToken,
    OnlyB,
}

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
