use anchor_spl::token_2022::spl_token_2022::extension::transfer_fee::{
    TransferFee, TransferFeeConfig,
};
use anyhow::Result;
use dynamic_bonding_curve::{
    params::swap::TradeDirection,
    state::SwapResult2,
    token::{calculate_transfer_fee_excluded_amount, calculate_transfer_fee_included_amount},
};

/// Curve result plus the token amounts that actually move once the quote mint's transfer fee applies.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct QuoteResult {
    pub swap_result: SwapResult2,
    pub included_transfer_fee_amount_in: u64,
    pub excluded_transfer_fee_amount_out: u64,
    // excluded_transfer_fee_amount_in is equivalent to swap_result.included_fee_input_amount
    // included_transfer_fee_amount_out is equivalent to swap_result.output_amount
}

/// Transfer fee of the quote mint active at `current_epoch`, split by leg for the given direction.
/// The base mint never carries a transfer fee, so its leg is always `None`.
pub struct QuoteTransferFees {
    pub input: Option<TransferFee>,
    pub output: Option<TransferFee>,
}

impl QuoteTransferFees {
    pub fn new(
        quote_mint_transfer_fee_config: Option<&TransferFeeConfig>,
        current_epoch: u64,
        trade_direction: TradeDirection,
    ) -> Self {
        let quote_fee = quote_mint_transfer_fee_config
            .map(|transfer_fee_config| *transfer_fee_config.get_epoch_fee(current_epoch));
        match trade_direction {
            TradeDirection::BaseToQuote => QuoteTransferFees {
                input: None,
                output: quote_fee,
            },
            TradeDirection::QuoteToBase => QuoteTransferFees {
                input: quote_fee,
                output: None,
            },
        }
    }

    pub fn excluded_input(&self, included_amount: u64) -> Result<u64> {
        Ok(calculate_transfer_fee_excluded_amount(self.input.as_ref(), included_amount)?.amount)
    }

    pub fn included_input(&self, excluded_amount: u64) -> Result<u64> {
        Ok(calculate_transfer_fee_included_amount(self.input.as_ref(), excluded_amount)?.amount)
    }

    pub fn excluded_output(&self, included_amount: u64) -> Result<u64> {
        Ok(calculate_transfer_fee_excluded_amount(self.output.as_ref(), included_amount)?.amount)
    }

    pub fn included_output(&self, excluded_amount: u64) -> Result<u64> {
        Ok(calculate_transfer_fee_included_amount(self.output.as_ref(), excluded_amount)?.amount)
    }
}
