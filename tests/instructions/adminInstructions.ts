import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  getClaimFeeOperator,
  getConfig,
  getOrCreateAssociatedTokenAccount,
  getTokenAccount,
  getVirtualPool,
  sendTransactionMaybeThrow,
  TREASURY,
  U64_MAX,
} from "../utils";
import {
  deriveClaimFeeOperatorAddress,
  deriveOperatorAddress,
  derivePoolAuthority,
} from "../utils/accounts";
import { VirtualCurveProgram } from "../utils/types";
import BN from "bn.js";

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

export type ClaimProtocolFeeParams = {
  operator: Keypair;
  pool: PublicKey;
};

export async function claimProtocolFee(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: ClaimProtocolFeeParams
): Promise<any> {
  const { operator, pool } = params;
  const poolState = getVirtualPool(svm, program, pool);
  const configState = getConfig(svm, program, poolState.config);
  const poolAuthority = derivePoolAuthority();
  const quoteMintInfo = getTokenAccount(svm, poolState.quoteVault)!;

  const tokenBaseProgram =
    configState.tokenType == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  const tokenQuoteProgram =
    configState.quoteTokenFlag == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  const preInstructions: TransactionInstruction[] = [];
  const [
    { ata: tokenBaseAccount, ix: createBaseTokenAccountIx },
    { ata: tokenQuoteAccount, ix: createQuoteTokenAccountIx },
  ] = [
      getOrCreateAssociatedTokenAccount(
        svm,
        operator,
        poolState.baseMint,
        TREASURY,
        tokenBaseProgram
      ),
      getOrCreateAssociatedTokenAccount(
        svm,
        operator,
        quoteMintInfo.mint,
        TREASURY,
        tokenQuoteProgram
      ),
    ];
  createBaseTokenAccountIx && preInstructions.push(createBaseTokenAccountIx);
  createQuoteTokenAccountIx && preInstructions.push(createQuoteTokenAccountIx);

  const transaction = await program.methods
    .claimProtocolFee(U64_MAX, U64_MAX)
    .accountsPartial({
      poolAuthority,
      config: poolState.config,
      pool,
      baseVault: poolState.baseVault,
      quoteVault: poolState.quoteVault,
      baseMint: poolState.baseMint,
      quoteMint: quoteMintInfo.mint,
      tokenBaseAccount,
      tokenQuoteAccount,
      operator: deriveOperatorAddress(operator.publicKey),
      signer: operator.publicKey,
      tokenBaseProgram,
      tokenQuoteProgram,
    })
    .preInstructions(preInstructions)
    .transaction();

  sendTransactionMaybeThrow(svm, transaction, [operator]);
}
