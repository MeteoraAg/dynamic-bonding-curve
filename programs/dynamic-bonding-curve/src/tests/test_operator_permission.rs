use crate::{
    bits::bitmask_max,
    state::operator::{Operator, OperatorPermission},
};

#[test]
fn test_initialize_with_full_permission() {
    let permission: u128 = bitmask_max(OperatorPermission::VARIANT_COUNT);
    assert_eq!(permission, 0b1111);

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

    assert_eq!(
        operator.is_permission_allow(OperatorPermission::CreateTokenBadge),
        true
    );

    assert_eq!(
        operator.is_permission_allow(OperatorPermission::CloseTokenBadge),
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
