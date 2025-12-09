import { SYSTEM_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/native/system";
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

export async function claimLegacyPoolCreationFee(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: ClaimLegacyPoolCreationFeeParams
) {
  const { operator, pool } = params;

  const claimFeeOperator = deriveClaimFeeOperatorAddress(operator.publicKey);

  const transaction = await program.methods
    .claimLegacyPoolCreationFee()
    .accountsPartial({
      pool,
      treasury: TREASURY,
      signer: operator.publicKey,
      systemProgram: SYSTEM_PROGRAM_ID,
      claimFeeOperator,
    })
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
  const totalQuoteProtocolFee = poolState.protocolQuoteFee;
  const totalBaseProtocolFee = poolState.protocolBaseFee;
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

  const tokenQuoteAccountState = getTokenAccount(svm, tokenQuoteAccount);
  const preQuoteTokenBalance = tokenQuoteAccountState
    ? tokenQuoteAccountState.amount
    : 0;

  const transaction = await program.methods
    .claimProtocolFee()
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

  //
  const quoteTokenBalance = getTokenAccount(svm, tokenQuoteAccount).amount;
  const baseTokenBalance = getTokenAccount(svm, tokenBaseAccount).amount;
  expect(
    (Number(quoteTokenBalance) - Number(preQuoteTokenBalance)).toString()
  ).eq(totalQuoteProtocolFee.toString());
  expect(Number(baseTokenBalance).toString()).eq(
    totalBaseProtocolFee.toString()
  );
}

export type ProtocolWithdrawSurplusParams = {
  operator: Keypair;
  virtualPool: PublicKey;
};
export async function protocolWithdrawSurplus(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: ProtocolWithdrawSurplusParams
): Promise<any> {
  const { operator, virtualPool } = params;

  const claimFeeOperator = deriveClaimFeeOperatorAddress(operator.publicKey);
  const poolState = getVirtualPool(svm, program, virtualPool);
  const poolAuthority = derivePoolAuthority();
  const quoteMintInfo = getTokenAccount(svm, poolState.quoteVault);

  const preInstructions: TransactionInstruction[] = [];
  const { ata: tokenQuoteAccount, ix: createQuoteTokenAccountIx } =
    getOrCreateAssociatedTokenAccount(
      svm,
      operator,
      quoteMintInfo.mint,
      TREASURY,
      TOKEN_PROGRAM_ID
    );
  createQuoteTokenAccountIx && preInstructions.push(createQuoteTokenAccountIx);

  const transaction = await program.methods
    .protocolWithdrawSurplus()
    .accountsPartial({
      poolAuthority,
      config: poolState.config,
      virtualPool,
      quoteVault: poolState.quoteVault,
      quoteMint: quoteMintInfo.mint,
      tokenQuoteAccount,
      claimFeeOperator,
      signer: operator.publicKey,
      tokenQuoteProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions(preInstructions)
    .transaction();

  sendTransactionMaybeThrow(svm, transaction, [operator]);
}
