use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    const_pda,
    event::EvtClaimProtocolFee,
    state::Operator,
    token::{transfer_token_from_pool_authority, validate_ata_token},
    treasury, ConfigAccountLoader, PoolAccountLoader, PoolError,
};

/// Accounts for withdraw protocol fees
#[event_cpi]
#[derive(Accounts)]
pub struct ClaimProtocolFeesCtx<'info> {
    /// CHECK: pool authority
    #[account(
        address = const_pda::pool_authority::ID,
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// CHECK: Validated by ConfigAccountLoader
    pub config: UncheckedAccount<'info>,

    /// CHECK: Validated by PoolAccountLoader
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,

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

    pub operator: AccountLoader<'info, Operator>,

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

    require!(
        !pool_loader.is_transfer_hook_pool(),
        PoolError::NotPermitToDoThisAction
    );

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
            None,
        )?;
    }

    let config_loader = ConfigAccountLoader::try_from(&ctx.accounts.config)?;
    let config = config_loader.load()?;
    require!(
        config.quote_mint.eq(&ctx.accounts.quote_mint.key()),
        PoolError::InvalidAccount
    );
    let token_quote_amount = pool
        .claim_protocol_quote_fee_and_surplus(max_quote_amount, config.migration_quote_threshold)?;

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
            None,
        )?;
    }

    emit_cpi!(EvtClaimProtocolFee {
        pool: ctx.accounts.pool.key(),
        token_base_amount,
        token_quote_amount
    });

    Ok(())
}
