use crate::{
    constants::{BASIS_POINT_MAX, MAX_SQRT_PRICE, MIN_SQRT_PRICE},
    curve::{get_delta_amount_base_unsigned, get_delta_amount_base_unsigned_256},
    damm_v2_utils::{InitialPoolInformation, MigrationHandler},
    safe_math::SafeMath,
    state::{MigrationAmount, PoolConfig},
    u128x128_math::Rounding,
    utils_math::safe_mul_div_cast_u64,
    PoolError,
};
use anchor_lang::prelude::*;
use ruint::aliases::{U256, U512};

pub struct ConcentratedLiquidity {
    pub migration_sqrt_price: u128,
}

impl MigrationHandler for ConcentratedLiquidity {
    fn get_initial_pool_information(
        &self,
        base_amount: u64,
        quote_amount: u64,
    ) -> Result<InitialPoolInformation> {
        let liquidity = calculate_concentrated_initial_liquidity(
            base_amount,
            quote_amount,
            self.migration_sqrt_price,
        )?;
        Ok(InitialPoolInformation {
            sqrt_price: self.migration_sqrt_price,
            distributable_liquidity: liquidity,
            dead_liquidity: 0,
        })
    }

    fn get_migration_protocol_fees(
        &self,
        _deposit_base_amount: u64,
        deposit_quote_amount: u64,
        migration_fee_bps: u16,
    ) -> Result<(u64, u64)> {
        let quote_fee_amount = safe_mul_div_cast_u64(
            deposit_quote_amount,
            migration_fee_bps.into(),
            BASIS_POINT_MAX,
            Rounding::Down,
        )?;
        let fee_liquidity = get_initial_liquidity_from_delta_quote(
            quote_fee_amount,
            MIN_SQRT_PRICE,
            self.migration_sqrt_price,
        )?;

        let base_fee_amount = get_delta_amount_base_unsigned(
            self.migration_sqrt_price,
            MAX_SQRT_PRICE,
            fee_liquidity,
            Rounding::Down,
        )?;
        Ok((base_fee_amount, quote_fee_amount))
    }

    fn calculate_liquidity_delta(
        &self,
        base_amount: u64,
        quote_amount: u64,
        _pool_base_reserve: u64,
        _pool_quote_reserve: u64,
        _pool_liquidity: u128,
    ) -> Result<u128> {
        let liquidity_from_base = get_initial_liquidity_from_delta_base(
            base_amount,
            MAX_SQRT_PRICE,
            self.migration_sqrt_price,
        )?;
        let liquidity_from_quote = get_initial_liquidity_from_delta_quote(
            quote_amount,
            MIN_SQRT_PRICE,
            self.migration_sqrt_price,
        )?;
        if liquidity_from_base > U512::from(liquidity_from_quote) {
            Ok(liquidity_from_quote)
        } else {
            Ok(liquidity_from_base
                .try_into()
                .map_err(|_| PoolError::TypeCastFailed)?)
        }
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

        // calculate to L firsty
        let liquidity = get_initial_liquidity_from_delta_quote(
            quote_amount,
            MIN_SQRT_PRICE,
            self.migration_sqrt_price,
        )?;
        // calculate base threshold
        let base_amount = get_delta_amount_base_unsigned_256(
            self.migration_sqrt_price,
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
            use crate::curve::get_initialize_amounts;

            let (_initial_base_amount, initial_quote_amount) = get_initialize_amounts(
                MIN_SQRT_PRICE,
                MAX_SQRT_PRICE,
                self.migration_sqrt_price,
                liquidity,
            )?;
            // TODO no need to validate for _initial_base_amount?
            msg!("debug dammv2 {} {}", initial_quote_amount, quote_amount);
            require!(
                initial_quote_amount <= quote_amount,
                PoolError::InsufficientLiquidityForMigration
            );
        }
        Ok((base_amount, quote_amount))
    }

    fn get_included_protocol_fee_migration_amounts_2(
        &self,
        _migration_base_threshold: u64,
        migration_quote_threshold: u64,
        migration_fee_percentage: u8,
        excluded_fee_base_reserve: u64,
    ) -> Result<(u64, u64)> {
        let MigrationAmount {
            quote_amount,
            fee: _,
        } = PoolConfig::get_migration_quote_amount(
            migration_quote_threshold,
            migration_fee_percentage,
        )?;
        // we use base vault balance for backward-compatible
        Ok((excluded_fee_base_reserve, quote_amount))
    }
}
// calculate liquidity for concentrated pool
// https://github.com/MeteoraAg/damm-v2/blob/8168ac6e94bfb1940488593d14014f0c30d34aa7/rust-sdk/src/tests/test_calculate_concentrated_initial_sqrt_price.rs#L44-L62
pub fn calculate_concentrated_initial_liquidity(
    base_amount: u64,
    quote_amount: u64,
    migration_sqrt_price: u128,
) -> Result<u128> {
    let liquidity_from_base =
        get_initial_liquidity_from_delta_base(base_amount, MAX_SQRT_PRICE, migration_sqrt_price)?;
    let liquidity_from_quote =
        get_initial_liquidity_from_delta_quote(quote_amount, MIN_SQRT_PRICE, migration_sqrt_price)?;
    if liquidity_from_base > U512::from(liquidity_from_quote) {
        Ok(liquidity_from_quote)
    } else {
        Ok(liquidity_from_base
            .try_into()
            .map_err(|_| PoolError::TypeCastFailed)?)
    }
}

// Δa = L * (1 / √P_lower - 1 / √P_upper) => L = Δa / (1 / √P_lower - 1 / √P_upper)
pub fn get_initial_liquidity_from_delta_base(
    base_amount: u64,
    sqrt_max_price: u128,
    sqrt_price: u128,
) -> Result<U512> {
    let price_delta = U512::from(sqrt_max_price.safe_sub(sqrt_price)?);
    let prod = U512::from(base_amount)
        .safe_mul(U512::from(sqrt_price))?
        .safe_mul(U512::from(sqrt_max_price))?;
    let liquidity = prod.safe_div(price_delta)?; // round down
    Ok(liquidity)
}

// Δb = L (√P_upper - √P_lower) => L = Δb / (√P_upper - √P_lower)
pub fn get_initial_liquidity_from_delta_quote(
    quote_amount: u64,
    sqrt_min_price: u128,
    sqrt_price: u128,
) -> Result<u128> {
    let price_delta = U256::from(sqrt_price.safe_sub(sqrt_min_price)?);
    let quote_amount = U256::from(quote_amount).safe_shl(128)?;
    let liquidity = quote_amount.safe_div(price_delta)?; // round down
    return Ok(liquidity
        .try_into()
        .map_err(|_| PoolError::TypeCastFailed)?);
}
