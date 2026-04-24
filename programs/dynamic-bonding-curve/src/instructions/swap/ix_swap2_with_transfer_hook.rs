use crate::{
    const_pda,
    event::{EvtCurveCompleteWithTransferHook, EvtSwap2WithTransferHook},
    remaining_accounts::TransferHookAccountsInfo,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use super::process_swap::{process_swap, SwapParameters2};

#[event_cpi]
#[derive(Accounts)]
pub struct SwapWithTransferHookCtx<'info> {
    /// CHECK: pool authority
    #[account(
        address = const_pda::pool_authority::ID,
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// CHECK: config account
    pub config: UncheckedAccount<'info>,

    /// CHECK: pool account - owner + discriminator (VirtualPool or TransferHookPool)
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,

    /// The user token account for input token
    #[account(mut)]
    pub input_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The user token account for output token
    #[account(mut)]
    pub output_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The vault token account for base token
    #[account(mut, token::token_program = token_base_program, token::mint = base_mint)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The vault token account for quote token
    #[account(mut, token::token_program = token_quote_program, token::mint = quote_mint)]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The mint of base token
    /// must be mutable so we can revoke the transfer hook after the last swap is performed
    #[account(mut)]
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The mint of quote token
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The user performing the swap
    pub payer: Signer<'info>,

    /// Token base program
    pub token_base_program: Interface<'info, TokenInterface>,

    /// Token quote program
    pub token_quote_program: Interface<'info, TokenInterface>,

    /// referral token account
    #[account(mut)]
    pub referral_token_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
}

pub fn handle_swap_with_transfer_hook_wrapper<'info>(
    ctx: Context<'info, SwapWithTransferHookCtx<'info>>,
    params: SwapParameters2,
    transfer_hook_accounts_info: TransferHookAccountsInfo,
) -> Result<()> {
    let output_token_account = ctx.accounts.output_token_account.to_account_info();
    let result = process_swap(
        &ctx.accounts.pool,
        &ctx.accounts.config,
        &ctx.accounts.pool_authority,
        &mut ctx.accounts.base_vault,
        &ctx.accounts.quote_vault,
        &ctx.accounts.base_mint,
        &ctx.accounts.quote_mint,
        &ctx.accounts.input_token_account,
        output_token_account,
        &ctx.accounts.payer,
        &ctx.accounts.token_base_program,
        &ctx.accounts.token_quote_program,
        &ctx.accounts.referral_token_account,
        ctx.remaining_accounts,
        params,
        transfer_hook_accounts_info,
    )?;

    emit_cpi!(EvtSwap2WithTransferHook {
        pool: ctx.accounts.pool.key(),
        config: ctx.accounts.config.key(),
        trade_direction: result.trade_direction.into(),
        has_referral: result.has_referral,
        swap_parameters: result.swap_parameters,
        swap_result: result.swap_result_2,
        quote_reserve_amount: result.quote_reserve_amount,
        migration_threshold: result.migration_threshold,
        current_timestamp: result.current_timestamp,
    });

    if let Some(data) = result.curve_complete {
        emit_cpi!(EvtCurveCompleteWithTransferHook {
            pool: ctx.accounts.pool.key(),
            config: ctx.accounts.config.key(),
            base_reserve: data.base_reserve,
            quote_reserve: data.quote_reserve,
        });
    }

    Ok(())
}
