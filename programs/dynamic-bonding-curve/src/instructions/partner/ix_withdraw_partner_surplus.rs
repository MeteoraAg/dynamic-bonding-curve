use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    const_pda,
    state::{PoolConfig, VirtualPool},
    token::transfer_token_from_pool_authority,
    EvtPartnerWithdrawSurplus, PoolError,
};

/// Accounts for partner withdraw surplus
#[event_cpi]
#[derive(Accounts)]
pub struct PartnerWithdrawSurplusCtx<'info> {
    /// CHECK: pool authority
    #[account(
        address = const_pda::pool_authority::ID
    )]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(has_one = quote_mint)]
    pub config: AccountLoader<'info, PoolConfig>,

    #[account(
        mut,
        has_one = quote_vault,
        has_one = config,
    )]
    pub virtual_pool: AccountLoader<'info, VirtualPool>,

    /// The receiver token account
    #[account(mut)]
    pub token_quote_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The vault token account for output token
    #[account(mut, token::token_program = token_quote_program, token::mint = quote_mint)]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The mint of quote token
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    pub fee_claimer: Signer<'info>,

    /// Token b program
    pub token_quote_program: Interface<'info, TokenInterface>,
}

pub fn handle_partner_withdraw_surplus(ctx: Context<PartnerWithdrawSurplusCtx>) -> Result<()> {
    let config = ctx.accounts.config.load()?;
    let mut pool = ctx.accounts.virtual_pool.load_mut()?;

    // Make sure pool has been completed
    require!(
        pool.is_curve_complete(config.migration_quote_threshold),
        PoolError::NotPermitToDoThisAction
    );

    // Ensure the partner has never been withdrawn
    require!(
        pool.is_partner_withdraw_surplus == 0,
        PoolError::SurplusHasBeenWithdraw
    );
    let total_surplus = pool.get_total_surplus(config.migration_quote_threshold)?;
    let partner_surplus_amount = pool.get_partner_surplus(&config, total_surplus)?;

    transfer_token_from_pool_authority(
        ctx.accounts.pool_authority.to_account_info(),
        &ctx.accounts.quote_mint,
        &ctx.accounts.quote_vault,
        ctx.accounts.token_quote_account.to_account_info(),
        &ctx.accounts.token_quote_program,
        partner_surplus_amount,
    )?;

    // update partner withdraw surplus
    pool.update_partner_withdraw_surplus();

    emit_cpi!(EvtPartnerWithdrawSurplus {
        pool: ctx.accounts.virtual_pool.key(),
        surplus_amount: partner_surplus_amount
    });
    Ok(())
}
