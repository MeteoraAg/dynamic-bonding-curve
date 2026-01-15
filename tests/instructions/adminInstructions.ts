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
  derivePoolAuthority,
} from "../utils/accounts";
import { VirtualCurveProgram } from "../utils/types";

export type CreateClaimProtocolFeeOperatorParams = {
  admin: Keypair;
  operator: PublicKey;
};

export async function createClaimProtocolFeeOperator(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: CreateClaimProtocolFeeOperatorParams
): Promise<PublicKey> {
  const { operator, admin } = params;
  const claimFeeOperator = deriveClaimFeeOperatorAddress(operator);
  const transaction = await program.methods
    .createClaimProtocolFeeOperator()
    .accountsPartial({
      claimFeeOperator,
      operator,
      signer: admin.publicKey,
      payer: admin.publicKey,
    })
    .transaction();

  sendTransactionMaybeThrow(svm, transaction, [admin]);

  const claimFeeOperatorState = getClaimFeeOperator(
    svm,
    program,
    claimFeeOperator
  );
  expect(claimFeeOperatorState.operator.toString()).eq(operator.toString());

  return claimFeeOperator;
}

export async function closeClaimProtocolFeeOperator(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  admin: Keypair,
  claimProtocolFeeOperator: PublicKey
): Promise<any> {
  const transaction = await program.methods
    .closeClaimProtocolFeeOperator()
    .accounts({
      claimFeeOperator: claimProtocolFeeOperator,
      rentReceiver: admin.publicKey,
      signer: admin.publicKey,
    })
    .transaction();

  const claimFeeOperatorState = getClaimFeeOperator(
    svm,
    program,
    claimProtocolFeeOperator
  );
  expect(claimFeeOperatorState).to.be.null;

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
      claimFeeOperator,
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
  const claimFeeOperator = deriveClaimFeeOperatorAddress(operator.publicKey);
  const quoteMintInfo = getTokenAccount(svm, poolState.quoteVault);

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
      claimFeeOperator,
      signer: operator.publicKey,
      tokenBaseProgram,
      tokenQuoteProgram,
    })
    .preInstructions(preInstructions)
    .transaction();

  sendTransactionMaybeThrow(svm, transaction, [operator]);

}

