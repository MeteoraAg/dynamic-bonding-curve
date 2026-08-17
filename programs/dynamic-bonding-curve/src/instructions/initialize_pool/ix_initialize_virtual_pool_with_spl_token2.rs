use anchor_lang::prelude::*;
use anchor_spl::{
    token::{Mint, Token, TokenAccount},
    token_interface::{
        Mint as MintInterface, TokenAccount as TokenAccountInterface, TokenInterface,
    },
};

use super::{max_key, min_key, InitializePoolParameters};
use crate::{
    const_pda,
    constants::seeds::{POOL_PREFIX, TOKEN_VAULT_PREFIX},
    event::EvtInitializePool,
    instructions::initialize_pool::process_initialize_virtual_pool_with_spl_token::process_initialize_virtual_pool_with_spl_token,
    state::{PoolConfig, PoolType, TokenBadge, VirtualPool},
    token::validate_quote_mint_with_token_badge,
};

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeVirtualPoolWithSplTokenV2Ctx<'info> {
    /// Which config the pool belongs to.
    #[account(has_one = quote_mint)]
    pub config: AccountLoader<'info, PoolConfig>,

    /// CHECK: pool authority
    #[account(
        address = const_pda::pool_authority::ID
    )]
    pub pool_authority: UncheckedAccount<'info>,

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

    /// token badge for quote mint, required when quote mint is not permissionless-supported
    pub token_badge: Option<AccountLoader<'info, TokenBadge>>,

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

pub fn handle_initialize_virtual_pool_with_spl_token2<'info>(
    ctx: Context<'info, InitializeVirtualPoolWithSplTokenV2Ctx<'info>>,
    params: InitializePoolParameters,
) -> Result<()> {
    validate_quote_mint_with_token_badge(&ctx.accounts.quote_mint, &ctx.accounts.token_badge)?;

    let activation_point = process_initialize_virtual_pool_with_spl_token(
        &ctx.accounts.config,
        &ctx.accounts.pool_authority,
        &ctx.accounts.creator,
        &ctx.accounts.base_mint,
        &ctx.accounts.pool,
        &ctx.accounts.base_vault,
        ctx.accounts.quote_vault.key(),
        &ctx.accounts.mint_metadata,
        &ctx.accounts.metadata_program,
        &ctx.accounts.payer,
        &ctx.accounts.token_program,
        &ctx.accounts.system_program,
        params,
    )?;

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
