use crate::{
    swap::{ProcessSwapParams, ProcessSwapResult},
    PoolError, SwapParameters,
};
use anchor_lang::prelude::*;

pub fn process_swap_partial_fill(params: ProcessSwapParams<'_>) -> Result<ProcessSwapResult> {
    let ProcessSwapParams {
        amount_0: amount_in,
        amount_1: minimum_amount_out,
        pool,
        config,
        fee_mode,
        trade_direction,
        current_point,
    } = params;

    let swap_result = pool.get_swap_result_from_partial_input(
        config,
        amount_in,
        fee_mode,
        trade_direction,
        current_point,
    )?;

    require!(
        swap_result.output_amount >= minimum_amount_out,
        PoolError::ExceededSlippage
    );

    let included_fee_input_amount = swap_result.included_fee_input_amount;
    let output_amount = swap_result.output_amount;

    Ok(ProcessSwapResult {
        swap_result,
        // For backward compatibility because we are emitting EvtSwap and EvtSwap2
        swap_in_parameters: SwapParameters {
            amount_in: included_fee_input_amount,
            minimum_amount_out: output_amount,
        },
    })
}
