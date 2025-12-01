use crate::{state::*, token::transfer_lamports_from_pool_authority, EvtClaimPoolCreationFee, *};

/// Accounts for withdraw creation fees
#[event_cpi]
#[derive(Accounts)]
pub struct ClaimProtocolPoolCreationFeeCtx<'info> {
    /// CHECK: pool authority
    #[account(
        mut,
        address = const_pda::pool_authority::ID
    )]
    pub pool_authority: UncheckedAccount<'info>,

    pub config: AccountLoader<'info, PoolConfig>,

    #[account(mut, has_one = config)]
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

pub fn handle_claim_protocol_pool_creation_fee(
    ctx: Context<ClaimProtocolPoolCreationFeeCtx>,
) -> Result<()> {
    let config = ctx.accounts.config.load()?;

    let (protocol_fee, _) = config.split_pool_creation_fee()?;

    require!(protocol_fee > 0, PoolError::ZeroPoolCreationFee);

    let mut pool = ctx.accounts.pool.load_mut()?;

    require!(
        pool.eligible_to_claim_protocol_pool_creation_fee(),
        PoolError::PoolCreationFeeHasBeenClaimed
    );

    // update flag status
    pool.update_protocol_pool_creation_fee_claimed();

    transfer_lamports_from_pool_authority(
        ctx.accounts.pool_authority.to_account_info(),
        ctx.accounts.treasury.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        protocol_fee,
    )?;

    emit_cpi!(EvtClaimPoolCreationFee {
        pool: ctx.accounts.pool.key(),
        receiver: ctx.accounts.treasury.key(),
        creation_fee: protocol_fee,
    });

    Ok(())
}
