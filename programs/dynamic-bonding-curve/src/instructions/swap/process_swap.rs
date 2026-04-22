use std::u64;

use crate::instruction::InitializeVirtualPoolWithSplToken;
use crate::instruction::InitializeVirtualPoolWithToken2022;
use crate::instruction::InitializeVirtualPoolWithToken2022TransferHook;
use crate::instruction::Swap as SwapInstruction;
use crate::instruction::Swap2 as Swap2Instruction;
use crate::instruction::Swap2WithTransferHook as Swap2WithTransferHookInstruction;
use crate::math::safe_math::SafeMath;
use crate::state::MigrationProgress;
use crate::state::SwapResult2;
use crate::{
    activation_handler::get_current_point,
    const_pda,
    params::swap::TradeDirection,
    remaining_accounts::{parse_transfer_hook_accounts, TransferHookAccountsInfo},
    state::fee::FeeMode,
    token::{transfer_token_from_pool_authority, transfer_token_from_user},
    ConfigAccountLoader, PoolAccountLoader, PoolError,
};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{get_stack_height, Instruction};
use anchor_spl::token_2022::{
    set_authority, spl_token_2022::instruction::AuthorityType, SetAuthority,
};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use num_enum::{IntoPrimitive, TryFromPrimitive};
use solana_instruction::syscalls::get_processed_sibling_instruction;
use solana_instructions_sysvar::{
    self as instructions_sysvar, load_current_index_checked, load_instruction_at_checked,
};

use super::swap_exact_in::process_swap_exact_in;
use super::swap_exact_out::process_swap_exact_out;
use super::swap_partial_fill::process_swap_partial_fill;
use super::{ProcessSwapParams, ProcessSwapResult};

// only be use for swap exact in
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SwapParameters {
    pub amount_in: u64,
    pub minimum_amount_out: u64,
}

// can be used for different swap_mode
#[derive(AnchorSerialize, AnchorDeserialize, Default, Copy, Clone)]
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
    Clone,
    Copy,
    Debug,
    PartialEq,
    IntoPrimitive,
    TryFromPrimitive,
    AnchorDeserialize,
    AnchorSerialize,
)]
pub enum SwapMode {
    ExactIn,
    PartialFill,
    ExactOut,
}

pub struct SwapEventData {
    pub trade_direction: TradeDirection,
    pub has_referral: bool,
    pub swap_parameters: SwapParameters2,
    pub swap_result_2: SwapResult2,
    pub swap_in_parameters: SwapParameters,
    pub quote_reserve_amount: u64,
    pub migration_threshold: u64,
    pub current_timestamp: u64,
    pub curve_complete: Option<CurveCompleteEventData>,
}

pub struct CurveCompleteEventData {
    pub base_reserve: u64,
    pub quote_reserve: u64,
}

