use std::u64;

use proptest::prelude::*;
use proptest::proptest;

use crate::constants::fee::MAX_FEE_BPS;
use crate::constants::fee::MIN_FEE_BPS;
use crate::state::PoolFeesConfig;
use crate::{
    activation_handler::ActivationType,
    base_fee::{BaseFeeHandler, FeeRateLimiter},
    constants::fee::{FEE_DENOMINATOR, MAX_FEE_NUMERATOR, MIN_FEE_NUMERATOR},
    params::{
        fee_parameters::{to_bps, to_numerator},
        swap::TradeDirection,
    },
    u128x128_math::Rounding,
    utils_math::safe_mul_div_cast_u64,
};

#[test]
fn test_validate_rate_limiter() {
    // validate collect fee mode
    {
        let rate_limiter = FeeRateLimiter {
            cliff_fee_numerator: 10_0000,
            reference_amount: 1_000_000_000, // 1SOL
            max_limiter_duration: 60,        // 60 seconds
            fee_increment_bps: 10,           // 10 bps
        };
        assert!(rate_limiter.validate(1, ActivationType::Slot).is_err());
        assert!(rate_limiter.validate(0, ActivationType::Slot).is_ok());
    }

    // validate zero rate limiter
    {
        let rate_limiter = FeeRateLimiter {
            cliff_fee_numerator: 10_0000,
            reference_amount: 1,     // 1SOL
            max_limiter_duration: 0, // 60 seconds
            fee_increment_bps: 0,    // 10 bps
        };
        assert!(rate_limiter.validate(0, ActivationType::Slot).is_err());
        let rate_limiter = FeeRateLimiter {
            cliff_fee_numerator: 10_0000,
            reference_amount: 0,     // 1SOL
            max_limiter_duration: 1, // 60 seconds
            fee_increment_bps: 0,    // 10 bps
        };
        assert!(rate_limiter.validate(0, ActivationType::Slot).is_err());
        let rate_limiter = FeeRateLimiter {
            cliff_fee_numerator: 10_0000,
            reference_amount: 0,     // 1SOL
            max_limiter_duration: 0, // 60 seconds
            fee_increment_bps: 1,    // 10 bps
        };
        assert!(rate_limiter.validate(0, ActivationType::Slot).is_err());
    }

    // validate cliff fee numerator
    {
        let rate_limiter = FeeRateLimiter {
            cliff_fee_numerator: MIN_FEE_NUMERATOR - 1,
            reference_amount: 1_000_000_000, // 1SOL
            max_limiter_duration: 60,        // 60 seconds
            fee_increment_bps: 10,           // 10 bps
        };
        assert!(rate_limiter.validate(0, ActivationType::Slot).is_err());
        let rate_limiter = FeeRateLimiter {
            cliff_fee_numerator: MAX_FEE_NUMERATOR + 1,
            reference_amount: 1_000_000_000, // 1SOL
            max_limiter_duration: 60,        // 60 seconds
            fee_increment_bps: 10,           // 10 bps
        };
        assert!(rate_limiter.validate(0, ActivationType::Slot).is_err());
    }
}

