#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

#[macro_use]
pub mod macros;

pub mod const_pda;
pub mod instructions;
pub use instructions::*;
pub mod constants;
pub mod error;
pub mod state;
pub use error::*;
pub mod event;
pub use event::*;
pub mod utils;
pub use utils::*;
pub mod math;
pub use math::*;
pub mod base_fee;
pub mod curve;
pub mod tests;

pub mod params;

declare_id!("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");

#[program]
pub mod dynamic_bonding_curve {
    use super::*;

    /// ADMIN FUNCTIONS_ ///
    pub fn create_claim_fee_operator(ctx: Context<CreateClaimFeeOperatorCtx>) -> Result<()> {
        instructions::handle_create_claim_fee_operator(ctx)
    }

    pub fn close_claim_fee_operator(ctx: Context<CloseClaimFeeOperatorCtx>) -> Result<()> {
        instructions::handle_close_claim_fee_operator(ctx)
    }

    pub fn claim_protocol_fee(ctx: Context<ClaimProtocolFeesCtx>) -> Result<()> {
        instructions::handle_claim_protocol_fee(ctx)
    }

    pub fn protocol_withdraw_surplus(ctx: Context<ProtocolWithdrawSurplusCtx>) -> Result<()> {
        instructions::handle_protocol_withdraw_surplus(ctx)
    }

    /// PARTNER FUNCTIONS ////
    pub fn create_partner_metadata(
        ctx: Context<CreatePartnerMetadataCtx>,
        metadata: CreatePartnerMetadataParameters,
    ) -> Result<()> {
        instructions::handle_create_partner_metadata(ctx, metadata)
    }
    pub fn create_config(
        ctx: Context<CreateConfigCtx>,
        config_parameters: ConfigParameters,
    ) -> Result<()> {
        instructions::handle_create_config(ctx, config_parameters)
    }
    pub fn claim_trading_fee(
        ctx: Context<ClaimTradingFeesCtx>,
        max_amount_a: u64,
        max_amount_b: u64,
    ) -> Result<()> {
        instructions::handle_claim_trading_fee(ctx, max_amount_a, max_amount_b)
    }

    // withdraw surplus on quote token
    pub fn partner_withdraw_surplus(ctx: Context<PartnerWithdrawSurplusCtx>) -> Result<()> {
        instructions::handle_partner_withdraw_surplus(ctx)
    }

    /// POOL CREATOR FUNCTIONS ////
    pub fn initialize_virtual_pool_with_spl_token<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, InitializeVirtualPoolWithSplTokenCtx<'info>>,
        params: InitializePoolParameters,
    ) -> Result<()> {
        instructions::handle_initialize_virtual_pool_with_spl_token(ctx, params)
    }

    pub fn initialize_virtual_pool_with_token2022<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, InitializeVirtualPoolWithToken2022Ctx<'info>>,
        params: InitializePoolParameters,
    ) -> Result<()> {
        instructions::handle_initialize_virtual_pool_with_token2022(ctx, params)
    }

    pub fn create_virtual_pool_metadata(
        ctx: Context<CreateVirtualPoolMetadataCtx>,
        metadata: CreateVirtualPoolMetadataParameters,
    ) -> Result<()> {
        instructions::handle_create_virtual_pool_metadata(ctx, metadata)
    }

    pub fn claim_creator_trading_fee(
        ctx: Context<ClaimCreatorTradingFeesCtx>,
        max_base_amount: u64,
        max_quote_amount: u64,
    ) -> Result<()> {
        instructions::handle_claim_creator_trading_fee(ctx, max_base_amount, max_quote_amount)
    }

    // withdraw surplus on quote token
    pub fn creator_withdraw_surplus(ctx: Context<CreatorWithdrawSurplusCtx>) -> Result<()> {
        instructions::handle_creator_withdraw_surplus(ctx)
    }

    pub fn transfer_pool_creator<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, TransferPoolCreatorCtx>,
    ) -> Result<()> {
        instructions::handle_transfer_pool_creator(ctx)
    }

    /// BOTH partner and creator FUNCTIONS ///
    pub fn withdraw_migration_fee(ctx: Context<WithdrawMigrationFeeCtx>, flag: u8) -> Result<()> {
        instructions::handle_withdraw_migration_fee(ctx, flag)
    }

    /// TRADING BOTS FUNCTIONS ////
    pub fn swap(ctx: Context<SwapCtx>, params: SwapParameters) -> Result<()> {
        instructions::handle_swap_wrapper(
            ctx,
            SwapParameters2 {
                amount_0: params.amount_in,
                amount_1: params.minimum_amount_out,
                swap_mode: SwapMode::ExactIn.into(),
                ..Default::default()
            },
        )
    }

    pub fn swap2(ctx: Context<SwapCtx>, params: SwapParameters2) -> Result<()> {
        instructions::handle_swap_wrapper(ctx, params)
    }

    /// PERMISSIONLESS FUNCTIONS ///
    /// create locker
    pub fn create_locker(ctx: Context<CreateLockerCtx>) -> Result<()> {
        instructions::handle_create_locker(ctx)
    }

    // withdraw leftover on base token, can only call after pool is initialized
    pub fn withdraw_leftover(ctx: Context<WithdrawLeftoverCtx>) -> Result<()> {
        instructions::handle_withdraw_leftover(ctx)
    }

    /// migrate damm v1
    pub fn migration_meteora_damm_create_metadata<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, MigrationMeteoraDammCreateMetadataCtx<'info>>,
    ) -> Result<()> {
        instructions::handle_migration_meteora_damm_create_metadata(ctx)
    }

    pub fn migrate_meteora_damm<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, MigrateMeteoraDammCtx<'info>>,
    ) -> Result<()> {
        instructions::handle_migrate_meteora_damm(ctx)
    }

    pub fn migrate_meteora_damm_lock_lp_token<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, MigrateMeteoraDammLockLpTokenCtx<'info>>,
    ) -> Result<()> {
        instructions::handle_migrate_meteora_damm_lock_lp_token(ctx)
    }

    pub fn migrate_meteora_damm_claim_lp_token<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, MigrateMeteoraDammClaimLpTokenCtx<'info>>,
    ) -> Result<()> {
        instructions::handle_migrate_meteora_damm_claim_lp_token(ctx)
    }

    // migrate damm v2
    pub fn migration_damm_v2_create_metadata<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, MigrationDammV2CreateMetadataCtx<'info>>,
    ) -> Result<()> {
        instructions::handle_migration_damm_v2_create_metadata(ctx)
    }

    pub fn migration_damm_v2<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, MigrateDammV2Ctx<'info>>,
    ) -> Result<()> {
        instructions::handle_migrate_damm_v2(ctx)
    }
}
