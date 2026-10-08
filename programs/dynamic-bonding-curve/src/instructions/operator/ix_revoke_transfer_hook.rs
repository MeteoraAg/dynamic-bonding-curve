use anchor_lang::prelude::*;
use anchor_spl::{token_2022::Token2022, token_interface::Mint};

use crate::{
    const_pda,
    event::EvtRevokeTransferHook,
    state::Operator,
    token::{get_transfer_hook_program_id, revoke_transfer_hook},
    PoolAccountLoader, PoolError,
};

#[event_cpi]
#[derive(Accounts)]
pub struct RevokeTransferHookCtx<'info> {
    /// CHECK: pool authority
    #[account(address = const_pda::pool_authority::ID)]
    pub pool_authority: UncheckedAccount<'info>,

    /// CHECK: pool account - owner + discriminator (TransferHookPool only)
    pub pool: UncheckedAccount<'info>,

    #[account(mut, mint::token_program = token_program)]
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,

    pub operator: AccountLoader<'info, Operator>,

    pub signer: Signer<'info>,

    pub token_program: Program<'info, Token2022>,
}

pub fn handle_revoke_transfer_hook(ctx: Context<RevokeTransferHookCtx>) -> Result<()> {
    let pool_loader = PoolAccountLoader::try_from(&ctx.accounts.pool)?;
    require!(
        pool_loader.is_transfer_hook_pool(),
        PoolError::PoolTypeMismatch
    );

    let pool = pool_loader.load()?;
    require!(
        pool.base_mint.eq(&ctx.accounts.base_mint.key()),
        ErrorCode::ConstraintHasOne
    );
    drop(pool);

    // return Ok when noop
    // revoke_transfer_hook revokes the program and the authority
    let Some(transfer_hook_program) = get_transfer_hook_program_id(&ctx.accounts.base_mint)? else {
        return Ok(());
    };

    revoke_transfer_hook(
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
