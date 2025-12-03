use anchor_lang::prelude::*;

use crate::{state::ClaimFeeOperator, EvtCloseClaimFeeOperator};

#[event_cpi]
#[derive(Accounts)]
pub struct CloseClaimProtocolFeeOperatorCtx<'info> {
    #[account(
        mut,
        close = rent_receiver,
    )]
    pub claim_fee_operator: AccountLoader<'info, ClaimFeeOperator>,

    /// CHECK: rent receiver
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,

    pub signer: Signer<'info>,
}

pub fn handle_close_claim_protocol_fee_operator(
    ctx: Context<CloseClaimProtocolFeeOperatorCtx>,
) -> Result<()> {
    let claim_fee_operator = ctx.accounts.claim_fee_operator.load()?;
    emit_cpi!(EvtCloseClaimFeeOperator {
        claim_fee_operator: ctx.accounts.claim_fee_operator.key(),
        operator: claim_fee_operator.operator,
    });

    Ok(())
}
