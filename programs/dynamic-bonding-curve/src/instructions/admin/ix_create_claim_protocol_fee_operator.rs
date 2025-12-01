use anchor_lang::prelude::*;

use crate::{
    constants::seeds::CLAIM_FEE_OPERATOR_PREFIX, state::ClaimFeeOperator, EvtCreateClaimFeeOperator,
};

#[event_cpi]
#[derive(Accounts)]
pub struct CreateClaimFeeOperatorCtx<'info> {
    #[account(
        init,
        payer = payer,
        seeds = [
            CLAIM_FEE_OPERATOR_PREFIX.as_ref(),
            operator.key().as_ref(),
        ],
        bump,
        space = 8 + ClaimFeeOperator::INIT_SPACE
    )]
    pub claim_fee_operator: AccountLoader<'info, ClaimFeeOperator>,

    /// CHECK: operator
    pub operator: UncheckedAccount<'info>,

    pub signer: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create_claim_fee_operator(ctx: Context<CreateClaimFeeOperatorCtx>) -> Result<()> {
    let mut claim_fee_operator = ctx.accounts.claim_fee_operator.load_init()?;
    claim_fee_operator.initialize(ctx.accounts.operator.key())?;

    emit_cpi!(EvtCreateClaimFeeOperator {
        operator: ctx.accounts.operator.key(),
    });

    Ok(())
}
