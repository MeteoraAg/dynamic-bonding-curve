use crate::utils_math::sqrt_u256;
use num::integer::Roots;
use proptest::prelude::*;
use ruint::aliases::U256;

#[test]
fn test_square_root() {
    let x = sqrt_u256(U256::ZERO).unwrap();
    assert_eq!(x, U256::ZERO);

    let x = sqrt_u256(U256::from(1)).unwrap();
    assert_eq!(x, U256::from(1));

    let x = sqrt_u256(U256::from(2)).unwrap();
    assert_eq!(x, U256::from(1));

    let x = sqrt_u256(U256::from(3)).unwrap();
    assert_eq!(x, U256::from(1));

    let x = sqrt_u256(U256::from(4)).unwrap();
    assert_eq!(x, U256::from(2));
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 10000, .. ProptestConfig::default()
    })]
    #[test]
    fn test_square_root_in_u128_range(
        value in 0..=u128::MAX,
    ){
       let square_root = sqrt_u256(U256::from(value)).unwrap();
       assert_eq!(square_root, U256::from(value.sqrt())); // compare with native math
    }

    #[test]
    fn test_square_root_in_u256_range(
        value in 0..=u128::MAX,
    ){
       let multi_factor = u128::MAX;
       let original_value = U256::from(value).checked_mul(U256::from(multi_factor)).unwrap();
       let square_root = sqrt_u256(U256::from(original_value)).unwrap();

       let square_root_upper_bound = square_root.checked_add(U256::ONE).unwrap();

       let lower_bound = square_root.checked_mul(square_root).unwrap();
       let upper_bound = square_root_upper_bound.checked_mul(square_root_upper_bound).unwrap();
       assert!(original_value >= lower_bound && original_value < upper_bound);
    }
}