// that test show that more amount, then more fee numerator
#[test]
fn test_rate_limiter_behavior() {
    let base_fee_bps = 100u64; // 1%
    let reference_amount = 1_000_000_000; // 1 sol
    let fee_increment_bps = 100; // 1%
    let cliff_fee_numerator = to_numerator(base_fee_bps.into(), FEE_DENOMINATOR.into()).unwrap();

    let rate_limiter = FeeRateLimiter {
        cliff_fee_numerator,
        reference_amount,         // 1SOL
        max_limiter_duration: 60, // 60 seconds
        fee_increment_bps,        // 10 bps
    };
    assert!(rate_limiter.validate(0, ActivationType::Slot).is_ok());

    {
        let fee_numerator = rate_limiter
            .get_fee_numerator_from_included_fee_amount(reference_amount)
            .unwrap();
        let fee_bps = to_bps(fee_numerator.into(), FEE_DENOMINATOR.into()).unwrap();
        assert_eq!(fee_bps, base_fee_bps);
    }

    {
        let fee_numerator = rate_limiter
            .get_fee_numerator_from_included_fee_amount(reference_amount * 3 / 2)
            .unwrap();
        let fee_bps = to_bps(fee_numerator.into(), FEE_DENOMINATOR.into()).unwrap();
        assert_eq!(fee_bps, 133);

        let fee_numerator = rate_limiter
            .get_fee_numerator_from_included_fee_amount(reference_amount * 2)
            .unwrap();
        let fee_bps = to_bps(fee_numerator.into(), FEE_DENOMINATOR.into()).unwrap();
        assert_eq!(fee_bps, 150); // 1.5%, (1+1+1) / 2
    }

    {
        let fee_numerator = rate_limiter
            .get_fee_numerator_from_included_fee_amount(reference_amount * 3)
            .unwrap();
        let fee_bps = to_bps(fee_numerator.into(), FEE_DENOMINATOR.into()).unwrap();
        assert_eq!(fee_bps, 200); // 2%, (1+1+1+1) / 2
    }

    {
        let fee_numerator = rate_limiter
            .get_fee_numerator_from_included_fee_amount(reference_amount * 4)
            .unwrap();
        let fee_bps = to_bps(fee_numerator.into(), FEE_DENOMINATOR.into()).unwrap();
        assert_eq!(fee_bps, 250); // 2.5% (1+1+1+1+1) / 2
    }

    {
        let fee_numerator = rate_limiter
            .get_fee_numerator_from_included_fee_amount(u64::MAX)
            .unwrap();
        let fee_bps = to_bps(fee_numerator.into(), FEE_DENOMINATOR.into()).unwrap();
        assert_eq!(fee_bps, 9899); // 98.99%
    }
}

fn calculate_output_amount(rate_limiter: &FeeRateLimiter, input_amount: u64) -> u64 {
    let trade_fee_numerator = rate_limiter
        .get_base_fee_numerator_from_included_fee_amount(
            0,
            0,
            TradeDirection::QuoteToBase,
            input_amount,
        )
        .unwrap();
    let trading_fee: u64 = safe_mul_div_cast_u64(
        input_amount,
        trade_fee_numerator,
        FEE_DENOMINATOR,
        Rounding::Up,
    )
    .unwrap();
    input_amount.checked_sub(trading_fee).unwrap()
}
// that test show that, more input amount, then more output amount
#[test]
fn test_rate_limiter_routing_friendly() {
    let base_fee_bps = 100u64; // 1%
    let reference_amount = 1_000_000_000; // 1 sol
    let fee_increment_bps = 100; // 1%
    let cliff_fee_numerator = to_numerator(base_fee_bps.into(), FEE_DENOMINATOR.into()).unwrap();

    let rate_limiter = FeeRateLimiter {
        cliff_fee_numerator,
        reference_amount,         // 1SOL
        max_limiter_duration: 60, // 60 seconds
        fee_increment_bps,        // 10 bps
    };

    let mut input_amount = reference_amount - 10;
    let mut currrent_output_amount = calculate_output_amount(&rate_limiter, input_amount);

    for _i in 0..500 {
        input_amount = input_amount + reference_amount / 2;
        let output_amount = calculate_output_amount(&rate_limiter, input_amount);
        assert!(output_amount > currrent_output_amount);
        currrent_output_amount = output_amount
    }
}

