use super::InitializePoolParameters;
use super::{max_key, min_key};
use crate::constants::fee::PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS;
use crate::constants::seeds::POOL_PREFIX;
use crate::instructions::initialize_pool::process_initialize_virtual_pool_with_token2022::process_initialize_virtual_pool_with_token2022;
use crate::state::fee::VolatilityTracker;
use crate::InitPoolData;
use crate::{
    const_pda,
    constants::seeds::TOKEN_VAULT_PREFIX,
    event::EvtInitializePoolWithTransferHook,
    state::{ConfigWithTransferHook, PoolType, TransferHookPool},
    token::{
        create_token_2022_base_mint, create_token_2022_base_vault,
        validate_quote_mint_with_token_badge, BaseMintTransferFee,
    },
};
use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

/// DAMM v2 do not support mints with active transfer hooks. DAMM v1 does not support token 2022 at all
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

    /// Unique token mint address, initialized in the handler
    #[account(mut)]
    pub base_mint: Signer<'info>,

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

    /// CHECK: Token base vault for the pool, initialized in the handler
    #[account(
        mut,
        seeds = [
            TOKEN_VAULT_PREFIX.as_ref(),
            base_mint.key().as_ref(),
            pool.key().as_ref(),
        ],
        bump,
    )]
    pub base_vault: UncheckedAccount<'info>,

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

    /// CHECK: transfer hook program
    #[account(executable, address = config.load()?.transfer_hook_program)]
    pub transfer_hook_program: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_quote_program: Interface<'info, TokenInterface>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_virtual_pool_with_token2022_transfer_hook<'info>(
    ctx: Context<'info, InitializeVirtualPoolWithToken2022TransferHookCtx<'info>>,
    params: InitializePoolParameters,
) -> Result<()> {
    validate_quote_mint_with_token_badge(&ctx.accounts.quote_mint, ctx.remaining_accounts.first())?;

    let config = ctx.accounts.config.load()?;
    let decimals = config.token_decimal;
    let transfer_hook_program = config.transfer_hook_program;
    let transfer_fee = BaseMintTransferFee::from_config(&config, ctx.accounts.creator.key())?;
    drop(config);

    create_token_2022_base_mint(
        &ctx.accounts.payer.to_account_info(),
        &ctx.accounts.base_mint.to_account_info(),
        &ctx.accounts.pool_authority.to_account_info(),
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        decimals,
        transfer_fee,
        Some(transfer_hook_program),
    )?;

    let base_mint_key = ctx.accounts.base_mint.key();
    let pool_key = ctx.accounts.pool.key();
    create_token_2022_base_vault(
        &ctx.accounts.payer.to_account_info(),
        &ctx.accounts.base_vault.to_account_info(),
        &ctx.accounts.base_mint.to_account_info(),
        &ctx.accounts.pool_authority.to_account_info(),
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &[
            TOKEN_VAULT_PREFIX.as_ref(),
            base_mint_key.as_ref(),
            pool_key.as_ref(),
            &[ctx.bumps.base_vault],
        ],
    )?;

    let InitPoolData {
        activation_point,
        initial_base_supply,
        sqrt_start_price,
    } = process_initialize_virtual_pool_with_token2022(
        ctx.accounts.config.as_ref(),
        &ctx.accounts.pool_authority,
        &ctx.accounts.creator,
        &ctx.accounts.base_mint.to_account_info(),
        ctx.accounts.pool.as_ref(),
        &ctx.accounts.base_vault.to_account_info(),
        &ctx.accounts.payer,
        &ctx.accounts.token_program,
        &ctx.accounts.system_program,
        params,
    )?;

    let mut pool = ctx.accounts.pool.load_init()?;
    pool.initialize(
        VolatilityTracker::default(),
        ctx.accounts.config.key(),
        ctx.accounts.creator.key(),
        ctx.accounts.base_mint.key(),
        ctx.accounts.base_vault.key(),
        ctx.accounts.quote_vault.key(),
        sqrt_start_price,
        PoolType::Token2022.into(),
        activation_point,
        initial_base_supply,
        PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS,
    );

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
