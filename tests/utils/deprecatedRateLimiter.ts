import { BN } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { LiteSVM } from "litesvm";

export type RateLimiterParams = {
  cliffFeeNumerator: BN;
  feeIncrementBps: number;
  maxLimiterDuration: BN;
  referenceAmount: BN;
};

export const RATE_LIMITER_BASE_FEE_MODE = 2;

// 8 bytes disc + 32 bytes quote_mint + 32 bytes fee_claimer + 32 bytes leftover_receiver
// ConfigWithTransferHook wraps PoolConfig as its first field, so the offset is the same
const CONFIG_BASE_FEE_OFFSET = 8 + 32 + 32 + 32;
const BASE_FEE_CONFIG_LEN = 32;

export function encodeRateLimiterBaseFeeConfig(
  params: RateLimiterParams
): Buffer {
  const encoded = Buffer.alloc(BASE_FEE_CONFIG_LEN);
  encoded.writeBigUInt64LE(BigInt(params.cliffFeeNumerator.toString()), 0);
  encoded.writeBigUInt64LE(BigInt(params.maxLimiterDuration.toString()), 8); // second_factor
  encoded.writeBigUInt64LE(BigInt(params.referenceAmount.toString()), 16); // third_factor
  encoded.writeUInt16LE(params.feeIncrementBps, 24); // first_factor
  encoded.writeUInt8(RATE_LIMITER_BASE_FEE_MODE, 26);
  return encoded;
}

// Rate limiter is deprecated and can no longer be created through the program.
// Existing configs are still valid on-chain, so tests build the base fee config
// bytes directly to cover them.
export function setDeprecatedRateLimiterConfig(
  svm: LiteSVM,
  config: PublicKey,
  params: RateLimiterParams
) {
  const account = svm.getAccount(config);
  if (!account) {
    throw new Error(`Config ${config.toBase58()} does not exist`);
  }

  const encoded = encodeRateLimiterBaseFeeConfig(params);
  if (encoded.length !== BASE_FEE_CONFIG_LEN) {
    throw new Error(
      `Expected ${BASE_FEE_CONFIG_LEN} bytes of base fee config, got ${encoded.length}`
    );
  }

  const data = Buffer.from(account.data);
  if (data.length < CONFIG_BASE_FEE_OFFSET + BASE_FEE_CONFIG_LEN) {
    throw new Error(
      `Config ${config.toBase58()} is too small to hold a base fee config`
    );
  }
  encoded.copy(data, CONFIG_BASE_FEE_OFFSET);

  svm.setAccount(config, {
    data: new Uint8Array(data),
    executable: account.executable,
    lamports: account.lamports,
    owner: account.owner,
  });
}
