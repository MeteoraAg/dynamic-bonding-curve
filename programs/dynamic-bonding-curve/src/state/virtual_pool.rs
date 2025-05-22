use std::ops::{BitAnd, BitXor};

use anchor_lang::prelude::*;
use num_enum::{IntoPrimitive, TryFromPrimitive};
use ruint::aliases::U256;
use static_assertions::const_assert_eq;

use crate::{
    constants::PARTNER_AND_CREATOR_SURPLUS_SHARE,
    curve::{
        get_delta_amount_base_unsigned, get_delta_amount_base_unsigned_256,
        get_delta_amount_quote_unsigned, get_delta_amount_quote_unsigned_256,
        get_next_sqrt_price_from_input,
    },
    params::swap::TradeDirection,
    safe_math::SafeMath,
    state::{
        fee::{FeeMode, FeeOnAmountResult, VolatilityTracker},
        PoolConfig,
    },
    u128x128_math::Rounding,
    utils_math::safe_mul_div_cast_u64,
    PoolError, SwapMode,
};

use super::{PartnerAndCreatorSplitFee, PoolFeesConfig};

/// collect fee mode
#[repr(u8)]
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    IntoPrimitive,
    TryFromPrimitive,
    AnchorDeserialize,
    AnchorSerialize,
)]
pub enum CollectFeeMode {
    /// Only quote token is being used for fee collection
    QuoteToken,
    /// Output token is being used for fee collection
    OutputToken,
}

#[repr(u8)]
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    IntoPrimitive,
    TryFromPrimitive,
    AnchorDeserialize,
    AnchorSerialize,
)]
pub enum PoolType {
    SplToken,
    Token2022,
}

// Pool state transition flows:
// 1. Without jup lock
//    PreBonding -> LockedVesting -> CreatedPool
//
// 2. With jup lock
//    PreBonding -> PostBonding -> LockedVesting -> CreatedPool
#[repr(u8)]
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    IntoPrimitive,
    TryFromPrimitive,
    AnchorDeserialize,
    AnchorSerialize,
)]
pub enum MigrationProgress {
    PreBondingCurve,
    PostBondingCurve,
    LockedVesting,
    CreatedPool,
}

#[account(zero_copy)]
#[derive(InitSpace, Debug, Default)]
pub struct VirtualPool {
    /// volatility tracker
    pub volatility_tracker: VolatilityTracker,
    /// config key
    pub config: Pubkey,
    /// creator
    pub creator: Pubkey,
    /// base mint
    pub base_mint: Pubkey,
    /// base vault
    pub base_vault: Pubkey,
    /// quote vault
    pub quote_vault: Pubkey,
    /// base reserve
    pub base_reserve: u64,
    /// quote reserve
    pub quote_reserve: u64,
    /// protocol base fee
    pub protocol_base_fee: u64,
    /// protocol quote fee
    pub protocol_quote_fee: u64,
    /// partner base fee
    pub partner_base_fee: u64,
    /// trading quote fee
    pub partner_quote_fee: u64,
    /// current price
    pub sqrt_price: u128,
    /// Activation point
    pub activation_point: u64,
    /// pool type, spl token or token2022
    pub pool_type: u8,
    /// is migrated
    pub is_migrated: u8,
    /// is partner withdraw surplus
    pub is_partner_withdraw_surplus: u8,
    /// is protocol withdraw surplus
    pub is_protocol_withdraw_surplus: u8,
    /// migration progress
    pub migration_progress: u8,
    /// is withdraw leftover
    pub is_withdraw_leftover: u8,
    /// is creator withdraw surplus
    pub is_creator_withdraw_surplus: u8,
    /// migration fee withdraw status, first bit is for partner, second bit is for creator
    pub migration_fee_withdraw_status: u8,
    /// pool metrics
    pub metrics: PoolMetrics,
    /// The time curve is finished
    pub finish_curve_timestamp: u64,
    /// creator base fee
    pub creator_base_fee: u64,
    /// creator quote fee
    pub creator_quote_fee: u64,
    /// Padding for further use
    pub _padding_1: [u64; 7],
}

