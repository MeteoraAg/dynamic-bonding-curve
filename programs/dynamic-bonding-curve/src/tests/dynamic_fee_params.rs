use proptest::prelude::*;

use crate::calculate_dynamic_fee_params;
use crate::params::fee_parameters::to_numerator;
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
