use std::u64;

use crate::instruction::Swap as SwapInstruction;
use crate::math::safe_math::SafeMath;
use crate::state::MigrationProgress;
use crate::swap::swap_exact_in::process_swap_exact_in;
use crate::swap::swap_exact_out::process_swap_exact_out;
use crate::swap::swap_partial_fill::process_swap_partial_fill;
use crate::swap::{ProcessSwapParams, ProcessSwapResult};
use crate::{
    activation_handler::get_current_point,
    const_pda,
    params::swap::TradeDirection,
    state::fee::FeeMode,
    state::{PoolConfig, VirtualPool},
    token::{transfer_from_pool, transfer_from_user},
    EvtSwap, PoolError,
};
use crate::{EvtCurveComplete, EvtSwap2};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{
    get_processed_sibling_instruction, get_stack_height,
};
use anchor_lang::solana_program::sysvar;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use num_enum::{FromPrimitive, IntoPrimitive};

// only be use for swap exact in
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SwapParameters {
    pub amount_in: u64,
    pub minimum_amount_out: u64,
}

// can be used for different swap_mode
#[derive(AnchorSerialize, AnchorDeserialize, Default)]
pub struct SwapParameters2 {
    /// When it's exact in, partial fill, this will be amount_in. When it's exact out, this will be amount_out
    pub amount_0: u64,
    /// When it's exact in, partial fill, this will be minimum_amount_out. When it's exact out, this will be maximum_amount_in
    pub amount_1: u64,
    /// Swap mode, refer [SwapMode]
    pub swap_mode: u8,
}

#[repr(u8)]
#[derive(
    Clone, Copy, Debug, PartialEq, IntoPrimitive, FromPrimitive, AnchorDeserialize, AnchorSerialize,
)]
pub enum SwapMode {
    #[num_enum(default)]
    ExactIn,
    PartialFill,
    ExactOut,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SwapCtx<'info> {
    /// CHECK: pool authority
    #[account(
        address = const_pda::pool_authority::ID,
    )]
    pub pool_authority: AccountInfo<'info>,

    /// config key
    pub config: AccountLoader<'info, PoolConfig>,

    /// Pool account
    #[account(mut, has_one = base_vault, has_one = quote_vault, has_one = config)]
    pub pool: AccountLoader<'info, VirtualPool>,

    /// The user token account for input token
    #[account(mut)]
    pub input_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The user token account for output token
    #[account(mut)]
    pub output_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The vault token account for base token
    #[account(mut, token::token_program = token_base_program, token::mint = base_mint)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The vault token account for quote token
    #[account(mut, token::token_program = token_quote_program, token::mint = quote_mint)]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The mint of base token
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The mint of quote token
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The user performing the swap
    pub payer: Signer<'info>,

    /// Token base program
    pub token_base_program: Interface<'info, TokenInterface>,

    /// Token quote program
    pub token_quote_program: Interface<'info, TokenInterface>,

    /// referral token account
    #[account(mut)]
    pub referral_token_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
}

impl<'info> SwapCtx<'info> {
    /// Get the trading direction of the current swap. Eg: USDT -> USDC
    pub fn get_trade_direction(&self) -> TradeDirection {
        if self.input_token_account.mint == self.base_mint.key() {
            return TradeDirection::BaseToQuote;
        }
        TradeDirection::QuoteToBase
    }
}

