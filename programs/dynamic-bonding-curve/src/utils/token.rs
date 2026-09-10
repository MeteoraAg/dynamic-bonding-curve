use anchor_lang::prelude::*;
use anchor_lang::{
    prelude::InterfaceAccount,
    solana_program::program::{invoke, invoke_signed},
    solana_program::system_instruction::transfer,
};
use anchor_spl::{
    token::Token,
    token_2022::spl_token_2022::{
        self,
        extension::{
            transfer_fee::{TransferFee, TransferFeeConfig},
            transfer_hook, BaseStateWithExtensions, ExtensionType, StateWithExtensions,
        },
    },
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use num_enum::{IntoPrimitive, TryFromPrimitive};

use crate::const_pda::pool_authority::BUMP;
use crate::safe_math::SafeMath;
use crate::state::{PoolState, TokenBadge};
use crate::PoolError;

#[derive(
    AnchorSerialize, AnchorDeserialize, Debug, PartialEq, Eq, IntoPrimitive, TryFromPrimitive,
)]
#[repr(u8)]
pub enum TokenProgramFlags {
    TokenProgram,
    TokenProgram2022,
}

pub fn get_token_program_flags<'a, 'info>(
    token_mint: &'a InterfaceAccount<'info, Mint>,
) -> TokenProgramFlags {
    let token_mint_ai = token_mint.to_account_info();

    if token_mint_ai.owner.eq(&anchor_spl::token::ID) {
        TokenProgramFlags::TokenProgram
    } else {
        TokenProgramFlags::TokenProgram2022
    }
}

pub fn get_transfer_hook_program_id(token_mint: &InterfaceAccount<Mint>) -> Result<Option<Pubkey>> {
    let token_mint_info = token_mint.to_account_info();
    if *token_mint_info.owner == Token::id() {
        return Ok(None);
    }

    let token_mint_data = token_mint_info.try_borrow_data()?;
    let token_mint_unpacked =
        StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&token_mint_data)?;
    Ok(transfer_hook::get_program_id(&token_mint_unpacked))
}

pub fn transfer_token_from_user<'a, 'info>(
    authority: &'a Signer<'info>,
    token_mint: &'a InterfaceAccount<'info, Mint>,
    token_owner_account: &'a InterfaceAccount<'info, TokenAccount>,
    destination_token_account: &'a InterfaceAccount<'info, TokenAccount>,
    token_program: &'a Interface<'info, TokenInterface>,
    amount: u64,
    transfer_hook_accounts: Option<&'info [AccountInfo<'info>]>,
) -> Result<()> {
    let destination_account = destination_token_account.to_account_info();

    let mut instruction = spl_token_2022::instruction::transfer_checked(
        token_program.key,
        &token_owner_account.key(),
        &token_mint.key(),
        destination_account.key,
        authority.key,
        &[],
        amount,
        token_mint.decimals,
    )?;

    let mut account_infos = vec![
        token_owner_account.to_account_info(),
        token_mint.to_account_info(),
        destination_account.to_account_info(),
        authority.to_account_info(),
    ];

    if let Some(hook_program_id) = get_transfer_hook_program_id(token_mint)? {
        let Some(hook_accounts) = transfer_hook_accounts else {
            return Err(PoolError::MissingRemainingAccountForTransferHook.into());
        };

        spl_transfer_hook_interface::onchain::add_extra_accounts_for_execute_cpi(
            &mut instruction,
            &mut account_infos,
            &hook_program_id,
            token_owner_account.to_account_info(),
            token_mint.to_account_info(),
            destination_account.to_account_info(),
            authority.to_account_info(),
            amount,
            hook_accounts,
        )?;
    } else {
        require!(
            transfer_hook_accounts.is_none(),
            PoolError::NoTransferHookProgram
        );
    }

    invoke(&instruction, &account_infos)?;

    Ok(())
}