#[test]
fn test_rate_limiter_base_fee_numerator() {
    let base_fee_bps = 100u64; // 1%
    let reference_amount = 1_000_000_000; // 1 sol
    let fee_increment_bps = 100; // 1%
    let cliff_fee_numerator = to_numerator(base_fee_bps.into(), FEE_DENOMINATOR.into()).unwrap();

    let rate_limiter = FeeRateLimiter {
        cliff_fee_numerator,
        reference_amount,         // 1SOL
        max_limiter_duration: 60, // 60 seconds
        fee_increment_bps,        // 10 bps
    };

    {
        // trade from base to quote
        let fee_numerator = rate_limiter
            .get_base_fee_numerator_from_included_fee_amount(
                0,
                0,
                TradeDirection::BaseToQuote,
                2_000_000_000,
            )
            .unwrap();

        assert_eq!(fee_numerator, rate_limiter.cliff_fee_numerator);
    }

    {
        // trade pass last effective point
        let fee_numerator = rate_limiter
            .get_base_fee_numerator_from_included_fee_amount(
                rate_limiter.max_limiter_duration + 1,
                0,
                TradeDirection::QuoteToBase,
                2_000_000_000,
            )
            .unwrap();

        assert_eq!(fee_numerator, rate_limiter.cliff_fee_numerator);
    }

    {
        // trade in effective point
        let fee_numerator = rate_limiter
            .get_base_fee_numerator_from_included_fee_amount(
                rate_limiter.max_limiter_duration,
                0,
                TradeDirection::QuoteToBase,
                2_000_000_000,
            )
            .unwrap();

        assert!(fee_numerator > rate_limiter.cliff_fee_numerator);
    }
}

fn assert_rate_limiter_inverse(rate_limiter: &FeeRateLimiter, included_fee_amount: u64) {
    let excluded_fee_amount = rate_limiter
        .get_excluded_fee_amount(included_fee_amount)
        .unwrap();

    let base_fee_numerator = rate_limiter
        .get_fee_numerator_from_excluded_fee_amount(excluded_fee_amount)
        .unwrap();
    let (inverse_amount, _) =
        PoolFeesConfig::get_included_fee_amount(base_fee_numerator, excluded_fee_amount).unwrap();

    let excluded_fee_inverse_amount = rate_limiter
        .get_excluded_fee_amount(inverse_amount)
        .unwrap();

    let (diff, is_inverse_greater) = if excluded_fee_amount > excluded_fee_inverse_amount {
        (excluded_fee_amount - excluded_fee_inverse_amount, false)
    } else {
        (excluded_fee_inverse_amount - excluded_fee_amount, true)
    };

    println!(
        "included_fee_amount {} excluded_fee_amount {} excluded_fee_inverse_amount {} diff {} is_inverse_greater {}",
        included_fee_amount, excluded_fee_amount, excluded_fee_inverse_amount, diff, is_inverse_greater
    );
}
#[test]
fn test_get_included_fee_amount_rate_limiter() {
    let base_fee_bps = 100u64; // 1%
    let reference_amount = 1_000_000_000; // 1 sol
    let fee_increment_bps = 100; // 1%
    let cliff_fee_numerator = to_numerator(base_fee_bps.into(), FEE_DENOMINATOR.into()).unwrap();
    let rate_limiter = FeeRateLimiter {
        cliff_fee_numerator,
        reference_amount,         // 1SOL
        max_limiter_duration: 60, // 60 seconds
        fee_increment_bps,        // 10 bps
    };
    {
        println!("1");
        assert_rate_limiter_inverse(&rate_limiter, reference_amount / 2);
    }

    {
        println!("2");
        assert_rate_limiter_inverse(&rate_limiter, reference_amount);
    }

    {
        println!("3");
        assert_rate_limiter_inverse(&rate_limiter, reference_amount + reference_amount / 2);
    }

    {
        println!("4");
        assert_rate_limiter_inverse(&rate_limiter, reference_amount + reference_amount * 3 / 2);
    }

    {
        println!("5");
        let max_index = rate_limiter.get_max_index().unwrap();
        let input_amount =
            max_index * rate_limiter.reference_amount + rate_limiter.reference_amount / 3;
        assert_rate_limiter_inverse(&rate_limiter, input_amount);
    }

    {
        println!("6");
        let max_index = rate_limiter.get_max_index().unwrap();
        let input_amount =
            max_index * rate_limiter.reference_amount + rate_limiter.reference_amount / 2;
        assert_rate_limiter_inverse(&rate_limiter, input_amount);
    }

    {
        println!("7");
        let max_index = rate_limiter.get_max_index().unwrap();
        let input_amount = (max_index + 1) * rate_limiter.reference_amount - 1;
        assert_rate_limiter_inverse(&rate_limiter, input_amount);
    }

    {
        println!("8");
        let max_index = rate_limiter.get_max_index().unwrap();
        let input_amount = (max_index + 1) * rate_limiter.reference_amount;
        assert_rate_limiter_inverse(&rate_limiter, input_amount);
    }

    {
        println!("9");
        let max_index = rate_limiter.get_max_index().unwrap();
        let input_amount =
            (max_index + 1) * rate_limiter.reference_amount + rate_limiter.reference_amount / 2;
        assert_rate_limiter_inverse(&rate_limiter, input_amount);
    }
    {
        println!("10");
        let input_amount = u64::MAX;
        assert_rate_limiter_inverse(&rate_limiter, input_amount);
    }
}

