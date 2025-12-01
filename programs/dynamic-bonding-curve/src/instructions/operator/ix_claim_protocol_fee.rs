use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    const_pda,
    state::{ClaimFeeOperator, PoolConfig, VirtualPool},
    token::transfer_from_pool,
    treasury, EvtClaimProtocolFee,
};

/// Accounts for withdraw protocol fees
#[event_cpi]
#[derive(Accounts)]
pub struct ClaimProtocolFeesCtx<'info> {
    /// CHECK: pool authority
    #[account(
        address = const_pda::pool_authority::ID,
    )]
    pub pool_authority: AccountInfo<'info>,

    #[account(has_one=quote_mint)]
    pub config: AccountLoader<'info, PoolConfig>,

    #[account(mut, has_one = base_vault, has_one = quote_vault, has_one = base_mint, has_one = config)]
    pub pool: AccountLoader<'info, VirtualPool>,

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

    /// The treasury token a account
    #[account(
        mut,
        associated_token::authority = treasury::ID,
        associated_token::mint = base_mint,
        associated_token::token_program = token_base_program,
    )]
    pub token_base_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The treasury token b account
    #[account(
        mut,
        associated_token::authority = treasury::ID,
        associated_token::mint = quote_mint,
        associated_token::token_program = token_quote_program,
    )]
    pub token_quote_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Claim fee operator
    pub claim_fee_operator: AccountLoader<'info, ClaimFeeOperator>,

    /// Signer
    pub signer: Signer<'info>,

    /// Token a program
    pub token_base_program: Interface<'info, TokenInterface>,

    /// Token b program
    pub token_quote_program: Interface<'info, TokenInterface>,
}

/// Withdraw protocol fees. Permissionless.
pub fn handle_claim_protocol_fee(ctx: Context<ClaimProtocolFeesCtx>) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;

    let (token_base_amount, token_quote_amount) = pool.claim_protocol_fee();

    transfer_from_pool(
        ctx.accounts.pool_authority.to_account_info(),
        &ctx.accounts.base_mint,
        &ctx.accounts.base_vault,
        &ctx.accounts.token_base_account,
        &ctx.accounts.token_base_program,
        token_base_amount,
        const_pda::pool_authority::BUMP,
    )?;

    transfer_from_pool(
        ctx.accounts.pool_authority.to_account_info(),
        &ctx.accounts.quote_mint,
        &ctx.accounts.quote_vault,
        &ctx.accounts.token_quote_account,
        &ctx.accounts.token_quote_program,
        token_quote_amount,
        const_pda::pool_authority::BUMP,
    )?;

    emit_cpi!(EvtClaimProtocolFee {
        pool: ctx.accounts.pool.key(),
        token_base_amount,
        token_quote_amount
    });

    Ok(())
}
