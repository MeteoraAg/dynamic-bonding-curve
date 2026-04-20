use anchor_lang::prelude::*;

use crate::{state::SwapResult2, SwapParameters2};

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
pub struct EvtVirtualPoolMetadataWithTransferHook {
    pub virtual_pool_metadata: Pubkey,
    pub virtual_pool: Pubkey,
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
pub struct EvtCurveCompleteWithTransferHook {
    pub pool: Pubkey,
    pub config: Pubkey,
    pub base_reserve: u64,
    pub quote_reserve: u64,
}

#[event]
pub struct EvtClaimProtocolFee2WithTransferHook {
    pub pool: Pubkey,
    pub receiver_token_account: Pubkey,
    pub token_mint: Pubkey,
    pub amount: u64,
}

#[event]
pub struct EvtClaimTradingFeeWithTransferHook {
    pub pool: Pubkey,
    pub token_base_amount: u64,
    pub token_quote_amount: u64,
}

#[event]
pub struct EvtClaimCreatorTradingFeeWithTransferHook {
    pub pool: Pubkey,
    pub token_base_amount: u64,
    pub token_quote_amount: u64,
}

#[event]
pub struct EvtPartnerWithdrawSurplusWithTransferHook {
    pub pool: Pubkey,
    pub surplus_amount: u64,
}

#[event]
pub struct EvtCreatorWithdrawSurplusWithTransferHook {
    pub pool: Pubkey,
    pub surplus_amount: u64,
}

#[event]
pub struct EvtUpdatePoolCreatorWithTransferHook {
    pub pool: Pubkey,
    pub creator: Pubkey,
    pub new_creator: Pubkey,
}

#[event]
pub struct EvtWithdrawMigrationFeeWithTransferHook {
    pub pool: Pubkey,
    pub fee: u64,
    pub flag: u8,
}

#[event]
pub struct EvtClaimPoolCreationFeeWithTransferHook {
    pub pool: Pubkey,
    pub receiver: Pubkey,
    pub creation_fee: u64,
}

#[event]
pub struct EvtPartnerClaimPoolCreationFeeWithTransferHook {
    pub pool: Pubkey,
    pub partner: Pubkey,
    pub creation_fee: u64,
    pub fee_receiver: Pubkey,
}
