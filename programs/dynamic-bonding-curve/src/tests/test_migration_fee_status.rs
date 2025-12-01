use crate::state::{VirtualPool, CREATOR_MIGRATION_FEE_MASK, PARTNER_MIGRATION_FEE_MASK};

#[test]
fn test_migration_claim_fee_status() {
    let mut pool = VirtualPool::default();

    assert_eq!(
        pool.eligible_to_withdraw_migration_fee(PARTNER_MIGRATION_FEE_MASK),
        true
    );
    assert_eq!(
        pool.eligible_to_withdraw_migration_fee(CREATOR_MIGRATION_FEE_MASK),
        true
    );

    pool.update_withdraw_migration_fee(PARTNER_MIGRATION_FEE_MASK);
    assert_eq!(
        pool.eligible_to_withdraw_migration_fee(PARTNER_MIGRATION_FEE_MASK),
        false
    );
    assert_eq!(
        pool.eligible_to_withdraw_migration_fee(CREATOR_MIGRATION_FEE_MASK),
        true
    );

    pool.update_withdraw_migration_fee(CREATOR_MIGRATION_FEE_MASK);
    assert_eq!(
        pool.eligible_to_withdraw_migration_fee(PARTNER_MIGRATION_FEE_MASK),
        false
    );
    assert_eq!(
        pool.eligible_to_withdraw_migration_fee(CREATOR_MIGRATION_FEE_MASK),
        false
    );
}
