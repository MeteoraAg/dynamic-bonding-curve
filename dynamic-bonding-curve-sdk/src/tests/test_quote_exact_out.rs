use crate::{
    quote_exact_in::quote_exact_in,
    quote_exact_out::quote_exact_out,
    tests::{get_fee_in_both_accounts, get_fee_in_quote_accounts, TestAccounts},
};

#[test]
fn test_quote_exact_out_fee_in_quote_from_base_for_quote() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_quote_accounts();

    let swap_base_for_quote = true;
    let output_amount = 4005059;
    let exact_out_swap_result = quote_exact_out(
        &pool,
        &config,
        swap_base_for_quote,
        current_timestamp,
        current_slot,
        output_amount,
    )
    .unwrap();

    println!("exact_out_swap_result {:?}", exact_out_swap_result);

    let exact_in_swap_result = quote_exact_in(
        &pool,
        &config,
        swap_base_for_quote,
        current_timestamp,
        current_slot,
        exact_out_swap_result.included_fee_input_amount,
        false,
    )
    .unwrap();
    println!("exact_in_swap_result {:?}", exact_in_swap_result);

    assert_eq!(exact_in_swap_result.output_amount, output_amount);
    assert_eq!(
        exact_in_swap_result.trading_fee,
        exact_out_swap_result.trading_fee
    );
    assert_eq!(
        exact_in_swap_result.protocol_fee,
        exact_out_swap_result.protocol_fee
    );
}

#[test]
fn test_quote_exact_out_fee_in_quote_from_quote_to_base() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_quote_accounts();

    let swap_base_for_quote = false;
    let output_amount = 100_000_000_000; // base token
    let exact_out_swap_result = quote_exact_out(
        &pool,
        &config,
        swap_base_for_quote,
        current_timestamp,
        current_slot,
        output_amount,
    )
    .unwrap();

    println!("exact_out_swap_result {:?}", exact_out_swap_result);
    let exact_in_swap_result = quote_exact_in(
        &pool,
        &config,
        swap_base_for_quote,
        current_timestamp,
        current_slot,
        exact_out_swap_result.included_fee_input_amount,
        false,
    )
    .unwrap();
    println!("exact_in_swap_result {:?}", exact_in_swap_result);

    assert!(exact_in_swap_result.output_amount >= output_amount);

    assert!(exact_in_swap_result.trading_fee == exact_out_swap_result.trading_fee);
    assert!(exact_in_swap_result.protocol_fee == exact_out_swap_result.protocol_fee);
}

#[test]
fn test_quote_exact_out_fee_in_both_from_base_for_quote() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_both_accounts();

    let swap_base_for_quote = true;
    let output_amount = 4005059;
    let exact_out_swap_result = quote_exact_out(
        &pool,
        &config,
        swap_base_for_quote,
        current_timestamp,
        current_slot,
        output_amount,
    )
    .unwrap();

    println!("exact_out_swap_result {:?}", exact_out_swap_result);

    let exact_in_swap_result = quote_exact_in(
        &pool,
        &config,
        swap_base_for_quote,
        current_timestamp,
        current_slot,
        exact_out_swap_result.included_fee_input_amount,
        false,
    )
    .unwrap();
    println!("exact_in_swap_result {:?}", exact_in_swap_result);

    assert_eq!(exact_in_swap_result.output_amount, output_amount);
    assert_eq!(
        exact_in_swap_result.trading_fee,
        exact_out_swap_result.trading_fee
    );
    assert_eq!(
        exact_in_swap_result.protocol_fee,
        exact_out_swap_result.protocol_fee
    );
}

#[test]
fn test_quote_exact_out_fee_in_both_from_quote_to_base() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_both_accounts();

    let swap_base_for_quote = false;
    let output_amount = 100_000_000_000; // base token
    let exact_out_swap_result = quote_exact_out(
        &pool,
        &config,
        swap_base_for_quote,
        current_timestamp,
        current_slot,
        output_amount,
    )
    .unwrap();

    println!("exact_out_swap_result {:?}", exact_out_swap_result);
    let exact_in_swap_result = quote_exact_in(
        &pool,
        &config,
        swap_base_for_quote,
        current_timestamp,
        current_slot,
        exact_out_swap_result.included_fee_input_amount,
        false,
    )
    .unwrap();
    println!("exact_in_swap_result {:?}", exact_in_swap_result);

    assert!(exact_in_swap_result.output_amount >= output_amount);
}
