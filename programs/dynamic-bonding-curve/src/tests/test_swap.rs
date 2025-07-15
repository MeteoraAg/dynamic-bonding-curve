use anchor_lang::prelude::Pubkey;

use crate::{
    constants::{MAX_CURVE_POINT, MAX_SQRT_PRICE},
    params::{
        liquidity_distribution::{
            get_base_token_for_swap, get_migration_base_token, get_migration_threshold_price,
            LiquidityDistributionParameters,
        },
        swap::TradeDirection,
    },
    state::{
        fee::{FeeMode, VolatilityTracker},
        CollectFeeMode, LiquidityDistributionConfig, MigrationOption, PoolConfig, VirtualPool,
    },
};

use super::price_math::get_price_from_id;

#[test]
fn test_swap() {
    let migration_quote_threshold = 50_000_000_000; // 50k usdc
    let bin_step = 80; // 80bps
    let sqrt_active_id = -100;
    // price = (1+bin_step/10000)^(sqrt_active_id*2)
    let sqrt_start_price: u128 = get_price_from_id(sqrt_active_id, bin_step).unwrap(); // price = 0.20
    let curve = vec![LiquidityDistributionParameters {
        sqrt_price: MAX_SQRT_PRICE,
        liquidity: 1_000_000_000_000_000_000_000_000u128
            .checked_shl(64)
            .unwrap(),
    }];

    let mut config = PoolConfig {
        migration_quote_threshold,
        sqrt_start_price,
        collect_fee_mode: CollectFeeMode::OutputToken.into(),
        ..Default::default()
    };
    let curve_length = curve.len();
    for i in 0..MAX_CURVE_POINT {
        if i < curve_length {
            config.curve[i] = curve[i].to_liquidity_distribution_config();
        } else {
            config.curve[i] = LiquidityDistributionConfig {
                sqrt_price: MAX_SQRT_PRICE, // set max
                liquidity: 0,
            }
        }
    }

    let sqrt_migration_price =
        get_migration_threshold_price(migration_quote_threshold, sqrt_start_price, &curve).unwrap();
    let swap_base_amount =
        get_base_token_for_swap(sqrt_start_price, sqrt_migration_price, &curve).unwrap();
    let migration_base_amount = get_migration_base_token(
        migration_quote_threshold,
        0,
        sqrt_migration_price,
        MigrationOption::MeteoraDamm,
    )
    .unwrap();
    println!(
        "swap_base_amount {} migration_base_amount {}",
        swap_base_amount, migration_base_amount
    );

    let mut pool = VirtualPool::default();
    pool.initialize(
        VolatilityTracker::default(),
        Pubkey::default(),
        Pubkey::default(),
        Pubkey::default(),
        Pubkey::default(),
        Pubkey::default(),
        config.sqrt_start_price,
        0,
        0,
        config.get_initial_base_supply().unwrap(),
    );
    let amount_in = 1_000_000_000; // 1k
    let fee_mode = FeeMode::default();
    let (result, _included_fee_input_amount) = pool
        .get_swap_exact_in_result(
            &config,
            amount_in,
            &fee_mode,
            TradeDirection::QuoteToBase,
            0,
            config.get_max_swallow_quote_amount().unwrap(),
        )
        .unwrap();
    println!("{:?}", result);
}
