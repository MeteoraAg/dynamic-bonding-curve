import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { VAULT_BASE_KEY } from "./";
import {
  DAMM_PROGRAM_ID,
  DAMM_V2_PROGRAM_ID,
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  METAPLEX_PROGRAM_ID,
  VAULT_PROGRAM_ID,
} from "./constants";

export function getSecondKey(key1: PublicKey, key2: PublicKey) {
  const buf1 = key1.toBuffer();
  const buf2 = key2.toBuffer();
  // Buf1 > buf2
  if (Buffer.compare(buf1, buf2) === 1) {
    return buf2;
  }
  return buf1;
}

export function getFirstKey(key1: PublicKey, key2: PublicKey) {
  const buf1 = key1.toBuffer();
  const buf2 = key2.toBuffer();
  // Buf1 > buf2
  if (Buffer.compare(buf1, buf2) === 1) {
    return buf1;
  }
  return buf2;
}

export function deriveMetadataAccount(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METAPLEX_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METAPLEX_PROGRAM_ID
  )[0];
}

export function derivePoolAuthority(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool_authority")],
    DYNAMIC_BONDING_CURVE_PROGRAM_ID
  )[0];
}

export function deriveBaseKeyForLocker(virtualPool: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("base_locker"), virtualPool.toBuffer()],
    DYNAMIC_BONDING_CURVE_PROGRAM_ID
  )[0];
}

export function derivePartnerMetadata(feeClaimer: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("partner_metadata"), feeClaimer.toBuffer()],
    DYNAMIC_BONDING_CURVE_PROGRAM_ID
  )[0];
}

export function deriveVirtualPoolMetadata(pool: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("virtual_pool_metadata"), pool.toBuffer()],
    DYNAMIC_BONDING_CURVE_PROGRAM_ID
  )[0];
}

export function deriveConfigAddress(index: BN): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config"), index.toArrayLike(Buffer, "le", 8)],
    DYNAMIC_BONDING_CURVE_PROGRAM_ID
  )[0];
}

export function derivePoolAddress(
  config: PublicKey,
  tokenAMint: PublicKey,
  tokenBMint: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("pool"),
      config.toBuffer(),
      getFirstKey(tokenAMint, tokenBMint),
      getSecondKey(tokenAMint, tokenBMint),
    ],
    DYNAMIC_BONDING_CURVE_PROGRAM_ID
  )[0];
}

export function deriveDammPoolAddress(
  config: PublicKey,
  tokenAMint: PublicKey,
  tokenBMint: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      getFirstKey(tokenAMint, tokenBMint),
      getSecondKey(tokenAMint, tokenBMint),
      config.toBuffer(),
    ],
    DAMM_PROGRAM_ID
  )[0];
}

export function deriveDammV2PoolAddress(
  config: PublicKey,
  tokenAMint: PublicKey,
  tokenBMint: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("pool"),
      config.toBuffer(),
      getFirstKey(tokenAMint, tokenBMint),
      getSecondKey(tokenAMint, tokenBMint),
    ],
    DAMM_V2_PROGRAM_ID
  )[0];
}

export function deriveTokenVaultAddress(
  tokenMint: PublicKey,
  pool: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token_vault"), tokenMint.toBuffer(), pool.toBuffer()],
    DYNAMIC_BONDING_CURVE_PROGRAM_ID
  )[0];
}

export function deriveClaimFeeOperatorAddress(operator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("cf_operator"), operator.toBuffer()],
    DYNAMIC_BONDING_CURVE_PROGRAM_ID
  )[0];
}

export const getVaultPdas = (tokenMint: PublicKey) => {
  const [vault, _vaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), tokenMint.toBuffer(), VAULT_BASE_KEY.toBuffer()],
    VAULT_PROGRAM_ID
  );

  const [tokenVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_vault"), vault.toBuffer()],
    VAULT_PROGRAM_ID
  );
  const [lpMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint"), vault.toBuffer()],
    VAULT_PROGRAM_ID
  );

  return {
    vaultPda: vault,
    tokenVaultPda: tokenVault,
    lpMintPda: lpMint,
  };
};

export function deriveProtocolFeeAddress(mint: PublicKey, pool: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("fee"), mint.toBuffer(), pool.toBuffer()],
    DAMM_PROGRAM_ID
  )[0];
}

export function deriveLpMintAddress(pool: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint"), pool.toBuffer()],
    DAMM_PROGRAM_ID
  )[0];
}

export function deriveVaultLPAddress(
  vault: PublicKey,
  pool: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [vault.toBuffer(), pool.toBuffer()],
    DAMM_PROGRAM_ID
  )[0];
}

export function deriveMigrationMetadataAddress(
  virtual_pool: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("meteora"), virtual_pool.toBuffer()],
    DYNAMIC_BONDING_CURVE_PROGRAM_ID
  )[0];
}

export function deriveMigrationDammV2MetadataAddress(
  virtual_pool: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("damm_v2"), virtual_pool.toBuffer()],
    DYNAMIC_BONDING_CURVE_PROGRAM_ID
  )[0];
}