const_assert_eq!(VirtualPool::INIT_SPACE, 416);

pub const PARTNER_MASK: u8 = 0b100;
pub const CREATOR_MASK: u8 = 0b010;

#[zero_copy]
#[derive(Debug, InitSpace, Default)]
pub struct PoolMetrics {
    pub total_protocol_base_fee: u64,
    pub total_protocol_quote_fee: u64,
    pub total_trading_base_fee: u64,
    pub total_trading_quote_fee: u64,
}

const_assert_eq!(PoolMetrics::INIT_SPACE, 32);

impl PoolMetrics {
    pub fn accumulate_fee(
        &mut self,
        protocol_fee: u64,
        trading_fee: u64,
        is_base_token: bool,
    ) -> Result<()> {
        if is_base_token {
            self.total_protocol_base_fee = self.total_protocol_base_fee.safe_add(protocol_fee)?;
            self.total_trading_base_fee = self.total_trading_base_fee.safe_add(trading_fee)?;
        } else {
            self.total_protocol_quote_fee = self.total_protocol_quote_fee.safe_add(protocol_fee)?;
            self.total_trading_quote_fee = self.total_trading_quote_fee.safe_add(trading_fee)?;
        }

        Ok(())
    }
}

impl VirtualPool {
    pub fn initialize(
        &mut self,
        volatility_tracker: VolatilityTracker,
        config: Pubkey,
        creator: Pubkey,
        base_mint: Pubkey,
        base_vault: Pubkey,
        quote_vault: Pubkey,
        sqrt_price: u128,
        pool_type: u8,
        activation_point: u64,
        base_reserve: u64,
    ) {
        self.volatility_tracker = volatility_tracker;
        self.config = config;
        self.creator = creator;
        self.base_mint = base_mint;
        self.base_vault = base_vault;
        self.quote_vault = quote_vault;
        self.sqrt_price = sqrt_price;
        self.pool_type = pool_type;
        self.activation_point = activation_point;
        self.base_reserve = base_reserve;
    }

    pub fn get_swap_result(
        &self,
        config: &PoolConfig,
        amount_in: u64,
        fee_mode: &FeeMode,
        trade_direction: TradeDirection,
        current_point: u64,
        swap_mode: SwapMode,
    ) -> Result<(SwapResult, u64)> {
        let mut actual_protocol_fee = 0;
        let mut actual_trading_fee = 0;
        let mut actual_referral_fee = 0;

        let trade_fee_numerator = config.pool_fees.get_total_trading_fee(
            &self.volatility_tracker,
            current_point,
            self.activation_point,
        )?;

        let mut actual_amount_in = if fee_mode.fees_on_input {
            let FeeOnAmountResult {
                amount,
                protocol_fee,
                trading_fee,
                referral_fee,
            } = config.pool_fees.get_fee_on_amount(
                trade_fee_numerator,
                amount_in,
                fee_mode.has_referral,
            )?;

            actual_protocol_fee = protocol_fee;
            actual_trading_fee = trading_fee;
            actual_referral_fee = referral_fee;

            amount
        } else {
            amount_in
        };

        let SwapAmount {
            amount_in: consumed_input_amount, // amount excluded fee
            output_amount,
            next_sqrt_price,
        } = match trade_direction {
            TradeDirection::BaseToQuote => {
                self.get_swap_amount_from_base_to_quote(config, actual_amount_in)
            }
            TradeDirection::QuoteToBase => {
                self.get_swap_amount_from_quote_to_base(config, actual_amount_in, swap_mode)
            }
        }?;

        // check if it is partial fill
        let user_pay_input_amount = if consumed_input_amount < actual_amount_in {
            if fee_mode.fees_on_input {
                let included_fee_amount_in = PoolFeesConfig::get_included_fee_amount(
                    trade_fee_numerator,
                    consumed_input_amount,
                )?;

                let FeeOnAmountResult {
                    amount,
                    protocol_fee,
                    trading_fee,
                    referral_fee,
                } = config.pool_fees.get_fee_on_amount(
                    trade_fee_numerator,
                    included_fee_amount_in,
                    fee_mode.has_referral,
                )?;
                // that should never happen
                require!(
                    included_fee_amount_in <= amount_in,
                    PoolError::UndeterminedError
                );
                actual_amount_in = amount;
                actual_protocol_fee = protocol_fee;
                actual_trading_fee = trading_fee;
                actual_referral_fee = referral_fee;
                included_fee_amount_in
            } else {
                actual_amount_in = consumed_input_amount;
                consumed_input_amount
            }
        } else {
            amount_in
        };

        let actual_amount_out = if fee_mode.fees_on_input {
            output_amount
        } else {
            let FeeOnAmountResult {
                amount,
                protocol_fee,
                trading_fee,
                referral_fee,
            } = config.pool_fees.get_fee_on_amount(
                trade_fee_numerator,
                output_amount,
                fee_mode.has_referral,
            )?;

            actual_protocol_fee = protocol_fee;
            actual_trading_fee = trading_fee;
            actual_referral_fee = referral_fee;

            amount
        };

        Ok((
            SwapResult {
                actual_input_amount: actual_amount_in,
                output_amount: actual_amount_out,
                next_sqrt_price,
                trading_fee: actual_trading_fee,
                protocol_fee: actual_protocol_fee,
                referral_fee: actual_referral_fee,
            },
            user_pay_input_amount,
        ))
    }

