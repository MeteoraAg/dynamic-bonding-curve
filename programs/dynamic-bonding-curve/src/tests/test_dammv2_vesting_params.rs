use anchor_lang::solana_program::clock::SECONDS_PER_DAY;

use crate::{
    constants::fee::MAX_BASIS_POINT,
    state::{LiquidityDistributionItem, LiquidityVestingInfo, PoolConfig},
};

#[test]
fn test_get_damm_v2_vesting_parameters() {
    // Cliff release all
    // Cliff release 50%, then linear release 50%
    // No cliff, linear release 100%

    let vested_liquidity: u128 = 1_000_000_000;
    let current_timestamp: u64 = 0;

    let vesting_percentage = 100;
    let cliff_duration_from_migration_time: u32 = 10;
    let frequency: u32 = 0;
    let number_of_periods: u16 = 0;
    let bps_per_period: u16 = 0;

    let liquidity_vesting_info = LiquidityVestingInfo {
        is_initialized: 1,
        vesting_percentage,
        cliff_duration_from_migration_time,
        frequency,
        number_of_periods,
        bps_per_period,
        ..Default::default()
    };

    let liquidity_distribution_item = LiquidityDistributionItem {
        unlocked_liquidity: 0,
        permanent_locked_liquidity: 0,
        permanent_locked_liquidity_percentage: 0,
        vested_liquidity,
        liquidity_vesting_info,
    };

    let params = liquidity_distribution_item.get_damm_v2_vesting_parameters(current_timestamp);
    assert!(params.is_ok());

    let params = params.unwrap();
    assert_eq!(
        params.cliff_point.unwrap(),
        current_timestamp + u64::from(cliff_duration_from_migration_time)
    );
    assert_eq!(params.cliff_unlock_liquidity, vested_liquidity);
    assert_eq!(params.liquidity_per_period, 0);
    assert_eq!(params.period_frequency, u64::from(frequency));
    assert_eq!(params.number_of_period, number_of_periods);

    let cliff_release_bps = 5000;
    let vest_duration = 60;
    let vest_bps = 10_000 - cliff_release_bps;
    let number_of_periods = 10;
    let bps_per_period: u16 = vest_bps / number_of_periods;
    let frequency = vest_duration as u32 / number_of_periods as u32;

    let liquidity_vesting_info = LiquidityVestingInfo {
        is_initialized: 1,
        vesting_percentage,
        cliff_duration_from_migration_time,
        frequency,
        number_of_periods,
        bps_per_period,
        ..Default::default()
    };

    let liquidity_distribution_item = LiquidityDistributionItem {
        unlocked_liquidity: 0,
        permanent_locked_liquidity: 0,
        permanent_locked_liquidity_percentage: 0,
        vested_liquidity,
        liquidity_vesting_info,
    };

    let params = liquidity_distribution_item.get_damm_v2_vesting_parameters(current_timestamp);
    assert!(params.is_ok());

    let params = params.unwrap();
    assert_eq!(
        params.cliff_point.unwrap(),
        current_timestamp + u64::from(cliff_duration_from_migration_time)
    );

    let liquidity_per_period =
        vested_liquidity * vest_bps as u128 / 10_000 / number_of_periods as u128;

    assert_eq!(liquidity_per_period, params.liquidity_per_period);

    let cliff_unlock_liquidity =
        vested_liquidity - liquidity_per_period * number_of_periods as u128;

    assert_eq!(params.cliff_unlock_liquidity, cliff_unlock_liquidity);
    assert_eq!(params.period_frequency, u64::from(frequency));
    assert_eq!(params.number_of_period, number_of_periods);

    let bps_per_period = MAX_BASIS_POINT as u16 / number_of_periods;

    let liquidity_vesting_info = LiquidityVestingInfo {
        is_initialized: 1,
        vesting_percentage,
        cliff_duration_from_migration_time,
        frequency,
        number_of_periods,
        bps_per_period,
        ..Default::default()
    };

    let liquidity_distribution_item = LiquidityDistributionItem {
        unlocked_liquidity: 0,
        permanent_locked_liquidity: 0,
        permanent_locked_liquidity_percentage: 0,
        vested_liquidity,
        liquidity_vesting_info,
    };

    let params = liquidity_distribution_item.get_damm_v2_vesting_parameters(current_timestamp);
    assert!(params.is_ok());

    let params = params.unwrap();

    let liquidity_per_period = vested_liquidity / number_of_periods as u128;
    let cliff_unlock_liquidity =
        vested_liquidity - liquidity_per_period * number_of_periods as u128;

    // Precision loss will be in cliff unlock if there's any

    assert_eq!(params.cliff_unlock_liquidity, cliff_unlock_liquidity);
    assert_eq!(params.liquidity_per_period, liquidity_per_period);
    assert_eq!(params.period_frequency, u64::from(frequency));
    assert_eq!(params.number_of_period, number_of_periods);
    assert_eq!(
        cliff_unlock_liquidity + liquidity_per_period * number_of_periods as u128,
        vested_liquidity
    );
}

#[test]
fn test_get_locked_bps_at_day_one() {
    let cliff_duration_from_migration_time = SECONDS_PER_DAY as u32 / 2;
    let bps_per_period: u16 = 100;
    let frequency: u32 = 3600; // 1 hour

    // Total bps = 10_000
    // We want cliff to unlock 5_000 bps (50%) at day one
    let bps_after_cliff = 10_000 - 5_000;
    let number_of_periods = bps_after_cliff / bps_per_period;

    // Total unlock bps at day one = 5000 + (12 * 100) = 6200
    // Locked percentage at day one = 10000 - 6200 = 3800
    // Expected locked percentage at day one = 38%
    // Creator lock 38% of 40% at day one = 15.2%
    let creator_liquidity_vesting_info = LiquidityVestingInfo {
        is_initialized: 1,
        vesting_percentage: 40,
        cliff_duration_from_migration_time,
        bps_per_period,
        frequency,
        number_of_periods,
        ..Default::default()
    };

    let creator_liquidity_locked_bps_at_day_one = creator_liquidity_vesting_info
        .get_locked_bps_at_n_seconds(SECONDS_PER_DAY)
        .unwrap();

    assert_eq!(creator_liquidity_locked_bps_at_day_one, 1520);

    let partner_liquidity_vesting_info = creator_liquidity_vesting_info.clone();

    let mut config = PoolConfig::default();
    config.partner_permanent_locked_liquidity_percentage = 1;
    config.creator_permanent_locked_liquidity_percentage = 1;

    config.partner_liquidity_vesting_info = partner_liquidity_vesting_info;
    config.creator_liquidity_vesting_info = creator_liquidity_vesting_info;

    let total_locked_liquidity_bps_at_day_one = config
        .get_total_liquidity_locked_bps_at_n_seconds(SECONDS_PER_DAY)
        .unwrap();

    assert_eq!(3240, total_locked_liquidity_bps_at_day_one);
    assert_eq!(
        creator_liquidity_locked_bps_at_day_one
            + partner_liquidity_vesting_info
                .get_locked_bps_at_n_seconds(SECONDS_PER_DAY)
                .unwrap()
            + u16::from(config.partner_permanent_locked_liquidity_percentage) * 100
            + u16::from(config.creator_permanent_locked_liquidity_percentage) * 100,
        total_locked_liquidity_bps_at_day_one
    );
}
