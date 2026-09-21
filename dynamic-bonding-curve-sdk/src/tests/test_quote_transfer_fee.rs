use crate::{
    quote_exact_in::quote_exact_in,
    quote_exact_out::quote_exact_out,
    quote_partial_fill::quote_partial_fill,
    tests::{get_fee_in_both_accounts, get_fee_in_quote_accounts, TestAccounts},
    transfer_fee::SwapResultWithTransferFee,
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

// different rates so the combined test can tell the two fees apart
fn base_fee() -> TransferFeeConfig {
    transfer_fee_config(250, u64::MAX)
}

fn quote_fee() -> TransferFeeConfig {
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

// transfer fee on the quote mint only

#[test]
fn test_quote_fee_exact_in_quote_to_base_consumes_the_net_input() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_quote_accounts();
    let quote_fee = quote_fee();
    let in_amount = 1_000_000_000;

    let quote = quote_exact_in(
        &pool,
        &config,
        false,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        None,
        Some(&quote_fee),
        in_amount,
        false,
        false,
    )
    .unwrap();

    assert_eq!(quote.included_transfer_fee_amount_in, in_amount);
    assert_eq!(
        quote.swap_result.included_fee_input_amount,
        excluded(&quote_fee, in_amount)
    );
    // the base mint has no transfer fee
    assert_eq!(
        quote.excluded_transfer_fee_amount_out,
        quote.swap_result.output_amount
    );

    // the curve receives less input than with no fee
    let fee_free = quote_exact_in(
        &pool,
        &config,
        false,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        None,
        None,
        in_amount,
        false,
        false,
    )
    .unwrap();
    assert!(quote.swap_result.output_amount < fee_free.swap_result.output_amount);
}

#[test]
fn test_quote_fee_exact_in_base_to_quote_nets_the_output_after_fee() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_quote_accounts();
    let quote_fee = quote_fee();
    let in_amount = 99_999_977_131;

    let quote = quote_exact_in(
        &pool,
        &config,
        true,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        None,
        Some(&quote_fee),
        in_amount,
        false,
        false,
    )
    .unwrap();

    assert_eq!(quote.included_transfer_fee_amount_in, in_amount);
    assert_eq!(quote.swap_result.included_fee_input_amount, in_amount);
    assert_eq!(
        quote.excluded_transfer_fee_amount_out,
        excluded(&quote_fee, quote.swap_result.output_amount)
    );
    assert!(quote.excluded_transfer_fee_amount_out < quote.swap_result.output_amount);
}

#[test]
fn test_quote_fee_exact_out_base_to_quote_round_trips_through_exact_in() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_quote_accounts();
    let quote_fee = quote_fee();
    let out_amount = 4_005_059;

    let exact_out = quote_exact_out(
        &pool,
        &config,
        true,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        None,
        Some(&quote_fee),
        out_amount,
        false,
    )
    .unwrap();

    assert_eq!(exact_out.excluded_transfer_fee_amount_out, out_amount);
    assert_eq!(
        exact_out.swap_result.output_amount,
        included(&quote_fee, out_amount)
    );
    // the base mint has no transfer fee
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
        None,
        Some(&quote_fee),
        exact_out.included_transfer_fee_amount_in,
        false,
        false,
    )
    .unwrap();
    assert!(exact_in.excluded_transfer_fee_amount_out >= out_amount);
}

#[test]
fn test_quote_fee_exact_out_quote_to_base_grosses_up_the_input() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_quote_accounts();
    let quote_fee = quote_fee();
    let out_amount = 4_005_059;

    let exact_out = quote_exact_out(
        &pool,
        &config,
        false,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        None,
        Some(&quote_fee),
        out_amount,
        false,
    )
    .unwrap();

    // the base mint has no transfer fee
    assert_eq!(exact_out.excluded_transfer_fee_amount_out, out_amount);
    assert_eq!(exact_out.swap_result.output_amount, out_amount);
    assert_eq!(
        exact_out.included_transfer_fee_amount_in,
        included(&quote_fee, exact_out.swap_result.included_fee_input_amount)
    );
    assert!(
        exact_out.included_transfer_fee_amount_in > exact_out.swap_result.included_fee_input_amount
    );

    // paying this input with exact-in returns at least out_amount
    let exact_in = quote_exact_in(
        &pool,
        &config,
        false,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        None,
        Some(&quote_fee),
        exact_out.included_transfer_fee_amount_in,
        false,
        false,
    )
    .unwrap();
    assert!(exact_in.excluded_transfer_fee_amount_out >= out_amount);
}

