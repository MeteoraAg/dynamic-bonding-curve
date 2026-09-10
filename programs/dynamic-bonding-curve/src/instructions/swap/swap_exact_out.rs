use crate::{
    swap::{ProcessSwapParams, ProcessSwapResult},
    token::calculate_transfer_fee_included_amount,
    PoolError, SwapParameters,
};
use anchor_lang::prelude::*;

pub fn process_swap_exact_out(params: ProcessSwapParams<'_>) -> Result<ProcessSwapResult> {
    let ProcessSwapParams {
        pool,
        config,
        fee_mode,
        trade_direction,
        current_point,
        amount_0: amount_out,
        amount_1: maximum_amount_in,
        eligible_for_first_swap_with_min_fee,
        transfer_fee_in,
        transfer_fee_out,
    } = params;

    // the pool must send this much so the user nets amount_out after the output mint's transfer fee
    let included_transfer_fee_amount_out =
        calculate_transfer_fee_included_amount(transfer_fee_out, amount_out)?.amount;

    let swap_result = pool.get_swap_result_from_exact_output(
        config,
        included_transfer_fee_amount_out,
        fee_mode,
        trade_direction,
        current_point,
        eligible_for_first_swap_with_min_fee,
    )?;

    let included_fee_input_amount = swap_result.included_fee_input_amount;

    // the user must send this much so the vault nets what the curve requires
    let included_transfer_fee_amount_in =
        calculate_transfer_fee_included_amount(transfer_fee_in, included_fee_input_amount)?.amount;
    require!(
        included_transfer_fee_amount_in <= maximum_amount_in,
        PoolError::ExceededSlippage
    );

    Ok(ProcessSwapResult {
        swap_result,
        // For backward compatibility because we are emitting EvtSwap and EvtSwap2
        swap_in_parameters: SwapParameters {
            amount_in: included_transfer_fee_amount_in,
            minimum_amount_out: amount_out,
        },
        included_transfer_fee_amount_in,
        excluded_transfer_fee_amount_out: amount_out,
    })
}
