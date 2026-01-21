use crate::{
    const_pda,
    state::{Operator, PoolConfig, VirtualPool},
    token::{get_token_program_from_flag, transfer_token_from_pool_authority, validate_ata_token},
    treasury, PoolError,
};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::ID as SYSVAR_IX_ID;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use zap_sdk::{constants::MINTS_DISALLOWED_TO_ZAP_OUT, utils::validate_zap_out_to_treasury};

/// Accounts for zap protocol fees
#[derive(Accounts)]
pub struct ZapProtocolFee<'info> {
    /// CHECK: pool authority
    #[account(address = const_pda::pool_authority::ID)]
    pub pool_authority: UncheckedAccount<'info>,

    pub config: AccountLoader<'info, PoolConfig>,

    #[account(mut, has_one = config)]
    pub pool: AccountLoader<'info, VirtualPool>,

    #[account(mut)]
    pub token_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: Receiver token account to receive the zap out fund.
    #[account(mut)]
    pub receiver_token: UncheckedAccount<'info>,

    /// zap claim fee operator
    pub operator: AccountLoader<'info, Operator>,

    /// Operator
    pub signer: Signer<'info>,

    /// Token program
    pub token_program: Interface<'info, TokenInterface>,

    /// CHECK: Sysvar Instructions account
    #[account(
        address = SYSVAR_IX_ID,
    )]
    pub sysvar_instructions: AccountInfo<'info>,
}

fn validate_accounts_and_return_withdraw_direction<'info>(
    config: &PoolConfig,
    pool: &VirtualPool,
    token_vault: &InterfaceAccount<'info, TokenAccount>,
    token_mint: &InterfaceAccount<'info, Mint>,
    token_program: &Interface<'info, TokenInterface>,
) -> Result<bool> {
    require!(
        token_mint.key() == pool.base_mint || token_mint.key() == config.quote_mint,
        PoolError::InvalidWithdrawProtocolFeeZapAccounts
    );

    let is_withdrawing_base = token_mint.key() == pool.base_mint;
    let token_mint_ai = token_mint.to_account_info();

    if is_withdrawing_base {
        require!(
            token_vault.key() == pool.base_vault,
            PoolError::InvalidWithdrawProtocolFeeZapAccounts
        );
    } else {
        require!(
            token_vault.key() == pool.quote_vault,
            PoolError::InvalidWithdrawProtocolFeeZapAccounts
        );
    }

    require!(
        *token_mint_ai.owner == token_program.key(),
        PoolError::InvalidWithdrawProtocolFeeZapAccounts
    );

    Ok(is_withdrawing_base)
}

// Rules:
// 1. If the token mint is SOL or USDC, then must withdraw to treasury using `claim_protocol_fee` endpoint. No zap out allowed.
// 2. If the token mint is not SOL or USDC, operator require to zap out to SOL or USDC or either one of the token of the pool
pub fn handle_zap_protocol_fee(ctx: Context<ZapProtocolFee>, max_amount: u64) -> Result<()> {
    let config = ctx.accounts.config.load()?;
    let mut pool = ctx.accounts.pool.load_mut()?;
    let is_withdrawing_base = validate_accounts_and_return_withdraw_direction(
        &config,
        &pool,
        &ctx.accounts.token_vault,
        &ctx.accounts.token_mint,
        &ctx.accounts.token_program,
    )?;

    require!(
        !MINTS_DISALLOWED_TO_ZAP_OUT.contains(&ctx.accounts.token_mint.key()),
        PoolError::MintRestrictedFromZap
    );

    let (amount, treasury_paired_destination_token_address) = if is_withdrawing_base {
        let base_amount = pool.claim_protocol_base_fee(max_amount)?;

        let treasury_token_quote_address = get_associated_token_address_with_program_id(
            &treasury::ID,
            &config.quote_mint,
            &get_token_program_from_flag(config.quote_token_flag)?,
        );
        (base_amount, treasury_token_quote_address)
    } else {
        let quote_amount = pool.claim_protocol_quote_fee(max_amount)?;

        let treasury_token_base_address = get_associated_token_address_with_program_id(
            &treasury::ID,
            &pool.base_mint,
            &get_token_program_from_flag(pool.pool_type)?,
        );
        (quote_amount, treasury_token_base_address)
    };

    require!(amount > 0, PoolError::AmountIsZero);

    drop(pool);

    let receiver_token_ai = ctx.accounts.receiver_token.to_account_info();

    validate_ata_token(
        &receiver_token_ai,
        &ctx.accounts.signer.key(),
        &ctx.accounts.token_mint.key(),
        &ctx.accounts.token_program.key(),
    )?;

    validate_zap_out_to_treasury(
        amount,
        crate::ID,
        &receiver_token_ai,
        &ctx.accounts.sysvar_instructions,
        treasury::ID,
        treasury_paired_destination_token_address,
    )?;

    transfer_token_from_pool_authority(
        ctx.accounts.pool_authority.to_account_info(),
        &ctx.accounts.token_mint,
        &ctx.accounts.token_vault,
        receiver_token_ai,
        &ctx.accounts.token_program,
        amount,
    )?;

    Ok(())
}
