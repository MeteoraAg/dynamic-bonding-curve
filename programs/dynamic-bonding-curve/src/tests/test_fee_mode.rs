use crate::{
    params::swap::TradeDirection,
    state::{fee::FeeMode, CollectFeeMode},
};

#[test]
fn test_fee_mode_output_token_base_to_quote() {
    let fee_mode = FeeMode::get_fee_mode(
        CollectFeeMode::OutputToken as u8,
        TradeDirection::BaseToQuote,
        false,
    )
    .unwrap();

    assert!(!fee_mode.fees_on_input);
    assert!(!fee_mode.fees_on_base_token);
    assert!(!fee_mode.has_referral);
}

#[test]
fn test_fee_mode_output_token_quote_to_base() {
    let fee_mode = FeeMode::get_fee_mode(
        CollectFeeMode::OutputToken as u8,
        TradeDirection::QuoteToBase,
        true,
    )
    .unwrap();

    assert!(!fee_mode.fees_on_input);
    assert!(fee_mode.fees_on_base_token);
    assert!(fee_mode.has_referral);
}

#[test]
fn test_fee_mode_quote_token_base_to_quote() {
    let fee_mode = FeeMode::get_fee_mode(
        CollectFeeMode::QuoteToken as u8,
        TradeDirection::BaseToQuote,
        false,
    )
    .unwrap();

    assert!(!fee_mode.fees_on_input);
    assert!(!fee_mode.fees_on_base_token);
    assert!(!fee_mode.has_referral);
}

#[test]
fn test_fee_mode_quote_token_quote_to_base() {
    let fee_mode = FeeMode::get_fee_mode(
        CollectFeeMode::QuoteToken as u8,
        TradeDirection::QuoteToBase,
        true,
    )
    .unwrap();

    assert!(fee_mode.fees_on_input);
    assert!(!fee_mode.fees_on_base_token);
    assert!(fee_mode.has_referral);
}

#[test]
fn test_invalid_collect_fee_mode() {
    let result = FeeMode::get_fee_mode(
        2, // Invalid mode
        TradeDirection::QuoteToBase,
        false,
    );

    assert!(result.is_err());
}

#[test]
fn test_fee_mode_default() {
    let fee_mode = FeeMode::default();

    assert!(!fee_mode.fees_on_input);
    assert!(!fee_mode.fees_on_base_token);
    assert!(!fee_mode.has_referral);
}

// Property-based test to ensure consistent behavior
#[test]
fn test_fee_mode_properties() {
    // When trading BaseToQuote, fees should never be on input
    let fee_mode = FeeMode::get_fee_mode(
        CollectFeeMode::QuoteToken as u8,
        TradeDirection::BaseToQuote,
        true,
    )
    .unwrap();
    assert!(!fee_mode.fees_on_input);

    // When using QuoteToken mode, base_token should always be false
    let fee_mode = FeeMode::get_fee_mode(
        CollectFeeMode::QuoteToken as u8,
        TradeDirection::QuoteToBase,
        false,
    )
    .unwrap();
    assert!(!fee_mode.fees_on_base_token);
}
