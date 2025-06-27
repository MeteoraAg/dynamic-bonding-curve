use crate::safe_math::SafeMath;
use anyhow::{ensure, Context, Error, Result};
use dynamic_bonding_curve::{
    activation_handler::ActivationType,
    constants::fee::FEE_DENOMINATOR,
    curve::{
        get_delta_amount_base_unsigned, get_delta_amount_base_unsigned_256,
        get_delta_amount_quote_unsigned, get_delta_amount_quote_unsigned_256,
    },
    params::swap::TradeDirection,
    state::{
        fee::{FeeMode, FeeOnAmountResult},
        PoolConfig, SwapResult, VirtualPool,
    },
    u128x128_math::{mul_div_u256, Rounding},
    utils_math::safe_mul_div_cast_u64,
};
use ruint::aliases::U256;
// reverse function of quote_exact_in
pub fn quote_exact_out(
    virtual_pool: &VirtualPool,
    config: &PoolConfig,
    swap_base_for_quote: bool,
    current_timestamp: u64,
    current_slot: u64,
    out_amount: u64,
) -> Result<SwapResult> {
    let mut virtual_pool = *virtual_pool;

    ensure!(
        !virtual_pool.is_curve_complete(config.migration_quote_threshold),
        "virtual pool is completed"
    );

    ensure!(out_amount > 0, "amount is zero");

    virtual_pool.update_pre_swap(config, current_timestamp)?;
    let activation_type =
        ActivationType::try_from(config.activation_type).context("invalid activation type")?;
    let current_point = match activation_type {
        ActivationType::Slot => current_slot,
        ActivationType::Timestamp => current_timestamp,
    };

    let trade_direction = if swap_base_for_quote {
        TradeDirection::BaseToQuote
    } else {
        TradeDirection::QuoteToBase
    };

    // not support for rate limiter duration
    if let Ok(rate_limiter) = config.pool_fees.base_fee.get_fee_rate_limiter() {
        ensure!(
            !rate_limiter.is_rate_limiter_applied(
                current_point,
                virtual_pool.activation_point,
                trade_direction,
            )?,
            "Not support in rate limiter duration"
        );
    }

    let fee_mode = &FeeMode::get_fee_mode(config.collect_fee_mode, trade_direction, false)?;

    let swap_result = get_swap_result_from_out_amount(
        &virtual_pool,
        &config,
        out_amount,
        fee_mode,
        trade_direction,
        current_point,
    )?;

    Ok(swap_result)
}

fn get_swap_result_from_out_amount(
    pool: &VirtualPool,
    config: &PoolConfig,
    out_amount: u64,
    fee_mode: &FeeMode,
    trade_direction: TradeDirection,
    current_point: u64,
) -> Result<SwapResult> {
    let mut actual_protocol_fee = 0;
    let mut actual_trading_fee = 0;
    let mut actual_referral_fee = 0;

    let trade_fee_numerator = config.pool_fees.get_total_trading_fee(
        &pool.volatility_tracker,
        current_point,
        pool.activation_point,
        0, // use zero because rate limiter is not applied
        trade_direction,
    )?;

    let included_fee_out_amount = if fee_mode.fees_on_input {
        out_amount
    } else {
        let included_fee_out_amount = get_included_fee_amount(trade_fee_numerator, out_amount)?;
        let FeeOnAmountResult {
            amount: _,
            protocol_fee,
            trading_fee,
            referral_fee,
        } = config.pool_fees.get_fee_on_amount(
            &pool.volatility_tracker,
            fee_mode.has_referral,
            included_fee_out_amount,
            current_point,
            pool.activation_point,
            trade_direction,
        )?;
        actual_protocol_fee = protocol_fee;
        actual_trading_fee = trading_fee;
        actual_referral_fee = referral_fee;
        included_fee_out_amount
    };

    let SwapAmount {
        output_amount: excluded_fee_in_amount,
        next_sqrt_price,
    } = match trade_direction {
        TradeDirection::BaseToQuote => {
            // reverse
            get_in_amount_from_base_to_quote(pool, config, included_fee_out_amount)?
        }
        TradeDirection::QuoteToBase => {
            get_in_amount_from_quote_to_base(pool, config, included_fee_out_amount)?
        }
    };

    let included_fee_in_amount = if fee_mode.fees_on_input {
        let included_fee_in_amount =
            get_included_fee_amount(trade_fee_numerator, excluded_fee_in_amount)?;
        let FeeOnAmountResult {
            amount: _,
            protocol_fee,
            trading_fee,
            referral_fee,
        } = config.pool_fees.get_fee_on_amount(
            &pool.volatility_tracker,
            fee_mode.has_referral,
            included_fee_in_amount,
            current_point,
            pool.activation_point,
            trade_direction,
        )?;
        actual_protocol_fee = protocol_fee;
        actual_trading_fee = trading_fee;
        actual_referral_fee = referral_fee;
        included_fee_in_amount
    } else {
        excluded_fee_in_amount
    };

    Ok(SwapResult {
        actual_input_amount: included_fee_in_amount,
        output_amount: out_amount,
        next_sqrt_price,
        trading_fee: actual_trading_fee,
        protocol_fee: actual_protocol_fee,
        referral_fee: actual_referral_fee,
    })
}

