use crate::{admin::admin::ADMIN, state::Operator, PoolError};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CloseOperatorAccountCtx<'info> {
    #[account(
        mut,
        close = rent_receiver
    )]
    pub operator: AccountLoader<'info, Operator>,

    pub signer: Signer<'info>,

    /// CHECK: Account to receive rent fee, must be the admin
    #[account(mut, address = ADMIN @ PoolError::InvalidRentReceiver)]
    pub rent_receiver: UncheckedAccount<'info>,
}

pub fn handle_close_operator_account(ctx: Context<CloseOperatorAccountCtx>) -> Result<()> {
    let operator = ctx.accounts.operator.load()?;

    msg!("Operator removed: {}", operator.whitelisted_address);
    msg!("Closed by: {}", ctx.accounts.signer.key());
    msg!(
        "Revoked permissions: {:?} (raw: {:#b})",
        Operator::permission_names(operator.permission),
        operator.permission
    );
    Ok(())
}
