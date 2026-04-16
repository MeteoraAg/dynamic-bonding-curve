use super::InitializePoolParameters;
use super::{max_key, min_key};
use crate::constants::seeds::POOL_PREFIX;
use crate::process_initialize_virtual_pool_with_token2022;
use crate::{
    const_pda,
    constants::seeds::TOKEN_VAULT_PREFIX,
    event::EvtInitializePoolWithTransferHook,
    state::{PoolConfig, PoolType, VirtualPool},
    PoolError,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

/// DAMM v2 do not support mints with active transfer hooks.
/// The transfer hook program_id and authority must be revoked before migration.
#[event_cpi]
#[derive(Accounts)]
pub struct InitializeVirtualPoolWithToken2022TransferHookCtx<'info> {
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
        extensions::transfer_hook::authority = transfer_hook_authority,
        extensions::transfer_hook::program_id = transfer_hook_program,
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

    /// CHECK: transfer hook program for the base mint
    pub transfer_hook_program: UncheckedAccount<'info>,

    /// CHECK: transfer hook authority for the base mint
    pub transfer_hook_authority: UncheckedAccount<'info>,

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

pub fn handle_initialize_virtual_pool_with_token2022_transfer_hook(
    ctx: Context<InitializeVirtualPoolWithToken2022TransferHookCtx>,
    params: InitializePoolParameters,
) -> Result<()> {
    require!(
        ctx.accounts
            .transfer_hook_authority
            .key()
            .ne(&Pubkey::default()),
        PoolError::InvalidTransferHookAuthority
    );

    let transfer_hook_program = &ctx.accounts.transfer_hook_program;
    require!(
        transfer_hook_program.executable
            && transfer_hook_program.key().ne(&crate::ID)
            && transfer_hook_program
                .key()
                .ne(&ctx.accounts.token_program.key()),
        PoolError::InvalidTransferHookProgram
    );

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
    )?;

    emit_cpi!(EvtInitializePoolWithTransferHook {
        pool: ctx.accounts.pool.key(),
        config: ctx.accounts.config.key(),
        creator: ctx.accounts.creator.key(),
        base_mint: ctx.accounts.base_mint.key(),
        pool_type: PoolType::Token2022.into(),
        activation_point,
    });
    Ok(())
}
