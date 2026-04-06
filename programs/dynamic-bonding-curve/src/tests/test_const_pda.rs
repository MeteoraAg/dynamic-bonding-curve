use crate::const_pda::{pool_authority, protocol_fee_authority};
use anchor_lang::prelude::*;

#[cfg(test)]
#[test]
fn test_const_pool_authority() {
    let (derived_pool_authority, derived_bump) = Pubkey::find_program_address(
        &[crate::constants::seeds::POOL_AUTHORITY_PREFIX],
        &crate::ID,
    );
    // derived_pool_authority = FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM
    assert_eq!(pool_authority::ID, derived_pool_authority);
    assert_eq!(pool_authority::BUMP, derived_bump);
}

#[test]
fn test_const_protocol_fee_authority() {
    let (derived_authority, derived_bump) = Pubkey::find_program_address(
        &[crate::constants::protocol_fee_program::seeds::PROTOCOL_FEE_AUTHORITY_PREFIX],
        &crate::constants::protocol_fee_program::ID,
    );
    assert_eq!(protocol_fee_authority::ID, derived_authority);
    assert_eq!(protocol_fee_authority::BUMP, derived_bump);
}
