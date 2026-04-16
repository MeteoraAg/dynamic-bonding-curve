use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    const_pda,
    event::{EvtClaimProtocolFee2, EvtClaimProtocolFee2WithTransferHook},
    remaining_accounts::{parse_transfer_hook_accounts, TransferHookAccountsInfo},
    state::{PoolConfig, VirtualPool},
    token::transfer_token_from_pool_authority,
    PoolError,
};

/// Accounts for claiming protocol fees via protocol_fee program
#[derive(Accounts)]
pub struct ClaimProtocolFee2Ctx<'info> {
    /// receiver token account for the claimed token. validated through the protocol_fee program
    #[account(mut)]
    pub receiver_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_base_program: Interface<'info, TokenInterface>,
    pub token_quote_program: Interface<'info, TokenInterface>,

    #[account(has_one = quote_mint)]
    pub config: AccountLoader<'info, PoolConfig>,

    #[account(
        mut,
        has_one = base_mint,
        has_one = base_vault,
        has_one = quote_vault,
        has_one = config,
    )]
    pub pool: AccountLoader<'info, VirtualPool>,

    #[account(mut)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: pool authority
    #[account(address = const_pda::pool_authority::ID)]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(address = const_pda::protocol_fee_authority::ID)]
    pub signer: Signer<'info>,
}

fn get_claim_direction_and_validate_accounts(
    pool: &VirtualPool,
    config: &PoolConfig,
    receiver_token_account: &InterfaceAccount<TokenAccount>,
    token_base_program: &Interface<TokenInterface>,
    token_quote_program: &Interface<TokenInterface>,
) -> Result<bool> {
    let receiver_token_mint = receiver_token_account.mint;
    let is_claiming_base = receiver_token_mint == pool.base_mint;

    require!(
        is_claiming_base || receiver_token_mint == config.quote_mint,
        PoolError::InvalidClaimProtocolFeeAccounts
    );

    let token_program = if is_claiming_base {
        token_base_program.key()
    } else {
        token_quote_program.key()
    };

    let receiver_token_account_ai = receiver_token_account.to_account_info();
    require!(
        *receiver_token_account_ai.owner == token_program,
        PoolError::InvalidClaimProtocolFeeAccounts
    );

    Ok(is_claiming_base)
}

/// claim protocol fees. called through the protocol_fee program
pub fn handle_claim_protocol_fee2<'info>(
    ctx: Context<'info, ClaimProtocolFee2Ctx<'info>>,
    max_amount: u64,
    transfer_hook_accounts_info: TransferHookAccountsInfo,
) -> Result<()> {
    let mut remaining_accounts = ctx.remaining_accounts;
    let parsed_transfer_hook_accounts =
        parse_transfer_hook_accounts(&mut remaining_accounts, &transfer_hook_accounts_info.slices)?;

    let config = ctx.accounts.config.load()?;
    let mut pool = ctx.accounts.pool.load_mut()?;

    let is_claiming_base = get_claim_direction_and_validate_accounts(
        &pool,
        &config,
        &ctx.accounts.receiver_token_account,
        &ctx.accounts.token_base_program,
        &ctx.accounts.token_quote_program,
    )?;

    let amount = if is_claiming_base {
        pool.claim_protocol_base_fee(max_amount)?
    } else {
        pool.claim_protocol_quote_fee_and_surplus(max_amount, config.migration_quote_threshold)?
    };

    if amount == 0 {
        return Ok(());
    }

    let (token_vault, token_mint, token_program, transfer_hook_accounts) = if is_claiming_base {
        (
            &ctx.accounts.base_vault,
            &ctx.accounts.base_mint,
            &ctx.accounts.token_base_program,
            parsed_transfer_hook_accounts.transfer_hook_base,
        )
    } else {
        (
            &ctx.accounts.quote_vault,
            &ctx.accounts.quote_mint,
            &ctx.accounts.token_quote_program,
            None,
        )
    };

    transfer_token_from_pool_authority(
        ctx.accounts.pool_authority.to_account_info(),
        token_mint,
        token_vault,
        ctx.accounts.receiver_token_account.to_account_info(),
        token_program,
        amount,
        transfer_hook_accounts,
    )?;

    if pool.is_transfer_hook_pool()? {
        emit!(EvtClaimProtocolFee2WithTransferHook {
            pool: ctx.accounts.pool.key(),
            receiver_token_account: ctx.accounts.receiver_token_account.key(),
            token_mint: token_mint.key(),
            amount,
        });
    } else {
        emit!(EvtClaimProtocolFee2 {
            pool: ctx.accounts.pool.key(),
            receiver_token_account: ctx.accounts.receiver_token_account.key(),
            token_mint: token_mint.key(),
            amount,
        });
    }

    Ok(())
}
