use crate::{state::*, token::transfer_lamports_from_pool_account, EvtClaimPoolCreationFee, *};

// Move the constant here, because the fixed fee logic is removed
const TOKEN_2022_POOL_WITH_OUTPUT_FEE_COLLECTION_CREATION_FEE: u64 = 10_000_000;

/// Accounts for withdraw creation fees
#[event_cpi]
#[derive(Accounts)]
pub struct ClaimLegacyCreationFeeCtx<'info> {
    #[account(mut)]
    pub pool: AccountLoader<'info, VirtualPool>,

    /// Claim fee operator
    pub claim_fee_operator: AccountLoader<'info, ClaimFeeOperator>,

    /// Operator
    pub signer: Signer<'info>,

    /// CHECK: treasury
    #[account(
        mut,
        address = treasury::ID
    )]
    pub treasury: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_claim_legacy_pool_creation_fee(
    ctx: Context<ClaimLegacyCreationFeeCtx>,
) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;

    require!(
        pool.has_legacy_creation_fee() && pool.eligible_to_claim_legacy_creation_fee(),
        PoolError::Unauthorized
    );

    pool.update_legacy_creation_fee_claimed();
    drop(pool);

    // Transfer the creation fee to the treasury
    transfer_lamports_from_pool_account(
        ctx.accounts.pool.to_account_info(),
        ctx.accounts.treasury.to_account_info(),
        TOKEN_2022_POOL_WITH_OUTPUT_FEE_COLLECTION_CREATION_FEE,
    )?;

    emit_cpi!(EvtClaimPoolCreationFee {
        pool: ctx.accounts.pool.key(),
        receiver: ctx.accounts.treasury.key(),
        creation_fee: TOKEN_2022_POOL_WITH_OUTPUT_FEE_COLLECTION_CREATION_FEE,
    });

    Ok(())
}
