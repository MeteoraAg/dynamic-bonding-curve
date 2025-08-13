pub mod ix_swap;
pub use ix_swap::*;
mod swap_exact_in;
mod swap_exact_out;
mod swap_partial_fill;

use crate::{
    params::swap::TradeDirection,
    state::{fee::FeeMode, PoolConfig, SwapResult2, VirtualPool},
};

struct ProcessSwapResult {
    swap_result: SwapResult2,
    swap_in_parameters: SwapParameters,
}

struct ProcessSwapParams<'a> {
    pool: &'a mut VirtualPool,
    config: &'a PoolConfig,
    fee_mode: &'a FeeMode,
    trade_direction: TradeDirection,
    current_point: u64,
    amount_0: u64,
    amount_1: u64,
}
