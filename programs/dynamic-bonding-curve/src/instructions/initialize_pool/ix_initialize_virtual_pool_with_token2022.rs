use super::InitializePoolParameters;
use super::{max_key, min_key};
use crate::process_initialize_virtual_pool_with_token2022;
use crate::{
    const_pda,
    constants::seeds::{POOL_PREFIX, TOKEN_VAULT_PREFIX},
    event::EvtInitializePool,
    state::{PoolConfig, PoolType, VirtualPool},
};
use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeVirtualPoolWithToken2022Ctx<'info> {
    /// Which config the pool belongs to.
    #[account(has_one = quote_mint)]
    pub config: AccountLoader<'info, PoolConfig>,

    /// CHECK: pool authority
    #[account(
        address = const_pda::pool_authority::ID
    )]
    pub pool_authority: UncheckedAccount<'info>,

    pub creator: Signer<'info>,

    /// Unique token mint address, initialize in contract
    #[account(
        init,
        signer,
        payer = payer,
        mint::token_program = token_program,
        mint::decimals = config.load()?.token_decimal,
        mint::authority = pool_authority,
        extensions::metadata_pointer::authority = pool_authority,
        extensions::metadata_pointer::metadata_address = base_mint,
    )]
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mint::token_program = token_quote_program,
    )]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

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

    /// CHECK: Token base vault for the pool
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
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Token quote vault for the pool
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
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Address paying to create the pool. Can be anyone
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Program to create mint account and mint tokens
    pub token_quote_program: Interface<'info, TokenInterface>,
    /// token program for base mint
    pub token_program: Program<'info, Token2022>,
    // Sysvar for program account
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_virtual_pool_with_token2022<'info>(
    ctx: Context<'info, InitializeVirtualPoolWithToken2022Ctx<'info>>,
    params: InitializePoolParameters,
) -> Result<()> {
    let activation_point = process_initialize_virtual_pool_with_token2022(
        &ctx.accounts.config,
        &ctx.accounts.pool_authority,
        &ctx.accounts.creator,
        &ctx.accounts.base_mint,
        &ctx.accounts.pool,
        &ctx.accounts.base_vault,
        &ctx.accounts.quote_vault,
        &ctx.accounts.payer,
        &ctx.accounts.token_program,
        &ctx.accounts.system_program,
        params,
        PoolType::Token2022,
    )?;

    emit_cpi!(EvtInitializePool {
        pool: ctx.accounts.pool.key(),
        config: ctx.accounts.config.key(),
        creator: ctx.accounts.creator.key(),
        base_mint: ctx.accounts.base_mint.key(),
        pool_type: PoolType::Token2022.into(),
        activation_point,
    });
    Ok(())
}