fn get_excluded_fee_amount(
    trade_fee_numerator: u64,
    included_fee_amount: u64,
) -> Result<(u64, u64)> {
    let trading_fee: u64 = safe_mul_div_cast_u64(
        included_fee_amount,
        trade_fee_numerator,
        FEE_DENOMINATOR,
        Rounding::Up,
    )?;
    // update amount
    let excluded_fee_amount = included_fee_amount.safe_sub(trading_fee)?;
    Ok((excluded_fee_amount, trading_fee))
}

fn get_included_fee_amount(trade_fee_numerator: u64, excluded_fee_amount: u64) -> Result<u64> {
    let included_fee_amount: u64 = safe_mul_div_cast_u64(
        excluded_fee_amount,
        FEE_DENOMINATOR,
        FEE_DENOMINATOR.safe_sub(trade_fee_numerator)?,
        Rounding::Up,
    )?;
    // sanity check
    let (inverse_amount, _trading_fee) =
        get_excluded_fee_amount(trade_fee_numerator, included_fee_amount)?;
    // that should never happen
    ensure!(
        inverse_amount >= excluded_fee_amount,
        "inverse amount is less than excluded_fee_amount"
    );
    Ok(included_fee_amount)
}

/// * `√P' = √P - Δy / L`
pub fn get_next_sqrt_price_from_amount_quote_rounding_up(
    sqrt_price: u128,
    liquidity: u128,
    amount: u64,
) -> Result<u128> {
    let liquidity = U256::from(liquidity);
    let quotient = U256::from(amount)
        .safe_shl(128)? // TODO remove unwrap
        .safe_add(liquidity)?
        .safe_sub(U256::from(1))?
        .safe_div(liquidity)?;
    let result = U256::from(sqrt_price).safe_sub(quotient)?;
    Ok(result
        .try_into()
        .map_err(|_| Error::msg("Typecast is error"))?)
}

///  √P' = √P * L / (L - Δx * √P)
pub fn get_next_sqrt_price_from_amount_base_rounding_down(
    sqrt_price: u128,
    liquidity: u128,
    amount: u64,
) -> Result<u128> {
    if amount == 0 {
        return Ok(sqrt_price);
    }
    let sqrt_price = U256::from(sqrt_price);
    let liquidity = U256::from(liquidity);

    let product = U256::from(amount).safe_mul(sqrt_price)?;
    let denominator = liquidity.safe_sub(U256::from(product))?;
    let result = mul_div_u256(liquidity, sqrt_price, denominator, Rounding::Down)
        .ok_or_else(|| Error::msg("Typecast is error"))?;
    Ok(result
        .try_into()
        .map_err(|_| Error::msg("Typecast is error"))?)
}

pub fn get_next_sqrt_price_from_output(
    sqrt_price: u128,
    liquidity: u128,
    out_amount: u64,
    is_quote: bool,
) -> Result<u128> {
    assert!(sqrt_price > 0);
    // round to make sure that we don't pass the target price
    if is_quote {
        get_next_sqrt_price_from_amount_quote_rounding_up(sqrt_price, liquidity, out_amount)
    } else {
        get_next_sqrt_price_from_amount_base_rounding_down(sqrt_price, liquidity, out_amount)
    }
}
pub struct SwapAmount {
    output_amount: u64,
    next_sqrt_price: u128,
}

