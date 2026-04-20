use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    const_pda,
    event::{EvtCreatorWithdrawSurplus, EvtCreatorWithdrawSurplusWithTransferHook},
    token::transfer_token_from_pool_authority,
    ConfigAccountLoader, PoolAccountLoader, PoolError,
};

/// Accounts for creator withdraw surplus
#[event_cpi]
#[derive(Accounts)]
pub struct CreatorWithdrawSurplusCtx<'info> {
    /// CHECK: pool authority
    #[account(
        address = const_pda::pool_authority::ID
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// CHECK: Validated by ConfigAccountLoader
    pub config: UncheckedAccount<'info>,

    /// CHECK: Validated by PoolAccountLoader
    #[account(mut)]
    pub virtual_pool: UncheckedAccount<'info>,

    /// The receiver token account
    #[account(mut)]
    pub token_quote_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The vault token account for output token
    #[account(mut, token::token_program = token_quote_program, token::mint = quote_mint)]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The mint of quote token
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    pub creator: Signer<'info>,

    /// Token b program
    pub token_quote_program: Interface<'info, TokenInterface>,
}

pub fn handle_creator_withdraw_surplus(ctx: Context<CreatorWithdrawSurplusCtx>) -> Result<()> {
    let config_loader = ConfigAccountLoader::try_from(&ctx.accounts.config)?;
    let config = config_loader.load()?;
    require!(
        config.quote_mint.eq(&ctx.accounts.quote_mint.key()),
        PoolError::InvalidAccount
    );

    let pool_loader = PoolAccountLoader::try_from(&ctx.accounts.virtual_pool)?;
    let mut pool = pool_loader.load_mut()?;

    require!(
        pool.quote_vault.eq(&ctx.accounts.quote_vault.key()),
        PoolError::InvalidAccount
    );
    require!(
        pool.config.eq(&ctx.accounts.config.key()),
        PoolError::InvalidAccount
    );

    // Make sure pool has been completed
    require!(
        pool.is_curve_complete(config.migration_quote_threshold),
        PoolError::NotPermitToDoThisAction
    );

    // Ensure the creator has never been withdrawn
    require!(
        pool.is_creator_withdraw_surplus == 0,
        PoolError::SurplusHasBeenWithdraw
    );
    let total_surplus = pool.get_total_surplus(config.migration_quote_threshold)?;
    let creator_surplus_amount = pool.get_creator_surplus(&config, total_surplus)?;

    transfer_token_from_pool_authority(
        ctx.accounts.pool_authority.to_account_info(),
        &ctx.accounts.quote_mint,
        &ctx.accounts.quote_vault,
        ctx.accounts.token_quote_account.to_account_info(),
        &ctx.accounts.token_quote_program,
        creator_surplus_amount,
        None,
    )?;

    // update creator withdraw surplus
    pool.update_creator_withdraw_surplus();

    if pool_loader.is_transfer_hook_pool() {
        emit_cpi!(EvtCreatorWithdrawSurplusWithTransferHook {
            pool: ctx.accounts.virtual_pool.key(),
            surplus_amount: creator_surplus_amount
        });
    } else {
        emit_cpi!(EvtCreatorWithdrawSurplus {
            pool: ctx.accounts.virtual_pool.key(),
            surplus_amount: creator_surplus_amount
        });
    }
    Ok(())
}
