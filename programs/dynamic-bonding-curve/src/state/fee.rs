use anchor_lang::prelude::*;
use static_assertions::const_assert_eq;

use crate::{
    constants::{BASIS_POINT_MAX, ONE_Q64},
    params::swap::TradeDirection,
    safe_math::SafeMath,
    state::CollectFeeMode,
    state::DynamicFeeConfig,
    u128x128_math::Rounding,
    utils_math::safe_shl_div_cast,
    PoolError,
};

/// Encodes all results of swapping
#[derive(Debug, PartialEq)]
pub struct FeeOnAmountResult {
    pub amount: u64,
    pub trading_fee: u64,
    pub protocol_fee: u64,
    pub referral_fee: u64,
}

#[zero_copy]
#[derive(Debug, InitSpace, Default)]
pub struct VolatilityTracker {
    pub last_update_timestamp: u64,
    pub padding: [u8; 8],           // Add padding for u128 alignment
    pub sqrt_price_reference: u128, // reference sqrt price
    pub volatility_accumulator: u128,
    pub volatility_reference: u128, // decayed volatility accumulator
}

const_assert_eq!(VolatilityTracker::INIT_SPACE, 64);

impl VolatilityTracker {
    // we approximate Px / Py = (1 + b) ^ delta_bin  = 1 + b * delta_bin (if b is too small)
    // Ex: (1+1/10000)^ 5000 / (1+5000 * 1/10000) = 1.1 (10% diff if sqrt_price diff is (1+1/10000)^ 5000 = 1.64 times)
    pub fn get_delta_bin_id(
        bin_step_u128: u128,
        sqrt_price_a: u128,
        sqrt_price_b: u128,
    ) -> Result<u128> {
        let (upper_sqrt_price, lower_sqrt_price) = if sqrt_price_a > sqrt_price_b {
            (sqrt_price_a, sqrt_price_b)
        } else {
            (sqrt_price_b, sqrt_price_a)
        };

        let price_ratio: u128 =
            safe_shl_div_cast(upper_sqrt_price, lower_sqrt_price, 64, Rounding::Down)?;

        let delta_bin_id = price_ratio.safe_sub(ONE_Q64)?.safe_div(bin_step_u128)?;

        Ok(delta_bin_id.safe_mul(2)?)
    }

    pub fn update_volatility_accumulator(
        &mut self,
        dynamic_fee_config: &DynamicFeeConfig,
        sqrt_price: u128,
    ) -> Result<()> {
        let delta_price = VolatilityTracker::get_delta_bin_id(
            dynamic_fee_config.bin_step_u128,
            sqrt_price,
            self.sqrt_price_reference,
        )?;

        let volatility_accumulator = self
            .volatility_reference
            .safe_add(delta_price.safe_mul(BASIS_POINT_MAX.into())?)?;

        self.volatility_accumulator = std::cmp::min(
            volatility_accumulator,
            dynamic_fee_config.max_volatility_accumulator.into(),
        );

        Ok(())
    }

    pub fn update_references(
        &mut self,
        dynamic_fee_config: &DynamicFeeConfig,
        sqrt_price_current: u128,
        current_timestamp: u64,
    ) -> Result<()> {
        let elapsed = current_timestamp.safe_sub(self.last_update_timestamp)?;
        // Not high frequency trade
        if elapsed >= dynamic_fee_config.filter_period as u64 {
            // Update sqrt of last transaction
            self.sqrt_price_reference = sqrt_price_current;
            // filter period < t < decay_period. Decay time window.
            if elapsed < dynamic_fee_config.decay_period as u64 {
                let volatility_reference = self
                    .volatility_accumulator
                    .safe_mul(dynamic_fee_config.reduction_factor.into())?
                    .safe_div(BASIS_POINT_MAX.into())?;

                self.volatility_reference = volatility_reference;
            }
            // Out of decay time window
            else {
                self.volatility_reference = 0;
            }
        }
        Ok(())
    }
}

#[derive(Default, Debug)]
pub struct FeeMode {
    pub fees_on_input: bool,
    pub fees_on_base_token: bool,
    pub has_referral: bool,
}

impl FeeMode {
    pub fn get_fee_mode(
        collect_fee_mode: u8,
        trade_direction: TradeDirection,
        has_referral: bool,
    ) -> Result<FeeMode> {
        let collect_fee_mode = CollectFeeMode::try_from(collect_fee_mode)
            .map_err(|_| PoolError::InvalidCollectFeeMode)?;

        let (fees_on_input, fees_on_base_token) = match (collect_fee_mode, trade_direction) {
            // When collecting fees on output token
            (CollectFeeMode::OutputToken, TradeDirection::BaseToQuote) => (false, false),
            (CollectFeeMode::OutputToken, TradeDirection::QuoteToBase) => (false, true),

            // When collecting fees on quote token
            (CollectFeeMode::QuoteToken, TradeDirection::BaseToQuote) => (false, false),
            (CollectFeeMode::QuoteToken, TradeDirection::QuoteToBase) => (true, false),
        };

        Ok(FeeMode {
            fees_on_input,
            fees_on_base_token,
            has_referral,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fee_mode_output_token_base_to_quote() {
        let fee_mode = FeeMode::get_fee_mode(
            CollectFeeMode::OutputToken as u8,
            TradeDirection::BaseToQuote,
            false,
        )
        .unwrap();

        assert_eq!(fee_mode.fees_on_input, false);
        assert_eq!(fee_mode.fees_on_base_token, false);
        assert_eq!(fee_mode.has_referral, false);
    }

    #[test]
    fn test_fee_mode_output_token_quote_to_base() {
        let fee_mode = FeeMode::get_fee_mode(
            CollectFeeMode::OutputToken as u8,
            TradeDirection::QuoteToBase,
            true,
        )
        .unwrap();

        assert_eq!(fee_mode.fees_on_input, false);
        assert_eq!(fee_mode.fees_on_base_token, true);
        assert_eq!(fee_mode.has_referral, true);
    }

    #[test]
    fn test_fee_mode_quote_token_base_to_quote() {
        let fee_mode = FeeMode::get_fee_mode(
            CollectFeeMode::QuoteToken as u8,
            TradeDirection::BaseToQuote,
            false,
        )
        .unwrap();

        assert_eq!(fee_mode.fees_on_input, false);
        assert_eq!(fee_mode.fees_on_base_token, false);
        assert_eq!(fee_mode.has_referral, false);
    }

    #[test]
    fn test_fee_mode_quote_token_quote_to_base() {
        let fee_mode = FeeMode::get_fee_mode(
            CollectFeeMode::QuoteToken as u8,
            TradeDirection::QuoteToBase,
            true,
        )
        .unwrap();

        assert_eq!(fee_mode.fees_on_input, true);
        assert_eq!(fee_mode.fees_on_base_token, false);
        assert_eq!(fee_mode.has_referral, true);
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

        assert_eq!(fee_mode.fees_on_input, false);
        assert_eq!(fee_mode.fees_on_base_token, false);
        assert_eq!(fee_mode.has_referral, false);
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
        assert_eq!(fee_mode.fees_on_input, false);

        // When using QuoteToken mode, base_token should always be false
        let fee_mode = FeeMode::get_fee_mode(
            CollectFeeMode::QuoteToken as u8,
            TradeDirection::QuoteToBase,
            false,
        )
        .unwrap();
        assert_eq!(fee_mode.fees_on_base_token, false);
    }
}
