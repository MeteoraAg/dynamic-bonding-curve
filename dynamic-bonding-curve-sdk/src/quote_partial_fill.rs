use anyhow::{ensure, Context, Result};
use dynamic_bonding_curve::{
    activation_handler::ActivationType,
    params::swap::TradeDirection,
    state::{fee::FeeMode, PoolConfig, SwapResult2, VirtualPool},
};

pub fn quote_partial_fill(
    pool: &VirtualPool,
    config: &PoolConfig,
    swap_base_for_quote: bool,
    current_timestamp: u64,
    current_slot: u64,
    in_amount: u64,
    has_referral: bool,
) -> Result<SwapResult2> {
    ensure!(
        !pool.is_curve_complete(config.migration_quote_threshold),
        "virtual pool is completed"
    );

    ensure!(in_amount > 0, "amount is zero");

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
    let fee_mode = &FeeMode::get_fee_mode(config.collect_fee_mode, trade_direction, has_referral)?;

    let swap_result = pool.get_swap_result_from_partial_input(
        config,
        in_amount,
        fee_mode,
        trade_direction,
        current_point,
    )?;

    Ok(swap_result)
}
