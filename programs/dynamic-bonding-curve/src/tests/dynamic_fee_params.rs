use crate::{
    calculate_dynamic_fee_params,
    constants::{
        dynamic_fee::{
            BIN_STEP_BPS_DEFAULT, BIN_STEP_BPS_U128_DEFAULT, MAX_DYNAMIC_FEE_PERCENT,
            MAX_VOLATILITY_ACCUMULATOR, SQUARE_VFA_BIN,
        },
        fee::FEE_DENOMINATOR,
        BASIS_POINT_MAX, ONE_Q64,
    },
    params::fee_parameters::to_numerator,
    state::{fee::VolatilityTracker, DynamicFeeConfig},
    PoolError,
};

use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 100, .. ProptestConfig::default()
    })]

    #[test]
    fn test_overflow_calculate_dynamic_fee_params(fee_bps in 10u64..10_000u64) {

            let numerator = to_numerator(fee_bps.into(), 1_000_000_000).unwrap();
            let result = calculate_dynamic_fee_params(numerator).unwrap();
            println!("{:?}", result);
    }
}

// https://github.com/MeteoraAg/damm-v2-sdk/blob/main/src/helpers/fee.ts#L344-L390
#[test]
fn test_calculate_dynamic_fee_params() {
    let max_price_change_bps: u64 = 1500; // 15%

    let price_ratio = (max_price_change_bps as f64) / (BASIS_POINT_MAX as f64) + 1.0;

    let sqrt_price_ratio_q64 = (price_ratio.sqrt() * (1u128 << 64) as f64).floor() as u128;

    let delta_bin_id = ((sqrt_price_ratio_q64 - ONE_Q64) / BIN_STEP_BPS_U128_DEFAULT) * 2;

    let max_volatility_accumulator_u128 = delta_bin_id * (BASIS_POINT_MAX as u128);

    let square_vfa_bin_u128 =
        (max_volatility_accumulator_u128 * (BIN_STEP_BPS_DEFAULT as u128)).pow(2);

    let square_vfa_bin = u64::try_from(square_vfa_bin_u128)
        .map_err(|_| PoolError::TypeCastFailed)
        .unwrap();

    let max_volatility_accumulator = u32::try_from(max_volatility_accumulator_u128)
        .map_err(|_| PoolError::TypeCastFailed)
        .unwrap();

    assert_eq!(max_volatility_accumulator, MAX_VOLATILITY_ACCUMULATOR);
    assert_eq!(square_vfa_bin, SQUARE_VFA_BIN);
}

#[test]
pub fn test_validate_dynamic_fee_params() {
    let base_fee_bps = 1000;
    let base_fee_numerator = to_numerator(base_fee_bps, FEE_DENOMINATOR.into()).unwrap();
    let dynamic_fee_params = calculate_dynamic_fee_params(base_fee_numerator).unwrap();

    let dynamic_fee_config = DynamicFeeConfig {
        initialized: 1,
        max_volatility_accumulator: dynamic_fee_params.max_volatility_accumulator,
        variable_fee_control: dynamic_fee_params.variable_fee_control,
        bin_step: dynamic_fee_params.bin_step,
        filter_period: dynamic_fee_params.filter_period,
        decay_period: dynamic_fee_params.decay_period,
        reduction_factor: dynamic_fee_params.reduction_factor,
        bin_step_u128: dynamic_fee_params.bin_step_u128,
        ..Default::default()
    };

    let volatility_tracker = VolatilityTracker {
        volatility_accumulator: u128::from(dynamic_fee_params.max_volatility_accumulator),
        ..Default::default()
    };

    let dynamic_fee_numerator = dynamic_fee_config
        .get_variable_fee_numerator(&volatility_tracker)
        .unwrap();

    let expect_dynamic_fee_numerator = u128::from(base_fee_numerator)
        .checked_mul(MAX_DYNAMIC_FEE_PERCENT.into())
        .unwrap()
        .checked_div(100)
        .unwrap();

    println!(
        "dynamic_fee_numerator: {} - expect_dynamic_fee_numerator {}",
        dynamic_fee_numerator, expect_dynamic_fee_numerator
    );

    let diff = (expect_dynamic_fee_numerator)
        .checked_sub(dynamic_fee_numerator)
        .unwrap()
        .checked_mul(100)
        .unwrap()
        .checked_div(expect_dynamic_fee_numerator)
        .unwrap();

    println!("diff {}", diff);

    // less than 1%
    assert!(diff < 1);
}
