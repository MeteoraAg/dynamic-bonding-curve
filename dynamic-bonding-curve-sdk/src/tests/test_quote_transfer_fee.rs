use crate::{
    quote_exact_in::quote_exact_in,
    quote_exact_out::quote_exact_out,
    quote_partial_fill::quote_partial_fill,
    tests::{get_fee_in_quote_accounts, TestAccounts},
    transfer_fee::QuoteResult,
};
use anchor_spl::token_2022::spl_token_2022::extension::transfer_fee::{
    TransferFee, TransferFeeConfig,
};
use dynamic_bonding_curve::token::{
    calculate_transfer_fee_excluded_amount, calculate_transfer_fee_included_amount,
};

const CURRENT_EPOCH: u64 = 500;

fn transfer_fee_config(basis_points: u16, maximum_fee: u64) -> TransferFeeConfig {
    let fee = TransferFee {
        epoch: 0.into(),
        maximum_fee: maximum_fee.into(),
        transfer_fee_basis_points: basis_points.into(),
    };
    TransferFeeConfig {
        older_transfer_fee: fee,
        newer_transfer_fee: fee,
        ..TransferFeeConfig::default()
    }
}

fn one_percent() -> TransferFeeConfig {
    transfer_fee_config(100, u64::MAX)
}

fn excluded(config: &TransferFeeConfig, amount: u64) -> u64 {
    calculate_transfer_fee_excluded_amount(Some(config.get_epoch_fee(CURRENT_EPOCH)), amount)
        .unwrap()
        .amount
}

fn included(config: &TransferFeeConfig, amount: u64) -> u64 {
    calculate_transfer_fee_included_amount(Some(config.get_epoch_fee(CURRENT_EPOCH)), amount)
        .unwrap()
        .amount
}

#[test]
fn test_exact_in_quote_to_base_consumes_the_net_input() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_quote_accounts();
    let fee_config = one_percent();
    let in_amount = 1_000_000_000;

    let quote = quote_exact_in(
        &pool,
        &config,
        false,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        Some(&fee_config),
        in_amount,
        false,
        false,
    )
    .unwrap();

    assert_eq!(quote.included_transfer_fee_amount_in, in_amount);
    assert_eq!(
        quote.swap_result.included_fee_input_amount,
        excluded(&fee_config, in_amount)
    );
    // base has no transfer fee
    assert_eq!(
        quote.excluded_transfer_fee_amount_out,
        quote.swap_result.output_amount
    );

    // the curve saw less input than a fee-free quote would
    let fee_free = quote_exact_in(
        &pool,
        &config,
        false,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        None,
        in_amount,
        false,
        false,
    )
    .unwrap();
    assert!(quote.swap_result.output_amount < fee_free.swap_result.output_amount);
}

#[test]
fn test_exact_in_base_to_quote_nets_the_output_after_fee() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_quote_accounts();
    let fee_config = one_percent();
    let in_amount = 99_999_977_131;

    let quote = quote_exact_in(
        &pool,
        &config,
        true,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        Some(&fee_config),
        in_amount,
        false,
        false,
    )
    .unwrap();

    assert_eq!(quote.included_transfer_fee_amount_in, in_amount);
    assert_eq!(quote.swap_result.included_fee_input_amount, in_amount);
    assert_eq!(
        quote.excluded_transfer_fee_amount_out,
        excluded(&fee_config, quote.swap_result.output_amount)
    );
    assert!(quote.excluded_transfer_fee_amount_out < quote.swap_result.output_amount);
}

#[test]
fn test_exact_out_base_to_quote_round_trips_through_exact_in() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_quote_accounts();
    let fee_config = one_percent();
    let out_amount = 4_005_059;

    let exact_out = quote_exact_out(
        &pool,
        &config,
        true,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        Some(&fee_config),
        out_amount,
        false,
    )
    .unwrap();

    assert_eq!(exact_out.excluded_transfer_fee_amount_out, out_amount);
    assert_eq!(
        exact_out.swap_result.output_amount,
        included(&fee_config, out_amount)
    );
    // base input has no transfer fee
    assert_eq!(
        exact_out.included_transfer_fee_amount_in,
        exact_out.swap_result.included_fee_input_amount
    );

    let exact_in = quote_exact_in(
        &pool,
        &config,
        true,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        Some(&fee_config),
        exact_out.included_transfer_fee_amount_in,
        false,
        false,
    )
    .unwrap();
    assert!(exact_in.excluded_transfer_fee_amount_out >= out_amount);
}

