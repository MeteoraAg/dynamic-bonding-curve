use std::fs;

use dynamic_bonding_curve::state::{PoolConfig, VirtualPool};

use crate::{quote_exact_in::quote_exact_in, quote_exact_out::quote_exact_out};

fn get_accounts() -> (PoolConfig, VirtualPool) {
    let account_data = fs::read(&"./fixtures/config.bin").expect("Failed to read account data");

    let mut data_without_discriminator = account_data[8..].to_vec();
    let config_state: &PoolConfig = bytemuck::from_bytes(&mut data_without_discriminator);

    let account_data = fs::read(&"./fixtures/pool.bin").expect("Failed to read account data");

    let mut data_without_discriminator = account_data[8..].to_vec();
    let pool_state: &VirtualPool = bytemuck::from_bytes_mut(&mut data_without_discriminator);

    (*config_state, *pool_state)
}

#[test]
fn test_quote_exact_out_fee_in_quote_from_base_for_quote() {
    let (config, pool) = get_accounts();

    let swap_base_for_quote = true;
    let current_timestamp = 1_750_997_303;
    let current_slot = 327_665_017;
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
        exact_out_swap_result.actual_input_amount,
        false,
    )
    .unwrap();
    println!("exact_in_swap_result {:?}", exact_in_swap_result);

    assert_eq!(exact_in_swap_result.output_amount, output_amount);
}

#[test]
fn test_quote_exact_out_fee_in_quote_from_quote_to_base() {
    let (config, pool) = get_accounts();

    let swap_base_for_quote = false;
    let current_timestamp = 1_750_997_303;
    let current_slot = 327_665_017;
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
        exact_out_swap_result.actual_input_amount,
        false,
    )
    .unwrap();
    println!("exact_in_swap_result {:?}", exact_in_swap_result);

    assert!(exact_in_swap_result.output_amount >= output_amount);
}
