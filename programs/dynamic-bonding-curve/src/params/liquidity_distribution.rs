use std::u64;

use anchor_lang::prelude::*;
use ruint::aliases::U256;

use crate::{
    constants::{BASIS_POINT_MAX, MAX_SQRT_PRICE, MIN_SQRT_PRICE},
    curve::{
        get_delta_amount_base_unsigned, get_delta_amount_base_unsigned_256,
        get_delta_amount_quote_unsigned_256, get_initial_liquidity_from_delta_quote,
        get_next_sqrt_price_from_input,
    },
    safe_math::SafeMath,
    state::{LiquidityDistributionConfig, MigrationAmount, MigrationOption, PoolConfig},
    u128x128_math::Rounding,
    utils_math::safe_mul_div_cast_u64,
    PoolError,
};

#[cfg(feature = "local")]
use crate::curve::get_initialize_amounts;

#[derive(Copy, Clone, Debug, AnchorSerialize, AnchorDeserialize, InitSpace, Default)]
pub struct LiquidityDistributionParameters {
    pub sqrt_price: u128,
    pub liquidity: u128,
}

impl LiquidityDistributionParameters {
    pub fn to_liquidity_distribution_config(&self) -> LiquidityDistributionConfig {
        LiquidityDistributionConfig {
            sqrt_price: self.sqrt_price,
            liquidity: self.liquidity,
        }
    }
}

pub fn get_base_token_for_swap(
    sqrt_start_price: u128,
    sqrt_migration_price: u128,
    curve: &[LiquidityDistributionParameters],
) -> Result<U256> {
    let mut total_amount = U256::ZERO;
    for i in 0..curve.len() {
        let lower_sqrt_price = if i == 0 {
            sqrt_start_price
        } else {
            curve[i - 1].sqrt_price
        };
        if curve[i].sqrt_price > sqrt_migration_price {
            let delta_amount = get_delta_amount_base_unsigned_256(
                lower_sqrt_price,
                sqrt_migration_price,
                curve[i].liquidity,
                Rounding::Up, // TODO check whether we should use round down or round up
            )?;
            total_amount = total_amount.safe_add(delta_amount)?;
            break;
        } else {
            let delta_amount = get_delta_amount_base_unsigned_256(
                lower_sqrt_price,
                curve[i].sqrt_price,
                curve[i].liquidity,
                Rounding::Up, // TODO check whether we should use round down or round up
            )?;
            total_amount = total_amount.safe_add(delta_amount)?;
        }
    }
    Ok(total_amount)
}

pub fn get_protocol_migration_fee(
    deposit_base_amount: u64,  // amount of base will be deposited in pool
    deposit_quote_amount: u64, // amount of quote will be deposited in pool
    migration_sqrt_price: u128,
    migration_fee_bps: u16,
    migration_option: MigrationOption,
) -> Result<(u64, u64)> {
    let quote_fee_amount = safe_mul_div_cast_u64(
        deposit_quote_amount,
        migration_fee_bps.into(),
        BASIS_POINT_MAX,
        Rounding::Down,
    )?;
    match migration_option {
        MigrationOption::MeteoraDamm => {
            // just take fee as the same ratio
            let base_fee_amount = safe_mul_div_cast_u64(
                deposit_base_amount,
                migration_fee_bps.into(),
                BASIS_POINT_MAX,
                Rounding::Down,
            )?;

            Ok((base_fee_amount, quote_fee_amount))
        }
        MigrationOption::DammV2 => {
            let fee_liquidity = get_initial_liquidity_from_delta_quote(
                quote_fee_amount,
                MIN_SQRT_PRICE,
                migration_sqrt_price,
            )?;

            let base_fee_amount = get_delta_amount_base_unsigned(
                migration_sqrt_price,
                MAX_SQRT_PRICE,
                fee_liquidity,
                Rounding::Down,
            )?;

            Ok((base_fee_amount, quote_fee_amount))
        }
    }
}