#[test]
fn test_exact_out_quote_to_base_grosses_up_the_input() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_quote_accounts();
    let fee_config = one_percent();
    let out_amount = 4_005_059;

    let exact_out = quote_exact_out(
        &pool,
        &config,
        false,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        Some(&fee_config),
        out_amount,
        false,
    )
    .unwrap();

    // base output has no transfer fee
    assert_eq!(exact_out.excluded_transfer_fee_amount_out, out_amount);
    assert_eq!(exact_out.swap_result.output_amount, out_amount);
    assert_eq!(
        exact_out.included_transfer_fee_amount_in,
        included(&fee_config, exact_out.swap_result.included_fee_input_amount)
    );
    assert!(
        exact_out.included_transfer_fee_amount_in > exact_out.swap_result.included_fee_input_amount
    );

    // paying the grossed-up input through exact-in yields at least the requested output
    let exact_in = quote_exact_in(
        &pool,
        &config,
        false,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        Some(&fee_config),
        exact_out.included_transfer_fee_amount_in,
        false,
        false,
    )
    .unwrap();
    assert!(exact_in.excluded_transfer_fee_amount_out >= out_amount);
}

#[test]
fn test_partial_fill_charges_the_grossed_up_consumed_input() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_quote_accounts();
    let fee_config = one_percent();
    // large enough to hit the migration threshold and leave amount_left behind
    let in_amount = u64::MAX / 4;

    let partial = quote_partial_fill(
        &pool,
        &config,
        false,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        Some(&fee_config),
        in_amount,
        false,
        false,
    )
    .unwrap();

    assert!(partial.swap_result.amount_left > 0);
    assert_eq!(
        partial.included_transfer_fee_amount_in,
        included(&fee_config, partial.swap_result.included_fee_input_amount)
    );
    assert!(partial.included_transfer_fee_amount_in < in_amount);
    // the user nets what the vault gives up, base has no fee
    assert_eq!(
        partial.excluded_transfer_fee_amount_out,
        partial.swap_result.output_amount
    );
}

#[test]
fn test_zero_fee_config_matches_none() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_quote_accounts();
    let zero_fee = transfer_fee_config(0, 0);
    let amount = 4_005_059;

    for swap_base_for_quote in [true, false] {
        let with_config: [QuoteResult; 3] = [
            quote_exact_in(
                &pool,
                &config,
                swap_base_for_quote,
                current_timestamp,
                current_slot,
                CURRENT_EPOCH,
                Some(&zero_fee),
                amount,
                false,
                false,
            )
            .unwrap(),
            quote_exact_out(
                &pool,
                &config,
                swap_base_for_quote,
                current_timestamp,
                current_slot,
                CURRENT_EPOCH,
                Some(&zero_fee),
                amount,
                false,
            )
            .unwrap(),
            quote_partial_fill(
                &pool,
                &config,
                swap_base_for_quote,
                current_timestamp,
                current_slot,
                CURRENT_EPOCH,
                Some(&zero_fee),
                amount,
                false,
                false,
            )
            .unwrap(),
        ];
        let without_config: [QuoteResult; 3] = [
            quote_exact_in(
                &pool,
                &config,
                swap_base_for_quote,
                current_timestamp,
                current_slot,
                CURRENT_EPOCH,
                None,
                amount,
                false,
                false,
            )
            .unwrap(),
            quote_exact_out(
                &pool,
                &config,
                swap_base_for_quote,
                current_timestamp,
                current_slot,
                CURRENT_EPOCH,
                None,
                amount,
                false,
            )
            .unwrap(),
            quote_partial_fill(
                &pool,
                &config,
                swap_base_for_quote,
                current_timestamp,
                current_slot,
                CURRENT_EPOCH,
                None,
                amount,
                false,
                false,
            )
            .unwrap(),
        ];
        assert_eq!(with_config, without_config);

        // with no fee the transfer amounts collapse onto the curve amounts
        for quote in without_config {
            assert_eq!(
                quote.included_transfer_fee_amount_in,
                quote.swap_result.included_fee_input_amount
            );
            assert_eq!(
                quote.excluded_transfer_fee_amount_out,
                quote.swap_result.output_amount
            );
        }
    }
}

#[test]
fn test_scheduled_fee_is_applied_only_once_its_epoch_arrives() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_quote_accounts();
    let mut fee_config = transfer_fee_config(0, 0);
    fee_config.newer_transfer_fee = TransferFee {
        epoch: (CURRENT_EPOCH + 2).into(),
        maximum_fee: u64::MAX.into(),
        transfer_fee_basis_points: 100u16.into(),
    };
    let in_amount = 1_000_000_000;

    let quote = |epoch: u64| {
        quote_exact_in(
            &pool,
            &config,
            false,
            current_timestamp,
            current_slot,
            epoch,
            Some(&fee_config),
            in_amount,
            false,
            false,
        )
        .unwrap()
    };

    // older fee (0 bps) is still active
    assert_eq!(
        quote(CURRENT_EPOCH).swap_result.included_fee_input_amount,
        in_amount
    );
    // newer fee (100 bps) took over
    assert_eq!(
        quote(CURRENT_EPOCH + 2)
            .swap_result
            .included_fee_input_amount,
        in_amount - in_amount / 100
    );
}