proptest! {
    // prop test for common rate limiter
    #![proptest_config(ProptestConfig {
        cases: 10000, .. ProptestConfig::default()
    })]

    #[test]
    fn test_base_fee_numerator_from_excluded_fee_amount_0(
        excluded_fee_amount in 0..=u64::MAX/100,
    ){
        let base_fee_bps = 100u64; // 1%
        let reference_amount = 1_000_000_000; // 1 sol
        let fee_increment_bps = 500; // 5%
        let cliff_fee_numerator = to_numerator(base_fee_bps.into(), FEE_DENOMINATOR.into()).unwrap();
        let rate_limiter = FeeRateLimiter {
            cliff_fee_numerator,
            reference_amount,         // 1SOL
            max_limiter_duration: 60, // 60 seconds
            fee_increment_bps,        // 10 bps
        };
        rate_limiter
        .get_fee_numerator_from_excluded_fee_amount(excluded_fee_amount)
        .unwrap();
    }


    #[test]
    fn test_base_fee_numerator_from_excluded_fee_amount_1(
        excluded_fee_amount in 0..=u64::MAX/100,
    ){
        let base_fee_bps = 100u64; // 1%
        let reference_amount = 1_000_000_000; // 1 sol
        let fee_increment_bps = 100; // 5%
        let cliff_fee_numerator = to_numerator(base_fee_bps.into(), FEE_DENOMINATOR.into()).unwrap();
        let rate_limiter = FeeRateLimiter {
            cliff_fee_numerator,
            reference_amount,         // 1SOL
            max_limiter_duration: 60, // 60 seconds
            fee_increment_bps,        // 10 bps
        };
        rate_limiter
        .get_fee_numerator_from_excluded_fee_amount(excluded_fee_amount)
        .unwrap();
    }


    #[test]
    fn test_base_fee_numerator_from_excluded_fee_amount_2(
        base_fee_bps in MIN_FEE_BPS..=MAX_FEE_BPS,
        reference_amount in 1_000u64..=10_000_000_000u64,
        fee_increment_bps in MIN_FEE_BPS..=MAX_FEE_BPS,
        excluded_fee_amount in 0..=u64::MAX/100,
    ){
        let  fee_increment_bps = fee_increment_bps.try_into().unwrap();
        let cliff_fee_numerator = to_numerator(base_fee_bps.into(), FEE_DENOMINATOR.into()).unwrap();
        let rate_limiter = FeeRateLimiter {
            cliff_fee_numerator,
            reference_amount,
            max_limiter_duration: 60, // 60 seconds
            fee_increment_bps: fee_increment_bps,
        };
        rate_limiter
        .get_fee_numerator_from_excluded_fee_amount(excluded_fee_amount)
        .unwrap();
    }
}
