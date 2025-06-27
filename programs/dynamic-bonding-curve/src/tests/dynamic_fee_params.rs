use crate::{
    constants::{
        dynamic_fee::{MAX_VOLATILITY_ACCUMULATOR, SQUARE_VFA_BIN},
        BASIS_POINT_MAX, BIN_STEP_BPS_DEFAULT, BIN_STEP_BPS_U128_DEFAULT, ONE_Q64,
    },
    params::fee_parameters::{calculate_dynamic_fee_params, to_numerator},
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