pub fn transfer_token_from_pool_authority<'info>(
    pool_authority: AccountInfo<'info>,
    token_mint: &InterfaceAccount<'info, Mint>,
    token_vault: &InterfaceAccount<'info, TokenAccount>,
    token_owner_account: AccountInfo<'info>,
    token_program: &Interface<'info, TokenInterface>,
    amount: u64,
    transfer_hook_accounts: Option<&'info [AccountInfo<'info>]>,
) -> Result<()> {
    let signer_seeds = pool_authority_seeds!(BUMP);

    let mut instruction = spl_token_2022::instruction::transfer_checked(
        token_program.key,
        &token_vault.key(),
        &token_mint.key(),
        &token_owner_account.key(),
        &pool_authority.key(),
        &[],
        amount,
        token_mint.decimals,
    )?;

    let mut account_infos = vec![
        token_vault.to_account_info(),
        token_mint.to_account_info(),
        token_owner_account.to_account_info(),
        pool_authority.to_account_info(),
    ];

    if let Some(hook_program_id) = get_transfer_hook_program_id(token_mint)? {
        let Some(transfer_hook_accounts) = transfer_hook_accounts else {
            return Err(PoolError::MissingRemainingAccountForTransferHook.into());
        };

        spl_transfer_hook_interface::onchain::add_extra_accounts_for_execute_cpi(
            &mut instruction,
            &mut account_infos,
            &hook_program_id,
            token_vault.to_account_info(),
            token_mint.to_account_info(),
            token_owner_account.to_account_info(),
            pool_authority.to_account_info(),
            amount,
            transfer_hook_accounts,
        )?;
    } else {
        require!(
            transfer_hook_accounts.is_none(),
            PoolError::NoTransferHookProgram
        );
    }

    invoke_signed(&instruction, &account_infos, &[&signer_seeds[..]])?;

    Ok(())
}

#[derive(Debug)]
pub struct TransferFeeIncludedAmount {
    pub amount: u64,
    pub transfer_fee: u64,
}

#[derive(Debug)]
pub struct TransferFeeExcludedAmount {
    pub amount: u64,
    pub transfer_fee: u64,
}

pub fn calculate_transfer_fee_excluded_amount(
    transfer_fee: Option<&TransferFee>,
    transfer_fee_included_amount: u64,
) -> Result<TransferFeeExcludedAmount> {
    if let Some(epoch_transfer_fee) = transfer_fee {
        let transfer_fee = epoch_transfer_fee
            .calculate_fee(transfer_fee_included_amount)
            .ok_or_else(|| PoolError::MathOverflow)?;
        let transfer_fee_excluded_amount = transfer_fee_included_amount.safe_sub(transfer_fee)?;
        return Ok(TransferFeeExcludedAmount {
            amount: transfer_fee_excluded_amount,
            transfer_fee,
        });
    }

    Ok(TransferFeeExcludedAmount {
        amount: transfer_fee_included_amount,
        transfer_fee: 0,
    })
}

pub fn calculate_transfer_fee_included_amount(
    transfer_fee: Option<&TransferFee>,
    transfer_fee_excluded_amount: u64,
) -> Result<TransferFeeIncludedAmount> {
    if transfer_fee_excluded_amount == 0 {
        return Ok(TransferFeeIncludedAmount {
            amount: 0,
            transfer_fee: 0,
        });
    }

    if let Some(epoch_transfer_fee) = transfer_fee {
        let transfer_fee = epoch_transfer_fee
            .calculate_inverse_fee(transfer_fee_excluded_amount)
            .ok_or_else(|| PoolError::MathOverflow)?;

        let transfer_fee_included_amount = transfer_fee_excluded_amount.safe_add(transfer_fee)?;

        // verify transfer fee calculation for safety
        let transfer_fee_verification = epoch_transfer_fee
            .calculate_fee(transfer_fee_included_amount)
            .ok_or_else(|| PoolError::MathOverflow)?; // should never fail

        require!(
            transfer_fee == transfer_fee_verification,
            PoolError::FeeInverseIsIncorrect
        );

        return Ok(TransferFeeIncludedAmount {
            amount: transfer_fee_included_amount,
            transfer_fee,
        });
    }

    Ok(TransferFeeIncludedAmount {
        amount: transfer_fee_excluded_amount,
        transfer_fee: 0,
    })
}

pub fn get_epoch_transfer_fee(mint_info: &AccountInfo) -> Result<Option<TransferFee>> {
    if mint_info.owner.eq(&Token::id()) {
        return Ok(None);
    }

    let mint_data = mint_info.try_borrow_data()?;
    let mint = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&mint_data)?;
    if let Ok(transfer_fee_config) = mint.get_extension::<TransferFeeConfig>() {
        return Ok(Some(
            *transfer_fee_config.get_epoch_fee(Clock::get()?.epoch),
        ));
    }

    Ok(None)
}

