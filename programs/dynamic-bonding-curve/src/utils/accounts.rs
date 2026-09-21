use anchor_lang::prelude::*;
use anchor_lang::{
    solana_program::program::invoke, solana_program::system_instruction::transfer, system_program,
};

use crate::safe_math::SafeMath;
use crate::state::PoolState;
use crate::PoolError;

/// reference: https://github.com/otter-sec/anchor/blob/v1.0.2/lang/syn/src/codegen/accounts/constraints.rs#L1722C1-L1723C1
pub fn create_account<'info>(
    account: &AccountInfo<'info>,
    space: usize,
    owner: &Pubkey,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    signer_seeds: &[&[u8]],
) -> Result<()> {
    // Anchor emits `with_signer(&[])` for keypair accounts and `with_signer(&[seeds])` for PDAs
    let signer_seeds: &[&[&[u8]]] = if signer_seeds.is_empty() {
        &[]
    } else {
        &[signer_seeds] // PDA
    };
    let rent = Rent::get()?;
    // If the account being initialized already has lamports, then
    // return them all back to the payer so that the account has
    // zero lamports when the system program's create instruction
    // is eventually called.
    let current_lamports = account.lamports();
    if current_lamports == 0 {
        let lamports = rent.minimum_balance(space);
        system_program::create_account(
            CpiContext::new(
                system_program.key(),
                system_program::CreateAccount {
                    from: payer.clone(),
                    to: account.clone(),
                },
            )
            .with_signer(signer_seeds),
            lamports,
            space.try_into().map_err(|_| PoolError::TypeCastFailed)?,
            owner,
        )?;
    } else {
        require_keys_neq!(
            payer.key(),
            account.key(),
            ErrorCode::TryingToInitPayerAsProgramAccount
        );
        let required_lamports = rent
            .minimum_balance(space)
            .max(1)
            .saturating_sub(current_lamports);
        if required_lamports > 0 {
            system_program::transfer(
                CpiContext::new(
                    system_program.key(),
                    system_program::Transfer {
                        from: payer.clone(),
                        to: account.clone(),
                    },
                ),
                required_lamports,
            )?;
        }
        system_program::allocate(
            CpiContext::new(
                system_program.key(),
                system_program::Allocate {
                    account_to_allocate: account.clone(),
                },
            )
            .with_signer(signer_seeds),
            space.try_into().map_err(|_| PoolError::TypeCastFailed)?,
        )?;
        system_program::assign(
            CpiContext::new(
                system_program.key(),
                system_program::Assign {
                    account_to_assign: account.clone(),
                },
            )
            .with_signer(signer_seeds),
            owner,
        )?;
    }

    Ok(())
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
