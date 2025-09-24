use anchor_lang::{prelude::*, solana_program::program_pack::Pack};
use anchor_spl::{
    token_2022::spl_token_2022::extension::ExtensionType, token_interface::find_mint_account_size,
};

use crate::safe_math::SafeMath;

// https://github.com/metaplex-foundation/mpl-token-metadata/blob/a7ee5e17ed60feaafeaa5582a4f46d9317c1b412/programs/token-metadata/program/src/state/fee.rs#L17
// pub fn get_create_fee() -> Result<u64, ProgramError> {
//     let rent = Rent::get()?.minimum_balance(CREATE_FEE_SCALAR);
//     // 0.00999456 + 0.00000544 = 0.01
//     Ok(rent
//         .checked_add(CREATE_FEE_OFFSET)
//         .ok_or(MetadataError::NumericalOverflowError)?)
// }
const METAPLEX_FEE_LAMPORTS: u64 = 10_000_000;
// https://github.com/metaplex-foundation/mpl-token-metadata/blob/a7ee5e17ed60feaafeaa5582a4f46d9317c1b412/programs/token-metadata/program/src/state/metadata.rs#L22
const METAPLEX_METADATA_ACCOUNT_LEN: usize = 607;
// Note: Do not alter the value of https://github.com/MeteoraAg/damm-v2/blob/e9ffd023db1974d7a91c24e3b1c58916397bf5ae/programs/cp-amm/src/instructions/ix_create_position.rs#L140
// TVL of metadata can be computed with
// add_type_and_length_to_len(get_instance_packed_len(&token_metadata).unwrap());
const DAMM_V2_METADATA_TVL: usize = 195;

fn get_token_account_rent() -> Result<u64> {
    Ok(Rent::get()?.minimum_balance(anchor_spl::token::spl_token::state::Account::LEN))
}

fn get_mint_account_rent() -> Result<u64> {
    Ok(Rent::get()?.minimum_balance(anchor_spl::token::spl_token::state::Mint::LEN))
}

pub struct MeteoraDammV2MigrationFeeCalculator;

impl MeteoraDammV2MigrationFeeCalculator {
    pub const NFT_MINT_EXTENSIONS: [ExtensionType; 2] = [
        ExtensionType::MetadataPointer,
        ExtensionType::MintCloseAuthority,
    ];

    pub fn get_initialize_pool_rent() -> Result<u64> {
        let pool_rent = Self::get_pool_rent()?;
        let position_rent = Self::get_create_position_rent()?;

        let token_a_vault_rent = Self::get_token_account_rent()?;
        let token_b_vault_rent = Self::get_token_account_rent()?;

        let init_pool_rent = pool_rent
            .safe_add(position_rent)?
            .safe_add(token_a_vault_rent)?
            .safe_add(token_b_vault_rent)?;

        Ok(init_pool_rent)
    }

    pub fn get_create_position_rent() -> Result<u64> {
        let nft_mint_rent = Self::get_nft_mint_rent()?;
        let nft_account_rent = Self::get_nft_account_rent()?;
        let position_rent = Self::get_position_rent()?;

        let total_rent_required = nft_mint_rent
            .safe_add(nft_account_rent)?
            .safe_add(position_rent)?;
        Ok(total_rent_required)
    }

    pub fn get_nft_mint_rent() -> Result<u64> {
        let space = find_mint_account_size(Some(&Self::NFT_MINT_EXTENSIONS.to_vec()))?
            .safe_add(DAMM_V2_METADATA_TVL)?;
        Ok(Rent::get()?.minimum_balance(space))
    }

    pub fn get_nft_account_rent() -> Result<u64> {
        let required_extensions =
            ExtensionType::get_required_init_account_extensions(&Self::NFT_MINT_EXTENSIONS);
        let space = ExtensionType::try_calculate_account_len::<
            anchor_spl::token_2022::spl_token_2022::state::Account,
        >(&required_extensions)?;
        Ok(Rent::get()?.minimum_balance(space))
    }

    pub fn get_pool_rent() -> Result<u64> {
        // Fine to use std::mem::size_of here since it used zero copy (no padding allowed)
        Ok(Rent::get()?.minimum_balance(8 + std::mem::size_of::<damm_v2::accounts::Pool>()))
    }

    pub fn get_position_rent() -> Result<u64> {
        // Fine to use std::mem::size_of here since it used zero copy (no padding allowed)
        Ok(Rent::get()?.minimum_balance(8 + std::mem::size_of::<damm_v2::accounts::Position>()))
    }

    pub fn get_token_account_rent() -> Result<u64> {
        get_token_account_rent()
    }
}

pub struct MeteoraDammMigrationFeeCalculator;

impl MeteoraDammMigrationFeeCalculator {
    pub fn get_initialize_pool_rent() -> Result<u64> {
        let pool_rent = Self::get_pool_rent()?;
        let lp_mint_rent = Self::get_mint_rent()?;
        let a_vault_lp_rent = Self::get_token_account_rent()?;
        let b_vault_lp_rent = Self::get_token_account_rent()?;
        let payer_lp_rent = Self::get_token_account_rent()?;
        let protocol_token_a_fee_rent = Self::get_token_account_rent()?;
        let protocol_token_b_fee_rent = Self::get_token_account_rent()?;
        let metadata_rent = Self::get_metadata_rent()?;

        let total_rent_required = pool_rent
            .safe_add(lp_mint_rent)?
            .safe_add(a_vault_lp_rent)?
            .safe_add(b_vault_lp_rent)?
            .safe_add(payer_lp_rent)?
            .safe_add(protocol_token_a_fee_rent)?
            .safe_add(protocol_token_b_fee_rent)?
            .safe_add(metadata_rent)?;
        Ok(total_rent_required)
    }

    pub fn get_pool_rent() -> Result<u64> {
        // Currently DAMM rent more space than intended
        Ok(Rent::get()?.minimum_balance(8 + std::mem::size_of::<dynamic_amm::accounts::Pool>()))
    }

    pub fn get_mint_rent() -> Result<u64> {
        get_mint_account_rent()
    }

    pub fn get_token_account_rent() -> Result<u64> {
        get_token_account_rent()
    }

    pub fn get_metadata_rent() -> Result<u64> {
        let create_fee = METAPLEX_FEE_LAMPORTS;
        let metadata_account_rent = Rent::get()?.minimum_balance(METAPLEX_METADATA_ACCOUNT_LEN);
        Ok(create_fee.safe_add(metadata_account_rent)?)
    }
}
