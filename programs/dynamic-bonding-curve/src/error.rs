//! Error module includes error messages and codes of the program
use anchor_lang::prelude::*;

/// Error messages and codes of the program
#[error_code]
#[derive(PartialEq)]
pub enum PoolError {
    #[msg("Math operation overflow")]
    MathOverflow,

    #[msg("Invalid fee setup")]
    InvalidFee,

    #[msg("Exceeded slippage tolerance")]
    ExceededSlippage,

    #[msg("Exceeded max fee bps")]
    ExceedMaxFeeBps,

    #[msg("Invalid admin")]
    InvalidAdmin,

    #[msg("Amount is zero")]
    AmountIsZero,

    #[msg("Type cast error")]
    TypeCastFailed,

    #[msg("Invalid activation type")]
    InvalidActivationType,

    #[msg("Invalid quote mint")]
    InvalidQuoteMint,

    #[msg("Invalid collect fee mode")]
    InvalidCollectFeeMode,

    #[msg("Invalid migration fee option")]
    InvalidMigrationFeeOption,

    #[msg("Invalid input")]
    InvalidInput,

    #[msg("Not enough liquidity")]
    NotEnoughLiquidity,

    #[msg("Pool is completed")]
    PoolIsCompleted,

    #[msg("Pool is incompleted")]
    PoolIsIncompleted,

    #[msg("Invalid migration option")]
    InvalidMigrationOption,

    #[msg("Invalid activation type")]
    InvalidTokenDecimals,

    #[msg("Invalid token type")]
    InvalidTokenType,

    #[msg("Invalid fee percentage")]
    InvalidFeePercentage,

    #[msg("Invalid quote threshold")]
    InvalidQuoteThreshold,

    #[msg("Invalid token supply")]
    InvalidTokenSupply,

    #[msg("Invalid curve")]
    InvalidCurve,

    #[msg("Not permit to do this action")]
    NotPermitToDoThisAction,

    #[msg("Invalid owner account")]
    InvalidOwnerAccount,

    #[msg("Invalid config account")]
    InvalidConfigAccount,

    #[msg("Surplus has been withdraw")]
    SurplusHasBeenWithdraw,

    #[msg("Leftover has been withdraw")]
    LeftoverHasBeenWithdraw,

    #[msg("Total base token is exceeded max supply")]
    TotalBaseTokenExceedMaxSupply,

    #[msg("Unsupport native mint token 2022")]
    UnsupportNativeMintToken2022,

    #[msg("Insufficient liquidity for migration")]
    InsufficientLiquidityForMigration,

    #[msg("Missing pool config in remaining account")]
    MissingPoolConfigInRemainingAccount,

    #[msg("Invalid vesting parameters")]
    InvalidVestingParameters,

    #[msg("Invalid leftover address")]
    InvalidLeftoverAddress,

    #[msg("Swap amount is over a threshold")]
    SwapAmountIsOverAThreshold,

    #[msg("Invalid fee scheduler")]
    InvalidFeeScheduler,

    #[msg("Invalid creator trading fee percentage")]
    InvalidCreatorTradingFeePercentage,

    #[msg("Invalid new creator")]
    InvalidNewCreator,

    #[msg("Invalid token authority option")]
    InvalidTokenAuthorityOption,

    #[msg("Invalid account for the instruction")]
    InvalidAccount,

    #[msg("Invalid migrator fee percentage")]
    InvalidMigratorFeePercentage,

    #[msg("Migration fee has been withdraw")]
    MigrationFeeHasBeenWithdraw,

    #[msg("Invalid base fee mode")]
    InvalidBaseFeeMode,

    #[msg("Invalid fee rate limiter")]
    InvalidFeeRateLimiter,

    #[msg("Fail to validate single swap instruction in rate limiter")]
    FailToValidateSingleSwapInstruction,

    #[msg("Invalid migrated pool fee params")]
    InvalidMigratedPoolFee,

    #[msg("Undertermined error")]
    UndeterminedError,

    #[msg("Rate limiter not supported")]
    RateLimiterNotSupported,

    #[msg("Amount left is not zero")]
    AmountLeftIsNotZero,

    #[msg("Next sqrt price is smaller than start sqrt price")]
    NextSqrtPriceIsSmallerThanStartSqrtPrice,
}
