use crate::constants::fee::{MAX_FEE_NUMERATOR, MIN_FEE_NUMERATOR};
use crate::state::PoolFeesConfig;
use proptest::prelude::*;
proptest! {
    #![proptest_config(ProptestConfig {
        cases: 10000, .. ProptestConfig::default()
    })]
    #[test]
    fn test_inverse_fee(
        excluded_fee_amount in 0..=u64::MAX/2,
        trade_fee_numerator in MIN_FEE_NUMERATOR..=MAX_FEE_NUMERATOR
    ){
        let included_fee_amount = PoolFeesConfig::get_included_fee_amount(trade_fee_numerator, excluded_fee_amount).unwrap();
        let (inverse_amount, _trading_fee) = PoolFeesConfig::get_excluded_fee_amount(trade_fee_numerator, included_fee_amount).unwrap();
        assert!(inverse_amount == excluded_fee_amount);
    }
}
