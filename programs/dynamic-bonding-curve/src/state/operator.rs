use std::ops::BitAnd;

use anchor_lang::prelude::*;
use num_enum::{IntoPrimitive, TryFromPrimitive};
use static_assertions::const_assert_eq;

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
pub enum OperatorPermission {
    ClaimProtocolFee, // 0
    ZapProtocolFee,   // 1
}

#[account(zero_copy)]
#[derive(InitSpace, Debug, Default)]
pub struct Operator {
    pub whitelisted_address: Pubkey,
    pub permission: u128,
    pub padding: [u64; 2], // padding for future use
}

const_assert_eq!(Operator::INIT_SPACE, 64);

impl Operator {
    pub fn initialize(&mut self, whitelisted_address: Pubkey, permission: u128) {
        self.whitelisted_address = whitelisted_address;
        self.permission = permission;
    }

    pub fn is_permission_allow(&self, permission: OperatorPermission) -> bool {
        let result: u128 = self
            .permission
            .bitand(1u128 << Into::<u8>::into(permission));
        result != 0
    }
}