// selling
fn get_in_amount_from_base_to_quote(
    pool: &VirtualPool,
    config: &PoolConfig,
    out_amount: u64, // quote amount
) -> Result<SwapAmount> {
    // finding new target price
    let mut current_sqrt_price = pool.sqrt_price;
    let mut amount_left = out_amount;
    let mut total_amount_in = 0;
    // Use curve.len() for backward compatibility for existing pools with 20 points
    for i in (0..config.curve.len() - 1).rev() {
        if config.curve[i].sqrt_price == 0 || config.curve[i].liquidity == 0 {
            continue;
        }
        if config.curve[i].sqrt_price < current_sqrt_price {
            let max_amount_out = get_delta_amount_quote_unsigned_256(
                current_sqrt_price,
                config.curve[i].sqrt_price,
                config.curve[i + 1].liquidity,
                Rounding::Down,
            )?;
            if U256::from(amount_left) < max_amount_out {
                let next_sqrt_price = get_next_sqrt_price_from_output(
                    current_sqrt_price,
                    config.curve[i + 1].liquidity,
                    amount_left,
                    true,
                )?;

                let in_amount = get_delta_amount_base_unsigned(
                    next_sqrt_price,
                    current_sqrt_price,
                    config.curve[i + 1].liquidity,
                    Rounding::Up,
                )?;
                total_amount_in = total_amount_in.safe_add(in_amount)?;
                current_sqrt_price = next_sqrt_price;
                amount_left = 0;
                break;
            } else {
                let next_sqrt_price = config.curve[i].sqrt_price;
                let in_amount = get_delta_amount_base_unsigned(
                    next_sqrt_price,
                    current_sqrt_price,
                    config.curve[i + 1].liquidity,
                    Rounding::Up,
                )?;
                total_amount_in = total_amount_in.safe_add(in_amount)?;
                current_sqrt_price = next_sqrt_price;
                amount_left = amount_left.safe_sub(max_amount_out.try_into().unwrap())?;
            }
        }
    }
    if amount_left != 0 {
        let next_sqrt_price = get_next_sqrt_price_from_output(
            current_sqrt_price,
            config.curve[0].liquidity,
            amount_left,
            true,
        )?;
        ensure!(
            next_sqrt_price >= config.sqrt_start_price,
            "not enough liquidity"
        );
        let in_amount = get_delta_amount_base_unsigned(
            next_sqrt_price,
            current_sqrt_price,
            config.curve[0].liquidity,
            Rounding::Up,
        )?;
        total_amount_in = total_amount_in.safe_add(in_amount)?;
        current_sqrt_price = next_sqrt_price;
    }

    Ok(SwapAmount {
        output_amount: total_amount_in,
        next_sqrt_price: current_sqrt_price,
    })
}

// buying
fn get_in_amount_from_quote_to_base(
    pool: &VirtualPool,
    config: &PoolConfig,
    out_amount: u64, // base amount
) -> Result<SwapAmount> {
    let mut total_in_amount = 0u64;
    let mut current_sqrt_price = pool.sqrt_price;
    let mut amount_left = out_amount;
    for i in 0..config.curve.len() {
        if config.curve[i].sqrt_price == 0 || config.curve[i].liquidity == 0 {
            break;
        }
        if config.curve[i].sqrt_price > current_sqrt_price {
            let max_amount_out = get_delta_amount_base_unsigned_256(
                current_sqrt_price,
                config.curve[i].sqrt_price,
                config.curve[i].liquidity,
                Rounding::Down,
            )?;
            if U256::from(amount_left) < max_amount_out {
                let next_sqrt_price = get_next_sqrt_price_from_output(
                    current_sqrt_price,
                    config.curve[i].liquidity,
                    amount_left,
                    false,
                )?;

                let in_amount = get_delta_amount_quote_unsigned(
                    current_sqrt_price,
                    next_sqrt_price,
                    config.curve[i].liquidity,
                    Rounding::Up,
                )?;
                total_in_amount = total_in_amount.safe_add(in_amount)?;
                current_sqrt_price = next_sqrt_price;
                amount_left = 0;
                break;
            } else {
                let next_sqrt_price = config.curve[i].sqrt_price;
                let in_amount = get_delta_amount_quote_unsigned(
                    next_sqrt_price,
                    current_sqrt_price,
                    config.curve[i + 1].liquidity,
                    Rounding::Up,
                )?;
                total_in_amount = total_in_amount.safe_add(in_amount)?;
                current_sqrt_price = next_sqrt_price;
                amount_left = amount_left.safe_sub(max_amount_out.try_into().unwrap())?;
            }
        }
    }

    // allow pool swallow an extra amount
    ensure!(amount_left == 0, "not enough liquidity");

    Ok(SwapAmount {
        output_amount: total_in_amount,
        next_sqrt_price: current_sqrt_price,
    })
}