#[test]
fn test_quote_fee_partial_fill_charges_the_grossed_up_consumed_input() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_quote_accounts();
    let quote_fee = quote_fee();
    // large enough to reach the migration threshold, so some input is left over
    let in_amount = u64::MAX / 4;

    let partial = quote_partial_fill(
        &pool,
        &config,
        false,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        None,
        Some(&quote_fee),
        in_amount,
        false,
        false,
    )
    .unwrap();

    assert!(partial.swap_result.amount_left > 0);
    assert_eq!(
        partial.included_transfer_fee_amount_in,
        included(&quote_fee, partial.swap_result.included_fee_input_amount)
    );
    assert!(partial.included_transfer_fee_amount_in < in_amount);
    // the base mint has no transfer fee, the user receives the full output
    assert_eq!(
        partial.excluded_transfer_fee_amount_out,
        partial.swap_result.output_amount
    );
}

// transfer fee on the base mint only

#[test]
fn test_base_fee_exact_in_base_to_quote_consumes_the_net_input() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_both_accounts();
    let base_fee = base_fee();
    let in_amount = 1_000_000_000;

    let quote = quote_exact_in(
        &pool,
        &config,
        true,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        Some(&base_fee),
        None,
        in_amount,
        false,
        false,
    )
    .unwrap();

    assert_eq!(quote.included_transfer_fee_amount_in, in_amount);
    assert_eq!(
        quote.swap_result.included_fee_input_amount,
        excluded(&base_fee, in_amount)
    );
    // the quote mint has no transfer fee
    assert_eq!(
        quote.excluded_transfer_fee_amount_out,
        quote.swap_result.output_amount
    );

    // the curve receives the net amount, so a fee-free quote of the net amount gives the same result
    let fee_free = quote_exact_in(
        &pool,
        &config,
        true,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        None,
        None,
        excluded(&base_fee, in_amount),
        false,
        false,
    )
    .unwrap();
    assert_eq!(quote.swap_result, fee_free.swap_result);
}

#[test]
fn test_base_fee_exact_in_quote_to_base_nets_the_output_after_fee() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_quote_accounts();
    let base_fee = base_fee();
    let in_amount = 1_000_000_000;

    let quote = quote_exact_in(
        &pool,
        &config,
        false,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        Some(&base_fee),
        None,
        in_amount,
        false,
        false,
    )
    .unwrap();

    assert_eq!(quote.included_transfer_fee_amount_in, in_amount);
    assert_eq!(quote.swap_result.included_fee_input_amount, in_amount);
    assert_eq!(
        quote.excluded_transfer_fee_amount_out,
        excluded(&base_fee, quote.swap_result.output_amount)
    );
    assert!(quote.excluded_transfer_fee_amount_out < quote.swap_result.output_amount);
}

#[test]
fn test_base_fee_exact_out_quote_to_base_grosses_up_the_output() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_quote_accounts();
    let base_fee = base_fee();
    let out_amount = 1_000_000_000;

    let exact_out = quote_exact_out(
        &pool,
        &config,
        false,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        Some(&base_fee),
        None,
        out_amount,
        false,
    )
    .unwrap();

    assert_eq!(exact_out.excluded_transfer_fee_amount_out, out_amount);
    assert_eq!(
        exact_out.swap_result.output_amount,
        included(&base_fee, out_amount)
    );
    // the quote mint has no transfer fee
    assert_eq!(
        exact_out.included_transfer_fee_amount_in,
        exact_out.swap_result.included_fee_input_amount
    );

    // paying this input with exact-in returns at least out_amount after the base fee
    let exact_in = quote_exact_in(
        &pool,
        &config,
        false,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        Some(&base_fee),
        None,
        exact_out.included_transfer_fee_amount_in,
        false,
        false,
    )
    .unwrap();
    assert!(exact_in.excluded_transfer_fee_amount_out >= out_amount);
}

#[test]
fn test_base_fee_exact_out_base_to_quote_grosses_up_the_input() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_both_accounts();
    let base_fee = base_fee();
    let out_amount = 100_000_000;

    let exact_out = quote_exact_out(
        &pool,
        &config,
        true,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        Some(&base_fee),
        None,
        out_amount,
        false,
    )
    .unwrap();

    // the quote mint has no transfer fee
    assert_eq!(exact_out.excluded_transfer_fee_amount_out, out_amount);
    assert_eq!(exact_out.swap_result.output_amount, out_amount);
    assert_eq!(
        exact_out.included_transfer_fee_amount_in,
        included(&base_fee, exact_out.swap_result.included_fee_input_amount)
    );

    let exact_in = quote_exact_in(
        &pool,
        &config,
        true,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        Some(&base_fee),
        None,
        exact_out.included_transfer_fee_amount_in,
        false,
        false,
    )
    .unwrap();
    assert!(exact_in.excluded_transfer_fee_amount_out >= out_amount);
}

