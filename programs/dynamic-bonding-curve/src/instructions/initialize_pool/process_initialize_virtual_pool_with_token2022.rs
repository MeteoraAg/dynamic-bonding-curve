use super::InitializePoolParameters;
use crate::constants::fee::PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS;
use crate::constants::MIN_LOCKED_LIQUIDITY_BPS;
use crate::token::transfer_lamports_from_user;
use crate::{
    activation_handler::get_current_point,
    const_pda,
    state::fee::VolatilityTracker,
    state::{PoolState, PoolType, TokenType},
    token::update_account_lamports_to_minimum_balance,
    ConfigAccountLoader, PoolError,
};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock::SECONDS_PER_DAY;
use anchor_spl::token_2022::spl_token_2022::instruction::AuthorityType;
use anchor_spl::token_2022::{mint_to, MintTo};
use anchor_spl::token_interface::spl_pod::optional_keys::OptionalNonZeroPubkey;
use anchor_spl::token_interface::{
    token_metadata_initialize, token_metadata_update_authority, Mint, TokenAccount,
    TokenMetadataInitialize,
};

pub struct InitPoolData {
    pub activation_point: u64,
    pub initial_base_supply: u64,
    pub config_key: Pubkey,
    pub sqrt_start_price: u128,
}

pub fn process_initialize_virtual_pool_with_token2022<'info>(
    config_info: &AccountInfo<'info>,
    pool_authority: &AccountInfo<'info>,
    creator: &AccountInfo<'info>,
    base_mint: &InterfaceAccount<'info, Mint>,
    pool_info: AccountInfo<'info>,
    base_vault: &InterfaceAccount<'info, TokenAccount>,
    payer: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    params: InitializePoolParameters,
) -> Result<InitPoolData> {
    let config_loader = ConfigAccountLoader::try_from(config_info)?;
    let config_key = config_loader.key();
    let config = config_loader.load()?;

    require!(
        config.get_total_liquidity_locked_bps_at_n_seconds(SECONDS_PER_DAY)?
            >= MIN_LOCKED_LIQUIDITY_BPS,
        PoolError::InvalidMigrationLockedLiquidity
    );

    // validate min base fee
    config.pool_fees.base_fee.validate_min_base_fee()?;

    let token_type_value =
        TokenType::try_from(config.token_type).map_err(|_| PoolError::InvalidTokenType)?;
    require!(
        token_type_value == TokenType::Token2022,
        PoolError::InvalidTokenType
    );

    let InitializePoolParameters { name, symbol, uri } = params;

    // initialize metadata
    let cpi_accounts = TokenMetadataInitialize {
        program_id: token_program.to_account_info(),
        mint: base_mint.to_account_info(),
        metadata: base_mint.to_account_info(),
        mint_authority: pool_authority.to_account_info(),
        update_authority: creator.to_account_info(),
    };
    let seeds = pool_authority_seeds!(const_pda::pool_authority::BUMP);
    let signer_seeds = &[&seeds[..]];
    let cpi_ctx = CpiContext::new_with_signer(token_program.key(), cpi_accounts, signer_seeds);
    token_metadata_initialize(cpi_ctx, name, symbol, uri)?;

    // transfer minimum rent to mint account
    update_account_lamports_to_minimum_balance(
        base_mint.to_account_info(),
        payer.to_account_info(),
        system_program.to_account_info(),
    )?;

    let token_authority = config.get_token_authority()?;
    // mint authority option are deprecated and no longer allowed for new pools
    require!(
        !token_authority.has_mint_authority(),
        PoolError::InvalidTokenAuthorityOption
    );

    let token_update_authority =
        token_authority.get_update_authority(creator.key(), config.fee_claimer.key());

    // set metadata pointer authority
    anchor_spl::token_interface::set_authority(
        CpiContext::new_with_signer(
            token_program.key(),
            anchor_spl::token_interface::SetAuthority {
                current_authority: pool_authority.to_account_info(),
                account_or_mint: base_mint.to_account_info(),
            },
            &[&seeds[..]],
        ),
        AuthorityType::MetadataPointer,
        token_update_authority,
    )?;

    // update token metadata update authority
    let new_update_token_metadata_authority =
        OptionalNonZeroPubkey::try_from(token_update_authority)?;

    token_metadata_update_authority(
        CpiContext::new_with_signer(
            token_program.key(),
            anchor_spl::token_interface::TokenMetadataUpdateAuthority {
                program_id: token_program.to_account_info(),
                metadata: base_mint.to_account_info(),
                current_authority: creator.to_account_info(),
                // new authority isn't actually needed as account in the CPI
                // use current authority as system_program to satisfy the struct
                // https://github.com/solana-developers/program-examples/blob/main/tokens/token-2022/metadata/anchor/programs/metadata/src/instructions/update_authority.rs
                new_authority: system_program.to_account_info(),
            },
            &[&seeds[..]],
        ),
        new_update_token_metadata_authority,
    )?;

    let initial_base_supply = config.get_initial_base_supply()?;

    // mint token
    let seeds = pool_authority_seeds!(const_pda::pool_authority::BUMP);
    mint_to(
        CpiContext::new_with_signer(
            token_program.key(),
            MintTo {
                mint: base_mint.to_account_info(),
                to: base_vault.to_account_info(),
                authority: pool_authority.to_account_info(),
            },
            &[&seeds[..]],
        ),
        initial_base_supply,
    )?;

    // revoke mint authority
    anchor_spl::token_interface::set_authority(
        CpiContext::new_with_signer(
            token_program.key(),
            anchor_spl::token_interface::SetAuthority {
                current_authority: pool_authority.to_account_info(),
                account_or_mint: base_mint.to_account_info(),
            },
            &[&seeds[..]],
        ),
        AuthorityType::MintTokens,
        None,
    )?;

    // charge pool creation fee
    if config.pool_creation_fee > 0 {
        transfer_lamports_from_user(
            payer.to_account_info(),
            pool_info,
            system_program.to_account_info(),
            config.pool_creation_fee,
        )?;
    }

    let activation_point = get_current_point(config.activation_type)?;

    Ok(InitPoolData {
        activation_point,
        initial_base_supply,
        config_key,
        sqrt_start_price: config.sqrt_start_price,
    })
}

pub fn initialize_pool_state(
    pool: &mut PoolState,
    data: &InitPoolData,
    creator: Pubkey,
    base_mint: Pubkey,
    base_vault: Pubkey,
    quote_vault: Pubkey,
    pool_type: PoolType,
) {
    pool.initialize(
        VolatilityTracker::default(),
        data.config_key,
        creator,
        base_mint,
        base_vault,
        quote_vault,
        data.sqrt_start_price,
        pool_type.into(),
        data.activation_point,
        data.initial_base_supply,
        PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS,
    );
}
