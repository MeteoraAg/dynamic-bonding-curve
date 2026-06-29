import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { LiteSVM } from "litesvm";
import {
  getConfig,
  getVirtualPool,
  sendTransactionMaybeThrow,
  TREASURY,
} from "../utils";
import { deriveOperatorAddress, derivePoolAuthority } from "../utils/accounts";
import { Pool, PoolConfig, VirtualCurveProgram } from "../utils/types";
import BN from "bn.js";
import { getRemainingAccountsForTransferHook } from "../utils/token";

export enum OperatorPermission {
  ClaimProtocolFee,
  ZapProtocolFee,
}

export function encodePermissions(permissions: OperatorPermission[]): BN {
  return permissions.reduce((acc, perm) => {
    return acc.or(new BN(1).shln(perm));
  }, new BN(0));
}

export async function createOperatorAccount(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: {
    admin: Keypair;
    whitelistedAddress: PublicKey;
    permissions: OperatorPermission[];
  }
) {
  const { admin, whitelistedAddress, permissions } = params;

  const transaction = await program.methods
    .createOperatorAccount(encodePermissions(permissions))
    .accountsPartial({
      signer: admin.publicKey,
      operator: deriveOperatorAddress(whitelistedAddress),
      whitelistedAddress,
      payer: admin.publicKey,
    })
    .transaction();

  sendTransactionMaybeThrow(svm, transaction, [admin]);
}

export type ClaimLegacyPoolCreationFeeParams = {
  operator: Keypair;
  pool: PublicKey;
};

export type ClaimProtocolPoolCreationFeeParams = {
  operator: Keypair;
  pool: PublicKey;
  claimFeeOperator: PublicKey;
};

export async function claimProtocolPoolCreationFee(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: ClaimProtocolPoolCreationFeeParams
) {
  const { operator, pool, claimFeeOperator } = params;

  const poolState = getVirtualPool(svm, program, pool);

  const transaction = await program.methods
    .claimProtocolPoolCreationFee()
    .accountsPartial({
      pool,
      config: poolState.config,
      treasury: TREASURY,
      signer: operator.publicKey,
      operator: deriveOperatorAddress(operator.publicKey),
    })
    // Trick to bypass bankrun transaction has been processed if we wish to execute same tx again
    .remainingAccounts([
      {
        pubkey: PublicKey.unique(),
        isSigner: false,
        isWritable: false,
      },
    ])
    .transaction();
  sendTransactionMaybeThrow(svm, transaction, [operator]);
}

const PARTNER_AND_CREATOR_SURPLUS_SHARE = 80;

function getClaimableProtocolAmount(
  pool: Pool,
  config: PoolConfig,
  isTokenBase: boolean
): BN {
  if (isTokenBase) {
    return pool.protocolBaseFee.add(pool.protocolMigrationBaseFeeAmount);
  }

  let amount = pool.protocolQuoteFee.add(pool.protocolMigrationQuoteFeeAmount);

  const isCurveComplete = pool.quoteReserve.gte(config.migrationQuoteThreshold);
  if (pool.isProtocolWithdrawSurplus === 0 && isCurveComplete) {
    const totalSurplus = pool.quoteReserve.sub(config.migrationQuoteThreshold);
    const partnerAndCreatorSurplus = totalSurplus
      .muln(PARTNER_AND_CREATOR_SURPLUS_SHARE)
      .divn(100);
    const protocolSurplus = totalSurplus.sub(partnerAndCreatorSurplus);
    amount = amount.add(protocolSurplus);
  }

  return amount;
}

export type ClaimProtocolFee2Params = {
  signerKP: Keypair;
  pool: PublicKey;
  isTokenBase: boolean;
  receiverTokenAccount: PublicKey;
  maxAmount?: BN;
};

export async function claimProtocolFee2(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: ClaimProtocolFee2Params
) {
  const { signerKP, pool, isTokenBase, receiverTokenAccount } = params;
  const poolState = getVirtualPool(svm, program, pool);
  const configState = getConfig(svm, program, poolState.config);
  const poolAuthority = derivePoolAuthority();

  const tokenBaseProgram =
    configState.tokenType == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
  const tokenQuoteProgram =
    configState.quoteTokenFlag == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  const maxAmount =
    params.maxAmount ??
    getClaimableProtocolAmount(poolState, configState, isTokenBase);

  const transaction = await program.methods
    .claimProtocolFee2(maxAmount)
    .accountsPartial({
      poolAuthority,
      config: poolState.config,
      pool,
      receiverTokenAccount,
      baseVault: poolState.baseVault,
      quoteVault: poolState.quoteVault,
      baseMint: poolState.baseMint,
      quoteMint: configState.quoteMint,
      signer: signerKP.publicKey,
      tokenBaseProgram,
      tokenQuoteProgram,
    })
    .transaction();

  sendTransactionMaybeThrow(svm, transaction, [signerKP]);
}