#[test]
fn test_base_fee_partial_fill_base_to_quote_charges_the_grossed_up_consumed_input() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_both_accounts();
    let base_fee = base_fee();
    let in_amount = u64::MAX / 4;

    let partial = quote_partial_fill(
        &pool,
        &config,
        true,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        Some(&base_fee),
        None,
        in_amount,
        false,
        false,
    )
    .unwrap();

    assert_eq!(
        partial.included_transfer_fee_amount_in,
        included(&base_fee, partial.swap_result.included_fee_input_amount)
    );
    assert!(partial.included_transfer_fee_amount_in <= in_amount);
    // the quote mint has no transfer fee
    assert_eq!(
        partial.excluded_transfer_fee_amount_out,
        partial.swap_result.output_amount
    );
}

// transfer fee on both mints

#[test]
fn test_both_fees_apply_to_their_own_legs() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_quote_accounts();
    let base_fee = base_fee();
    let quote_fee = quote_fee();
    let in_amount = 1_000_000_000;

    // quote in, base out: the quote fee applies to the input, the base fee to the output
    let quote_to_base = quote_exact_in(
        &pool,
        &config,
        false,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        Some(&base_fee),
        Some(&quote_fee),
        in_amount,
        false,
        false,
    )
    .unwrap();
    assert_eq!(
        quote_to_base.swap_result.included_fee_input_amount,
        excluded(&quote_fee, in_amount)
    );
    assert_eq!(
        quote_to_base.excluded_transfer_fee_amount_out,
        excluded(&base_fee, quote_to_base.swap_result.output_amount)
    );

    // base in, quote out: the base fee applies to the input, the quote fee to the output
    let base_to_quote = quote_exact_in(
        &pool,
        &config,
        true,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        Some(&base_fee),
        Some(&quote_fee),
        in_amount,
        false,
        false,
    )
    .unwrap();
    assert_eq!(
        base_to_quote.swap_result.included_fee_input_amount,
        excluded(&base_fee, in_amount)
    );
    assert_eq!(
        base_to_quote.excluded_transfer_fee_amount_out,
        excluded(&quote_fee, base_to_quote.swap_result.output_amount)
    );

    // exact-out with both fees grosses up the input and the output
    let out_amount = 100_000_000;
    let exact_out = quote_exact_out(
        &pool,
        &config,
        true,
        current_timestamp,
        current_slot,
        CURRENT_EPOCH,
        Some(&base_fee),
        Some(&quote_fee),
        out_amount,
        false,
    )
    .unwrap();
    assert_eq!(
        exact_out.swap_result.output_amount,
        included(&quote_fee, out_amount)
    );
    assert_eq!(
        exact_out.included_transfer_fee_amount_in,
        included(&base_fee, exact_out.swap_result.included_fee_input_amount)
    );
}

// edge cases, checked on the base mint and the quote mint

#[test]
fn test_zero_fee_config_matches_none_on_either_slot() {
    let TestAccounts {
        config,
        pool,
        current_timestamp,
        current_slot,
    } = get_fee_in_quote_accounts();
    let zero_fee = transfer_fee_config(0, 0);
    let amount = 4_005_059;

    let quotes = |swap_base_for_quote: bool,
                  base_fee: Option<&TransferFeeConfig>,
                  quote_fee: Option<&TransferFeeConfig>|
     -> [SwapResultWithTransferFee; 3] {
        [
            quote_exact_in(
                &pool,
                &config,
                swap_base_for_quote,
                current_timestamp,
                current_slot,
                CURRENT_EPOCH,
                base_fee,
                quote_fee,
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
                base_fee,
                quote_fee,
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
                base_fee,
                quote_fee,
                amount,
                false,
                false,
            )
            .unwrap(),
        ]
    };

    for swap_base_for_quote in [true, false] {
        let without_config = quotes(swap_base_for_quote, None, None);

        for (base_fee, quote_fee) in [
            (Some(&zero_fee), None),
            (None, Some(&zero_fee)),
            (Some(&zero_fee), Some(&zero_fee)),
        ] {
            assert_eq!(
                quotes(swap_base_for_quote, base_fee, quote_fee),
                without_config
            );
        }

        // with no fee the transfer amounts equal the curve amounts
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

    // the scheduled fee is on the input mint in both cases
    for (swap_base_for_quote, base_fee, quote_fee) in [
        (false, None, Some(&fee_config)),
        (true, Some(&fee_config), None),
    ] {
        let quote = |epoch: u64| {
            quote_exact_in(
                &pool,
                &config,
                swap_base_for_quote,
                current_timestamp,
                current_slot,
                epoch,
                base_fee,
                quote_fee,
                in_amount,
                false,
                false,
            )
            .unwrap()
        };

        // the older fee (0 bps) is active
        assert_eq!(
            quote(CURRENT_EPOCH).swap_result.included_fee_input_amount,
            in_amount
        );
        // the newer fee (100 bps) is active
        assert_eq!(
            quote(CURRENT_EPOCH + 2)
                .swap_result
                .included_fee_input_amount,
            in_amount - in_amount / 100
        );
    }
}
