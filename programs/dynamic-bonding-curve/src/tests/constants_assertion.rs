use crate::constants::{
    dynamic_fee::{MAX_VOLATILITY_ACCUMULATOR, SQUARE_VFA_BIN},
    BASIS_POINT_MAX, BIN_STEP_BPS_DEFAULT, BIN_STEP_BPS_U128_DEFAULT,
};

#[test]
fn constants_assertion() {
    // assert square vfa bin
    let max_volatility_accumulator = u64::from(MAX_VOLATILITY_ACCUMULATOR);
    let bin_step = u64::from(BIN_STEP_BPS_DEFAULT);
    let base = max_volatility_accumulator * bin_step;

    let square_vfa_bin = base * base;

    assert_eq!(square_vfa_bin, SQUARE_VFA_BIN);

    //
    let bin_step_u128 = (u128::from(BIN_STEP_BPS_DEFAULT) << 64) / u128::from(BASIS_POINT_MAX);
    assert_eq!(bin_step_u128, BIN_STEP_BPS_U128_DEFAULT);
}
