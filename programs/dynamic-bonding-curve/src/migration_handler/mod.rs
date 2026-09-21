pub mod compounding_liquidity;
pub use compounding_liquidity::*;

pub mod concentrated_liquidity;
pub use concentrated_liquidity::*;

use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::transfer_fee::TransferFee;
use num_enum::{IntoPrimitive, TryFromPrimitive};

use crate::{
    constants::MAX_SQRT_PRICE, curve::get_delta_amount_base_unsigned, safe_math::SafeMath,
    state::MigrationOption, token::calculate_transfer_fee_excluded_amount, u128x128_math::Rounding,
};

pub struct InitialPoolInformation {
    pub sqrt_price: u128,
    pub distributable_liquidity: u128,
    pub dead_liquidity: u128,
}

/// Collect fee mode for migrated DAMM v2 pools.
/// Separate from DBC's own CollectFeeMode (which only supports QuoteToken/OutputToken)
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
pub enum MigratedCollectFeeMode {
    QuoteToken,
    OutputToken,
    Compounding, // Compounding mode is only supported in DAMM v2, not in DBC collect fee mode
}

impl MigratedCollectFeeMode {
    pub fn to_dammv2_collect_fee_mode(&self) -> Result<u8> {
        // DBC: 0 | QuoteToken is as the same as Damm v2: 1 : OnlyB
        // DBC: 1 | OutputToken is as the same as Damm v2: 0 : BothToken
        // DBC: 2 | Compounding is as the same as Damm v2: 2 : Compounding
        // https://github.com/MeteoraAg/damm-v2/blob/main/programs/cp-amm/src/state/pool.rs#L41-L46
        match self {
            MigratedCollectFeeMode::QuoteToken => Ok(1),
            MigratedCollectFeeMode::OutputToken => Ok(0),
            MigratedCollectFeeMode::Compounding => Ok(2),
        }
    }
}

pub trait MigrationHandler {
    fn get_initial_pool_information(
        &self,
        base_amount: u64,
        quote_amount: u64,
    ) -> Result<InitialPoolInformation>;

    fn get_migration_protocol_fees(
        &self,
        deposit_base_amount: u64,
        deposit_quote_amount: u64,
        migration_fee_bps: u16,
    ) -> Result<(u64, u64)>;
    fn calculate_liquidity_delta(
        &self,
        base_amount: u64,
        quote_amount: u64,
        pool_base_reserve: u64,
        pool_quote_reserve: u64,
        pool_liquidity: u128,
    ) -> Result<u128>;

    // we use this in create config
    fn get_included_protocol_fee_migration_amounts_1(
        &self,
        migration_quote_threshold: u64,
        migration_fee_percentage: u8,
    ) -> Result<(u64, u64)>;

    // we use this in in migration
    fn get_included_protocol_fee_migration_amounts_2(
        &self,
        migration_base_threshold: u64,
        migration_quote_threshold: u64,
        migration_fee_percentage: u8,
        excluded_fee_base_reserve: u64,
    ) -> Result<(u64, u64)>;

    fn get_migration_deposit_amounts(
        &self,
        base_budget: u64,
        quote_budget: u64,
        base_amount: u64,
        quote_amount: u64,
    ) -> Result<(u64, u64)>;

    fn get_migration_transfer_fee_amounts(
        &self,
        base_transfer_fee: Option<&TransferFee>,
        quote_transfer_fee: Option<&TransferFee>,
        base_budget: u64,
        quote_budget: u64,
    ) -> Result<(u64, u64)> {
        let base_transfer = calculate_transfer_fee_excluded_amount(base_transfer_fee, base_budget)?;
        let quote_transfer =
            calculate_transfer_fee_excluded_amount(quote_transfer_fee, quote_budget)?;
        Ok((base_transfer.transfer_fee, quote_transfer.transfer_fee))
    }

    /// base amount damm v2 would receive if the quote mint charged no transfer fee
    fn get_base_deposit_without_transfer_fee(
        &self,
        base_budget: u64,
        quote_budget: u64,
    ) -> Result<u64> {
        let InitialPoolInformation {
            sqrt_price,
            distributable_liquidity,
            dead_liquidity,
        } = self.get_initial_pool_information(base_budget, quote_budget)?;
        let base_amount = get_delta_amount_base_unsigned(
            sqrt_price,
            MAX_SQRT_PRICE,
            distributable_liquidity.safe_add(dead_liquidity)?,
            Rounding::Up,
        )?;
        Ok(base_amount.min(base_budget))
    }
}

pub fn get_migration_handler(
    migration_option: MigrationOption,
    migrated_collect_fee_mode: MigratedCollectFeeMode,
    migration_sqrt_price: u128,
) -> Box<dyn MigrationHandler> {
    // if damm v1
    if migration_option == MigrationOption::MeteoraDamm {
        return Box::new(CompoundingLiquidity {
            migration_sqrt_price,
        });
    }
    // else damm v2
    if migrated_collect_fee_mode == MigratedCollectFeeMode::Compounding {
        Box::new(CompoundingLiquidity {
            migration_sqrt_price,
        })
    } else {
        Box::new(ConcentratedLiquidity {
            migration_sqrt_price,
        })
    }
}