pub fn handle_swap_wrapper(ctx: Context<SwapCtx>, params: SwapParameters2) -> Result<()> {
    let SwapParameters2 {
        amount_0,
        amount_1,
        swap_mode,
        ..
    } = params;

    let swap_mode = SwapMode::try_from(swap_mode).map_err(|_| PoolError::TypeCastFailed)?;

    let trade_direction = ctx.accounts.get_trade_direction();
    let (
        token_in_mint,
        token_out_mint,
        input_vault_account,
        output_vault_account,
        input_program,
        output_program,
    ) = match trade_direction {
        TradeDirection::BaseToQuote => (
            &ctx.accounts.base_mint,
            &ctx.accounts.quote_mint,
            &ctx.accounts.base_vault,
            &ctx.accounts.quote_vault,
            &ctx.accounts.token_base_program,
            &ctx.accounts.token_quote_program,
        ),
        TradeDirection::QuoteToBase => (
            &ctx.accounts.quote_mint,
            &ctx.accounts.base_mint,
            &ctx.accounts.quote_vault,
            &ctx.accounts.base_vault,
            &ctx.accounts.token_quote_program,
            &ctx.accounts.token_base_program,
        ),
    };

    require!(amount_0 > 0, PoolError::AmountIsZero);

    let has_referral = ctx.accounts.referral_token_account.is_some();

    let config = ctx.accounts.config.load()?;
    let mut pool = ctx.accounts.pool.load_mut()?;

    let current_point = get_current_point(config.activation_type)?;

    // another validation to prevent snipers to craft multiple swap instructions in 1 tx
    // (if we dont do this, they are able to concat 16 swap instructions in 1 tx)
    let rate_limiter = config.pool_fees.base_fee.get_fee_rate_limiter();
    if let Ok(rate_limiter) = &rate_limiter {
        if rate_limiter.is_rate_limiter_applied(
            current_point,
            pool.activation_point,
            trade_direction,
        )? {
            validate_single_swap_instruction(&ctx.accounts.pool.key(), ctx.remaining_accounts)?;
        }
    }

    // validate if it is over threshold
    require!(
        !pool.is_curve_complete(config.migration_quote_threshold),
        PoolError::PoolIsCompleted
    );

    // update for dynamic fee reference
    let current_timestamp = Clock::get()?.unix_timestamp as u64;
    pool.update_pre_swap(&config, current_timestamp)?;

    let fee_mode = &FeeMode::get_fee_mode(config.collect_fee_mode, trade_direction, has_referral)?;

    let process_swap_params = ProcessSwapParams {
        pool: &mut pool,
        config: &config,
        fee_mode,
        trade_direction,
        current_point,
        amount_0,
        amount_1,
    };

    let ProcessSwapResult {
        swap_result: swap_result_2,
        swap_in_parameters,
    } = match swap_mode {
        SwapMode::ExactIn => process_swap_exact_in(process_swap_params)?,
        SwapMode::PartialFill => process_swap_partial_fill(process_swap_params)?,
        SwapMode::ExactOut => process_swap_exact_out(process_swap_params)?,
    };

    let swap_result = swap_result_2.get_swap_result();
    pool.apply_swap_result(
        &config,
        &swap_result,
        fee_mode,
        trade_direction,
        current_timestamp,
    )?;

    // send to reserve
    transfer_from_user(
        &ctx.accounts.payer,
        token_in_mint,
        &ctx.accounts.input_token_account,
        input_vault_account,
        input_program,
        swap_result_2.included_fee_input_amount,
    )?;

    // send to user
    transfer_from_pool(
        ctx.accounts.pool_authority.to_account_info(),
        token_out_mint,
        output_vault_account,
        &ctx.accounts.output_token_account,
        output_program,
        swap_result.output_amount,
        const_pda::pool_authority::BUMP,
    )?;

    // send to referral
    if let Some(referral_token_account) = ctx.accounts.referral_token_account.as_ref() {
        if fee_mode.fees_on_base_token {
            transfer_from_pool(
                ctx.accounts.pool_authority.to_account_info(),
                &ctx.accounts.base_mint,
                &ctx.accounts.base_vault,
                referral_token_account,
                &ctx.accounts.token_base_program,
                swap_result.referral_fee,
                const_pda::pool_authority::BUMP,
            )?;
        } else {
            transfer_from_pool(
                ctx.accounts.pool_authority.to_account_info(),
                &ctx.accounts.quote_mint,
                &ctx.accounts.quote_vault,
                referral_token_account,
                &ctx.accounts.token_quote_program,
                swap_result.referral_fee,
                const_pda::pool_authority::BUMP,
            )?;
        }
    }

    emit_cpi!(EvtSwap {
        pool: ctx.accounts.pool.key(),
        config: ctx.accounts.config.key(),
        trade_direction: trade_direction.into(),
        has_referral,
        params: swap_in_parameters,
        swap_result,
        amount_in: swap_result_2.included_fee_input_amount,
        current_timestamp,
    });

    emit_cpi!(EvtSwap2 {
        pool: ctx.accounts.pool.key(),
        config: ctx.accounts.config.key(),
        trade_direction: trade_direction.into(),
        has_referral,
        swap_parameters: params,
        swap_result: swap_result_2,
        quote_reserve_amount: pool.quote_reserve,
        migration_threshold: config.migration_quote_threshold,
        current_timestamp,
    });

    if pool.is_curve_complete(config.migration_quote_threshold) {
        ctx.accounts.base_vault.reload()?;
        // validate if base reserve is enough token for migration
        let base_vault_balance = ctx.accounts.base_vault.amount;

        let required_base_balance = config
            .migration_base_threshold
            .safe_add(pool.get_protocol_and_trading_base_fee()?)?
            .safe_add(
                config
                    .locked_vesting_config
                    .to_locked_vesting_params()
                    .get_total_amount()?,
            )?;

        require!(
            base_vault_balance >= required_base_balance,
            PoolError::InsufficientLiquidityForMigration
        );

        // set finish time and migration progress
        pool.finish_curve_timestamp = current_timestamp;

        let locked_vesting_params = config.locked_vesting_config.to_locked_vesting_params();
        if locked_vesting_params.has_vesting() {
            pool.set_migration_progress(MigrationProgress::PostBondingCurve.into());
        } else {
            pool.set_migration_progress(MigrationProgress::LockedVesting.into());
        }

        emit_cpi!(EvtCurveComplete {
            pool: ctx.accounts.pool.key(),
            config: ctx.accounts.config.key(),
            base_reserve: pool.base_reserve,
            quote_reserve: pool.quote_reserve,
        })
    }

    Ok(())
}

