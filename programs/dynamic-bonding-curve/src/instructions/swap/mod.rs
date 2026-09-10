pub mod ix_swap;
pub use ix_swap::*;
pub mod ix_swap2_with_transfer_hook;
pub use ix_swap2_with_transfer_hook::*;
pub mod process_swap;
pub use process_swap::*;
mod swap_exact_in;
mod swap_exact_out;
mod swap_partial_fill;

use crate::{
    params::swap::TradeDirection,
    state::{fee::FeeMode, PoolConfig, PoolState, SwapResult2},
};
use anchor_spl::token_2022::spl_token_2022::extension::transfer_fee::TransferFee;

struct ProcessSwapResult {
    swap_result: SwapResult2,
    swap_in_parameters: SwapParameters,
    included_transfer_fee_amount_in: u64,
    excluded_transfer_fee_amount_out: u64,
}

struct ProcessSwapParams<'a> {
    pool: &'a mut PoolState,
    config: &'a PoolConfig,
    fee_mode: &'a FeeMode,
    trade_direction: TradeDirection,
    current_point: u64,
    amount_0: u64,
    amount_1: u64,
    eligible_for_first_swap_with_min_fee: bool,
    transfer_fee_in: Option<&'a TransferFee>,
    transfer_fee_out: Option<&'a TransferFee>,
}