    fn get_swap_amount_from_base_to_quote(
        &self,
        config: &PoolConfig,
        amount_in: u64,
    ) -> Result<SwapAmount> {
        // finding new target price
        let mut total_output_amount = 0u64;
        let mut current_sqrt_price = self.sqrt_price;
        let mut amount_left = amount_in;
        // Use curve.len() for backward compatibility for existing pools with 20 points
        for i in (0..config.curve.len() - 1).rev() {
            if config.curve[i].sqrt_price == 0 || config.curve[i].liquidity == 0 {
                continue;
            }
            if config.curve[i].sqrt_price < current_sqrt_price {
                let max_amount_in = get_delta_amount_base_unsigned_256(
                    config.curve[i].sqrt_price,
                    current_sqrt_price,
                    config.curve[i + 1].liquidity,
                    Rounding::Up, // TODO check whether we should use round down or round up
                )?;
                if U256::from(amount_left) < max_amount_in {
                    let next_sqrt_price = get_next_sqrt_price_from_input(
                        current_sqrt_price,
                        config.curve[i + 1].liquidity,
                        amount_left,
                        true,
                    )?;

                    let output_amount = get_delta_amount_quote_unsigned(
                        next_sqrt_price,
                        current_sqrt_price,
                        config.curve[i + 1].liquidity,
                        Rounding::Down,
                    )?;
                    total_output_amount = total_output_amount.safe_add(output_amount)?;
                    current_sqrt_price = next_sqrt_price;
                    amount_left = 0;
                    break;
                } else {
                    let next_sqrt_price = config.curve[i].sqrt_price;
                    let output_amount = get_delta_amount_quote_unsigned(
                        next_sqrt_price,
                        current_sqrt_price,
                        config.curve[i + 1].liquidity,
                        Rounding::Down,
                    )?;
                    total_output_amount = total_output_amount.safe_add(output_amount)?;
                    current_sqrt_price = next_sqrt_price;
                    amount_left = amount_left.safe_sub(
                        max_amount_in
                            .try_into()
                            .map_err(|_| PoolError::TypeCastFailed)?,
                    )?;
                }
            }
        }
        if amount_left != 0 {
            let next_sqrt_price = get_next_sqrt_price_from_input(
                current_sqrt_price,
                config.curve[0].liquidity,
                amount_left,
                true,
            )?;

            let output_amount = get_delta_amount_quote_unsigned(
                next_sqrt_price,
                current_sqrt_price,
                config.curve[0].liquidity,
                Rounding::Down,
            )?;
            total_output_amount = total_output_amount.safe_add(output_amount)?;
            current_sqrt_price = next_sqrt_price;
        }

        Ok(SwapAmount {
            amount_in,
            output_amount: total_output_amount,
            next_sqrt_price: current_sqrt_price,
        })
    }