#[allow(clippy::too_many_arguments)]
pub fn process_swap<'a: 'info, 'info>(
    pool_account: &'a UncheckedAccount<'info>,
    config_account: &'a UncheckedAccount<'info>,
    pool_authority: &'a UncheckedAccount<'info>,
    base_vault: &'a mut Box<InterfaceAccount<'info, TokenAccount>>,
    quote_vault: &'a Box<InterfaceAccount<'info, TokenAccount>>,
    base_mint: &'a Box<InterfaceAccount<'info, Mint>>,
    quote_mint: &'a Box<InterfaceAccount<'info, Mint>>,
    input_token_account: &'a Box<InterfaceAccount<'info, TokenAccount>>,
    output_token_account: AccountInfo<'info>,
    payer: &'a Signer<'info>,
    token_base_program: &'a Interface<'info, TokenInterface>,
    token_quote_program: &'a Interface<'info, TokenInterface>,
    referral_token_account: &'a Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    remaining_accounts: &'a [AccountInfo<'info>],
    params: SwapParameters2,
    transfer_hook_accounts_info: TransferHookAccountsInfo,
) -> Result<SwapEventData> {
    let pool_loader = PoolAccountLoader::try_from(pool_account)?;
    let mut pool = pool_loader.load_mut()?;

    require!(
        pool.base_vault.eq(&base_vault.key()),
        ErrorCode::ConstraintHasOne
    );
    require!(
        pool.quote_vault.eq(&quote_vault.key()),
        ErrorCode::ConstraintHasOne
    );
    require!(
        pool.config.eq(&config_account.key()),
        ErrorCode::ConstraintHasOne
    );

    let config_loader = ConfigAccountLoader::try_from(config_account)?;
    let config = config_loader.load()?;

    let SwapParameters2 {
        amount_0,
        amount_1,
        swap_mode,
        ..
    } = params;

    let swap_mode = SwapMode::try_from(swap_mode).map_err(|_| PoolError::TypeCastFailed)?;

    let trade_direction = if input_token_account.mint == base_mint.key() {
        TradeDirection::BaseToQuote
    } else {
        TradeDirection::QuoteToBase
    };

    // Reborrow base_vault as immutable to match quote_vault's type in the match
    let base_vault_ref: &Box<InterfaceAccount<'info, TokenAccount>> = base_vault;
    let (
        token_in_mint,
        token_out_mint,
        input_vault_account,
        output_vault_account,
        input_program,
        output_program,
    ) = match trade_direction {
        TradeDirection::BaseToQuote => (
            base_mint,
            quote_mint,
            base_vault_ref,
            quote_vault,
            token_base_program,
            token_quote_program,
        ),
        TradeDirection::QuoteToBase => (
            quote_mint,
            base_mint,
            quote_vault,
            base_vault_ref,
            token_quote_program,
            token_base_program,
        ),
    };

    require!(amount_0 > 0, PoolError::AmountIsZero);

    let transfer_hook_account_count = transfer_hook_accounts_info
        .slices
        .iter()
        .map(|s| s.length as usize)
        .sum();
    let extra_remaining_account_count = remaining_accounts
        .len()
        .safe_sub(transfer_hook_account_count)?;
    require!(
        extra_remaining_account_count <= 1,
        PoolError::InvalidRemainingAccountsLength
    );
    let instruction_sysvar_account_info = if extra_remaining_account_count == 1 {
        let account = &remaining_accounts[0];
        require!(
            account.key.eq(&instructions_sysvar::ID),
            PoolError::InvalidInstructionsSysvar
        );
        Some(account)
    } else {
        None
    };

    let has_referral = referral_token_account.is_some();

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
            validate_single_swap_instruction(&pool_account.key(), instruction_sysvar_account_info)?;
        }
    }

    let eligible_for_first_swap_with_min_fee = config.is_first_swap_with_min_fee_enabled()
        && pool.is_first_swap()
        && validate_contain_initialize_pool_ix_and_no_cpi(
            &pool_account.key(),
            referral_token_account,
            instruction_sysvar_account_info,
        )
        .is_ok();

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
        pool: &mut *pool,
        config: &config,
        fee_mode,
        trade_direction,
        current_point,
        amount_0,
        amount_1,
        eligible_for_first_swap_with_min_fee,
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

    let mut remaining_accounts = &remaining_accounts[extra_remaining_account_count..];
    let parsed_transfer_hook_accounts =
        parse_transfer_hook_accounts(&mut remaining_accounts, &transfer_hook_accounts_info.slices)?;
    let transfer_hook_base_accounts = parsed_transfer_hook_accounts.transfer_hook_base;

    let (transfer_hook_in, transfer_hook_out) = match trade_direction {
        TradeDirection::BaseToQuote => (transfer_hook_base_accounts, None),
        TradeDirection::QuoteToBase => (None, transfer_hook_base_accounts),
    };

    // send to reserve
    transfer_token_from_user(
        payer,
        token_in_mint,
        input_token_account,
        input_vault_account,
        input_program,
        swap_result_2.included_fee_input_amount,
        transfer_hook_in,
    )?;

    // send to user
    transfer_token_from_pool_authority(
        pool_authority.to_account_info(),
        token_out_mint,
        output_vault_account,
        output_token_account,
        output_program,
        swap_result.output_amount,
        transfer_hook_out,
    )?;

    // send to referral
    if let Some(referral_token_account) = referral_token_account.as_ref() {
        if fee_mode.fees_on_base_token {
            let transfer_hook_base_referral_accounts =
                parsed_transfer_hook_accounts.transfer_hook_base_referral;
            transfer_token_from_pool_authority(
                pool_authority.to_account_info(),
                base_mint,
                base_vault_ref,
                referral_token_account.to_account_info(),
                token_base_program,
                swap_result.referral_fee,
                transfer_hook_base_referral_accounts,
            )?;
        } else {
            transfer_token_from_pool_authority(
                pool_authority.to_account_info(),
                quote_mint,
                quote_vault,
                referral_token_account.to_account_info(),
                token_quote_program,
                swap_result.referral_fee,
                None,
            )?;
        }
    }

    let curve_complete = if pool.is_curve_complete(config.migration_quote_threshold) {
        base_vault.reload()?;
        let base_vault_balance = base_vault.amount;

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

        if pool_loader.is_transfer_hook_pool() {
            revoke_transfer_hook(token_base_program, base_mint, pool_authority)?;
        }

        Some(CurveCompleteEventData {
            base_reserve: pool.base_reserve,
            quote_reserve: pool.quote_reserve,
        })
    } else {
        None
    };

    Ok(SwapEventData {
        trade_direction,
        has_referral,
        swap_parameters: params,
        swap_result_2,
        swap_in_parameters,
        quote_reserve_amount: pool.quote_reserve,
        migration_threshold: config.migration_quote_threshold,
        current_timestamp,
        curve_complete,
    })
}

