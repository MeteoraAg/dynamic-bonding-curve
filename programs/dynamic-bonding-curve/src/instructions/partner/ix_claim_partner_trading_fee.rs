use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::PoolAccountLoader;
use crate::{
    const_pda,
    event::{EvtClaimTradingFee, EvtClaimTradingFeeWithTransferHook},
    remaining_accounts::{parse_transfer_hook_accounts, TransferHookAccountsInfo},
    token::transfer_token_from_pool_authority,
    ConfigAccountLoader, PoolError,
};

/// Accounts for partner to claim fees
#[event_cpi]
#[derive(Accounts)]
pub struct ClaimTradingFeesCtx<'info> {
    /// CHECK: pool authority
    #[account(
        address = const_pda::pool_authority::ID
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// CHECK: Validated by ConfigAccountLoader
    pub config: UncheckedAccount<'info>,

    /// CHECK: Validated by PoolAccountLoader
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,

    /// The treasury token a account
    #[account(mut)]
    pub token_a_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The treasury token b account
    #[account(mut)]
    pub token_b_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The vault token account for input token
    #[account(mut, token::token_program = token_base_program, token::mint = base_mint)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The vault token account for output token
    #[account(mut, token::token_program = token_quote_program, token::mint = quote_mint)]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The mint of token a
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The mint of token b
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    pub fee_claimer: Signer<'info>,

    /// Token a program
    pub token_base_program: Interface<'info, TokenInterface>,

    /// Token b program
    pub token_quote_program: Interface<'info, TokenInterface>,
}

/// Partner claim fees.
pub fn handle_claim_trading_fee<'info>(
    ctx: Context<'info, ClaimTradingFeesCtx<'info>>,
    max_base_amount: u64,
    max_quote_amount: u64,
    transfer_hook_accounts_info: TransferHookAccountsInfo,
) -> Result<()> {
    let mut remaining_accounts = ctx.remaining_accounts;
    let parsed_transfer_hook_accounts =
        parse_transfer_hook_accounts(&mut remaining_accounts, &transfer_hook_accounts_info.slices)?;

    let config_loader = ConfigAccountLoader::try_from(&ctx.accounts.config)?;
    let config = config_loader.load()?;
    require!(
        config.quote_mint.eq(&ctx.accounts.quote_mint.key()),
        PoolError::InvalidAccount
    );

    let pool_loader = PoolAccountLoader::try_from(&ctx.accounts.pool)?;
    let mut pool = pool_loader.load_mut()?;
    require!(
        pool.base_vault.eq(&ctx.accounts.base_vault.key()),
        PoolError::InvalidAccount
    );
    require!(
        pool.quote_vault.eq(&ctx.accounts.quote_vault.key()),
        PoolError::InvalidAccount
    );
    require!(
        pool.base_mint.eq(&ctx.accounts.base_mint.key()),
        PoolError::InvalidAccount
    );
    require!(
        pool.config.eq(&ctx.accounts.config.key()),
        PoolError::InvalidAccount
    );
    let (token_base_amount, token_quote_amount) =
        pool.claim_partner_trading_fee(max_base_amount, max_quote_amount)?;

    transfer_token_from_pool_authority(
        ctx.accounts.pool_authority.to_account_info(),
        &ctx.accounts.base_mint,
        &ctx.accounts.base_vault,
        ctx.accounts.token_a_account.to_account_info(),
        &ctx.accounts.token_base_program,
        token_base_amount,
        parsed_transfer_hook_accounts.transfer_hook_base,
    )?;

    transfer_token_from_pool_authority(
        ctx.accounts.pool_authority.to_account_info(),
        &ctx.accounts.quote_mint,
        &ctx.accounts.quote_vault,
        ctx.accounts.token_b_account.to_account_info(),
        &ctx.accounts.token_quote_program,
        token_quote_amount,
        None,
    )?;

    if pool_loader.is_transfer_hook_pool() {
        emit_cpi!(EvtClaimTradingFeeWithTransferHook {
            pool: ctx.accounts.pool.key(),
            token_base_amount,
            token_quote_amount
        });
    } else {
        emit_cpi!(EvtClaimTradingFee {
            pool: ctx.accounts.pool.key(),
            token_base_amount,
            token_quote_amount
        });
    }

    Ok(())
}
