use crate::{
    quote_exact_in::quote_exact_in,
    quote_partial_fill::quote_partial_fill,
    tests::{get_fee_in_both_accounts, get_fee_in_quote_accounts, TestAccounts},
};

#[test]
fn test_quote_partial_fill_fee_in_quote_from_base_for_quote() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_quote_accounts();

    let swap_base_for_quote = true;

    let input_amount = 99999977131;
    let partial_fill_swap_result = quote_partial_fill(
        &pool,
        &config,
        swap_base_for_quote,
        current_timestamp,
        current_slot,
        input_amount,
        false,
    )
    .unwrap();

    let exact_in_swap_result = quote_exact_in(
        &pool,
        &config,
        swap_base_for_quote,
        current_timestamp,
        current_slot,
        input_amount,
        false,
    )
    .unwrap();

    assert!(partial_fill_swap_result.eq(&exact_in_swap_result));
}

#[test]
fn test_quote_partial_fill_fee_in_quote_from_quote_to_base() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_quote_accounts();

    let swap_base_for_quote = false;
    let input_amount = 4046480; // base token
    let partial_fill_swap_result = quote_partial_fill(
        &pool,
        &config,
        swap_base_for_quote,
        current_timestamp,
        current_slot,
        input_amount,
        false,
    )
    .unwrap();

    let exact_in_swap_result = quote_exact_in(
        &pool,
        &config,
        swap_base_for_quote,
        current_timestamp,
        current_slot,
        input_amount,
        false,
    )
    .unwrap();
    assert!(partial_fill_swap_result.eq(&exact_in_swap_result));
}

#[test]
fn test_quote_partial_fill_fee_in_both_from_base_for_quote() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_both_accounts();

    let swap_base_for_quote = true;

    let input_amount = 99999977131;
    let partial_fill_swap_result = quote_partial_fill(
        &pool,
        &config,
        swap_base_for_quote,
        current_timestamp,
        current_slot,
        input_amount,
        false,
    )
    .unwrap();

    let exact_in_swap_result = quote_exact_in(
        &pool,
        &config,
        swap_base_for_quote,
        current_timestamp,
        current_slot,
        input_amount,
        false,
    )
    .unwrap();

    assert!(partial_fill_swap_result.eq(&exact_in_swap_result));
}

#[test]
fn test_quote_partial_fill_fee_in_both_from_quote_to_base() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_both_accounts();

    let swap_base_for_quote = false;
    let input_amount = 4046480; // base token
    let partial_fill_swap_result = quote_partial_fill(
        &pool,
        &config,
        swap_base_for_quote,
        current_timestamp,
        current_slot,
        input_amount,
        false,
    )
    .unwrap();

    let exact_in_swap_result = quote_exact_in(
        &pool,
        &config,
        swap_base_for_quote,
        current_timestamp,
        current_slot,
        input_amount,
        false,
    )
    .unwrap();
    assert!(partial_fill_swap_result.eq(&exact_in_swap_result));
}