fn is_transfer_fee_zero(
    mint: &StateWithExtensions<spl_token_2022::state::Mint>,
    current_epoch: u64,
) -> bool {
    if let Ok(transfer_fee_config) = mint.get_extension::<TransferFeeConfig>() {
        let older_transfer_fee_bps = u16::from(
            transfer_fee_config
                .older_transfer_fee
                .transfer_fee_basis_points,
        );
        let newer_transfer_fee_bps = u16::from(
            transfer_fee_config
                .newer_transfer_fee
                .transfer_fee_basis_points,
        );
        let newer_transfer_fee_epoch = u64::from(transfer_fee_config.newer_transfer_fee.epoch);

        if current_epoch < newer_transfer_fee_epoch {
            // older fee is active and newer fee is scheduled, both must be zero
            return older_transfer_fee_bps == 0 && newer_transfer_fee_bps == 0;
        } else {
            // newer fee is active, older fee is historical
            return newer_transfer_fee_bps == 0;
        }
    }

    true
}

/// Rule: quote mint must be SPL-Token or Token-2022 (non-native) with only metadata extensions and/or zero transfer fee with no authority
/// Anything else requires a token badge
pub fn is_supported_quote_mint(mint_account: &InterfaceAccount<Mint>) -> Result<bool> {
    let mint_info = mint_account.to_account_info();
    if *mint_info.owner == Token::id() {
        return Ok(true);
    }

    require!(
        !spl_token_2022::native_mint::check_id(&mint_account.key()),
        PoolError::UnsupportNativeMintToken2022
    );

    let mint_data = mint_info.try_borrow_data()?;
    let mint = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&mint_data)?;

    let extensions = mint.get_extension_types()?;
    for e in extensions {
        match e {
            ExtensionType::MetadataPointer | ExtensionType::TokenMetadata => {
                // permissionless supported
            }
            ExtensionType::TransferFeeConfig => {
                // permissionless only when the transfer fee is zero and no authority
                let transfer_fee_config = mint.get_extension::<TransferFeeConfig>()?;
                let authority: Option<Pubkey> =
                    transfer_fee_config.transfer_fee_config_authority.into();
                if authority.is_some() || !is_transfer_fee_zero(&mint, Clock::get()?.epoch) {
                    return Ok(false);
                }
            }
            _ => return Ok(false),
        }
    }
    Ok(true)
}

pub fn validate_quote_mint_with_token_badge<'info>(
    quote_mint: &InterfaceAccount<'info, Mint>,
    token_badge: Option<&'info AccountInfo<'info>>,
) -> Result<()> {
    if !is_supported_quote_mint(quote_mint)? {
        let token_badge = token_badge.ok_or_else(|| PoolError::InvalidTokenBadge)?;
        require!(
            is_token_badge_initialized(quote_mint.key(), token_badge)?,
            PoolError::InvalidTokenBadge
        );
    }
    Ok(())
}

fn is_token_badge_initialized<'info>(
    mint: Pubkey,
    token_badge: &'info AccountInfo<'info>,
) -> Result<bool> {
    let token_badge: AccountLoader<'_, TokenBadge> = AccountLoader::try_from(token_badge)?;
    let token_badge = token_badge.load()?;
    Ok(token_badge.token_mint == mint)
}

pub fn update_account_lamports_to_minimum_balance<'info>(
    account: AccountInfo<'info>,
    payer: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
) -> Result<()> {
    let minimum_balance = Rent::get()?.minimum_balance(account.data_len());
    let current_lamport = account.get_lamports();
    if minimum_balance > current_lamport {
        let extra_lamports = minimum_balance.safe_sub(current_lamport)?;
        invoke(
            &transfer(payer.key, account.key, extra_lamports),
            &[payer, account, system_program],
        )?;
    }

    Ok(())
}

pub fn transfer_lamports_from_user<'info>(
    from: AccountInfo<'info>,
    to: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    lamports: u64,
) -> Result<()> {
    invoke(
        &transfer(from.key, to.key, lamports),
        &[from, to, system_program],
    )?;

    Ok(())
}

pub fn transfer_lamports_from_pool_account<'info>(
    pool: AccountInfo<'info>,
    to: AccountInfo<'info>,
    lamports: u64,
) -> Result<()> {
    pool.sub_lamports(lamports)?;
    to.add_lamports(lamports)?;

    let minimum_balance = Rent::get()?.minimum_balance(8 + PoolState::INIT_SPACE);

    require!(
        pool.get_lamports() >= minimum_balance,
        PoolError::InsufficientPoolLamports
    );

    Ok(())
}
