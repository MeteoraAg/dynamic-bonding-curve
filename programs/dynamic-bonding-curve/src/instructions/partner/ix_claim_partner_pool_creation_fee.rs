use crate::{state::*, token::transfer_lamports_from_pool_authority, *};

/// Accounts for partner withdraw creation fees
#[event_cpi]
#[derive(Accounts)]
pub struct ClaimPartnerPoolCreationFeeCtx<'info> {
    /// CHECK: pool authority
    #[account(
        mut,
        address = const_pda::pool_authority::ID
    )]
    pub pool_authority: UncheckedAccount<'info>,

    pub config: AccountLoader<'info, PoolConfig>,

    #[account(mut, has_one = config)]
    pub pool: AccountLoader<'info, VirtualPool>,

    pub fee_claimer: Signer<'info>,

    /// CHECK: fee receiver
    #[account(mut)]
    pub fee_receiver: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
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

    transfer_lamports_from_pool_authority(
        ctx.accounts.pool_authority.to_account_info(),
        ctx.accounts.fee_receiver.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        partner_fee,
    )?;

    emit_cpi!(EvtPartnerClaimPoolCreationFee {
        pool: ctx.accounts.pool.key(),
        partner: ctx.accounts.fee_claimer.key(),
        creation_fee: partner_fee,
    });

    Ok(())
}
