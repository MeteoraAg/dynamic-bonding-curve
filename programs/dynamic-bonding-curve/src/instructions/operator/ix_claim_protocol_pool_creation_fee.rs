use crate::{
    event::{EvtClaimPoolCreationFee, EvtClaimPoolCreationFeeWithTransferHook},
    safe_math::SafeMath,
    state::*,
    token::transfer_lamports_from_pool_account,
    *,
};

// Move the constant here, because the fixed fee logic is removed
const TOKEN_2022_POOL_WITH_OUTPUT_FEE_COLLECTION_CREATION_FEE: u64 = 10_000_000;

/// Accounts for withdraw creation fees
#[event_cpi]
#[derive(Accounts)]
pub struct ClaimProtocolPoolCreationFeeCtx<'info> {
    /// CHECK: Validated by ConfigAccountLoader
    pub config: UncheckedAccount<'info>,

    /// CHECK: Validated by PoolAccountLoader
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,

    pub operator: AccountLoader<'info, Operator>,

    /// Operator
    pub signer: Signer<'info>,

    /// CHECK: treasury
    #[account(
        mut,
        address = treasury::ID
    )]
    pub treasury: UncheckedAccount<'info>,
}

pub fn handle_claim_protocol_pool_creation_fee(
    ctx: Context<ClaimProtocolPoolCreationFeeCtx>,
) -> Result<()> {
    let config_loader = ConfigAccountLoader::try_from(&ctx.accounts.config)?;
    let config = config_loader.load()?;
    let pool_loader = PoolAccountLoader::try_from(&ctx.accounts.pool)?;
    let mut pool = pool_loader.load_mut()?;

    require!(
        pool.config.eq(&ctx.accounts.config.key()),
        PoolError::InvalidAccount
    );
    let mut protocol_fee = if pool.eligible_to_claim_protocol_pool_creation_fee() {
        pool.update_protocol_pool_creation_fee_claimed();
        let (protocol_fee, _) = config.split_pool_creation_fee()?;
        protocol_fee
    } else {
        0
    };

    if pool.has_legacy_creation_fee() && pool.eligible_to_claim_legacy_creation_fee() {
        pool.update_legacy_creation_fee_claimed();
        protocol_fee =
            protocol_fee.safe_add(TOKEN_2022_POOL_WITH_OUTPUT_FEE_COLLECTION_CREATION_FEE)?;
    }

    if protocol_fee > 0 {
        transfer_lamports_from_pool_account(
            ctx.accounts.pool.to_account_info(),
            ctx.accounts.treasury.to_account_info(),
            protocol_fee,
        )?;
    }

    if pool_loader.is_transfer_hook_pool() {
        emit_cpi!(EvtClaimPoolCreationFeeWithTransferHook {
            pool: ctx.accounts.pool.key(),
            receiver: ctx.accounts.treasury.key(),
            creation_fee: protocol_fee,
        });
    } else {
        emit_cpi!(EvtClaimPoolCreationFee {
            pool: ctx.accounts.pool.key(),
            receiver: ctx.accounts.treasury.key(),
            creation_fee: protocol_fee,
        });
    }

    Ok(())
}
