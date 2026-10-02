//! Event module includes information about events of the program
//! Transfer-hook event variants only added for events consumed by external indexers
use anchor_lang::prelude::*;

use crate::{
    state::{SwapResult, SwapResult2},
    ConfigParameters, SwapParameters, SwapParameters2, TransferFeeParameters,
};

/// Create partner metadata
#[event]
pub struct EvtPartnerMetadata {
    pub partner_metadata: Pubkey,
    pub fee_claimer: Pubkey,
}

#[event]
pub struct EvtVirtualPoolMetadata {
    pub virtual_pool_metadata: Pubkey,
    pub virtual_pool: Pubkey,
}

#[deprecated(since = "0.2.2")]
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

#[event]
pub struct EvtCreateConfig3 {
    pub config: Pubkey,
    pub quote_mint: Pubkey,
    pub fee_claimer: Pubkey,
    pub leftover_receiver: Pubkey,
    pub config_parameters: ConfigParameters,
    pub transfer_fee_parameters: TransferFeeParameters,
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

#[event]
pub struct EvtInitializePool {
    pub pool: Pubkey,
    pub config: Pubkey,
    pub creator: Pubkey,
    pub base_mint: Pubkey,
    pub pool_type: u8,
    pub activation_point: u64,
}

#[event]
pub struct EvtInitializePoolWithTransferHook {
    pub pool: Pubkey,
    pub config: Pubkey,
    pub creator: Pubkey,
    pub base_mint: Pubkey,
    pub pool_type: u8,
    pub activation_point: u64,
}

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

#[event]
pub struct EvtSwap2 {
    pub pool: Pubkey,
    pub config: Pubkey,
    pub trade_direction: u8,
    pub has_referral: bool,
    pub swap_parameters: SwapParameters2,
    pub swap_result: SwapResult2,
    pub quote_reserve_amount: u64,
    pub migration_threshold: u64,
    pub current_timestamp: u64,
}

#[event]
pub struct EvtSwap2WithTransferHook {
    pub pool: Pubkey,
    pub config: Pubkey,
    pub trade_direction: u8,
    pub has_referral: bool,
    pub swap_parameters: SwapParameters2,
    pub swap_result: SwapResult2,
    pub quote_reserve_amount: u64,
    pub migration_threshold: u64,
    pub current_timestamp: u64,
}

#[event]
pub struct EvtSwap3 {
    pub pool: Pubkey,
    pub config: Pubkey,
    pub trade_direction: u8,
    pub swap_mode: u8,
    pub has_referral: bool,
    pub fee_on_base_token: bool,
    pub included_transfer_fee_amount_in: u64,
    pub excluded_transfer_fee_amount_in: u64,
    pub included_transfer_fee_amount_out: u64,
    pub excluded_transfer_fee_amount_out: u64,
    pub trading_fee: u64,
    pub protocol_fee: u64,
    pub referral_fee: u64,
    pub next_sqrt_price: u128,
    pub quote_reserve: u64,
    pub current_timestamp: u64,
}

#[event]
pub struct EvtSwap3WithTransferHook {
    pub pool: Pubkey,
    pub config: Pubkey,
    pub trade_direction: u8,
    pub swap_mode: u8,
    pub has_referral: bool,
    pub fee_on_base_token: bool,
    pub included_transfer_fee_amount_in: u64,
    pub excluded_transfer_fee_amount_in: u64,
    pub included_transfer_fee_amount_out: u64,
    pub excluded_transfer_fee_amount_out: u64,
    pub trading_fee: u64,
    pub protocol_fee: u64,
    pub referral_fee: u64,
    pub next_sqrt_price: u128,
    pub quote_reserve: u64,
    pub current_timestamp: u64,
}

#[event]
pub struct EvtCurveComplete {
    pub pool: Pubkey,
    pub config: Pubkey,
    pub base_reserve: u64,
    pub quote_reserve: u64,
}

#[event]
pub struct EvtCurveCompleteWithTransferHook {
    pub pool: Pubkey,
    pub config: Pubkey,
    pub base_reserve: u64,
    pub quote_reserve: u64,
}

#[event]
pub struct EvtClaimProtocolFee2 {
    pub pool: Pubkey,
    pub receiver_token_account: Pubkey,
    pub token_mint: Pubkey,
    pub amount: u64,
}

#[event]
pub struct EvtClaimTradingFee {
    pub pool: Pubkey,
    pub token_base_amount: u64,
    pub token_quote_amount: u64,
}

#[event]
pub struct EvtClaimCreatorTradingFee {
    pub pool: Pubkey,
    pub token_base_amount: u64,
    pub token_quote_amount: u64,
}

#[event]
pub struct EvtCreateMeteoraMigrationMetadata {
    pub virtual_pool: Pubkey,
}

#[event]
pub struct EvtPartnerWithdrawSurplus {
    pub pool: Pubkey,
    pub surplus_amount: u64,
}

#[event]
pub struct EvtCreatorWithdrawSurplus {
    pub pool: Pubkey,
    pub surplus_amount: u64,
}

#[event]
pub struct EvtWithdrawLeftover {
    pub pool: Pubkey,
    pub leftover_receiver: Pubkey,
    pub leftover_amount: u64,
}

#[event]
pub struct EvtUpdatePoolCreator {
    pub pool: Pubkey,
    pub creator: Pubkey,
    pub new_creator: Pubkey,
}

#[event]
pub struct EvtWithdrawMigrationFee {
    pub pool: Pubkey,
    pub fee: u64,
    pub flag: u8,
}

#[event]
pub struct EvtClaimPoolCreationFee {
    pub pool: Pubkey,
    pub receiver: Pubkey,
    pub creation_fee: u64,
}

#[event]
pub struct EvtPartnerClaimPoolCreationFee {
    pub pool: Pubkey,
    pub partner: Pubkey,
    pub creation_fee: u64,
    pub fee_receiver: Pubkey,
}

#[event]
pub struct EvtCreateTokenBadge {
    pub token_mint: Pubkey,
}

#[event]
pub struct EvtCloseTokenBadge {
    pub token_mint: Pubkey,
}