    fn get_swap_amount_from_quote_to_base(
        &self,
        config: &PoolConfig,
        amount_in: u64,
        swap_mode: SwapMode,
    ) -> Result<SwapAmount> {
        // finding new target price
        let mut total_output_amount = 0u64;
        let mut current_sqrt_price = self.sqrt_price;
        let mut amount_left = amount_in;
        // Use curve.len() for backward compatibility for existing pools with 20 points
        for i in 0..config.curve.len() {
            if config.curve[i].sqrt_price == 0 || config.curve[i].liquidity == 0 {
                break;
            }
            if config.curve[i].sqrt_price > current_sqrt_price {
                let max_amount_in = get_delta_amount_quote_unsigned_256(
                    current_sqrt_price,
                    config.curve[i].sqrt_price,
                    config.curve[i].liquidity,
                    Rounding::Up, // TODO check whether we should use round down or round up
                )?;
                if U256::from(amount_left) < max_amount_in {
                    let next_sqrt_price = get_next_sqrt_price_from_input(
                        current_sqrt_price,
                        config.curve[i].liquidity,
                        amount_left,
                        false,
                    )?;

                    let output_amount = get_delta_amount_base_unsigned(
                        current_sqrt_price,
                        next_sqrt_price,
                        config.curve[i].liquidity,
                        Rounding::Down,
                    )?;
                    total_output_amount = total_output_amount.safe_add(output_amount)?;
                    current_sqrt_price = next_sqrt_price;
                    amount_left = 0;
                    break;
                } else {
                    let next_sqrt_price = config.curve[i].sqrt_price;
                    let output_amount = get_delta_amount_base_unsigned(
                        current_sqrt_price,
                        next_sqrt_price,
                        config.curve[i].liquidity,
                        Rounding::Down,
                    )?;
                    total_output_amount = total_output_amount.safe_add(output_amount)?;
                    current_sqrt_price = next_sqrt_price;
                    amount_left = amount_left.safe_sub(
                        max_amount_in
                            .try_into()
                            .map_err(|_| PoolError::TypeCastFailed)?,
                    )?;
                }
            }
        }

        let amount_in = match swap_mode {
            SwapMode::ExactIn => {
                // allow pool swallow an extra amount
                require!(
                    amount_left <= config.get_max_swallow_quote_amount()?,
                    PoolError::SwapAmountIsOverAThreshold
                );
                amount_in
            }
            SwapMode::PartialFill => amount_in.safe_sub(amount_left)?,
        };

        Ok(SwapAmount {
            amount_in,
            output_amount: total_output_amount,
            next_sqrt_price: current_sqrt_price,
        })
    }

