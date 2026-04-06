use crate::{
    activation_handler::get_current_point, utils::activation_handler::ActivationType, PoolError,
};
use std::convert::TryFrom;

#[test]
fn test_activation_type_conversion() {
    // Test ActivationType enum conversion
    assert_eq!(ActivationType::Slot as u8, 0);
    assert_eq!(ActivationType::Timestamp as u8, 1);

    assert_eq!(ActivationType::try_from(0).unwrap(), ActivationType::Slot);
    assert_eq!(
        ActivationType::try_from(1).unwrap(),
        ActivationType::Timestamp
    );
    assert!(ActivationType::try_from(2).is_err());
}

#[test]
fn test_get_current_point_invalid_type() {
    // Test with invalid activation type
    let result = get_current_point(2); // Invalid type
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), PoolError::InvalidActivationType.into());
}

// Note: We cannot directly test get_current_point with slot/timestamp
// as it requires access to the Clock sysvar which is not available in unit tests.
// These tests should be done in integration tests or program tests instead.
