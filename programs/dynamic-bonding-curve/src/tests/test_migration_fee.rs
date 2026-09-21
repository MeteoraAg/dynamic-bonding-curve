use crate::migration_handler::calculate_concentrated_initial_liquidity;
use crate::migration_handler::get_migration_handler;
use crate::migration_handler::CompoundingLiquidity;
use crate::migration_handler::ConcentratedLiquidity;
use crate::migration_handler::InitialPoolInformation;
use crate::migration_handler::MigratedCollectFeeMode;
use crate::migration_handler::MigrationHandler;
use crate::utils_math::safe_mul_div_cast_u128;
use crate::{
    constants::{
        fee::PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS, BASIS_POINT_MAX, MAX_SQRT_PRICE, MIN_SQRT_PRICE,
    },
    safe_math::SafeMath,
    state::MigrationOption,
    u128x128_math::Rounding,
    utils_math::safe_mul_div_cast_u64,
};

use proptest::prelude::*;
use ruint::aliases::U256;

proptest! {
    #[test]
    fn test_damm_v2_protocol_migration_fee(
        migration_quote_amount in 100_000_000u64..u64::MAX,
        migration_sqrt_price in MIN_SQRT_PRICE..MAX_SQRT_PRICE
    ) {
         let price = U256::from(migration_sqrt_price)
            .safe_mul(U256::from(migration_sqrt_price))
            .unwrap();

        let (migration_base_amount, _rem) =
                U256::from(migration_quote_amount).safe_shl(128).unwrap().div_rem(price);
        let  migration_base_amount: u64 = migration_base_amount.try_into().unwrap();


        let initial_liquidity = calculate_concentrated_initial_liquidity(migration_base_amount, migration_quote_amount, migration_sqrt_price).unwrap();

        if initial_liquidity == 0 {
            return Ok(());
        }

        let liquidity_handler = ConcentratedLiquidity{migration_sqrt_price};
        let (base_fee_amount, quote_fee_amount) = liquidity_handler.get_migration_protocol_fees(
             migration_base_amount,
            migration_quote_amount,
            PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS,
          ).unwrap();

        let excluced_fee_migration_base_amount = migration_base_amount.checked_sub(base_fee_amount).unwrap();
        let excluced_fee_migration_quote_amount = migration_quote_amount.checked_sub(quote_fee_amount).unwrap();

        let excluded_fee_initial_liquidity = calculate_concentrated_initial_liquidity(excluced_fee_migration_base_amount, excluced_fee_migration_quote_amount, migration_sqrt_price).unwrap();

        let fee_liquidity = initial_liquidity.checked_sub(excluded_fee_initial_liquidity).unwrap();

        let fee_liquidity_bps = safe_mul_div_cast_u128(fee_liquidity, BASIS_POINT_MAX.into(), initial_liquidity, Rounding::Down).unwrap();

        // println!("fee_liquidity_bps {} {} {} {} {}",  fee_liquidity_bps, migration_base_amount, migration_quote_amount, base_fee_amount, quote_fee_amount);
        assert!(fee_liquidity_bps <= PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS.into());
    }
}

proptest! {
    #[test]
    fn test_compounding_protocol_migration_fee(
        migration_quote_amount in 1_000_000_000u64..u64::MAX,
        migration_sqrt_price in MIN_SQRT_PRICE..MAX_SQRT_PRICE
    ) {
        let liquidity_handler = CompoundingLiquidity{
                migration_sqrt_price
        };
        let (migrate_base_amount, migrate_quote_amount) = liquidity_handler.get_included_protocol_fee_migration_amounts_1(migration_quote_amount, 0).unwrap();
        let (base_fee_amount, quote_fee_amount) = liquidity_handler.get_migration_protocol_fees(
            migrate_base_amount,
            migration_quote_amount,
            PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS,
        ).unwrap();

        let excluced_fee_migration_base_amount = migrate_base_amount.checked_sub(base_fee_amount).unwrap();
        let excluced_fee_migration_quote_amount = migrate_quote_amount.checked_sub(quote_fee_amount).unwrap();

        let InitialPoolInformation{
            distributable_liquidity: initial_liquidity,
            ..
        } = liquidity_handler.get_initial_pool_information(excluced_fee_migration_base_amount, excluced_fee_migration_quote_amount).unwrap();

        assert!(initial_liquidity > 0);
    }
}

proptest! {
    #[test]
    fn test_damm_v1_protocol_base_amount_computed_from_protocol_quote_amount_always_lesser(
        quote_amount in 10_000_000_000_000u64..u64::MAX,
        migration_sqrt_price in MIN_SQRT_PRICE..MAX_SQRT_PRICE
    ) {
         let price = U256::from(migration_sqrt_price)
            .safe_mul(U256::from(migration_sqrt_price))
            .unwrap();

        let (migration_base_amount, rem) =
                U256::from(quote_amount).safe_shl(128).unwrap().div_rem(price);

        let mut migration_base_amount: u64 = migration_base_amount.try_into().unwrap();

        if !rem.is_zero() {
            migration_base_amount = migration_base_amount.safe_add(1).unwrap();
        }

        if migration_base_amount == 0 {
            return Ok(());
        }

        let protocol_fee_base_amount: u64 = safe_mul_div_cast_u64(
            migration_base_amount,
            PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS.into(),
            BASIS_POINT_MAX,
            Rounding::Down,
        ).unwrap();

        let liquidity_handler = get_migration_handler(  MigrationOption::MeteoraDamm, MigratedCollectFeeMode::OutputToken, migration_sqrt_price);
        let (computed_protocol_base_fee_amount, _protocol_fee_quote_amount) = liquidity_handler.get_migration_protocol_fees(migration_base_amount, quote_amount, PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS).unwrap();

        assert!(computed_protocol_base_fee_amount <= protocol_fee_base_amount);
    }
}

