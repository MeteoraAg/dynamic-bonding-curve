use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

use crate::{const_pda, treasury};

#[derive(Accounts)]
pub struct WithdrawLamportsFromAuthority<'info> {
    /// CHECK: pool authority
    #[account(
        mut,
        address = const_pda::pool_authority::ID
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// CHECK: The treasury address
    #[account(
        mut,
       address = treasury::ID
    )]
    pub receiver: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_withdraw_lamports_from_authority(
    ctx: Context<WithdrawLamportsFromAuthority>,
) -> Result<()> {
    let pool_authority = &ctx.accounts.pool_authority;
    let lamports = pool_authority.lamports();
    if lamports > 0 {
        let seeds = pool_authority_seeds!(const_pda::pool_authority::BUMP);
        transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: pool_authority.to_account_info(),
                    to: ctx.accounts.receiver.to_account_info(),
                },
                &[&seeds[..]],
            ),
            lamports,
        )?;
    }

    // No need to emit event
    Ok(())
}
