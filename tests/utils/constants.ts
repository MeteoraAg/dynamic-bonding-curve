import { BN } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import VirtualCurveIDL from "../../target/idl/dynamic_bonding_curve.json";

export const DYNAMIC_BONDING_CURVE_PROGRAM_ID = new PublicKey(
  VirtualCurveIDL.address
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

export const BASIS_POINT_MAX = 10_000;
export const OFFSET = 64;
export const U64_MAX = new BN("18446744073709551615");
export const MIN_SQRT_PRICE = new BN("4295048016");
export const MAX_SQRT_PRICE = new BN("79226673521066979257578248091");

export const PROTOCOL_FEE_PROGRAM_ID = new PublicKey(
  "pFee3tb7qh5z53jRF4PbLwmNd148Q8ypLNZbqsMeinA"
);

export const TRANSFER_HOOK_COUNTER_PROGRAM_ID = new PublicKey(
  "EBZDYx7599krFc4m2govwBdZcicr4GgepqC78m71nsHS"
);

export const FEE_DENOMINATOR = new BN(1_000_000_000);
export const FLASH_RENT_FUND = 1e9;
