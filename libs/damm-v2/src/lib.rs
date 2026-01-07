use anchor_lang::prelude::*;

declare_program!(damm_v2);

pub use damm_v2::*;
use num_enum::{IntoPrimitive, TryFromPrimitive};

pub fn get_max_fee_numerator(pool_version: u8) -> Result<u64> {
    match pool_version {
        0 => Ok(crate::constants::MAX_FEE_NUMERATOR_V0),
        1 => Ok(crate::constants::MAX_FEE_NUMERATOR_V1),
        // Shall not happen because pool version is retrieved from on-chain data
        _ => Err(crate::error::ErrorCode::RequireViolated.into()),
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
