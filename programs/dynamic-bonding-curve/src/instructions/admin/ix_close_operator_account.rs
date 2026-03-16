use crate::state::Operator;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CloseOperatorAccountCtx<'info> {
    #[account(
        mut,
        close = rent_receiver
    )]
    pub operator: AccountLoader<'info, Operator>,

    pub signer: Signer<'info>,

    /// CHECK: Account to receive rent fee
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,
}