    pub fn apply_swap_result(
        &mut self,
        config: &PoolConfig,
        swap_result: &SwapResult,
        fee_mode: &FeeMode,
        trade_direction: TradeDirection,
        current_timestamp: u64,
    ) -> Result<()> {
        let &SwapResult {
            actual_input_amount,
            output_amount,
            next_sqrt_price,
            protocol_fee,
            trading_fee,
            referral_fee,
        } = swap_result;

        let old_sqrt_price = self.sqrt_price;
        self.sqrt_price = next_sqrt_price;

        let PartnerAndCreatorSplitFee {
            partner_fee,
            creator_fee,
        } = config.split_partner_and_creator_fee(trading_fee)?;
        if fee_mode.fees_on_base_token {
            self.partner_base_fee = self.partner_base_fee.safe_add(partner_fee)?;
            self.protocol_base_fee = self.protocol_base_fee.safe_add(protocol_fee)?;
            self.creator_base_fee = self.creator_base_fee.safe_add(creator_fee)?;
            self.metrics
                .accumulate_fee(protocol_fee, trading_fee, true)?;
        } else {
            self.partner_quote_fee = self.partner_quote_fee.safe_add(partner_fee)?;
            self.protocol_quote_fee = self.protocol_quote_fee.safe_add(protocol_fee)?;
            self.creator_quote_fee = self.creator_quote_fee.safe_add(creator_fee)?;
            self.metrics
                .accumulate_fee(protocol_fee, trading_fee, false)?;
        }

        let actual_output_amount = if fee_mode.fees_on_input {
            output_amount
        } else {
            output_amount
                .safe_add(trading_fee)?
                .safe_add(protocol_fee)?
                .safe_add(referral_fee)?
        };

        if trade_direction == TradeDirection::BaseToQuote {
            self.base_reserve = self.base_reserve.safe_add(actual_input_amount)?;
            self.quote_reserve = self.quote_reserve.safe_sub(actual_output_amount)?;
        } else {
            self.quote_reserve = self.quote_reserve.safe_add(actual_input_amount)?;
            self.base_reserve = self.base_reserve.safe_sub(actual_output_amount)?;
        }

        self.update_post_swap(config, old_sqrt_price, current_timestamp)?;
        Ok(())
    }

    pub fn update_pre_swap(&mut self, config: &PoolConfig, current_timestamp: u64) -> Result<()> {
        if config.pool_fees.dynamic_fee.is_dynamic_fee_enable() {
            self.volatility_tracker.update_references(
                &config.pool_fees.dynamic_fee,
                self.sqrt_price,
                current_timestamp,
            )?;
        }
        Ok(())
    }

    pub fn update_post_swap(
        &mut self,
        config: &PoolConfig,
        old_sqrt_price: u128,
        current_timestamp: u64,
    ) -> Result<()> {
        if config.pool_fees.dynamic_fee.is_dynamic_fee_enable() {
            self.volatility_tracker
                .update_volatility_accumulator(&config.pool_fees.dynamic_fee, self.sqrt_price)?;

            // update only last_update_timestamp if bin is crossed
            let delta_price = VolatilityTracker::get_delta_bin_id(
                config.pool_fees.dynamic_fee.bin_step_u128,
                old_sqrt_price,
                self.sqrt_price,
            )?;

            if delta_price > 0 {
                self.volatility_tracker.last_update_timestamp = current_timestamp;
            }
        }
        Ok(())
    }

    pub fn claim_protocol_fee(&mut self) -> (u64, u64) {
        let token_base_amount = self.protocol_base_fee;
        let token_quote_amount = self.protocol_quote_fee;
        self.protocol_base_fee = 0;
        self.protocol_quote_fee = 0;
        (token_base_amount, token_quote_amount)
    }

    pub fn claim_partner_trading_fee(
        &mut self,
        max_base_amount: u64,
        max_quote_amount: u64,
    ) -> Result<(u64, u64)> {
        let token_base_amount = self.partner_base_fee.min(max_base_amount);
        let token_quote_amount = self.partner_quote_fee.min(max_quote_amount);
        self.partner_base_fee = self.partner_base_fee.safe_sub(token_base_amount)?;
        self.partner_quote_fee = self.partner_quote_fee.safe_sub(token_quote_amount)?;
        Ok((token_base_amount, token_quote_amount))
    }

    pub fn claim_creator_trading_fee(
        &mut self,
        max_base_amount: u64,
        max_quote_amount: u64,
    ) -> Result<(u64, u64)> {
        let token_base_amount = self.creator_base_fee.min(max_base_amount);
        let token_quote_amount = self.creator_quote_fee.min(max_quote_amount);
        self.creator_base_fee = self.creator_base_fee.safe_sub(token_base_amount)?;
        self.creator_quote_fee = self.creator_quote_fee.safe_sub(token_quote_amount)?;
        Ok((token_base_amount, token_quote_amount))
    }

