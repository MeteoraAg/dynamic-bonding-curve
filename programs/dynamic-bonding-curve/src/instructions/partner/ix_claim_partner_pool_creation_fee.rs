use crate::{state::*, *};

/// Accounts for partner withdraw creation fees
#[event_cpi]
#[derive(Accounts)]
pub struct ClaimPartnerCreationFeeCtx<'info> {
    #[account(mut, has_one = config)]
    pub pool: AccountLoader<'info, VirtualPool>,

    #[account(has_one=fee_claimer)]
    pub config: AccountLoader<'info, PoolConfig>,

    pub fee_claimer: Signer<'info>,

    /// CHECK: fee receiver
    #[account(mut)]
    pub fee_receiver: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_partner_claim_pool_creation_fee(
    ctx: Context<ClaimPartnerCreationFeeCtx>,
) -> Result<()> {
    let pool = ctx.accounts.pool.load()?;

    if pool.has_creation_fee() && !pool.partner_pool_creation_fee_claimed() {
        let partner_pool_creation_fee = pool.get_partner_pool_creation_fee()?;
        drop(pool);

        // Transfer the creation fee to the treasury
        ctx.accounts.pool.sub_lamports(partner_pool_creation_fee)?;
        ctx.accounts
            .fee_receiver
            .add_lamports(partner_pool_creation_fee)?;

        let mut pool = ctx.accounts.pool.load_mut()?;
        pool.update_partner_pool_creation_fee_claimed();

        emit_cpi!(EvtClaimPoolCreationFee {
            pool: ctx.accounts.pool.key(),
            receiver: ctx.accounts.fee_receiver.key(),
            creation_fee: partner_pool_creation_fee,
        });
    }

    Ok(())
}
