use std::u64;

use crate::{
    constants::{MAX_CURVE_POINT, MAX_SQRT_PRICE},
    params::{liquidity_distribution::LiquidityDistributionParameters, swap::TradeDirection},
    state::{
        fee::{FeeMode, VolatilityTracker},
        CollectFeeMode, LiquidityDistributionConfig, PoolConfig, SwapResult2, VirtualPool,
    },
    PoolError,
};
use anchor_lang::prelude::Pubkey;
use rand::prelude::*;

use super::price_math::get_price_from_id;

fn initialize_pool_and_config() -> (PoolConfig, VirtualPool, UserBalance) {
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
        1_000_000_000_000,
    );
    let user = UserBalance {
        base_balance: 0,
        quote_balance: u64::MAX,
    };
    (config, pool, user)
}
#[test]
fn test_swap() {
    let (config, pool, _user) = initialize_pool_and_config();
    let amount_in = 1_000_000_000; // 1k
    let trade_direction = TradeDirection::QuoteToBase;
    let fee_mode = &FeeMode::get_fee_mode(config.collect_fee_mode, trade_direction, false).unwrap();
    let result = pool
        .get_swap_result_from_exact_input(
            &config,
            amount_in,
            &fee_mode,
            TradeDirection::QuoteToBase,
            0,
        )
        .unwrap();
    println!("{:?}", result);
}

#[derive(Debug, PartialEq, Copy, Clone)]
struct UserBalance {
    pub base_balance: u64,
    pub quote_balance: u64,
}

impl UserBalance {
    fn apply_swap_result(&mut self, swap_result: &SwapResult2, trade_direction: TradeDirection) {
        let &SwapResult2 {
            included_fee_input_amount,
            excluded_fee_input_amount: _,
            amount_left: _,
            output_amount,
            next_sqrt_price: _,
            trading_fee: _,
            protocol_fee: _,
            referral_fee: _,
        } = swap_result;
        if trade_direction == TradeDirection::BaseToQuote {
            self.base_balance = self
                .base_balance
                .checked_sub(included_fee_input_amount)
                .unwrap();
            self.quote_balance = self.quote_balance.checked_add(output_amount).unwrap();
        } else {
            self.base_balance = self.base_balance.checked_add(output_amount).unwrap();
            self.quote_balance = self
                .quote_balance
                .checked_sub(included_fee_input_amount)
                .unwrap();
        }
    }
}

fn simulate_swap_exact_in(
    config: &PoolConfig,
    pool: &mut VirtualPool,
    user: &mut UserBalance,
    amount_in: u64,
    trade_direction: TradeDirection,
) {
    let fee_mode = &FeeMode::get_fee_mode(config.collect_fee_mode, trade_direction, false).unwrap();
    let current_timestamp = 0;
    let swap_exact_in_result = pool
        .get_swap_result_from_exact_input(
            &config,
            amount_in,
            &fee_mode,
            trade_direction,
            current_timestamp,
        )
        .unwrap();

    pool.apply_swap_result(
        &config,
        &swap_exact_in_result.get_swap_result(),
        &fee_mode,
        trade_direction,
        current_timestamp,
    )
    .unwrap();

    user.apply_swap_result(&swap_exact_in_result, trade_direction);
}

fn simulate_swap_exact_out(
    config: &PoolConfig,
    pool: &mut VirtualPool,
    user: &mut UserBalance,
    amount_out: u64,
    trade_direction: TradeDirection,
) -> bool {
    let fee_mode = &FeeMode::get_fee_mode(config.collect_fee_mode, trade_direction, false).unwrap();
    let current_timestamp = 0;
    match pool.get_swap_result_from_exact_output(
        &config,
        amount_out,
        &fee_mode,
        trade_direction,
        current_timestamp,
    ) {
        Ok(swap_exact_out_result) => {
            if trade_direction == TradeDirection::BaseToQuote
                && swap_exact_out_result.included_fee_input_amount <= user.base_balance
            {
                pool.apply_swap_result(
                    &config,
                    &swap_exact_out_result.get_swap_result(),
                    &fee_mode,
                    trade_direction,
                    current_timestamp,
                )
                .unwrap();
                user.apply_swap_result(&swap_exact_out_result, trade_direction);
                return true;
            }
        }
        Err(err) => {
            assert_eq!(
                err,
                PoolError::NextSqrtPriceIsSmallerThanStartSqrtPrice.into()
            );
        }
    }
    return false;
}

#[test]
fn test_swap_exact_out() {
    let (config, mut pool, mut user) = initialize_pool_and_config();

    let amount_in = 1_000_000_000; // 1k
    {
        let trade_direction = TradeDirection::QuoteToBase;
        simulate_swap_exact_in(&config, &mut pool, &mut user, amount_in, trade_direction);
        println!("{:?}", user);
    }

    {
        let trade_direction = TradeDirection::QuoteToBase;
        simulate_swap_exact_in(&config, &mut pool, &mut user, amount_in, trade_direction);
        println!("{:?}", user);
    }

    {
        let trade_direction = TradeDirection::BaseToQuote;
        simulate_swap_exact_out(&config, &mut pool, &mut user, amount_in, trade_direction);
        println!("{:?}", user);
    }

    {
        let trade_direction = TradeDirection::BaseToQuote;
        let remaining_base_balance = user.base_balance;
        simulate_swap_exact_in(
            &config,
            &mut pool,
            &mut user,
            remaining_base_balance,
            trade_direction,
        );
        println!("{:?} user loss: {}", user, u64::MAX - user.quote_balance);
    }
}

#[test]
fn test_swap_wont_depelete_reserve() {
    let (config, mut pool, mut user) = initialize_pool_and_config();
    let mut rng = rand::rng();
    let mut count_exact_in = 0;
    let mut count_exact_out = 0;
    for _i in 0..10000 {
        let trade_direction = if rng.random::<bool>() {
            TradeDirection::QuoteToBase
        } else {
            TradeDirection::BaseToQuote
        };

        let amount = rng.random_range(1000..10_000);

        if rng.random::<bool>() {
            if trade_direction == TradeDirection::BaseToQuote && user.base_balance < amount {
                continue;
            }
            simulate_swap_exact_in(&config, &mut pool, &mut user, amount, trade_direction);
            count_exact_in = count_exact_in + 1;
        } else {
            if trade_direction == TradeDirection::BaseToQuote && pool.quote_reserve < amount {
                continue;
            }
            if trade_direction == TradeDirection::QuoteToBase && pool.base_reserve < amount {
                continue;
            }
            if simulate_swap_exact_out(&config, &mut pool, &mut user, amount, trade_direction) {
                count_exact_out = count_exact_out + 1;
            }
        }
    }

    println!(
        "count_exact_in {} count_exact_out {}",
        count_exact_in, count_exact_out
    );

    let trade_direction = TradeDirection::BaseToQuote;
    let remaining_base_balance = user.base_balance;
    if remaining_base_balance > 0 {
        simulate_swap_exact_in(
            &config,
            &mut pool,
            &mut user,
            remaining_base_balance,
            trade_direction,
        );
    }

    println!("{:?} user loss: {}", user, u64::MAX - user.quote_balance);
}
