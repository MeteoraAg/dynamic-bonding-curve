use crate::{
    swap::{ProcessSwapParams, ProcessSwapResult},
    PoolError, SwapParameters,
};
use anchor_lang::prelude::*;

pub fn process_swap_exact_in(params: ProcessSwapParams<'_>) -> Result<ProcessSwapResult> {
    let ProcessSwapParams {
        amount_0: amount_in,
        amount_1: minimum_amount_out,
        pool,
        config,
        fee_mode,
        trade_direction,
        current_point,
        ..
    } = params;

    let swap_result = pool.get_swap_result_from_exact_input(
        config,
        amount_in,
        fee_mode,
        trade_direction,
        current_point,
    )?;

    require!(
        swap_result.amount_left <= config.get_max_swallow_quote_amount()?,
        PoolError::SwapAmountIsOverAThreshold
    );

    require!(
        swap_result.output_amount >= minimum_amount_out,
        PoolError::ExceededSlippage
    );

    Ok(ProcessSwapResult {
        swap_result,
        swap_in_parameters: SwapParameters {
            amount_in,
            minimum_amount_out,
        },
    })
}