proptest! {
    #[test]
    fn test_damm_v1_protocol_fee_rounding_avoid_price_increment(
        quote_amount in 10_000_000_000_000u64..u64::MAX,
        migration_sqrt_price in MIN_SQRT_PRICE..MAX_SQRT_PRICE
    ) {
        let price_0 = U256::from(migration_sqrt_price)
            .safe_mul(U256::from(migration_sqrt_price))
            .unwrap();

        let (migration_base_amount, rem) =
                U256::from(quote_amount).safe_shl(128).unwrap().div_rem(price_0);

        let mut migration_base_amount: u64 = migration_base_amount.try_into().unwrap();

        if !rem.is_zero() {
            migration_base_amount = migration_base_amount.safe_add(1).unwrap();
        }

        if migration_base_amount == 0 {
            return Ok(());
        }

        let price_0 = U256::from(quote_amount)
            .safe_shl(128).unwrap()
            .safe_div(U256::from(migration_base_amount)).unwrap();


        let liquidity_handler = get_migration_handler(  MigrationOption::MeteoraDamm, MigratedCollectFeeMode::OutputToken, migration_sqrt_price);
        let (protocol_fee_base_amount, protocol_fee_quote_amount) = liquidity_handler.get_migration_protocol_fees(migration_base_amount, quote_amount, PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS).unwrap();

        let excluded_fee_base_amount = migration_base_amount.safe_sub(protocol_fee_base_amount).unwrap();
        let excluded_fee_quote_amount = quote_amount.safe_sub(protocol_fee_quote_amount).unwrap();

        let price_1 = U256::from(excluded_fee_quote_amount)
            .safe_shl(128).unwrap()
            .safe_div(U256::from(excluded_fee_base_amount)).unwrap();


        assert!(price_1 <= price_0);

    }
}

/// When both mints charge the same rate, each side gives up exactly its own fee and
/// neither is scaled down to match the other, so neither mint is left with a surplus.
/// No `FEE_CASES` entry covers equal rates, so this is the only guard on that path.
#[test]
fn test_equal_transfer_fee_rates_leave_no_surplus() {
    use anchor_spl::token_2022::spl_token_2022::extension::transfer_fee::TransferFee;
    use anchor_spl::token_interface::spl_pod::primitives::{PodU16, PodU64};

    let liquidity_handler = CompoundingLiquidity {
        migration_sqrt_price: MIN_SQRT_PRICE << 32,
    };

    let fee = |bps: u16| TransferFee {
        epoch: PodU64::from(0),
        transfer_fee_basis_points: PodU16::from(bps),
        maximum_fee: PodU64::from(u64::MAX),
    };

    for bps in [1u16, 100, 250, 1000] {
        let base_budget: u64 = 2_500_000_000;
        let quote_budget: u64 = 5_000_000_000;
        let base_fee = fee(bps);
        let quote_fee = fee(bps);

        let (base_fee_amount, quote_fee_amount) = liquidity_handler
            .get_migration_transfer_fee_amounts(
                Some(&base_fee),
                Some(&quote_fee),
                base_budget,
                quote_budget,
            )
            .unwrap();

        let (base_amount, quote_amount) = liquidity_handler
            .get_migration_deposit_amounts(
                base_budget,
                quote_budget,
                base_budget.safe_sub(base_fee_amount).unwrap(),
                quote_budget.safe_sub(quote_fee_amount).unwrap(),
            )
            .unwrap();

        // the surplus is whatever the scaling holds back on top of the mint's own fee
        let base_surplus = base_budget
            .safe_sub(base_fee_amount)
            .unwrap()
            .saturating_sub(base_amount);
        let quote_surplus = quote_budget
            .safe_sub(quote_fee_amount)
            .unwrap()
            .saturating_sub(quote_amount);

        assert_eq!(base_surplus, 0, "base surplus at {} bps on both mints", bps);
        assert_eq!(
            quote_surplus, 0,
            "quote surplus at {} bps on both mints",
            bps
        );
    }

    // the same measurement must find a surplus when the rates differ, otherwise the
    // assertions above would hold for any implementation
    let base_fee = fee(250);
    let quote_fee = fee(100);
    let base_budget: u64 = 2_500_000_000;
    let quote_budget: u64 = 5_000_000_000;

    let (base_fee_amount, quote_fee_amount) = liquidity_handler
        .get_migration_transfer_fee_amounts(
            Some(&base_fee),
            Some(&quote_fee),
            base_budget,
            quote_budget,
        )
        .unwrap();

    let (base_amount, quote_amount) = liquidity_handler
        .get_migration_deposit_amounts(
            base_budget,
            quote_budget,
            base_budget.safe_sub(base_fee_amount).unwrap(),
            quote_budget.safe_sub(quote_fee_amount).unwrap(),
        )
        .unwrap();

    let base_surplus = base_budget
        .safe_sub(base_fee_amount)
        .unwrap()
        .saturating_sub(base_amount);
    let quote_surplus = quote_budget
        .safe_sub(quote_fee_amount)
        .unwrap()
        .saturating_sub(quote_amount);

    // base charges the larger rate, so base binds and the surplus lands on quote
    assert_eq!(base_surplus, 0);
    assert!(quote_surplus > 0);
}