    pub fn get_protocol_and_trading_base_fee(&self) -> Result<u64> {
        Ok(self
            .partner_base_fee
            .safe_add(self.protocol_base_fee)?
            .safe_add(self.creator_base_fee)?)
    }

    pub fn is_curve_complete(&self, migration_threshold: u64) -> bool {
        self.quote_reserve >= migration_threshold
    }

    pub fn update_after_create_pool(&mut self) {
        self.is_migrated = 1;
    }

    pub fn get_total_surplus(&self, migration_threshold: u64) -> Result<u64> {
        Ok(self.quote_reserve.safe_sub(migration_threshold)?)
    }

    fn get_partner_and_creator_surplus(&self, total_surplus: u64) -> Result<u64> {
        let partner_and_creator_surplus = safe_mul_div_cast_u64(
            total_surplus,
            PARTNER_AND_CREATOR_SURPLUS_SHARE.into(),
            100,
            Rounding::Down,
        )?;
        Ok(partner_and_creator_surplus)
    }

    pub fn get_partner_surplus(&self, config: &PoolConfig, total_surplus: u64) -> Result<u64> {
        let partner_and_creator_surplus = self.get_partner_and_creator_surplus(total_surplus)?;

        let PartnerAndCreatorSplitFee { partner_fee, .. } =
            config.split_partner_and_creator_fee(partner_and_creator_surplus)?;

        Ok(partner_fee)
    }

    pub fn get_creator_surplus(&self, config: &PoolConfig, total_surplus: u64) -> Result<u64> {
        let partner_and_creator_surplus = self.get_partner_and_creator_surplus(total_surplus)?;

        let PartnerAndCreatorSplitFee { creator_fee, .. } =
            config.split_partner_and_creator_fee(partner_and_creator_surplus)?;

        Ok(creator_fee)
    }

    pub fn get_protocol_surplus(&self, migration_threshold: u64) -> Result<u64> {
        let total_surplus: u64 = self.get_total_surplus(migration_threshold)?;
        let partner_surplus_amount = self.get_partner_and_creator_surplus(total_surplus)?;
        Ok(total_surplus.safe_sub(partner_surplus_amount)?)
    }

    pub fn update_partner_withdraw_surplus(&mut self) {
        self.is_partner_withdraw_surplus = 1;
    }

    pub fn update_creator_withdraw_surplus(&mut self) {
        self.is_creator_withdraw_surplus = 1;
    }

    pub fn update_protocol_withdraw_surplus(&mut self) {
        self.is_protocol_withdraw_surplus = 1;
    }

    pub fn update_withdraw_leftover(&mut self) {
        self.is_withdraw_leftover = 1;
    }

    pub fn eligible_to_withdraw_migration_fee(&self, mask: u8) -> bool {
        self.migration_fee_withdraw_status.bitand(mask) == 0
    }
    pub fn update_withdraw_migration_fee(&mut self, mask: u8) {
        self.migration_fee_withdraw_status = self.migration_fee_withdraw_status.bitxor(mask)
    }

    pub fn get_migration_progress(&self) -> Result<MigrationProgress> {
        let migration_progress = MigrationProgress::try_from(self.migration_progress)
            .map_err(|_| PoolError::TypeCastFailed)?;
        Ok(migration_progress)
    }

    pub fn set_migration_progress(&mut self, progress: u8) {
        self.migration_progress = progress;
    }
}

/// Encodes all results of swapping
#[derive(Debug, PartialEq, AnchorDeserialize, AnchorSerialize)]
pub struct SwapResult {
    pub actual_input_amount: u64, // if fees are on input, this can be different that the original input_amount.
    pub output_amount: u64,
    pub next_sqrt_price: u128,
    pub trading_fee: u64,
    pub protocol_fee: u64,
    pub referral_fee: u64,
}

pub struct SwapAmount {
    amount_in: u64,
    output_amount: u64,
    next_sqrt_price: u128,
}
