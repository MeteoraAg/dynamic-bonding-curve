use crate::{
    error::PoolError, token::transfer_token_from_pool_authority,
    EvtClaimProtocolLiquidityMigrationFee,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    const_pda,
    state::{ClaimFeeOperator, MigrationProgress, VirtualPool},
    treasury,
};

/// Accounts for withdraw protocol fees
#[event_cpi]
#[derive(Accounts)]
pub struct ClaimProtocolLiquidityMigrationFeesCtx<'info> {
    /// CHECK: pool authority
    #[account(
        address = const_pda::pool_authority::ID,
    )]
    pub pool_authority: AccountInfo<'info>,

    #[account(mut, has_one = base_vault, has_one = quote_vault, has_one = base_mint)]
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

pub fn handle_claim_protocol_liquidity_migration_fee(
    ctx: Context<ClaimProtocolLiquidityMigrationFeesCtx>,
) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;

    require!(
        pool.eligible_to_withdraw_protocol_migration_fee(),
        PoolError::NotPermitToDoThisAction
    );

    let migration_progress = pool.get_migration_progress()?;

    require!(
        migration_progress == MigrationProgress::CreatedPool,
        PoolError::PoolIsIncompleted
    );

    let base_amount = pool.protocol_liquidity_migration_base_fee_amount;
    let quote_amount = pool.protocol_liquidity_migration_quote_fee_amount;

    pool.update_protocol_withdraw_migration_fee();

    if base_amount > 0 {
        transfer_token_from_pool_authority(
            ctx.accounts.pool_authority.to_account_info(),
            &ctx.accounts.base_mint,
            &ctx.accounts.base_vault,
            &ctx.accounts.token_base_account,
            &ctx.accounts.token_base_program,
            base_amount,
        )?;
    }

    if quote_amount > 0 {
        transfer_token_from_pool_authority(
            ctx.accounts.pool_authority.to_account_info(),
            &ctx.accounts.quote_mint,
            &ctx.accounts.quote_vault,
            &ctx.accounts.token_quote_account,
            &ctx.accounts.token_quote_program,
            quote_amount,
        )?;
    }

    emit_cpi!(EvtClaimProtocolLiquidityMigrationFee {
        pool: ctx.accounts.pool.key(),
        token_base_amount: base_amount,
        token_quote_amount: quote_amount
    });

    Ok(())
}
