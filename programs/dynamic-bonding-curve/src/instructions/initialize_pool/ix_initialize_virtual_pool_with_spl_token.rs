use anchor_lang::prelude::*;
use anchor_spl::{
    token::{Mint, MintTo, Token, TokenAccount},
    token_2022::spl_token_2022::instruction::AuthorityType,
    token_interface::{
        Mint as MintInterface, TokenAccount as TokenAccountInterface, TokenInterface,
    },
};
use std::cmp::{max, min};

use crate::{
    activation_handler::get_current_point,
    const_pda,
    constants::{
        seeds::{POOL_PREFIX, TOKEN_VAULT_PREFIX},
        MIN_LOCKED_LP_PERCENTAGE,
    },
    cpi_checker::cpi_with_account_lamport_and_owner_checking,
    process_create_token_metadata,
    state::{fee::VolatilityTracker, PoolConfig, PoolType, TokenType, VirtualPool},
    EvtInitializePool, PoolError, ProcessCreateTokenMetadataParams,
};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializePoolParameters {
    pub name: String,
    pub symbol: String,
    pub uri: String,
}

// To fix IDL generation: https://github.com/coral-xyz/anchor/issues/3209
pub fn max_key(left: &Pubkey, right: &Pubkey) -> [u8; 32] {
    max(left, right).to_bytes()
}

pub fn min_key(left: &Pubkey, right: &Pubkey) -> [u8; 32] {
    min(left, right).to_bytes()
}

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeVirtualPoolWithSplTokenCtx<'info> {
    /// Which config the pool belongs to.
    #[account(has_one = quote_mint)]
    pub config: AccountLoader<'info, PoolConfig>,

    /// CHECK: pool authority
    #[account(
        address = const_pda::pool_authority::ID
    )]
    pub pool_authority: AccountInfo<'info>,

    pub creator: Signer<'info>,

    #[account(
        init,
        signer,
        payer = payer,
        mint::decimals = config.load()?.token_decimal,
        mint::authority = pool_authority,
        mint::token_program = token_program,
    )]
    pub base_mint: Box<Account<'info, Mint>>,

    #[account(
        mint::token_program = token_quote_program,
    )]
    pub quote_mint: Box<InterfaceAccount<'info, MintInterface>>,

    /// Initialize an account to store the pool state
    #[account(
        init,
        seeds = [
            POOL_PREFIX.as_ref(),
            config.key().as_ref(),
            &max_key(&base_mint.key(), &quote_mint.key()),
            &min_key(&base_mint.key(), &quote_mint.key()),
        ],
        bump,
        payer = payer,
        space = 8 + VirtualPool::INIT_SPACE
    )]
    pub pool: AccountLoader<'info, VirtualPool>,

    /// Token a vault for the pool
    #[account(
        init,
        seeds = [
            TOKEN_VAULT_PREFIX.as_ref(),
            base_mint.key().as_ref(),
            pool.key().as_ref(),
        ],
        token::mint = base_mint,
        token::authority = pool_authority,
        token::token_program = token_program,
        payer = payer,
        bump,
    )]
    pub base_vault: Box<Account<'info, TokenAccount>>,

    /// Token b vault for the pool
    #[account(
        init,
        seeds = [
            TOKEN_VAULT_PREFIX.as_ref(),
            quote_mint.key().as_ref(),
            pool.key().as_ref(),
        ],
        token::mint = quote_mint,
        token::authority = pool_authority,
        token::token_program = token_quote_program,
        payer = payer,
        bump,
    )]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    /// CHECK: mint_metadata
    #[account(mut)]
    pub mint_metadata: UncheckedAccount<'info>,

    /// CHECK: Metadata program
    #[account(address = mpl_token_metadata::ID)]
    pub metadata_program: UncheckedAccount<'info>,

    /// Address paying to create the pool. Can be anyone
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Program to create mint account and mint tokens
    pub token_quote_program: Interface<'info, TokenInterface>,

    pub token_program: Program<'info, Token>,

    // Sysvar for program account
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_virtual_pool_with_spl_token<'c: 'info, 'info>(
    ctx: Context<'_, '_, 'c, 'info, InitializeVirtualPoolWithSplTokenCtx<'info>>,
    params: InitializePoolParameters,
) -> Result<()> {
    let config = ctx.accounts.config.load()?;

    require!(
        config.get_total_locked_lp_percentage()? >= MIN_LOCKED_LP_PERCENTAGE,
        PoolError::InvalidVestingParameters
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
    // create token metadata
    cpi_with_account_lamport_and_owner_checking(
        || {
            process_create_token_metadata(ProcessCreateTokenMetadataParams {
                system_program: ctx.accounts.system_program.to_account_info(),
                payer: ctx.accounts.payer.to_account_info(),
                pool_authority: ctx.accounts.pool_authority.to_account_info(),
                mint: ctx.accounts.base_mint.to_account_info(),
                metadata_program: ctx.accounts.metadata_program.to_account_info(),
                mint_metadata: ctx.accounts.mint_metadata.to_account_info(),
                creator: ctx.accounts.creator.to_account_info(),
                name: &name,
                symbol: &symbol,
                uri: &uri,
                pool_authority_bump: const_pda::pool_authority::BUMP,
                token_authority,
                partner: config.fee_claimer,
            })
        },
        ctx.accounts.pool_authority.to_account_info(),
    )?;

    // mint token
    let seeds = pool_authority_seeds!(const_pda::pool_authority::BUMP);
    anchor_spl::token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.base_mint.to_account_info(),
                to: ctx.accounts.base_vault.to_account_info(),
                authority: ctx.accounts.pool_authority.to_account_info(),
            },
            &[&seeds[..]],
        ),
        initial_base_supply,
    )?;

    // update mint authority
    let token_mint_authority =
        token_authority.get_mint_authority(ctx.accounts.creator.key(), config.fee_claimer.key());

    anchor_spl::token_interface::set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token_interface::SetAuthority {
                current_authority: ctx.accounts.pool_authority.to_account_info(),
                account_or_mint: ctx.accounts.base_mint.to_account_info(),
            },
            &[&seeds[..]],
        ),
        AuthorityType::MintTokens,
        token_mint_authority,
    )?;

    // init pool
    let mut pool = ctx.accounts.pool.load_init()?;

    let activation_point = get_current_point(config.activation_type)?;

    pool.initialize(
        VolatilityTracker::default(),
        ctx.accounts.config.key(),
        ctx.accounts.creator.key(),
        ctx.accounts.base_mint.key(),
        ctx.accounts.base_vault.key(),
        ctx.accounts.quote_vault.key(),
        config.sqrt_start_price,
        PoolType::SplToken.into(),
        activation_point,
        initial_base_supply,
        false,
    );

    emit_cpi!(EvtInitializePool {
        pool: ctx.accounts.pool.key(),
        config: ctx.accounts.config.key(),
        creator: ctx.accounts.creator.key(),
        base_mint: ctx.accounts.base_mint.key(),
        pool_type: PoolType::SplToken.into(),
        activation_point,
    });
    Ok(())
}
