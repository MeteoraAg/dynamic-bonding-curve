use crate::{
    constants::MAX_OPERATION,
    state::operator::{Operator, OperatorPermission},
};

#[test]
fn test_initialize_with_full_permission() {
    let permission: u128 = 0b11;
    assert!(permission >= 1 << (MAX_OPERATION - 1) && permission <= 1 << MAX_OPERATION);

    let operator = Operator {
        permission,
        ..Default::default()
    };

    assert_eq!(
        operator.is_permission_allow(OperatorPermission::ZapProtocolFee),
        true
    );

    assert_eq!(
        operator.is_permission_allow(OperatorPermission::ClaimProtocolFee),
        true
    );
}

#[test]
fn test_is_permission_not_allow() {
    let operator = Operator {
        permission: 0b01,
        ..Default::default()
    };
    assert_eq!(
        operator.is_permission_allow(OperatorPermission::ZapProtocolFee),
        false
    );

    let operator = Operator {
        permission: 0b10,
        ..Default::default()
    };
    assert_eq!(
        operator.is_permission_allow(OperatorPermission::ClaimProtocolFee),
        false
    );
}
