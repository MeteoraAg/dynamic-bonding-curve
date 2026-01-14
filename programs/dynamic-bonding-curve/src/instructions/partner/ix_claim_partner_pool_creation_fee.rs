use crate::{state::*, token::transfer_lamports_from_pool_account, *};

/// Accounts for partner withdraw creation fees
#[event_cpi]
#[derive(Accounts)]
pub struct ClaimPartnerPoolCreationFeeCtx<'info> {
    pub config: AccountLoader<'info, PoolConfig>,

    #[account(mut, has_one = config)]
    pub pool: AccountLoader<'info, VirtualPool>,

    pub fee_claimer: Signer<'info>,

    /// CHECK: fee receiver
    #[account(mut)]
    pub fee_receiver: UncheckedAccount<'info>,
}

pub fn handle_claim_partner_pool_creation_fee(
    ctx: Context<ClaimPartnerPoolCreationFeeCtx>,
) -> Result<()> {
    let config = ctx.accounts.config.load()?;

    let (_, partner_fee) = config.split_pool_creation_fee()?;

    require!(partner_fee > 0, PoolError::ZeroPoolCreationFee);

    let mut pool = ctx.accounts.pool.load_mut()?;

    require!(
        pool.eligible_to_claim_partner_pool_creation_fee(),
        PoolError::PoolCreationFeeHasBeenClaimed
    );

    // update flag status
    pool.update_partner_pool_creation_fee_claimed();

    transfer_lamports_from_pool_account(
        ctx.accounts.pool.to_account_info(),
        ctx.accounts.fee_receiver.to_account_info(),
        partner_fee,
    )?;

    emit_cpi!(EvtPartnerClaimPoolCreationFee {
        pool: ctx.accounts.pool.key(),
        partner: ctx.accounts.fee_claimer.key(),
        creation_fee: partner_fee,
        fee_receiver: ctx.accounts.fee_receiver.key(),
    });

    Ok(())
}
