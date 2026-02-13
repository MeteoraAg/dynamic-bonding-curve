import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export const DYNAMIC_BONDING_CURVE_PROGRAM_ID = new PublicKey(
  "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"
);

export const METAPLEX_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

export const DAMM_PROGRAM_ID = new PublicKey(
  "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB"
);

export const VAULT_PROGRAM_ID = new PublicKey(
  "24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi"
);

export const DAMM_V2_PROGRAM_ID = new PublicKey(
  "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"
);

export const TREASURY = new PublicKey(
  "6aYhxiNGmG8AyU25rh2R7iFu4pBrqnQHpNUGhmsEXRcm"
);

export const LOCKER_PROGRAM_ID = new PublicKey(
  "LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn"
);

export const ZAP_PROGRAM_ID = new PublicKey(
  "zapvX9M3uf5pvy4wRPAbQgdQsM1xmuiFnkfHKPvwMiz"
);

export const JUPITER_V6_PROGRAM_ID = new PublicKey(
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
);

export const JUP_V6_EVENT_AUTHORITY = new PublicKey(
  "D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf"
);

export const BASIS_POINT_MAX = 10_000;
export const OFFSET = 64;
export const U64_MAX = new BN("18446744073709551615");
export const MIN_SQRT_PRICE = new BN("4295048016");
export const MAX_SQRT_PRICE = new BN("79226673521066979257578248091");

export const FEE_DENOMINATOR = new BN(1_000_000_000);
export const FLASH_RENT_FUND = 1e9;
