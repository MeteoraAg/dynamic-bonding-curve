use crate::{
    constants::{BASIS_POINT_MAX, MAX_SQRT_PRICE, MIN_SQRT_PRICE},
    damm_v2_utils::{InitialPoolInformation, MigrationHandler},
    safe_math::SafeMath,
    state::{MigrationAmount, PoolConfig},
    u128x128_math::Rounding,
    utils_math::{safe_mul_div_cast_u128, safe_mul_div_cast_u64, sqrt_u256},
    PoolError,
};
use anchor_lang::prelude::*;
use ruint::aliases::U256;

// https://github.com/MeteoraAg/damm-v2/blob/8168ac6e94bfb1940488593d14014f0c30d34aa7/programs/cp-amm/src/liquidity_handler/compounding_liquidity.rs#L13
pub const DAMM_V2_COMPOUNDING_DEAD_LIQUIDITY: u128 = 100 << 64;
pub struct CompoundingLiquidity {
    pub migration_sqrt_price: u128,
}

impl CompoundingLiquidity {
    pub fn validate_initial_pool_information(
        base_amount: u64,
        quote_amount: u64,
        migration_sqrt_price: u128,
    ) -> Result<()> {
        let (sqrt_price, total_liquidity) =
            calculate_compounding_initial_sqrt_price_and_liquidity(base_amount, quote_amount)
                .ok_or_else(|| PoolError::MathOverflow)?;

        require!(
            sqrt_price >= MIN_SQRT_PRICE && sqrt_price <= MAX_SQRT_PRICE,
            PoolError::InvalidCompoundingParameters
        );

        require!(
            total_liquidity > DAMM_V2_COMPOUNDING_DEAD_LIQUIDITY,
            PoolError::InsufficientLiquidityForMigration
        );

        // Verify compounding-derived sqrt price is within 1% of curve-derived sqrt price:
        // abs_diff / max <= 1 / 100
        // abs_diff       <= max / 100
        // abs_diff * 100 <= max
        require!(
            migration_sqrt_price.abs_diff(sqrt_price).safe_mul(100)?
                <= migration_sqrt_price.max(sqrt_price),
            PoolError::InvalidCurve
        );
        Ok(())
    }

    pub fn get_migration_protocol_fees(
        deposit_base_amount: u64,
        deposit_quote_amount: u64,
        migration_fee_bps: u16,
    ) -> Result<(u64, u64)> {
        let base_fee_amount = safe_mul_div_cast_u64(
            deposit_base_amount,
            migration_fee_bps.into(),
            BASIS_POINT_MAX,
            Rounding::Down,
        )?;
        let quote_fee_amount = safe_mul_div_cast_u64(
            deposit_quote_amount,
            migration_fee_bps.into(),
            BASIS_POINT_MAX,
            Rounding::Down,
        )?;
        Ok((base_fee_amount, quote_fee_amount))
    }
}

impl MigrationHandler for CompoundingLiquidity {
    fn get_initial_pool_information(
        &self,
        base_amount: u64,
        quote_amount: u64,
        // _migration_sqrt_price: u128,
    ) -> Result<InitialPoolInformation> {
        let (sqrt_price, total_liquidity) =
            calculate_compounding_initial_sqrt_price_and_liquidity(base_amount, quote_amount)
                .ok_or_else(|| PoolError::MathOverflow)?;

        let distributable_liquidity =
            total_liquidity.safe_sub(DAMM_V2_COMPOUNDING_DEAD_LIQUIDITY)?;
        Ok(InitialPoolInformation {
            sqrt_price,
            distributable_liquidity,
            dead_liquidity: DAMM_V2_COMPOUNDING_DEAD_LIQUIDITY, // compounding locks dead liquidity in pool
        })
    }

    fn get_migration_protocol_fees(
        &self,
        deposit_base_amount: u64,
        deposit_quote_amount: u64,
        migration_fee_bps: u16,
    ) -> Result<(u64, u64)> {
        Self::get_migration_protocol_fees(
            deposit_base_amount,
            deposit_quote_amount,
            migration_fee_bps,
        )
    }

    fn calculate_liquidity_delta(
        &self,
        base_amount: u64,
        quote_amount: u64,
        pool_base_reserve: u64,
        pool_quote_reserve: u64,
        pool_liquidity: u128,
    ) -> Result<u128> {
        let liquidity_from_base = safe_mul_div_cast_u128(
            u128::from(base_amount),
            pool_liquidity,
            u128::from(pool_base_reserve),
            Rounding::Down,
        )?;

        let liquidity_from_quote = safe_mul_div_cast_u128(
            u128::from(quote_amount),
            pool_liquidity,
            u128::from(pool_quote_reserve),
            Rounding::Down,
        )?;

        Ok(liquidity_from_base.min(liquidity_from_quote))
    }
    fn get_included_protocol_fee_migration_amounts_1(
        &self,
        migration_quote_threshold: u64,
        migration_fee_percentage: u8,
    ) -> Result<(u64, u64)> {
        let MigrationAmount { quote_amount, .. } = PoolConfig::get_migration_quote_amount(
            migration_quote_threshold,
            migration_fee_percentage,
        )?;

        let base_amount =
            get_constant_product_base_from_quote(quote_amount, self.migration_sqrt_price)?;

        Ok((base_amount, quote_amount))
    }

    fn get_included_protocol_fee_migration_amounts_2(
        &self,
        migration_base_threshold: u64,
        migration_quote_threshold: u64,
        migration_fee_percentage: u8,
        excluded_fee_base_reserve: u64,
    ) -> Result<(u64, u64)> {
        // just add a check to debug
        require!(
            excluded_fee_base_reserve >= migration_base_threshold,
            PoolError::UndeterminedError
        );
        let MigrationAmount {
            quote_amount,
            fee: _,
        } = PoolConfig::get_migration_quote_amount(
            migration_quote_threshold,
            migration_fee_percentage,
        )?;
        Ok((migration_base_threshold, quote_amount))
    }
}

// calculates initial sqrt price and liquidity for compounding pool
// https://github.com/MeteoraAg/damm-v2/blob/8168ac6e94bfb1940488593d14014f0c30d34aa7/rust-sdk/src/calculate_initial_sqrt_price.rs#L44-L71
fn calculate_compounding_initial_sqrt_price_and_liquidity(
    token_a_amount: u64,
    token_b_amount: u64,
) -> Option<(u128, u128)> {
    // a = l/s and b = l * s
    // s1: sqrt_price round up
    // s2: sqrt_price round down
    // return (s1, a * s2)
    let sqrt_price_1 = sqrt_u256(
        U256::from(token_b_amount)
            .checked_shl(128)?
            .div_ceil(U256::from(token_a_amount)),
    )?;
    let sqrt_price_1 = u128::try_from(sqrt_price_1).ok()?;
    if sqrt_price_1 < MIN_SQRT_PRICE || sqrt_price_1 > MAX_SQRT_PRICE {
        return None;
    }

    let sqrt_price_2 = sqrt_u256(
        U256::from(token_b_amount)
            .checked_shl(128)?
            .checked_div(U256::from(token_a_amount))?,
    )?;
    let sqrt_price_2 = u128::try_from(sqrt_price_2).ok()?;
    let liquidity = sqrt_price_2.checked_mul(u128::from(token_a_amount))?;

    Some((sqrt_price_1, liquidity))
}

fn get_constant_product_base_from_quote(
    quote_amount: u64,
    sqrt_migration_price: u128,
) -> Result<u64> {
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
