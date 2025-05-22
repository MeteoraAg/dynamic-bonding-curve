use anyhow::{ensure, Context, Result};
use dynamic_bonding_curve::{
    activation_handler::ActivationType,
    params::swap::TradeDirection,
    state::{fee::FeeMode, PoolConfig, SwapResult, VirtualPool},
    PoolError, SwapMode,
};

pub fn quote_exact_in(
    virtual_pool: &VirtualPool,
    config: &PoolConfig,
    swap_base_for_quote: bool,
    current_timestamp: u64,
    current_slot: u64,
    transfer_fee_excluded_amount_in: u64, // must be calculated from outside
    has_referral: bool,
    swap_mode: u8,
) -> Result<SwapResult> {
    let mut virtual_pool = *virtual_pool;

    ensure!(
        !virtual_pool.is_curve_complete(config.migration_quote_threshold),
        "virtual pool is completed"
    );

    ensure!(transfer_fee_excluded_amount_in > 0, "amount is zero");

    let swap_mode = SwapMode::try_from(swap_mode).context("invalid swap mode")?;

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
    let fee_mode = &FeeMode::get_fee_mode(config.collect_fee_mode, trade_direction, has_referral)?;
    let (swap_result, _user_pay_input_amount) = virtual_pool.get_swap_result(
        &config,
        transfer_fee_excluded_amount_in,
        fee_mode,
        trade_direction,
        current_point,
        swap_mode,
    )?;

    Ok(swap_result)
}
