import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { LiteSVM } from "litesvm";
import {
  createDammProgram,
  createDammV2Program,
  createVaultProgram,
} from "./common";
import { DynamicAmm } from "./idl/dynamic_amm";
import {
  ClaimFeeOperator,
  DammV1Pool,
  DammV2Pool,
  DynamicVault,
  LockEscrow,
  MeteoraDammMigrationMetadata,
  PartnerMetadata,
  Pool,
  PoolConfig,
  VirtualCurveProgram,
  VirtualPoolMetadata,
} from "./types";

export function getVirtualPool(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  pool: PublicKey
): Pool {
  const account = svm.getAccount(pool);
  return program.coder.accounts.decode(
    "virtualPool",
    Buffer.from(account.data)
  );
}

export function getConfig(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  config: PublicKey
): PoolConfig {
  const account = svm.getAccount(config);
  return program.coder.accounts.decode("poolConfig", Buffer.from(account.data));
}

export function getPartnerMetadata(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  partnerMetadata: PublicKey
): PartnerMetadata {
  const account = svm.getAccount(partnerMetadata);
  return program.coder.accounts.decode(
    "partnerMetadata",
    Buffer.from(account.data)
  );
}

export function getVirtualPoolMetadata(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  virtualPoolMetadata: PublicKey
): VirtualPoolMetadata {
  const account = svm.getAccount(virtualPoolMetadata);
  return program.coder.accounts.decode(
    "virtualPoolMetadata",
    Buffer.from(account.data)
  );
}

export function getClaimFeeOperator(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  claimFeeOperator: PublicKey
): ClaimFeeOperator {
  const account = svm.getAccount(claimFeeOperator);
  return program.coder.accounts.decode(
    "claimFeeOperator",
    Buffer.from(account.data)
  );
}

export function getMeteoraDammMigrationMetadata(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  migrationMetadata: PublicKey
): MeteoraDammMigrationMetadata {
  const account = svm.getAccount(migrationMetadata);
  return program.coder.accounts.decode(
    "meteoraDammMigrationMetadata",
    Buffer.from(account.data)
  );
}

export function getLockEscrow(
  svm: LiteSVM,
  program: Program<DynamicAmm>,
  lockEscrow: PublicKey
): LockEscrow {
  const account = svm.getAccount(lockEscrow);
  return program.coder.accounts.decode("lockEscrow", Buffer.from(account.data));
}

export function getDammV2Pool(svm: LiteSVM, pool: PublicKey): DammV2Pool {
  const account = svm.getAccount(pool);
  const program = createDammV2Program();
  return program.coder.accounts.decode("pool", Buffer.from(account.data));
}

export function getDammV1Pool(svm: LiteSVM, pool: PublicKey): DammV1Pool {
  const account = svm.getAccount(pool);
  const program = createDammProgram();
  return program.coder.accounts.decode("pool", Buffer.from(account.data));
}

export function getVaultAccount(svm: LiteSVM, vault: PublicKey): DynamicVault {
  const account = svm.getAccount(vault);
  const program = createVaultProgram();
  return program.coder.accounts.decode("vault", Buffer.from(account.data));
}
