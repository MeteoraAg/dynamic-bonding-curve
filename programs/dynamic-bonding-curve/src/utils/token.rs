use anchor_lang::prelude::*;
use anchor_lang::{
    prelude::InterfaceAccount,
    solana_program::program::{invoke, invoke_signed},
    solana_program::system_instruction::transfer,
};
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token::accessor;
use anchor_spl::token_2022::spl_token_2022::extension::transfer_hook;
use anchor_spl::{
    token::Token,
    token_2022::spl_token_2022::{
        self,
        extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
    },
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use num_enum::{IntoPrimitive, TryFromPrimitive};

use crate::const_pda::pool_authority::BUMP;
use crate::safe_math::{SafeCast, SafeMath};
use crate::state::{PoolType, VirtualPool};
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

pub fn get_token_program_from_flag(token_program_flag: u8) -> Result<Pubkey> {
    let token_program_flag: TokenProgramFlags = token_program_flag.safe_cast()?;
    match token_program_flag {
        TokenProgramFlags::TokenProgram => Ok(anchor_spl::token::ID),
        TokenProgramFlags::TokenProgram2022 => Ok(anchor_spl::token_2022::ID),
    }
}

pub fn get_token_program_from_pool_type(pool_type: u8) -> Result<Pubkey> {
    let pool_type: PoolType = pool_type.safe_cast()?;
    match pool_type {
        PoolType::SplToken => Ok(anchor_spl::token::ID),
        PoolType::Token2022 | PoolType::Token2022WithTransferHook => Ok(anchor_spl::token_2022::ID),
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

pub fn is_supported_quote_mint(mint_account: &InterfaceAccount<Mint>) -> Result<bool> {
    let mint_info = mint_account.to_account_info();
    if *mint_info.owner == Token::id() {
        return Ok(true);
    }

    if spl_token_2022::native_mint::check_id(&mint_account.key()) {
        return Err(PoolError::UnsupportNativeMintToken2022.into());
    }

    let mint_data = mint_info.try_borrow_data()?;
    let mint = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&mint_data)?;
    let extensions = mint.get_extension_types()?;
    for e in extensions {
        if e != ExtensionType::MetadataPointer && e != ExtensionType::TokenMetadata {
            return Ok(false);
        }
    }
    Ok(true)
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

    let minimum_balance = Rent::get()?.minimum_balance(8 + VirtualPool::INIT_SPACE);

    require!(
        pool.get_lamports() >= minimum_balance,
        PoolError::InsufficientPoolLamports
    );

    Ok(())
}

pub fn validate_ata_token<'info>(
    token_account: &AccountInfo<'info>,
    owner: &Pubkey,
    mint: &Pubkey,
    token_program_id: &Pubkey,
) -> Result<()> {
    // validate ata address
    let ata_address = get_associated_token_address_with_program_id(owner, mint, token_program_id);
    require!(ata_address.eq(token_account.key), PoolError::IncorrectATA);

    // validate owner
    let current_owner = accessor::authority(token_account)?;
    require!(current_owner.eq(owner), PoolError::IncorrectATA);
    Ok(())
}
