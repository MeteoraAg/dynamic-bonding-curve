use crate::{
    constants::fee::{MAX_BASIS_POINT, PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS},
    error::PoolError,
    migration,
    safe_math::SafeMath,
    state::{MigrationAmount, MigrationOption},
    token::transfer_token_from_pool_authority,
    u128x128_math::Rounding,
    utils_math::safe_mul_div_cast_u128,
    EvtClaimProtocolLiquidityMigrationFee,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    const_pda,
    state::{ClaimFeeOperator, MigrationProgress, PoolConfig, VirtualPool},
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

    let config = ctx.accounts.config.load()?;
    let migration_option = MigrationOption::try_from(config.migration_option)
        .map_err(|_| PoolError::TypeCastFailed)?;

    let (base_amount, quote_amount) = match migration_option {
        MigrationOption::DammV2 => calculate_damm_v2_protocol_liquidity_fee_tokens(&config, &pool)?,
        MigrationOption::MeteoraDamm => {
            calculate_damm_protocol_liquidity_fee_tokens(&config, &pool)?
        }
    };

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

fn calculate_damm_protocol_liquidity_fee_tokens(
    config: &PoolConfig,
    pool: &VirtualPool,
) -> Result<(u64, u64)> {
    let sqrt_price = config.migration_sqrt_price;
    let base_reserve = config.migration_base_threshold;

    let MigrationAmount { quote_amount, .. } = config.get_migration_quote_amount_for_config()?;

    let (base_amount, quote_amount) = migration::meteora_damm::get_protocol_liquidity_fee_tokens(
        base_reserve,
        quote_amount,
        sqrt_price,
        pool.protocol_liquidity_migration_fee_bps,
    )?;

    Ok((base_amount, quote_amount))
}

fn calculate_damm_v2_protocol_liquidity_fee_tokens(
    config: &PoolConfig,
    pool: &VirtualPool,
) -> Result<(u64, u64)> {
    let protocol_and_partner_base_fee = pool.get_protocol_and_trading_base_fee()?;
    let migration_sqrt_price = config.migration_sqrt_price;

    let MigrationAmount { quote_amount, .. } = config.get_migration_quote_amount_for_config()?;

    let initial_base_supply_amount = config.get_initial_base_supply()?;

    let excluded_fee_base_reserve =
        initial_base_supply_amount.safe_sub(protocol_and_partner_base_fee)?;

    let initial_liquidity = migration::dynamic_amm_v2::get_liquidity_for_adding_liquidity(
        excluded_fee_base_reserve,
        quote_amount,
        migration_sqrt_price,
    )?;

    let protocol_liquidity_fee = safe_mul_div_cast_u128(
        initial_liquidity,
        PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS.into(),
        MAX_BASIS_POINT.into(),
        Rounding::Down,
    )?;

    let (base_amount, quote_amount) = migration::dynamic_amm_v2::get_protocol_liquidity_fee_tokens(
        protocol_liquidity_fee,
        migration_sqrt_price,
        Rounding::Down,
    )?;

    Ok((base_amount, quote_amount))
}
