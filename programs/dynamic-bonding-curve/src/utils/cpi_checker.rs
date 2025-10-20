use crate::PoolError;
use anchor_lang::prelude::*;

pub fn cpi_with_account_lamport_and_owner_checking<'info>(
    cpi_fn: impl FnOnce() -> Result<()>,
    account: AccountInfo<'info>,
) -> Result<()> {
    let before_lamports = account.lamports();
    let before_owner = *account.owner;

    cpi_fn()?;

    let after_lamports = account.lamports();
    let after_owner = *account.owner;

    require!(
        before_lamports == after_lamports,
        PoolError::AccountInvariantViolation
    );
    require!(
        before_owner.eq(&after_owner),
        PoolError::AccountInvariantViolation
    );

    Ok(())
}
