import {
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { LiteSVM } from "litesvm";
import { SwapMode } from "../../instructions";
import {
  deriveVirtualPoolMetadata,
  getOrCreateAssociatedTokenAccount,
  METAPLEX_PROGRAM_ID,
  sendTransactionMaybeThrow,
  unwrapSOLInstruction,
  wrapSOLInstruction,
} from "../../utils";
import {
  deriveMetadataAccount,
  derivePoolAddress,
  derivePoolAuthority,
  deriveTokenVaultAddress,
} from "../../utils/accounts";
import { getConfig, getVirtualPool } from "../../utils/fetcher";
import { VirtualCurveProgram } from "../../utils/types";
import { deriveEventAuthority, readIxData } from "../utils";

export type CreatePoolSplTokenParams = {
  payer: Keypair;
  poolCreator: Keypair;
  quoteMint: PublicKey;
  config: PublicKey;
};
export type CreatePoolToken2022Params = CreatePoolSplTokenParams;

export async function createPoolWithSplToken(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: CreatePoolSplTokenParams
): Promise<PublicKey> {
  const { payer, quoteMint, poolCreator, config } = params;
  const configState = getConfig(svm, program, config);

  const poolAuthority = derivePoolAuthority();
  const baseMintKP = Keypair.generate();
  const pool = derivePoolAddress(config, baseMintKP.publicKey, quoteMint);
  const baseVault = deriveTokenVaultAddress(baseMintKP.publicKey, pool);
  const quoteVault = deriveTokenVaultAddress(quoteMint, pool);
  const mintMetadata = deriveMetadataAccount(baseMintKP.publicKey);

  const tokenProgram =
    configState.tokenType === 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  const eventAuthority = deriveEventAuthority(program);

  const ix = new TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: poolAuthority, isSigner: false, isWritable: true },
      { pubkey: poolCreator.publicKey, isSigner: true, isWritable: false },
      { pubkey: baseMintKP.publicKey, isSigner: true, isWritable: true },
      { pubkey: quoteMint, isSigner: false, isWritable: false },
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: baseVault, isSigner: false, isWritable: true },
      { pubkey: quoteVault, isSigner: false, isWritable: true },
      { pubkey: mintMetadata, isSigner: false, isWritable: true },
      { pubkey: METAPLEX_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: program.programId, isSigner: false, isWritable: false },
    ],
    data: await readIxData("initializeVirtualPoolWithSplToken"),
  });

  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 400_000,
  });

  const tx = new Transaction().add(computeBudgetIx, ix);
  sendTransactionMaybeThrow(svm, tx, [payer, baseMintKP, poolCreator]);

  return pool;
}

export async function createPoolWithToken2022(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: CreatePoolToken2022Params
): Promise<PublicKey> {
  const { payer, quoteMint, config, poolCreator } = params;

  const poolAuthority = derivePoolAuthority();
  const baseMintKP = Keypair.generate();
  const pool = derivePoolAddress(config, baseMintKP.publicKey, quoteMint);
  const baseVault = deriveTokenVaultAddress(baseMintKP.publicKey, pool);
  const quoteVault = deriveTokenVaultAddress(quoteMint, pool);
  const eventAuthority = deriveEventAuthority(program);

  const ix = new TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: poolAuthority, isSigner: false, isWritable: true },
      { pubkey: poolCreator.publicKey, isSigner: true, isWritable: false },
      { pubkey: baseMintKP.publicKey, isSigner: true, isWritable: true },
      { pubkey: quoteMint, isSigner: false, isWritable: false },
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: baseVault, isSigner: false, isWritable: true },
      { pubkey: quoteVault, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: program.programId, isSigner: false, isWritable: false },
    ],
    data: await readIxData("initializeVirtualPoolWithToken2022"),
  });

  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 400_000,
  });

  const tx = new Transaction().add(computeBudgetIx, ix);
  sendTransactionMaybeThrow(svm, tx, [payer, baseMintKP, poolCreator]);

  return pool;
}

export type Swap2Params = {
  config: PublicKey;
  payer: Keypair;
  pool: PublicKey;
  inputTokenMint: PublicKey;
  outputTokenMint: PublicKey;
  swapMode: SwapMode;
  referralTokenAccount: PublicKey | null;
};

