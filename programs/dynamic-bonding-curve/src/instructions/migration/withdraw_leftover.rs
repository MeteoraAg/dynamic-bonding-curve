use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    const_pda,
    event::{EvtWithdrawLeftover, EvtWithdrawLeftoverWithTransferHook},
    remaining_accounts::{parse_transfer_hook_accounts, TransferHookAccountsInfo},
    safe_math::SafeMath,
    state::{MigrationProgress, PoolConfig, VirtualPool},
    token::transfer_token_from_pool_authority,
    PoolError,
};

/// Accounts for withdraw leftover
#[event_cpi]
#[derive(Accounts)]
pub struct WithdrawLeftoverCtx<'info> {
    /// CHECK: pool authority
    #[account(
        address = const_pda::pool_authority::ID
    )]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(has_one=leftover_receiver)]
    pub config: AccountLoader<'info, PoolConfig>,

    #[account(
        mut,
        has_one = base_mint,
        has_one = base_vault,
        has_one = config,
    )]
    pub virtual_pool: AccountLoader<'info, VirtualPool>,

    /// The receiver token account, withdraw to ATA
    #[account(mut,
        associated_token::authority = leftover_receiver,
        associated_token::mint = base_mint,
        associated_token::token_program = token_base_program
    )]
    pub token_base_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The vault token account for output token
    #[account(mut, token::token_program = token_base_program, token::mint = base_mint)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The mint of quote token
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: leftover receiver
    pub leftover_receiver: UncheckedAccount<'info>,

    /// Token base program
    pub token_base_program: Interface<'info, TokenInterface>,
}

pub fn handle_withdraw_leftover<'info>(
    ctx: Context<'info, WithdrawLeftoverCtx<'info>>,
    transfer_hook_accounts_info: TransferHookAccountsInfo,
) -> Result<()> {
    let config = ctx.accounts.config.load()?;

    let mut virtual_pool = ctx.accounts.virtual_pool.load_mut()?;
    require!(
        virtual_pool.get_migration_progress()? == MigrationProgress::CreatedPool,
        PoolError::NotPermitToDoThisAction
    );

    require!(
        config.is_fixed_token_supply(),
        PoolError::NotPermitToDoThisAction
    );

    // Ensure the leftover has never been withdrawn
    require!(
        virtual_pool.is_withdraw_leftover == 0,
        PoolError::LeftoverHasBeenWithdraw
    );

    let leftover_amount = ctx
        .accounts
        .base_vault
        .amount
        .safe_sub(virtual_pool.get_protocol_and_trading_base_fee()?)?
        .safe_sub(virtual_pool.protocol_migration_base_fee_amount)?;

    let mut remaining_accounts = ctx.remaining_accounts;
    let parsed_transfer_hook_accounts =
        parse_transfer_hook_accounts(&mut remaining_accounts, &transfer_hook_accounts_info.slices)?;

    transfer_token_from_pool_authority(
        ctx.accounts.pool_authority.to_account_info(),
        &ctx.accounts.base_mint,
        &ctx.accounts.base_vault,
        ctx.accounts.token_base_account.to_account_info(),
        &ctx.accounts.token_base_program,
        leftover_amount,
        parsed_transfer_hook_accounts.transfer_hook_base,
    )?;

    // update partner withdraw leftover
    virtual_pool.update_withdraw_leftover();

    if transfer_hook_accounts_info.has_accounts() {
        emit_cpi!(EvtWithdrawLeftoverWithTransferHook {
            pool: ctx.accounts.virtual_pool.key(),
            leftover_receiver: ctx.accounts.leftover_receiver.key(),
            leftover_amount,
        });
    } else {
        emit_cpi!(EvtWithdrawLeftover {
            pool: ctx.accounts.virtual_pool.key(),
            leftover_receiver: ctx.accounts.leftover_receiver.key(),
            leftover_amount,
        });
    }

    Ok(())
}
