use crate::transfer_fee::{get_transfer_fees, QuoteResult};
use anchor_spl::token_2022::spl_token_2022::extension::transfer_fee::TransferFeeConfig;
use anyhow::{ensure, Context, Result};
use dynamic_bonding_curve::{
    activation_handler::ActivationType,
    params::swap::TradeDirection,
    state::{fee::FeeMode, PoolConfig, PoolState},
    token::calculate_transfer_fee_excluded_amount,
};

pub fn quote_exact_in(
    pool: &PoolState,
    config: &PoolConfig,
    swap_base_for_quote: bool,
    current_timestamp: u64,
    current_slot: u64,
    current_epoch: u64,
    base_mint_transfer_fee_config: Option<&TransferFeeConfig>,
    quote_mint_transfer_fee_config: Option<&TransferFeeConfig>,
    in_amount: u64,
    has_referral: bool,
    eligible_for_first_swap_with_min_fee: bool, // Only for creator to bundle swap in initialize pool instruction to avoid anti sniper suite fee
) -> Result<QuoteResult> {
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

    let (input_transfer_fee, output_transfer_fee) = get_transfer_fees(
        base_mint_transfer_fee_config,
        quote_mint_transfer_fee_config,
        current_epoch,
        trade_direction,
    );
    let excluded_transfer_fee_amount_in =
        calculate_transfer_fee_excluded_amount(input_transfer_fee.as_ref(), in_amount)?.amount;
    ensure!(excluded_transfer_fee_amount_in > 0, "amount is zero");

    let swap_result = pool.get_swap_result_from_exact_input(
        config,
        excluded_transfer_fee_amount_in,
        fee_mode,
        trade_direction,
        current_point,
        eligible_for_first_swap_with_min_fee,
    )?;

    let excluded_transfer_fee_amount_out = calculate_transfer_fee_excluded_amount(
        output_transfer_fee.as_ref(),
        swap_result.output_amount,
    )?
    .amount;

    Ok(QuoteResult {
        included_transfer_fee_amount_in: in_amount,
        excluded_transfer_fee_amount_out,
        swap_result,
    })
}