pub fn validate_single_swap_instruction<'c, 'info>(
    pool: &Pubkey,
    remaining_accounts: &'c [AccountInfo<'info>],
) -> Result<()> {
    let instruction_sysvar_account_info = remaining_accounts
        .get(0)
        .ok_or_else(|| PoolError::FailToValidateSingleSwapInstruction)?;

    // get current index of instruction
    let current_index =
        sysvar::instructions::load_current_index_checked(instruction_sysvar_account_info)?;
    let current_instruction = sysvar::instructions::load_instruction_at_checked(
        current_index.into(),
        instruction_sysvar_account_info,
    )?;

    if current_instruction.program_id != crate::ID {
        // check if current instruction is CPI
        // disable any stack height greater than 2
        if get_stack_height() > 2 {
            return Err(PoolError::FailToValidateSingleSwapInstruction.into());
        }
        // check for any sibling instruction
        let mut sibling_index = 0;
        while let Some(sibling_instruction) = get_processed_sibling_instruction(sibling_index) {
            if sibling_instruction.program_id == crate::ID
                && sibling_instruction.data[..8].eq(SwapInstruction::DISCRIMINATOR)
            {
                if sibling_instruction.accounts[2].pubkey.eq(pool) {
                    return Err(PoolError::FailToValidateSingleSwapInstruction.into());
                }
            }
            sibling_index = sibling_index.safe_add(1)?;
        }
    }

    if current_index == 0 {
        // skip for first instruction
        return Ok(());
    }
    for i in 0..current_index {
        let instruction = sysvar::instructions::load_instruction_at_checked(
            i.into(),
            instruction_sysvar_account_info,
        )?;

        if instruction.program_id != crate::ID {
            // we treat any instruction including that pool address is other swap ix
            for i in 0..instruction.accounts.len() {
                if instruction.accounts[i].pubkey.eq(pool) {
                    msg!("Multiple swaps not allowed");
                    return Err(PoolError::FailToValidateSingleSwapInstruction.into());
                }
            }
        } else if instruction.data[..8].eq(SwapInstruction::DISCRIMINATOR) {
            if instruction.accounts[2].pubkey.eq(pool) {
                // otherwise, we just need to search swap instruction discriminator, so creator can still bundle initialzing pool and swap at 1 tx
                msg!("Multiple swaps not allowed");
                return Err(PoolError::FailToValidateSingleSwapInstruction.into());
            }
        }
    }
    Ok(())
}
