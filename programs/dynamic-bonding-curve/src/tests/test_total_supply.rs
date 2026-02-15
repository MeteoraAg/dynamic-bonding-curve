use std::ops::Shl;

use crate::{
    constants::MAX_SQRT_PRICE,
    curve::{get_initial_liquidity_from_delta_base, get_initial_liquidity_from_delta_quote},
    params::liquidity_distribution::{
        get_base_token_for_swap, get_migration_base_token, get_migration_threshold_price,
        LiquidityDistributionParameters,
    },
    state::{MigrationOption, PoolConfig},
    LockedVestingParams,
};
use proptest::prelude::*;

fn get_sqrt_price_from_price(price: f64) -> u128 {
    let sqrt_price = price.sqrt();
    let sqrt_price_q64 = (sqrt_price * (1u128.shl(64) as f64)).floor() as u128;
    return sqrt_price_q64;
}

fn get_migration_amount(total_supply: u64, migration_percentage: f64) -> u64 {
    let supply = (migration_percentage * (total_supply as f64) / 100.0).floor();
    return supply as u64;
}

fn get_liquidity(
    base_amount: u64,
    quote_amount: u64,
    min_sqrt_price: u128,
    max_sqrt_price: u128,
) -> u128 {
    let liquidity_from_base: u128 =
        get_initial_liquidity_from_delta_base(base_amount, max_sqrt_price, min_sqrt_price)
            .unwrap()
            .try_into()
            .unwrap();
    let liquidity_from_quote =
        get_initial_liquidity_from_delta_quote(quote_amount, min_sqrt_price, max_sqrt_price)
            .unwrap();
    liquidity_from_base.min(liquidity_from_quote)
}

fn get_first_curve(
    migration_sqrt_price: u128,
    migration_amount: u64,
    swap_amount: u64,
    migration_quote_threshold: u64,
) -> (u128, Vec<LiquidityDistributionParameters>) {
    let sqrt_start_price = migration_sqrt_price
        .checked_mul(migration_amount.into())
        .unwrap()
        .checked_div(swap_amount.into())
        .unwrap();
    let liquidity = get_liquidity(
        swap_amount,
        migration_quote_threshold,
        sqrt_start_price,
        migration_sqrt_price,
    );
    // check remaining
    let curve = vec![LiquidityDistributionParameters {
        sqrt_price: migration_sqrt_price,
        liquidity,
    }];

    return (sqrt_start_price, curve);
}

pub struct ConstantProductParams {
    pub sqrt_start_price: u128,
    pub curve: Vec<LiquidityDistributionParameters>,
}
fn get_constant_product_curve(
    total_supply: u64,
    migration_amount: u64,
    migration_quote_threshold: u64,
    migration_option: MigrationOption,
    locked_vesting: LockedVestingParams,
) -> ConstantProductParams {
    let migration_price = (migration_quote_threshold as f64) / (migration_amount as f64);
    let migration_sqrt_price = get_sqrt_price_from_price(migration_price); //round up to reduce base token
    let migration_base_amount = get_migration_base_token(
        migration_quote_threshold,
        0,
        migration_sqrt_price,
        migration_option,
        false,
    )
    .unwrap();

    let swap_amount = total_supply
        .checked_sub(migration_base_amount)
        .unwrap()
        .checked_sub(locked_vesting.get_total_amount().unwrap())
        .unwrap();

    let (sqrt_start_price, mut curve) = get_first_curve(
        migration_sqrt_price,
        migration_base_amount,
        swap_amount,
        migration_quote_threshold,
    );

    let total_dynamic_supply = get_total_supply_from_curve(
        migration_quote_threshold,
        sqrt_start_price,
        &curve,
        locked_vesting,
        migration_option,
    );

    let remaining_amount = total_supply.checked_sub(total_dynamic_supply).unwrap();

    let last_liquidity = get_initial_liquidity_from_delta_base(
        remaining_amount,
        MAX_SQRT_PRICE,
        migration_sqrt_price,
    )
    .unwrap()
    .try_into()
    .unwrap();

    if last_liquidity != 0 {
        println!(
            "last_liquidity {} remaining_amount {}",
            last_liquidity, remaining_amount
        );
        curve.push(LiquidityDistributionParameters {
            sqrt_price: MAX_SQRT_PRICE,
            liquidity: last_liquidity,
        });
    }

    return ConstantProductParams {
        sqrt_start_price,
        curve,
    };
}

