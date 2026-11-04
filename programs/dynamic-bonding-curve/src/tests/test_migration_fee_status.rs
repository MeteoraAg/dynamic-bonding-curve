use crate::state::{VirtualPool, CREATOR_MIGRATION_FEE_MASK, PARTNER_MIGRATION_FEE_MASK};

#[test]
fn test_migration_claim_fee_status() {
    let mut pool = VirtualPool::default();

    assert!(pool.eligible_to_withdraw_migration_fee(PARTNER_MIGRATION_FEE_MASK));
    assert!(pool.eligible_to_withdraw_migration_fee(CREATOR_MIGRATION_FEE_MASK));

    pool.update_withdraw_migration_fee(PARTNER_MIGRATION_FEE_MASK);
    assert!(!pool.eligible_to_withdraw_migration_fee(PARTNER_MIGRATION_FEE_MASK));
    assert!(pool.eligible_to_withdraw_migration_fee(CREATOR_MIGRATION_FEE_MASK));

    pool.update_withdraw_migration_fee(CREATOR_MIGRATION_FEE_MASK);
    assert!(!pool.eligible_to_withdraw_migration_fee(PARTNER_MIGRATION_FEE_MASK));
    assert!(!pool.eligible_to_withdraw_migration_fee(CREATOR_MIGRATION_FEE_MASK));
}
