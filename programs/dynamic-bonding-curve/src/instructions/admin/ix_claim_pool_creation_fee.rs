use crate::{state::*, EvtClaimPoolCreationFee, *};

/// Accounts for withdraw creation fees
#[event_cpi]
#[derive(Accounts)]
pub struct ClaimCreationFeeCtx<'info> {
    #[account(mut)]
    pub pool: AccountLoader<'info, VirtualPool>,

    /// Claim fee operator
    #[account(has_one = operator)]
    pub claim_fee_operator: AccountLoader<'info, ClaimFeeOperator>,

    /// Operator
    pub operator: Signer<'info>,

    /// CHECK: treasury
    #[account(
        mut,
        address = treasury::ID
    )]
    pub treasury: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_claim_pool_creation_fee(ctx: Context<ClaimCreationFeeCtx>) -> Result<()> {
    let pool = ctx.accounts.pool.load()?;

    if pool.has_creation_fee() && !pool.protocol_pool_creation_fee_claimed() {
        let protocol_pool_creation_fee = pool.get_protocol_pool_creation_fee()?;
        drop(pool);

        // Transfer the creation fee to the treasury
        ctx.accounts.pool.sub_lamports(protocol_pool_creation_fee)?;
        ctx.accounts
            .treasury
            .add_lamports(protocol_pool_creation_fee)?;

        let mut pool = ctx.accounts.pool.load_mut()?;
        pool.update_protocol_pool_creation_fee_claimed();

        emit_cpi!(EvtClaimPoolCreationFee {
            pool: ctx.accounts.pool.key(),
            receiver: ctx.accounts.treasury.key(),
            creation_fee: protocol_pool_creation_fee,
        });
    }

    Ok(())
}
