use crate::PoolAccountLoader;
use crate::{
    event::{EvtPartnerClaimPoolCreationFee, EvtPartnerClaimPoolCreationFeeWithTransferHook},
    state::*,
    token::transfer_lamports_from_pool_account,
    *,
};

/// Accounts for partner withdraw creation fees
#[event_cpi]
#[derive(Accounts)]
pub struct ClaimPartnerPoolCreationFeeCtx<'info> {
    /// CHECK: Validated by ConfigAccountLoader
    pub config: UncheckedAccount<'info>,

    /// CHECK: Validated by PoolAccountLoader
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,

    pub fee_claimer: Signer<'info>,

    /// CHECK: fee receiver
    #[account(mut)]
    pub fee_receiver: UncheckedAccount<'info>,
}

pub fn handle_claim_partner_pool_creation_fee(
    ctx: Context<ClaimPartnerPoolCreationFeeCtx>,
) -> Result<()> {
    let config_loader = ConfigAccountLoader::try_from(&ctx.accounts.config)?;
    let config = config_loader.load()?;

    let (_, partner_fee) = config.split_pool_creation_fee()?;

    require!(partner_fee > 0, PoolError::ZeroPoolCreationFee);

    let pool_loader = PoolAccountLoader::try_from(&ctx.accounts.pool)?;
    let mut pool = pool_loader.load_mut()?;
    require!(
        pool.config.eq(&ctx.accounts.config.key()),
        PoolError::InvalidAccount
    );

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

    if pool_loader.is_transfer_hook_pool() {
        emit_cpi!(EvtPartnerClaimPoolCreationFeeWithTransferHook {
            pool: ctx.accounts.pool.key(),
            partner: ctx.accounts.fee_claimer.key(),
            creation_fee: partner_fee,
            fee_receiver: ctx.accounts.fee_receiver.key(),
        });
    } else {
        emit_cpi!(EvtPartnerClaimPoolCreationFee {
            pool: ctx.accounts.pool.key(),
            partner: ctx.accounts.fee_claimer.key(),
            creation_fee: partner_fee,
            fee_receiver: ctx.accounts.fee_receiver.key(),
        });
    }

    Ok(())
}
