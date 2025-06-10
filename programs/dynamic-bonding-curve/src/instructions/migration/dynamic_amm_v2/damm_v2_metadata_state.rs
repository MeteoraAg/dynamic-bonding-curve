#![allow(deprecated)]
use anchor_lang::prelude::*;
use static_assertions::const_assert_eq;

#[account(zero_copy)]
#[deprecated]
#[derive(InitSpace, Debug)]
pub struct MeteoraDammV2Metadata {
    /// pool
    pub virtual_pool: Pubkey,
    /// !!! BE CAREFUL to use tomestone field, previous is pool creator
    pub padding_0: [u8; 32],
    /// partner
    pub partner: Pubkey,
    /// Reserve
    pub _padding: [u8; 126],
}
// TODO add assertion
const_assert_eq!(MeteoraDammV2Metadata::INIT_SPACE, 222);
