import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { BanksClient } from "solana-bankrun";
import {
  deriveClaimFeeOperatorAddress,
  deriveMigrationMetadataAddress,
  derivePoolAuthority,
} from "../utils/accounts";
import { VirtualCurveProgram } from "../utils/types";
import {
  getOrCreateAssociatedTokenAccount,
  getVirtualPool,
  getTokenAccount,
  processTransactionMaybeThrow,
  TREASURY,
  getClaimFeeOperator,
  getConfig,
} from "../utils";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";
import { SYSTEM_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/native/system";

export type CreateClaimfeeOperatorParams = {
  admin: Keypair;
  operator: PublicKey;
};

export async function createClaimFeeOperator(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  params: CreateClaimfeeOperatorParams
): Promise<PublicKey> {
  const { operator, admin } = params;
  const claimFeeOperator = deriveClaimFeeOperatorAddress(operator);
  const transaction = await program.methods
    .createClaimFeeOperator()
    .accountsPartial({
      claimFeeOperator,
      operator,
      admin: admin.publicKey,
    })
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(admin);

  await processTransactionMaybeThrow(banksClient, transaction);

  const claimFeeOperatorState = await getClaimFeeOperator(
    banksClient,
    program,
    claimFeeOperator
  );
  expect(claimFeeOperatorState.operator.toString()).eq(operator.toString());

  return claimFeeOperator;
}

export async function closeClaimFeeOperator(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  admin: Keypair,
  claimFeeOperator: PublicKey
): Promise<any> {
  const transaction = await program.methods
    .closeClaimFeeOperator()
    .accounts({
      claimFeeOperator,
      rentReceiver: admin.publicKey,
      admin: admin.publicKey,
    })
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(admin);

  const claimFeeOperatorState = await getClaimFeeOperator(
    banksClient,
    program,
    claimFeeOperator
  );
  expect(claimFeeOperatorState).to.be.null;

  await processTransactionMaybeThrow(banksClient, transaction);
}

export type ClaimPoolCreationFeeParams = {
  operator: Keypair;
  pool: PublicKey;
};

export async function claimPoolCreationFee(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  params: ClaimPoolCreationFeeParams
) {
  const { operator, pool } = params;

  const claimFeeOperator = deriveClaimFeeOperatorAddress(operator.publicKey);

  const transaction = await program.methods
    .claimPoolCreationFee()
    .accountsPartial({
      pool,
      treasury: TREASURY,
      operator: operator.publicKey,
      systemProgram: SYSTEM_PROGRAM_ID,
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

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(operator);

  await processTransactionMaybeThrow(banksClient, transaction);
}

export type ClaimProtocolFeeParams = {
  operator: Keypair;
  pool: PublicKey;
};

export async function claimProtocolFee(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  params: ClaimProtocolFeeParams
): Promise<any> {
  const { operator, pool } = params;
  const poolState = await getVirtualPool(banksClient, program, pool);
  const configState = await getConfig(banksClient, program, poolState.config);
  const totalQuoteProtocolFee = poolState.protocolQuoteFee;
  const totalBaseProtocolFee = poolState.protocolBaseFee;
  const poolAuthority = derivePoolAuthority();
  const claimFeeOperator = deriveClaimFeeOperatorAddress(operator.publicKey);
  const quoteMintInfo = await getTokenAccount(
    banksClient,
    poolState.quoteVault
  );

  const tokenBaseProgram =
    configState.tokenType == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  const tokenQuoteProgram =
    configState.quoteTokenFlag == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  const preInstructions: TransactionInstruction[] = [];
  const [
    { ata: tokenBaseAccount, ix: createBaseTokenAccountIx },
    { ata: tokenQuoteAccount, ix: createQuoteTokenAccountIx },
  ] = await Promise.all([
    getOrCreateAssociatedTokenAccount(
      banksClient,
      operator,
      poolState.baseMint,
      TREASURY,
      tokenBaseProgram
    ),
    getOrCreateAssociatedTokenAccount(
      banksClient,
      operator,
      quoteMintInfo.mint,
      TREASURY,
      tokenQuoteProgram
    ),
  ]);
  createBaseTokenAccountIx && preInstructions.push(createBaseTokenAccountIx);
  createQuoteTokenAccountIx && preInstructions.push(createQuoteTokenAccountIx);

  const tokenQuoteAccountState = await getTokenAccount(
    banksClient,
    tokenQuoteAccount
  );
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
      operator: operator.publicKey,
      tokenBaseProgram,
      tokenQuoteProgram,
    })
    .preInstructions(preInstructions)
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(operator);
  await processTransactionMaybeThrow(banksClient, transaction);

  //
  const quoteTokenBalance = (
    await getTokenAccount(banksClient, tokenQuoteAccount)
  ).amount;
  const baseTokenBalance = (
    await getTokenAccount(banksClient, tokenBaseAccount)
  ).amount;
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
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  params: ProtocolWithdrawSurplusParams
): Promise<any> {
  const { operator, virtualPool } = params;
  const poolState = await getVirtualPool(banksClient, program, virtualPool);
  const poolAuthority = derivePoolAuthority();
  const quoteMintInfo = await getTokenAccount(
    banksClient,
    poolState.quoteVault
  );

  const preInstructions: TransactionInstruction[] = [];
  const { ata: tokenQuoteAccount, ix: createQuoteTokenAccountIx } =
    await getOrCreateAssociatedTokenAccount(
      banksClient,
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
      tokenQuoteProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions(preInstructions)
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(operator);
  await processTransactionMaybeThrow(banksClient, transaction);
}
