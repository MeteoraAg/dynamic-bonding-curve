use anchor_lang::prelude::*;
use anchor_spl::{token_2022::Token2022, token_interface::Mint};

use crate::{
    const_pda,
    event::EvtRevokeTransferHook,
    state::{Operator, TransferHookPool},
    token::{get_transfer_hook_program_id, revoke_transfer_hook_and_authority},
};

#[event_cpi]
#[derive(Accounts)]
pub struct RevokeTransferHookCtx<'info> {
    /// CHECK: pool authority
    #[account(address = const_pda::pool_authority::ID)]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(has_one = base_mint)]
    pub pool: AccountLoader<'info, TransferHookPool>,

    #[account(mut, mint::token_program = token_program)]
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,

    pub operator: AccountLoader<'info, Operator>,

    pub signer: Signer<'info>,

    pub token_program: Program<'info, Token2022>,
}

pub fn handle_revoke_transfer_hook(ctx: Context<RevokeTransferHookCtx>) -> Result<()> {
    // If pool curve is not completed get_transfer_hook_program_id will be Some (unless it was already revoked)
    // If pool curve is completed, then transfer hook program is already revoked, so we skip it
    // return Ok when noop
    let Some(transfer_hook_program) = get_transfer_hook_program_id(&ctx.accounts.base_mint)? else {
        return Ok(());
    };

    revoke_transfer_hook_and_authority(
        &ctx.accounts.token_program,
        &ctx.accounts.base_mint,
        &ctx.accounts.pool_authority,
    )?;

    emit_cpi!(EvtRevokeTransferHook {
        pool: ctx.accounts.pool.key(),
        base_mint: ctx.accounts.base_mint.key(),
        operator: ctx.accounts.signer.key(),
        transfer_hook_program,
    });

    Ok(())
}
