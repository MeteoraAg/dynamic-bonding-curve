use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use damm_v2::accounts::ClaimFeeOperator;

use crate::{
    const_pda,
    safe_math::SafeMath,
    state::{MigrationAmount, PoolConfig, VirtualPool},
    token::transfer_from_pool,
    treasury, PoolError,
};

#[derive(Accounts)]
pub struct ClaimMigrationProtocolFeeCtx<'info> {
    #[account(
        mut,
        has_one = config,
        has_one = quote_vault,
    )]
    pub virtual_pool: AccountLoader<'info, VirtualPool>,

    #[account(mut)]
    pub quote_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        has_one = quote_mint
    )]
    pub config: AccountLoader<'info, PoolConfig>,

    /// Claim fee operator
    #[account(has_one = operator)]
    pub claim_fee_operator: AccountLoader<'info, ClaimFeeOperator>,

    /// Operator
    pub operator: Signer<'info>,

    #[account(
        mut,
        associated_token::mint = quote_mint,
        associated_token::authority = treasury::ID
    )]
    pub treasury_quote_token_account: InterfaceAccount<'info, TokenAccount>,

    pub quote_mint: InterfaceAccount<'info, Mint>,
    pub token_quote_program: Interface<'info, TokenInterface>,

    /// CHECK: pool authority
    #[account(
        address = const_pda::pool_authority::ID,
    )]
    pub pool_authority: AccountInfo<'info>,
}

pub fn handle_claim_migration_protocol_fee(
    ctx: Context<ClaimMigrationProtocolFeeCtx>,
) -> Result<()> {
    let mut virtual_pool = ctx.accounts.virtual_pool.load_mut()?;
    let config = &ctx.accounts.config.load()?;

    require!(
        config.version == PoolConfig::LATEST_VERSION,
        PoolError::InvalidVersion
    );

    require!(
        !virtual_pool.migration_protocol_fee_claimed(),
        PoolError::MigrationProtocolFeeClaimed
    );

    let MigrationAmount { quote_amount, fee } = config.get_migration_quote_amount_for_config()?;

    let creator_fee_included_quote_amount = quote_amount.safe_add(fee)?;

    let protocol_fee = config
        .migration_quote_threshold
        .safe_sub(creator_fee_included_quote_amount)?;

    if protocol_fee > 0 {
        transfer_from_pool(
            ctx.accounts.pool_authority.to_account_info(),
            &ctx.accounts.quote_mint,
            &ctx.accounts.quote_vault,
            &ctx.accounts.treasury_quote_token_account,
            &ctx.accounts.token_quote_program,
            protocol_fee,
            const_pda::pool_authority::BUMP,
        )?;
    }

    virtual_pool.update_migration_protocol_fee_claimed();

    Ok(())
}
