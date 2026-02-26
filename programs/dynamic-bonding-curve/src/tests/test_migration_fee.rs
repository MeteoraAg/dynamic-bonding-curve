use crate::damm_v2_utils::calculate_concentrated_liquidity;
use crate::damm_v2_utils::get_liquidity_handler;
use crate::damm_v2_utils::CompoundingLiquidity;
use crate::damm_v2_utils::ConcentratedLiquidity;
use crate::damm_v2_utils::InitialPoolInformation;
use crate::damm_v2_utils::LiquidityHandler;
use crate::damm_v2_utils::MigratedCollectFeeMode;
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
        sqrt_price in MIN_SQRT_PRICE..MAX_SQRT_PRICE
    ) {
         let price = U256::from(sqrt_price)
            .safe_mul(U256::from(sqrt_price))
            .unwrap();

        let (migration_base_amount, _rem) =
                U256::from(migration_quote_amount).safe_shl(128).unwrap().div_rem(price);
        let  migration_base_amount: u64 = migration_base_amount.try_into().unwrap();


        let initial_liquidity = calculate_concentrated_liquidity(migration_base_amount, migration_quote_amount, sqrt_price).unwrap();

        if initial_liquidity == 0 {
            return Ok(());
        }

        let liquidity_handler = ConcentratedLiquidity{};
        let (base_fee_amount, quote_fee_amount) = liquidity_handler.get_migration_protocol_fees(
             migration_base_amount,
            migration_quote_amount,
            PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS,
            sqrt_price
          ).unwrap();

        let excluced_fee_migration_base_amount = migration_base_amount.checked_sub(base_fee_amount).unwrap();
        let excluced_fee_migration_quote_amount = migration_quote_amount.checked_sub(quote_fee_amount).unwrap();

        let excluded_fee_initial_liquidity = calculate_concentrated_liquidity(excluced_fee_migration_base_amount, excluced_fee_migration_quote_amount, sqrt_price).unwrap();

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
        sqrt_price in MIN_SQRT_PRICE..MAX_SQRT_PRICE
    ) {
        let liquidity_handler = CompoundingLiquidity{};
        let (migrate_base_amount, migrate_quote_amount) = liquidity_handler.get_migrate_amounts(migration_quote_amount, 0, sqrt_price).unwrap();
        let (base_fee_amount, quote_fee_amount) = liquidity_handler.get_migration_protocol_fees(
            migrate_base_amount,
            migration_quote_amount,
            PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS,
            sqrt_price,
        ).unwrap();

        let excluced_fee_migration_base_amount = migrate_base_amount.checked_sub(base_fee_amount).unwrap();
        let excluced_fee_migration_quote_amount = migrate_quote_amount.checked_sub(quote_fee_amount).unwrap();

        let InitialPoolInformation{
            distributable_liquidity: initial_liquidity,
            ..
        } = liquidity_handler.get_initial_pool_information(excluced_fee_migration_base_amount, excluced_fee_migration_quote_amount, sqrt_price).unwrap();

        assert!(initial_liquidity > 0);
    }
}

proptest! {
    #[test]
    fn test_damm_v1_protocol_base_amount_computed_from_protocol_quote_amount_always_lesser(
        quote_amount in 10_000_000_000_000u64..u64::MAX,
        sqrt_price in MIN_SQRT_PRICE..MAX_SQRT_PRICE
    ) {
         let price = U256::from(sqrt_price)
            .safe_mul(U256::from(sqrt_price))
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

        let liquidity_handler = get_liquidity_handler(  MigrationOption::MeteoraDamm, MigratedCollectFeeMode::OutputToken);
        let (computed_protocol_base_fee_amount, _protocol_fee_quote_amount) = liquidity_handler.get_migration_protocol_fees(migration_base_amount, quote_amount, PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS, sqrt_price).unwrap();

        assert!(computed_protocol_base_fee_amount <= protocol_fee_base_amount);
    }
}

proptest! {
    #[test]
    fn test_damm_v1_protocol_fee_rounding_avoid_price_increment(
        quote_amount in 10_000_000_000_000u64..u64::MAX,
        sqrt_price in MIN_SQRT_PRICE..MAX_SQRT_PRICE
    ) {
        let price_0 = U256::from(sqrt_price)
            .safe_mul(U256::from(sqrt_price))
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


        let liquidity_handler = get_liquidity_handler(  MigrationOption::MeteoraDamm, MigratedCollectFeeMode::OutputToken);
        let (protocol_fee_base_amount, protocol_fee_quote_amount) = liquidity_handler.get_migration_protocol_fees(migration_base_amount, quote_amount, PROTOCOL_LIQUIDITY_MIGRATION_FEE_BPS, sqrt_price).unwrap();

        let excluded_fee_base_amount = migration_base_amount.safe_sub(protocol_fee_base_amount).unwrap();
        let excluded_fee_quote_amount = quote_amount.safe_sub(protocol_fee_quote_amount).unwrap();

        let price_1 = U256::from(excluded_fee_quote_amount)
            .safe_shl(128).unwrap()
            .safe_div(U256::from(excluded_fee_base_amount)).unwrap();


        assert!(price_1 <= price_0);

    }
}
