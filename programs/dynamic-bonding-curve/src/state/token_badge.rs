use anchor_lang::prelude::*;
use static_assertions::const_assert_eq;

#[account(zero_copy)]
#[derive(InitSpace, Debug)]
/// Parameter that set by the protocol
pub struct TokenBadge {
    /// token mint
    pub token_mint: Pubkey,
    /// Reserve
    pub _padding: [u8; 128],
}

const_assert_eq!(TokenBadge::INIT_SPACE, 160);