export async function swap2(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: Swap2Params
): Promise<{
  pool: PublicKey;
  computeUnitsConsumed: number;
  message: string[];
  numInstructions: number;
  completed: boolean;
}> {
  const {
    config,
    payer,
    pool,
    inputTokenMint,
    outputTokenMint,
    referralTokenAccount,
  } = params;

  const poolAuthority = derivePoolAuthority();
  let poolState = getVirtualPool(svm, program, pool);
  const configState = getConfig(svm, program, config);

  const tokenBaseProgram =
    configState.tokenType === 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
  const isInputBase = inputTokenMint.equals(poolState.baseMint);
  const quoteMint = isInputBase ? outputTokenMint : inputTokenMint;
  const [inputProgram, outputProgram] = isInputBase
    ? [tokenBaseProgram, TOKEN_PROGRAM_ID]
    : [TOKEN_PROGRAM_ID, tokenBaseProgram];

  const preInstructions: TransactionInstruction[] = [];
  const postInstructions: TransactionInstruction[] = [];

  const [
    { ata: inputTokenAccount, ix: createInIx },
    { ata: outputTokenAccount, ix: createOutIx },
  ] = [
    getOrCreateAssociatedTokenAccount(
      svm,
      payer,
      inputTokenMint,
      payer.publicKey,
      inputProgram
    ),
    getOrCreateAssociatedTokenAccount(
      svm,
      payer,
      outputTokenMint,
      payer.publicKey,
      outputProgram
    ),
  ];
  createInIx && preInstructions.push(createInIx);
  createOutIx && preInstructions.push(createOutIx);

  if (inputTokenMint.equals(NATIVE_MINT)) {
    const wrapSOLIx = wrapSOLInstruction(
      payer.publicKey,
      inputTokenAccount,
      BigInt((6e9).toString())
    );

    preInstructions.push(...wrapSOLIx);
  }

  if (outputTokenMint.equals(NATIVE_MINT)) {
    const unwrapIx = unwrapSOLInstruction(payer.publicKey);
    unwrapIx && postInstructions.push(unwrapIx);
  }

  const eventAuthority = deriveEventAuthority(program);

  const ix = new TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: poolAuthority, isSigner: false, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: inputTokenAccount, isSigner: false, isWritable: true },
      { pubkey: outputTokenAccount, isSigner: false, isWritable: true },
      { pubkey: poolState.baseVault, isSigner: false, isWritable: true },
      { pubkey: poolState.quoteVault, isSigner: false, isWritable: true },
      { pubkey: poolState.baseMint, isSigner: false, isWritable: false },
      { pubkey: quoteMint, isSigner: false, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      { pubkey: tokenBaseProgram, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      referralTokenAccount
        ? { pubkey: referralTokenAccount, isSigner: false, isWritable: false }
        : // For an optional account, the program's id means None
          // https://github.com/coral-xyz/anchor/blob/2b0f3a7c999771f40e240b3ce421895ce6b066cf/lang/src/accounts/option.rs#L44-L48
          { pubkey: program.programId, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: program.programId, isSigner: false, isWritable: false },
    ],
    data: await readIxData("swap2"),
  });

  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 400_000,
  });

  const tx = new Transaction().add(
    computeBudgetIx,
    ...preInstructions,
    ix,
    ...postInstructions
  );
  tx.recentBlockhash = svm.latestBlockhash();
  tx.sign(payer);

  const simulation = svm.simulateTransaction(tx);
  const computeUnitsConsumed = Number(simulation.meta().computeUnitsConsumed);
  svm.sendTransaction(tx);

  poolState = getVirtualPool(svm, program, pool);
  const updatedConfig = getConfig(svm, program, config);

  return {
    pool,
    computeUnitsConsumed,
    message: simulation.meta().logs(),
    numInstructions: tx.instructions.length,
    completed:
      Number(poolState.quoteReserve) >=
      Number(updatedConfig.migrationQuoteThreshold),
  };
}

export type CreateVirtualPoolMetadataParams = {
  virtualPool: PublicKey;
  creator: Keypair;
  payer: Keypair;
};

export async function createVirtualPoolMetadata(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: CreateVirtualPoolMetadataParams
): Promise<void> {
  const { virtualPool, creator, payer } = params;
  const virtualPoolMetadata = deriveVirtualPoolMetadata(virtualPool);
  const eventAuthority = deriveEventAuthority(program);

  const ix = new TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: virtualPool, isSigner: false, isWritable: true },
      { pubkey: virtualPoolMetadata, isSigner: false, isWritable: true },
      { pubkey: creator.publicKey, isSigner: true, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: program.programId, isSigner: false, isWritable: false },
    ],
    data: await readIxData("createVirtualPoolMetadata"),
  });

  const tx = new Transaction().add(ix);
  sendTransactionMaybeThrow(svm, tx, [payer, creator]);
}
