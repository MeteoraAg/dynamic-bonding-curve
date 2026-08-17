use anchor_lang::{prelude::*, solana_program::clock::SECONDS_PER_DAY};
use anchor_spl::{
    token::{Mint, MintTo, Token, TokenAccount},
    token_2022::spl_token_2022::instruction::AuthorityType,
};

use crate::{
    activation_handler::get_current_point,
    base_fee::BaseFeeEnumReader,
    const_pda,
    constants::{fee::PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS, MIN_LOCKED_LIQUIDITY_BPS},
    cpi_checker::cpi_with_account_lamport_and_owner_checking,
    process_create_token_metadata,
    state::{fee::VolatilityTracker, BaseFeeMode, PoolConfig, PoolType, TokenType, VirtualPool},
    token::transfer_lamports_from_user,
    InitializePoolParameters, PoolError, ProcessCreateTokenMetadataParams,
};

pub fn process_initialize_virtual_pool_with_spl_token<'info>(
    config_loader: &AccountLoader<'info, PoolConfig>,
    pool_authority: &UncheckedAccount<'info>,
    creator: &Signer<'info>,
    base_mint: &Account<'info, Mint>,
    pool_loader: &AccountLoader<'info, VirtualPool>,
    base_vault: &Account<'info, TokenAccount>,
    quote_vault: Pubkey,
    mint_metadata: &UncheckedAccount<'info>,
    metadata_program: &UncheckedAccount<'info>,
    payer: &Signer<'info>,
    token_program: &Program<'info, Token>,
    system_program: &Program<'info, System>,
    params: InitializePoolParameters,
) -> Result<u64> {
    let config = config_loader.load()?;

    require!(
        config.get_total_liquidity_locked_bps_at_n_seconds(SECONDS_PER_DAY)?
            >= MIN_LOCKED_LIQUIDITY_BPS,
        PoolError::InvalidMigrationLockedLiquidity
    );

    require!(
        config.pool_fees.base_fee.get_base_fee_mode()? != BaseFeeMode::RateLimiter,
        PoolError::DeprecatedBaseFeeMode
    );

    // validate min base fee
    config.pool_fees.base_fee.validate_min_base_fee()?;

    let initial_base_supply = config.get_initial_base_supply()?;

    let token_type_value =
        TokenType::try_from(config.token_type).map_err(|_| PoolError::InvalidTokenType)?;
    require!(
        token_type_value == TokenType::SplToken,
        PoolError::InvalidTokenType
    );

    let InitializePoolParameters { name, symbol, uri } = params;

    let token_authority = config.get_token_authority()?;
    // mint authority option are deprecated and no longer allowed for new pools
    require!(
        !token_authority.has_mint_authority(),
        PoolError::InvalidTokenAuthorityOption
    );

    // create token metadata
    cpi_with_account_lamport_and_owner_checking(
        || {
            process_create_token_metadata(ProcessCreateTokenMetadataParams {
                system_program: system_program.to_account_info(),
                payer: payer.to_account_info(),
                pool_authority: pool_authority.to_account_info(),
                mint: base_mint.to_account_info(),
                metadata_program: metadata_program.to_account_info(),
                mint_metadata: mint_metadata.to_account_info(),
                creator: creator.to_account_info(),
                name: &name,
                symbol: &symbol,
                uri: &uri,
                pool_authority_bump: const_pda::pool_authority::BUMP,
                token_authority,
                partner: config.fee_claimer,
            })
        },
        pool_authority.to_account_info(),
    )?;

    // mint token
    let seeds = pool_authority_seeds!(const_pda::pool_authority::BUMP);
    anchor_spl::token::mint_to(
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
            pool_loader.to_account_info(),
            system_program.to_account_info(),
            config.pool_creation_fee,
        )?;
    }

    // init pool
    let mut pool = pool_loader.load_init()?;

    let activation_point = get_current_point(config.activation_type)?;

    pool.initialize(
        VolatilityTracker::default(),
        config_loader.key(),
        creator.key(),
        base_mint.key(),
        base_vault.key(),
        quote_vault,
        config.sqrt_start_price,
        PoolType::SplToken.into(),
        activation_point,
        initial_base_supply,
        PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS,
    );

    Ok(activation_point)
}
