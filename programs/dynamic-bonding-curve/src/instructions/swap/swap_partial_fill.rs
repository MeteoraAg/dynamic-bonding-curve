use crate::{
    swap::{ProcessSwapParams, ProcessSwapResult},
    token::{calculate_transfer_fee_excluded_amount, calculate_transfer_fee_included_amount},
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
        eligible_for_first_swap_with_min_fee,
        transfer_fee_in,
        transfer_fee_out,
    } = params;

    let excluded_transfer_fee_amount_in =
        calculate_transfer_fee_excluded_amount(transfer_fee_in, amount_in)?.amount;

    require!(excluded_transfer_fee_amount_in > 0, PoolError::AmountIsZero);

    let swap_result = pool.get_swap_result_from_partial_input(
        config,
        excluded_transfer_fee_amount_in,
        fee_mode,
        trade_direction,
        current_point,
        eligible_for_first_swap_with_min_fee,
    )?;

    let excluded_transfer_fee_amount_out =
        calculate_transfer_fee_excluded_amount(transfer_fee_out, swap_result.output_amount)?.amount;
    require!(
        excluded_transfer_fee_amount_out >= minimum_amount_out,
        PoolError::ExceededSlippage
    );

    let included_transfer_fee_amount_in = calculate_transfer_fee_included_amount(
        transfer_fee_in,
        swap_result.included_fee_input_amount,
    )?
    .amount;

    Ok(ProcessSwapResult {
        swap_result,
        // For backward compatibility because we are emitting EvtSwap and EvtSwap2
        swap_in_parameters: SwapParameters {
            amount_in: included_transfer_fee_amount_in,
            minimum_amount_out: excluded_transfer_fee_amount_out,
        },
        included_transfer_fee_amount_in,
        excluded_transfer_fee_amount_out,
    })
}