pub fn get_migration_base_token(
    migration_threshold: u64,
    migration_fee_percentage: u8,
    sqrt_migration_price: u128,
    migration_option: MigrationOption,
) -> Result<u64> {
    let MigrationAmount { quote_amount, .. } =
        PoolConfig::get_migration_quote_amount(migration_threshold, migration_fee_percentage)?;
    match migration_option {
        MigrationOption::MeteoraDamm => {
            // constant product
            let sqrt_migration_price = U256::from(sqrt_migration_price);
            // price = quote / base for constant-product
            // base = quote / price
            let price = sqrt_migration_price.safe_mul(sqrt_migration_price)?;
            let quote = U256::from(quote_amount).safe_shl(128)?;
            // round up
            let (mut base, rem) = quote.div_rem(price);
            if !rem.is_zero() {
                base = base.safe_add(U256::from(1))?;
            }
            require!(base <= U256::from(u64::MAX), PoolError::MathOverflow);
            Ok(base.try_into().map_err(|_| PoolError::TypeCastFailed)?)
        }
        MigrationOption::DammV2 => {
            // calculate to L firsty
            let liquidity = get_initial_liquidity_from_delta_quote(
                quote_amount,
                MIN_SQRT_PRICE,
                sqrt_migration_price,
            )?;
            // calculate base threshold
            let base_amount = get_delta_amount_base_unsigned_256(
                sqrt_migration_price,
                MAX_SQRT_PRICE,
                liquidity,
                Rounding::Up,
            )?;
            require!(base_amount <= U256::from(u64::MAX), PoolError::MathOverflow);
            let base_amount = base_amount
                .try_into()
                .map_err(|_| PoolError::TypeCastFailed)?;

            // re-validation
            #[cfg(feature = "local")]
            {
                let (_initial_base_amount, initial_quote_amount) = get_initialize_amounts(
                    MIN_SQRT_PRICE,
                    MAX_SQRT_PRICE,
                    sqrt_migration_price,
                    liquidity,
                )?;
                // TODO no need to validate for _initial_base_amount?
                msg!("debug dammv2 {} {}", initial_quote_amount, quote_amount);
                require!(
                    initial_quote_amount <= quote_amount,
                    PoolError::InsufficientLiquidityForMigration
                );
            }
            Ok(base_amount)
        }
    }
}

pub fn get_migration_threshold_price(
    migration_threshold: u64,
    sqrt_start_price: u128,
    curve: &[LiquidityDistributionParameters],
) -> Result<u128> {
    let mut next_sqrt_price = sqrt_start_price;

    let total_amount = get_delta_amount_quote_unsigned_256(
        next_sqrt_price,
        curve[0].sqrt_price,
        curve[0].liquidity,
        Rounding::Up, // TODO check whether we should use round down or round up
    )?;
    if total_amount > U256::from(migration_threshold) {
        next_sqrt_price = get_next_sqrt_price_from_input(
            next_sqrt_price,
            curve[0].liquidity,
            migration_threshold,
            false,
        )?;
    } else {
        let total_amount = total_amount
            .try_into()
            .map_err(|_| PoolError::TypeCastFailed)?;
        let mut amount_left = migration_threshold.safe_sub(total_amount)?;
        next_sqrt_price = curve[0].sqrt_price;
        for i in 1..curve.len() {
            let max_amount = get_delta_amount_quote_unsigned_256(
                next_sqrt_price,
                curve[i].sqrt_price,
                curve[i].liquidity,
                Rounding::Up, // TODO check whether we should use round down or round up
            )?;
            if max_amount > U256::from(amount_left) {
                next_sqrt_price = get_next_sqrt_price_from_input(
                    next_sqrt_price,
                    curve[i].liquidity,
                    amount_left,
                    false,
                )?;
                amount_left = 0;
                break;
            } else {
                amount_left = amount_left.safe_sub(
                    max_amount
                        .try_into()
                        .map_err(|_| PoolError::TypeCastFailed)?,
                )?;
                next_sqrt_price = curve[i].sqrt_price
            }
        }
        require!(amount_left == 0, PoolError::NotEnoughLiquidity);
    }
    Ok(next_sqrt_price)
}
