pub mod damm_v2_common;
pub use damm_v2_common::*;

pub mod compounding_liquidity;
pub use compounding_liquidity::*;

pub mod concentrated_liquidity;
pub use concentrated_liquidity::*;

use anchor_lang::prelude::*;

use crate::state::MigrationOption;

pub struct InitialPoolInformation {
    pub sqrt_price: u128,
    pub distributable_liquidity: u128,
    pub dead_liquidity: u128,
}

pub trait LiquidityHandler {
    fn get_initial_pool_information(
        &self,
        base_amount: u64,
        quote_amount: u64,
        // migration_sqrt_price: u128,
    ) -> Result<InitialPoolInformation>;

    fn get_migration_protocol_fees(
        &self,
        deposit_base_amount: u64,
        deposit_quote_amount: u64,
        migration_fee_bps: u16,
        // migration_sqrt_price: u128,
    ) -> Result<(u64, u64)>;
    fn calculate_liquidity_delta(
        &self,
        base_amount: u64,
        quote_amount: u64,
        // migration_sqrt_price: u128,
        pool_base_reserve: u64,
        pool_quote_reserve: u64,
        pool_liquidity: u128,
    ) -> Result<u128>;

    // we use this in create config
    fn get_included_protocol_fee_migration_amounts_1(
        &self,
        migration_quote_threshold: u64,
        migration_fee_percentage: u8,
        // sqrt_migration_price: u128,
    ) -> Result<(u64, u64)>;

    // we use this in in migration
    fn get_included_protocol_fee_migration_amounts_2(
        &self,
        migration_base_threshold: u64,
        migration_quote_threshold: u64,
        migration_fee_percentage: u8,
        excluded_fee_base_reserve: u64,
    ) -> Result<(u64, u64)>;
}

pub fn get_liquidity_handler(
    migration_option: MigrationOption,
    migrated_collect_fee_mode: MigratedCollectFeeMode,
    migration_sqrt_price: u128,
) -> Box<dyn LiquidityHandler> {
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
