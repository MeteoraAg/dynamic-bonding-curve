use static_assertions::const_assert;

pub const MIN_SQRT_PRICE: u128 = 4295048016;
pub const MAX_SQRT_PRICE: u128 = 79226673521066979257578248091;

pub const BASIS_POINT_MAX: u64 = 10_000;

pub const U24_MAX: u32 = 0xffffff;

pub const ONE_Q64: u128 = 1u128 << 64;
pub mod dynamic_fee {

    pub const BIN_STEP_BPS_DEFAULT: u16 = 1;

    //  bin_step << 64 / BASIS_POINT_MAX
    pub const BIN_STEP_BPS_U128_DEFAULT: u128 = 1844674407370955;

    pub const FILTER_PERIOD_DEFAULT: u16 = 10; // 10 seconds

    pub const DECAY_PERIOD_DEFAULT: u16 = 120; // 120 seconds

    pub const REDUCTION_FACTOR_DEFAULT: u16 = 5000; // 50%

    pub const MAX_DYNAMIC_FEE_PERCENT: u8 = 20; // 20% of base fee

    // refer https://github.com/MeteoraAg/damm-v2-sdk/blob/main/src/helpers/fee.ts#L344C23-L344C25
    pub const MAX_VOLATILITY_ACCUMULATOR: u32 = 14460000;

    // refer https://github.com/MeteoraAg/damm-v2-sdk/blob/main/src/helpers/fee.ts#L344C23-L344C25
    pub const SQUARE_VFA_BIN: u64 = 209091600000000;
}

// Number of bits to scale. This will decide the position of the radix point.

pub const MIN_MIGRATED_POOL_FEE_BPS: u16 = 10; // 0.1%
pub const MAX_MIGRATED_POOL_FEE_BPS: u16 = 1000; // 10%

pub const MAX_CURVE_POINT: usize = 16;
pub const MAX_CURVE_POINT_CONFIG: usize = 20;
const_assert!(MAX_CURVE_POINT <= MAX_CURVE_POINT_CONFIG);

pub const SWAP_BUFFER_PERCENTAGE: u8 = 25; // 25%

pub const PARTNER_AND_CREATOR_SURPLUS_SHARE: u8 = 80; // 80 %

static_assertions::const_assert!(PARTNER_AND_CREATOR_SURPLUS_SHARE <= 100);

pub const MAX_SWALLOW_PERCENTAGE: u8 = 20; // 20 %

pub const MAX_RATE_LIMITER_DURATION_IN_SECONDS: u64 = 60 * 60 * 12; // 12 hours
pub const MAX_RATE_LIMITER_DURATION_IN_SLOTS: u64 = 108000; // 12 hours
static_assertions::const_assert_eq!(
    MAX_RATE_LIMITER_DURATION_IN_SECONDS * 1000 / 400,
    MAX_RATE_LIMITER_DURATION_IN_SLOTS
);

/// Store constants related to fees
pub mod fee {

    /// Default fee denominator. DO NOT simply update it as it will break logic that depends on it as default value.
    pub const FEE_DENOMINATOR: u64 = 1_000_000_000;

    /// Max fee BPS
    pub const MAX_FEE_BPS: u64 = 9900; // 99%
    pub const MAX_FEE_NUMERATOR: u64 = 990_000_000; // 99%

    /// Max basis point. 100% in pct
    pub const MAX_BASIS_POINT: u64 = 10000;

    pub const MIN_FEE_BPS: u64 = 1; // 0.01%
    pub const MIN_FEE_NUMERATOR: u64 = 100_000;

    static_assertions::const_assert_eq!(
        MAX_FEE_BPS * FEE_DENOMINATOR / MAX_BASIS_POINT,
        MAX_FEE_NUMERATOR
    );

    static_assertions::const_assert_eq!(
        MIN_FEE_BPS * FEE_DENOMINATOR / MAX_BASIS_POINT,
        MIN_FEE_NUMERATOR
    );

    pub const PROTOCOL_FEE_PERCENT: u8 = 20; // 20%

    pub const HOST_FEE_PERCENT: u8 = 20; // 20%
}

pub mod seeds {
    pub const CONFIG_PREFIX: &[u8] = b"config";
    pub const CUSTOMIZABLE_POOL_PREFIX: &[u8] = b"cpool";
    pub const POOL_PREFIX: &[u8] = b"pool";
    pub const TOKEN_VAULT_PREFIX: &[u8] = b"token_vault";
    pub const POOL_AUTHORITY_PREFIX: &[u8] = b"pool_authority";
    pub const POSITION_PREFIX: &[u8] = b"position";
    pub const POSITION_NFT_ACCOUNT_PREFIX: &[u8] = b"position_nft_account";
    pub const TOKEN_BADGE_PREFIX: &[u8] = b"token_badge";
    pub const REWARD_VAULT_PREFIX: &[u8] = b"reward_vault";
    pub const CLAIM_FEE_OPERATOR_PREFIX: &[u8] = b"cf_operator";
    pub const METEORA_METADATA_PREFIX: &[u8] = b"meteora";
    pub const DAMM_V2_METADATA_PREFIX: &[u8] = b"damm_v2";
    pub const PARTNER_METADATA_PREFIX: &[u8] = b"partner_metadata";
    pub const VIRTUAL_POOL_METADATA_PREFIX: &[u8] = b"virtual_pool_metadata";
    pub const BASE_LOCKER_PREFIX: &[u8] = b"base_locker";
}
