use super::InitializePoolParameters;
use super::{max_key, min_key};
use crate::constants::seeds::POOL_PREFIX;
use crate::instructions::initialize_pool::process_initialize_virtual_pool_with_token2022::{
    initialize_pool_state, process_initialize_virtual_pool_with_token2022,
};
use crate::{
    const_pda,
    constants::seeds::TOKEN_VAULT_PREFIX,
    event::EvtInitializePoolWithTransferHook,
    state::{ConfigWithTransferHook, PoolType, TransferHookPool},
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
    /// Transfer hook config — contains the transfer hook program set by partner
    #[account(has_one = quote_mint)]
    pub config: AccountLoader<'info, ConfigWithTransferHook>,

    /// CHECK: pool authority
    #[account(address = const_pda::pool_authority::ID)]
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
        extensions::transfer_hook::authority = pool_authority,
        extensions::transfer_hook::program_id = config.load()?.transfer_hook_program,
    )]
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mint::token_program = token_quote_program)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

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
        space = 8 + TransferHookPool::INIT_SPACE
    )]
    pub pool: AccountLoader<'info, TransferHookPool>,

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

    /// CHECK: transfer hook program — validated against config in handler
    pub transfer_hook_program: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_quote_program: Interface<'info, TokenInterface>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_virtual_pool_with_token2022_transfer_hook(
    ctx: Context<InitializeVirtualPoolWithToken2022TransferHookCtx>,
    params: InitializePoolParameters,
) -> Result<()> {
    let config_data = ctx.accounts.config.load()?;
    let transfer_hook_program = &ctx.accounts.transfer_hook_program;
    require!(
        transfer_hook_program
            .key()
            .eq(&config_data.transfer_hook_program)
            && transfer_hook_program.executable,
        PoolError::InvalidTransferHookProgram
    );
    drop(config_data);

    let init_data = process_initialize_virtual_pool_with_token2022(
        &ctx.accounts.config.to_account_info(),
        &ctx.accounts.pool_authority,
        &ctx.accounts.creator,
        &ctx.accounts.base_mint,
        ctx.accounts.pool.to_account_info(),
        &ctx.accounts.base_vault,
        &ctx.accounts.payer,
        &ctx.accounts.token_program,
        &ctx.accounts.system_program,
        params,
    )?;

    let mut pool = ctx.accounts.pool.load_init()?;
    initialize_pool_state(
        &mut pool,
        &init_data,
        ctx.accounts.creator.key(),
        ctx.accounts.base_mint.key(),
        ctx.accounts.base_vault.key(),
        ctx.accounts.quote_vault.key(),
        PoolType::Token2022,
    );

    emit_cpi!(EvtInitializePoolWithTransferHook {
        pool: ctx.accounts.pool.key(),
        config: ctx.accounts.config.key(),
        creator: ctx.accounts.creator.key(),
        base_mint: ctx.accounts.base_mint.key(),
        pool_type: PoolType::Token2022.into(),
        activation_point: init_data.activation_point,
    });
    Ok(())
}
