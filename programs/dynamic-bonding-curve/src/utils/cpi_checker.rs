use crate::PoolError;
use anchor_lang::prelude::*;

pub fn cpi_with_account_lamport_and_owner_checking<'info>(
    cpi_fn: impl FnOnce() -> Result<()>,
    account: AccountInfo<'info>,
) -> Result<()> {
    let before_lamports = account.lamports();
    let before_owner = *account.owner;
    let before_data_len = account.data_len();

    cpi_fn()?;

    let after_lamports = account.lamports();
    let after_owner = *account.owner;
    let after_data_len = account.data_len();

    require!(
        after_lamports >= before_lamports,
        PoolError::AccountInvariantViolation
    );
    require!(
        before_owner.eq(&after_owner),
        PoolError::AccountInvariantViolation
    );
    require!(
        before_data_len == after_data_len,
        PoolError::AccountInvariantViolation
    );

    Ok(())
}