fn revoke_transfer_hook<'info>(
    token_program: &Interface<'info, TokenInterface>,
    base_mint: &InterfaceAccount<'info, Mint>,
    pool_authority: &UncheckedAccount<'info>,
) -> Result<()> {
    let pool_authority_seeds = pool_authority_seeds!(const_pda::pool_authority::BUMP);

    // revoke transfer_hook program
    let update_hook_ix =
        anchor_spl::token_2022::spl_token_2022::extension::transfer_hook::instruction::update(
            &token_program.key(),
            &base_mint.key(),
            &pool_authority.key(),
            &[],
            None,
        )?;
    anchor_lang::solana_program::program::invoke_signed(
        &update_hook_ix,
        &[
            base_mint.to_account_info(),
            pool_authority.to_account_info(),
        ],
        &[&pool_authority_seeds[..]],
    )?;

    // revoke transfer_hook authority
    set_authority(
        CpiContext::new_with_signer(
            token_program.key(),
            SetAuthority {
                current_authority: pool_authority.to_account_info(),
                account_or_mint: base_mint.to_account_info(),
            },
            &[&pool_authority_seeds[..]],
        ),
        AuthorityType::TransferHookProgramId,
        None,
    )?;

    Ok(())
}

pub fn validate_single_swap_instruction<'info>(
    pool: &Pubkey,
    instruction_sysvar_account_info: Option<&AccountInfo<'info>>,
) -> Result<()> {
    let instruction_sysvar_account_info = instruction_sysvar_account_info
        .ok_or_else(|| PoolError::FailToValidateSingleSwapInstruction)?;

    // get current index of instruction
    let current_index = load_current_index_checked(instruction_sysvar_account_info)?;
    let current_instruction =
        load_instruction_at_checked(current_index.into(), instruction_sysvar_account_info)?;

    if current_instruction.program_id != crate::ID {
        // check if current instruction is CPI
        // disable any stack height greater than 2
        if get_stack_height() > 2 {
            return Err(PoolError::FailToValidateSingleSwapInstruction.into());
        }
        // check for any sibling instruction
        let mut sibling_index = 0;
        while let Some(sibling_instruction) = get_processed_sibling_instruction(sibling_index) {
            if sibling_instruction.program_id == crate::ID {
                require!(
                    !is_instruction_include_pool_swap(&sibling_instruction, pool),
                    PoolError::FailToValidateSingleSwapInstruction
                );
            }

            sibling_index = sibling_index.safe_add(1)?;
        }
    }

    if current_index == 0 {
        // skip for first instruction
        return Ok(());
    }
    for i in 0..current_index {
        let instruction = load_instruction_at_checked(i.into(), instruction_sysvar_account_info)?;

        if instruction.program_id != crate::ID {
            // we treat any instruction including that pool address is other swap ix
            for i in 0..instruction.accounts.len() {
                if instruction.accounts[i].pubkey.eq(pool) {
                    msg!("Multiple swaps not allowed");
                    return Err(PoolError::FailToValidateSingleSwapInstruction.into());
                }
            }
        } else {
            require!(
                !is_instruction_include_pool_swap(&instruction, pool),
                PoolError::FailToValidateSingleSwapInstruction
            );
        }
    }
    Ok(())
}

fn is_instruction_include_pool_swap(instruction: &Instruction, pool: &Pubkey) -> bool {
    let instruction_discriminator = &instruction.data[..8];
    if instruction_discriminator.eq(SwapInstruction::DISCRIMINATOR)
        || instruction_discriminator.eq(Swap2Instruction::DISCRIMINATOR)
        || instruction_discriminator.eq(Swap2WithTransferHookInstruction::DISCRIMINATOR)
    {
        return instruction.accounts[2].pubkey.eq(pool);
    }
    false
}

// Note: initialize_pool ix must be before swap ix and at the top level (no cpi)
pub fn validate_contain_initialize_pool_ix_and_no_cpi<'info>(
    pool: &Pubkey,
    referral_token_account: &Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    instruction_sysvar_account_info: Option<&AccountInfo<'info>>,
) -> Result<()> {
    // just use a random error
    // not allow user to bypass referral fee
    require!(
        referral_token_account.is_none(),
        PoolError::UndeterminedError
    );

    let instruction_sysvar_account_info =
        instruction_sysvar_account_info.ok_or_else(|| PoolError::UndeterminedError)?;

    let current_index = load_current_index_checked(instruction_sysvar_account_info)?;

    let current_instruction =
        load_instruction_at_checked(current_index.into(), instruction_sysvar_account_info)?;

    require!(
        current_instruction.program_id.eq(&crate::ID),
        PoolError::UndeterminedError
    );

    for i in 0..current_index {
        let instruction = load_instruction_at_checked(i.into(), instruction_sysvar_account_info)?;

        if instruction.program_id == crate::ID {
            let disc = &instruction.data[..8];

            if disc.eq(InitializeVirtualPoolWithSplToken::DISCRIMINATOR)
                || disc.eq(InitializeVirtualPoolWithToken2022::DISCRIMINATOR)
                || disc.eq(InitializeVirtualPoolWithToken2022TransferHook::DISCRIMINATOR)
            {
                const VIRTUAL_POOL_ACCOUNT_INDEX: usize = 5;
                let Some(account) = instruction.accounts.get(VIRTUAL_POOL_ACCOUNT_INDEX) else {
                    continue;
                };

                if account.pubkey.eq(pool) {
                    //pass
                    return Ok(());
                }
            }
        }
    }

    Err(PoolError::UndeterminedError.into())
}
