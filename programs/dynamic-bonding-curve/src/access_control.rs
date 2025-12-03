use crate::assert_eq_admin;
use crate::state::{ClaimFeeOperator, PoolConfig, VirtualPool};
use crate::PoolError;
use anchor_lang::prelude::*;
// check whether the signer is in admin list
pub fn is_admin(signer: &Pubkey) -> Result<()> {
    require!(assert_eq_admin(signer.key()), PoolError::InvalidAdmin);
    Ok(())
}

pub fn is_claim_fee_operator<'info>(
    claim_fee_operator: &AccountLoader<'info, ClaimFeeOperator>,
    signer: &Pubkey,
) -> Result<()> {
    let claim_fee_operator = claim_fee_operator.load()?;
    require!(
        claim_fee_operator.operator.eq(signer),
        PoolError::Unauthorized
    );
    Ok(())
}

pub fn is_partner_fee_claimer<'info>(
    config: &AccountLoader<'info, PoolConfig>,
    fee_claimer: &Pubkey,
) -> Result<()> {
    let config = config.load()?;
    require!(config.fee_claimer.eq(fee_claimer), PoolError::Unauthorized);
    Ok(())
}

pub fn is_pool_creator<'info>(
    pool: &AccountLoader<'info, VirtualPool>,
    creator: &Pubkey,
) -> Result<()> {
    let pool = pool.load()?;
    require!(pool.creator.eq(creator), PoolError::Unauthorized);
    Ok(())
}
