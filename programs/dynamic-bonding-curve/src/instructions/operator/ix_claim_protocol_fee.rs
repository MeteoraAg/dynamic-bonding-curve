use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    const_pda,
    safe_math::SafeMath,
    state::{ClaimFeeOperator, PoolConfig, VirtualPool},
    token::{transfer_token_from_pool_authority, validate_ata_token},
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

    /// CHECK: The treasury base account
    #[account(mut)]
    pub token_base_account: UncheckedAccount<'info>,

    /// CHECK: The treasury quote account
    #[account(mut)]
    pub token_quote_account: UncheckedAccount<'info>,

    /// Claim fee operator
    pub claim_fee_operator: AccountLoader<'info, ClaimFeeOperator>,

    /// Signer
    pub signer: Signer<'info>,

    /// Token a program
    pub token_base_program: Interface<'info, TokenInterface>,

    /// Token b program
    pub token_quote_program: Interface<'info, TokenInterface>,
}

pub fn handle_claim_protocol_fee(
    ctx: Context<ClaimProtocolFeesCtx>,
    max_base_amount: u64,
    // note: max_quote_amount is just a cap of total trading fee and migration fee, if pool has surplus we could withdraw more than max_quote_amount
    max_quote_amount: u64,
) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;

    let token_base_amount = pool.claim_protocol_base_fee(max_base_amount)?;
    if token_base_amount > 0 {
        validate_ata_token(
            &ctx.accounts.token_base_account.to_account_info(),
            &treasury::ID,
            &ctx.accounts.base_mint.key(),
            &ctx.accounts.token_base_program.key(),
        )?;
        transfer_token_from_pool_authority(
            ctx.accounts.pool_authority.to_account_info(),
            &ctx.accounts.base_mint,
            &ctx.accounts.base_vault,
            ctx.accounts.token_base_account.to_account_info(),
            &ctx.accounts.token_base_program,
            token_base_amount,
        )?;
    }

    let mut token_quote_amount = pool.claim_protocol_quote_fee(max_quote_amount)?;

    // check if pool is having surplus
    let config = ctx.accounts.config.load()?;
    if pool.is_protocol_withdraw_surplus == 0
        && pool.is_curve_complete(config.migration_quote_threshold)
    {
        // Update protocol withdraw surplus
        pool.update_protocol_withdraw_surplus();
        let protocol_surplus_amount =
            pool.get_protocol_surplus(config.migration_quote_threshold)?;
        token_quote_amount = token_quote_amount.safe_add(protocol_surplus_amount)?;
    }

    if token_quote_amount > 0 {
        validate_ata_token(
            &ctx.accounts.token_quote_account.to_account_info(),
            &treasury::ID,
            &ctx.accounts.quote_mint.key(),
            &ctx.accounts.token_quote_program.key(),
        )?;
        transfer_token_from_pool_authority(
            ctx.accounts.pool_authority.to_account_info(),
            &ctx.accounts.quote_mint,
            &ctx.accounts.quote_vault,
            ctx.accounts.token_quote_account.to_account_info(),
            &ctx.accounts.token_quote_program,
            token_quote_amount,
        )?;
    }

    emit_cpi!(EvtClaimProtocolFee {
        pool: ctx.accounts.pool.key(),
        token_base_amount,
        token_quote_amount
    });

    Ok(())
}
