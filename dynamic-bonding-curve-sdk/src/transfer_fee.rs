use anchor_spl::token_2022::spl_token_2022::extension::transfer_fee::{
    TransferFee, TransferFeeConfig,
};
use dynamic_bonding_curve::{params::swap::TradeDirection, state::SwapResult2};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SwapResultWithTransferFee {
    pub swap_result: SwapResult2,
    pub included_transfer_fee_amount_in: u64,
    pub excluded_transfer_fee_amount_out: u64,
    // excluded_transfer_fee_amount_in is equivalent to swap_result.included_fee_input_amount
    // included_transfer_fee_amount_out is equivalent to swap_result.output_amount
}

pub fn get_transfer_fees(
    base_mint_transfer_fee_config: Option<&TransferFeeConfig>,
    quote_mint_transfer_fee_config: Option<&TransferFeeConfig>,
    current_epoch: u64,
    trade_direction: TradeDirection,
) -> (Option<TransferFee>, Option<TransferFee>) {
    let base_fee = base_mint_transfer_fee_config
        .map(|transfer_fee_config| *transfer_fee_config.get_epoch_fee(current_epoch));
    let quote_fee = quote_mint_transfer_fee_config
        .map(|transfer_fee_config| *transfer_fee_config.get_epoch_fee(current_epoch));
    match trade_direction {
        TradeDirection::BaseToQuote => (base_fee, quote_fee),
        TradeDirection::QuoteToBase => (quote_fee, base_fee),
    }
}