fn get_total_supply_from_curve(
    migration_quote_threshold: u64,
    sqrt_start_price: u128,
    curve: &Vec<LiquidityDistributionParameters>,
    locked_vesting: LockedVestingParams,
    migration_option: MigrationOption,
) -> u64 {
    let sqrt_migration_price =
        get_migration_threshold_price(migration_quote_threshold, sqrt_start_price, &curve).unwrap();

    let swap_base_amount_256 =
        get_base_token_for_swap(sqrt_start_price, sqrt_migration_price, &curve).unwrap();
    let swap_base_amount: u64 = swap_base_amount_256.try_into().unwrap();
    let swap_base_amount_buffer =
        PoolConfig::get_swap_amount_with_buffer(swap_base_amount, sqrt_start_price, &curve)
            .unwrap();

    let migration_base_amount = get_migration_base_token(
        migration_quote_threshold,
        0,
        sqrt_migration_price,
        migration_option,
        false,
    )
    .unwrap();

    let minimum_base_supply_with_buffer = PoolConfig::get_total_token_supply(
        swap_base_amount_buffer,
        migration_base_amount,
        &locked_vesting,
    )
    .unwrap();

    return minimum_base_supply_with_buffer;
}
#[test]
fn test_total_supply_without_lock_vesting() {
    let total_supply: u64 = 1_000_000_345_000_234_123; // 1B with 6 decimals
    let migration_quote_threshold: u64 = 50_000_000_002; // 50k usdc
    let migration_percentage: f64 = 34.1231232227;
    let migration_amount = get_migration_amount(total_supply, migration_percentage);
    let ConstantProductParams {
        sqrt_start_price,
        curve,
    } = get_constant_product_curve(
        total_supply,
        migration_amount,
        migration_quote_threshold,
        MigrationOption::DammV2,
        LockedVestingParams::default(),
    );
    // reverse
    let total_supply_reverse = get_total_supply_from_curve(
        migration_quote_threshold,
        sqrt_start_price,
        &curve,
        LockedVestingParams::default(),
        MigrationOption::DammV2,
    );
    assert!(total_supply_reverse == total_supply);
}

#[test]
fn test_total_supply_with_lock_vesting() {
    let total_supply: u64 = 1_000_000_345_000_234_123; // 1B with 6 decimals
    let migration_quote_threshold: u64 = 50_000_000_002; // 50k usdc
    let migration_percentage: f64 = 34.1231232227;
    let migration_amount = get_migration_amount(total_supply, migration_percentage);
    let lock_vesting = LockedVestingParams {
        amount_per_period: 10012323,
        cliff_duration_from_migration_time: 0,
        frequency: 1234,
        number_of_period: 100,
        cliff_unlock_amount: 20000,
    };
    let ConstantProductParams {
        sqrt_start_price,
        curve,
    } = get_constant_product_curve(
        total_supply,
        migration_amount,
        migration_quote_threshold,
        MigrationOption::DammV2,
        lock_vesting,
    );
    // reverse
    let total_supply_reverse = get_total_supply_from_curve(
        migration_quote_threshold,
        sqrt_start_price,
        &curve,
        lock_vesting,
        MigrationOption::DammV2,
    );
    assert!(total_supply_reverse == total_supply);
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 10000, .. ProptestConfig::default()
    })]
    #[test]
    fn test_fixed_token_supply(
        total_supply in 1_000_000_000u64..=10_000_000_000_000_000_000u64, // 10b of decimal = 9
        migration_quote_threshold in 100_000_000u64..=1_000_000_000_000u64, // 100 usdc to 1M usdc
        migration_percentage in 1u64..=49u64,
        migration_option in 0u64..=1u64,
    ) {
        let migration_percentage = migration_percentage as f64;
        let migration_amount = get_migration_amount(total_supply, migration_percentage);
        let migration_option = if migration_option == 0 {
            MigrationOption::MeteoraDamm
        }else{
            MigrationOption::DammV2
        };
        let ConstantProductParams {
            sqrt_start_price,
            curve,
        } =
            get_constant_product_curve(total_supply, migration_amount, migration_quote_threshold, migration_option, LockedVestingParams::default());
        // reverse
        let total_supply_reverse = get_total_supply_from_curve(
            migration_quote_threshold,
            sqrt_start_price,
            &curve,
            LockedVestingParams::default(),
            migration_option
        );
        assert!(total_supply_reverse == total_supply);
    }
}
