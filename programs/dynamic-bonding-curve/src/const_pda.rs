use anchor_lang::solana_program::pubkey::Pubkey;
use const_crypto::ed25519;

pub mod pool_authority {
    use super::*;

    const POOL_AUTHORITY_AND_BUMP: ([u8; 32], u8) = ed25519::derive_program_address(
        &[crate::constants::seeds::POOL_AUTHORITY_PREFIX],
        &crate::ID_CONST.to_bytes(),
    );

    pub const ID: Pubkey = Pubkey::new_from_array(POOL_AUTHORITY_AND_BUMP.0);
    pub const BUMP: u8 = POOL_AUTHORITY_AND_BUMP.1;
}

pub mod protocol_fee_authority {
    use super::*;

    const PROTOCOL_FEE_AUTHORITY_AND_BUMP: ([u8; 32], u8) = ed25519::derive_program_address(
        &[crate::constants::protocol_fee_program::seeds::PROTOCOL_FEE_AUTHORITY_PREFIX],
        &crate::constants::protocol_fee_program::ID.to_bytes(),
    );

    pub const ID: Pubkey = Pubkey::new_from_array(PROTOCOL_FEE_AUTHORITY_AND_BUMP.0);
    pub const BUMP: u8 = PROTOCOL_FEE_AUTHORITY_AND_BUMP.1;
}
