//! Event module includes information about events of the program
use anchor_lang::prelude::*;

use crate::{
    params::{
        fee_parameters::PoolFeeParameters, liquidity_distribution::LiquidityDistributionParameters,
    },
    state::{SwapResult, SwapResult2},
    ConfigParameters, LockedVestingParams, SwapParameters, SwapParameters2,
};

/// Create partner metadata
#[event]
pub struct EvtPartnerMetadata {
    pub partner_metadata: Pubkey,
    pub fee_claimer: Pubkey,
}

define_event_pair!(
    EvtVirtualPoolMetadata,
    EvtVirtualPoolMetadataWithTransferHook {
        virtual_pool_metadata: Pubkey,
        virtual_pool: Pubkey,
    }
);

/// Create config
#[deprecated(since = "0.1.8")]
#[event]
pub struct EvtCreateConfig {
    pub config: Pubkey,
    pub quote_mint: Pubkey,
    pub fee_claimer: Pubkey,
    pub owner: Pubkey,
    pub pool_fees: PoolFeeParameters,
    pub collect_fee_mode: u8,
    pub migration_option: u8,
    pub activation_type: u8,
    pub token_decimal: u8,
    pub token_type: u8,
    pub partner_permanent_locked_liquidity_percentage: u8,
    pub partner_liquidity_percentage: u8,
    pub creator_permanent_locked_liquidity_percentage: u8,
    pub creator_liquidity_percentage: u8,
    pub swap_base_amount: u64,
    pub migration_quote_threshold: u64,
    pub migration_base_amount: u64,
    pub sqrt_start_price: u128,
    pub locked_vesting: LockedVestingParams,
    pub migration_fee_option: u8,
    pub fixed_token_supply_flag: u8,
    pub pre_migration_token_supply: u64,
    pub post_migration_token_supply: u64,
    pub curve: Vec<LiquidityDistributionParameters>,
}

#[event]
pub struct EvtCreateConfigV2 {
    pub config: Pubkey,
    pub quote_mint: Pubkey,
    pub fee_claimer: Pubkey,
    pub leftover_receiver: Pubkey,
    pub config_parameters: ConfigParameters,
}

#[event]
pub struct EvtCreateConfigV2WithTransferHook {
    pub config: Pubkey,
    pub quote_mint: Pubkey,
    pub fee_claimer: Pubkey,
    pub leftover_receiver: Pubkey,
    pub config_parameters: ConfigParameters,
    pub transfer_hook_program: Pubkey,
}

/// Create claim fee operator
#[event]
pub struct EvtCreateClaimFeeOperator {
    pub operator: Pubkey,
}

/// Close claim fee operator
#[event]
pub struct EvtCloseClaimFeeOperator {
    pub claim_fee_operator: Pubkey,
    pub operator: Pubkey,
}

define_event_pair!(
    EvtInitializePool,
    EvtInitializePoolWithTransferHook {
        pool: Pubkey,
        config: Pubkey,
        creator: Pubkey,
        base_mint: Pubkey,
        pool_type: u8,
        activation_point: u64,
    }
);

#[event]
pub struct EvtSwap {
    pub pool: Pubkey,
    pub config: Pubkey,
    pub trade_direction: u8,
    pub has_referral: bool,
    pub params: SwapParameters,
    pub swap_result: SwapResult,
    pub amount_in: u64,
    pub current_timestamp: u64,
}

define_event_pair!(
    EvtSwap2,
    EvtSwap2WithTransferHook {
        pool: Pubkey,
        config: Pubkey,
        trade_direction: u8,
        has_referral: bool,
        swap_parameters: SwapParameters2,
        swap_result: SwapResult2,
        quote_reserve_amount: u64,
        migration_threshold: u64,
        current_timestamp: u64,
    }
);

define_event_pair!(
    EvtCurveComplete,
    EvtCurveCompleteWithTransferHook {
        pool: Pubkey,
        config: Pubkey,
        base_reserve: u64,
        quote_reserve: u64,
    }
);

#[event]
pub struct EvtClaimProtocolFee {
    pub pool: Pubkey,
    pub token_base_amount: u64,
    pub token_quote_amount: u64,
}

#[event]
pub struct EvtClaimProtocolFee2 {
    pub pool: Pubkey,
    pub receiver_token_account: Pubkey,
    pub token_mint: Pubkey,
    pub amount: u64,
}

define_event_pair!(
    EvtClaimTradingFee,
    EvtClaimTradingFeeWithTransferHook {
        pool: Pubkey,
        token_base_amount: u64,
        token_quote_amount: u64,
    }
);

define_event_pair!(
    EvtClaimCreatorTradingFee,
    EvtClaimCreatorTradingFeeWithTransferHook {
        pool: Pubkey,
        token_base_amount: u64,
        token_quote_amount: u64,
    }
);

#[event]
pub struct EvtCreateMeteoraMigrationMetadata {
    pub virtual_pool: Pubkey,
}

define_event_pair!(
    EvtPartnerWithdrawSurplus,
    EvtPartnerWithdrawSurplusWithTransferHook {
        pool: Pubkey,
        surplus_amount: u64,
    }
);

define_event_pair!(
    EvtCreatorWithdrawSurplus,
    EvtCreatorWithdrawSurplusWithTransferHook {
        pool: Pubkey,
        surplus_amount: u64,
    }
);

#[event]
pub struct EvtWithdrawLeftover {
    pub pool: Pubkey,
    pub leftover_receiver: Pubkey,
    pub leftover_amount: u64,
}

define_event_pair!(
    EvtUpdatePoolCreator,
    EvtUpdatePoolCreatorWithTransferHook {
        pool: Pubkey,
        creator: Pubkey,
        new_creator: Pubkey,
    }
);

define_event_pair!(
    EvtWithdrawMigrationFee,
    EvtWithdrawMigrationFeeWithTransferHook {
        pool: Pubkey,
        fee: u64,
        flag: u8,
    }
);

#[event]
pub struct EvtClaimPoolCreationFee {
    pub pool: Pubkey,
    pub receiver: Pubkey,
    pub creation_fee: u64,
}

define_event_pair!(
    EvtPartnerClaimPoolCreationFee,
    EvtPartnerClaimPoolCreationFeeWithTransferHook {
        pool: Pubkey,
        partner: Pubkey,
        creation_fee: u64,
        fee_receiver: Pubkey,
    }
);
