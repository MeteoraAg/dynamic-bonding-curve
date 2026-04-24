use crate::assert_eq_admin;
use crate::state::{ClaimFeeOperator, Operator, OperatorPermission};
use crate::PoolError;
use crate::{ConfigAccountLoader, PoolAccountLoader};
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
    config: &AccountInfo<'info>,
    fee_claimer: &Pubkey,
) -> Result<()> {
    let config_loader = ConfigAccountLoader::try_from(config)?;
    let config = config_loader.load()?;
    require!(config.fee_claimer.eq(fee_claimer), PoolError::Unauthorized);
    Ok(())
}

pub fn is_pool_creator<'info>(pool: &AccountInfo<'info>, creator: &Pubkey) -> Result<()> {
    let loader = PoolAccountLoader::try_from(pool)?;
    let pool = loader.load()?;
    require!(pool.creator.eq(creator), PoolError::Unauthorized);
    Ok(())
}

pub fn is_valid_operator_role<'info>(
    operator: &AccountLoader<'info, Operator>,
    signer: &Pubkey,
    permission: OperatorPermission,
) -> Result<()> {
    let operator = operator.load()?;

    if operator.whitelisted_address.eq(signer) && operator.is_permission_allow(permission) {
        Ok(())
    } else {
        err!(PoolError::InvalidPermission)
    }
}
