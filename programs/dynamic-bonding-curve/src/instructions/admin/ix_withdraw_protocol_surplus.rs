use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    const_pda,
    state::{PoolConfig, VirtualPool},
    token::transfer_from_pool,
    treasury, EvtProtocolWithdrawSurplus, PoolError,
};

/// Accounts for protocol withdraw surplus
#[event_cpi]
#[derive(Accounts)]
pub struct ProtocolWithdrawSurplusCtx<'info> {
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

    /// The treasury quote token account
    #[account(
        mut,
        associated_token::authority = treasury::ID,
        associated_token::mint = quote_mint,
        associated_token::token_program = token_quote_program,
    )]
    pub token_quote_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The vault token account for quote token
    #[account(mut, token::token_program = token_quote_program, token::mint = quote_mint)]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The mint of token
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Token b program
    pub token_quote_program: Interface<'info, TokenInterface>,
}

pub fn handle_protocol_withdraw_surplus(ctx: Context<ProtocolWithdrawSurplusCtx>) -> Result<()> {
    let config = ctx.accounts.config.load()?;
    let mut pool = ctx.accounts.virtual_pool.load_mut()?;
    // Make sure pool has been completed
    require!(
        pool.is_curve_complete(config.migration_quote_threshold),
        PoolError::NotPermitToDoThisAction
    );

    // Ensure the protocol has never been withdrawn
    require!(
        pool.is_protocol_withdraw_surplus == 0,
        PoolError::SurplusHasBeenWithdraw
    );

    let protocol_surplus_amount = pool.get_protocol_surplus(config.migration_quote_threshold)?;

    transfer_from_pool(
        ctx.accounts.pool_authority.to_account_info(),
        &ctx.accounts.quote_mint,
        &ctx.accounts.quote_vault,
        &ctx.accounts.token_quote_account,
        &ctx.accounts.token_quote_program,
        protocol_surplus_amount,
        const_pda::pool_authority::BUMP,
    )?;

    // Update protocol withdraw surplus
    pool.update_protocol_withdraw_surplus();

    emit_cpi!(EvtProtocolWithdrawSurplus {
        pool: ctx.accounts.virtual_pool.key(),
        surplus_amount: protocol_surplus_amount
    });

    Ok(())
}
