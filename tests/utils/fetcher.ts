import { PublicKey } from "@solana/web3.js";
import { BanksClient } from "solana-bankrun";
import {
  ClaimFeeOperator,
  LockEscrow,
  MeteoraDammMigrationMetadata,
  PartnerMetadata,
  Pool,
  PoolConfig,
  VirtualCurveProgram,
  VirtualPoolMetadata,
} from "./types";
import { Program } from "@coral-xyz/anchor";
import { DynamicAmm } from "./idl/dynamic_amm";
import { createDammV2Program } from "./common";

export async function getVirtualPool(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  pool: PublicKey
): Promise<Pool> {
  const account = await banksClient.getAccount(pool);
  return program.coder.accounts.decode(
    "virtualPool",
    Buffer.from(account.data)
  );
}

export async function getConfig(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  config: PublicKey
): Promise<PoolConfig> {
  const account = await banksClient.getAccount(config);
  return program.coder.accounts.decode("poolConfig", Buffer.from(account.data));
}

export async function getPartnerMetadata(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  partnerMetadata: PublicKey
): Promise<PartnerMetadata> {
  const account = await banksClient.getAccount(partnerMetadata);
  return program.coder.accounts.decode(
    "partnerMetadata",
    Buffer.from(account.data)
  );
}

export async function getVirtualPoolMetadata(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  virtualPoolMetadata: PublicKey
): Promise<VirtualPoolMetadata> {
  const account = await banksClient.getAccount(virtualPoolMetadata);
  return program.coder.accounts.decode(
    "virtualPoolMetadata",
    Buffer.from(account.data)
  );
}

export async function getClaimFeeOperator(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  claimFeeOperator: PublicKey
): Promise<ClaimFeeOperator> {
  const account = await banksClient.getAccount(claimFeeOperator);
  return program.coder.accounts.decode(
    "claimFeeOperator",
    Buffer.from(account.data)
  );
}

export async function getMeteoraDammMigrationMetadata(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  migrationMetadata: PublicKey
): Promise<MeteoraDammMigrationMetadata> {
  const account = await banksClient.getAccount(migrationMetadata);
  return program.coder.accounts.decode(
    "meteoraDammMigrationMetadata",
    Buffer.from(account.data)
  );
}

export async function getLockEscrow(
  banksClient: BanksClient,
  program: Program<DynamicAmm>,
  lockEscrow: PublicKey
): Promise<LockEscrow> {
  const account = await banksClient.getAccount(lockEscrow);
  return program.coder.accounts.decode("lockEscrow", Buffer.from(account.data));
}

export async function getDammV2Pool(
  banksClient: BanksClient,
  pool: PublicKey
): Promise<any> {
  const account = await banksClient.getAccount(pool);
  const program =  createDammV2Program()
  return program.coder.accounts.decode(
    "pool",
    Buffer.from(account.data)
  );
}
