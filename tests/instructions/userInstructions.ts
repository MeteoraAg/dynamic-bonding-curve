import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  deriveMetadataAccount,
  derivePoolAddress,
  derivePoolAuthority,
  deriveTokenVaultAddress,
} from "../utils/accounts";
import { VirtualCurveProgram } from "../utils/types";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { BN, Instruction } from "@coral-xyz/anchor";
import { BanksClient } from "solana-bankrun";
import {
  createVaultIfNotExists,
  createVaultProgram,
  DAMM_PROGRAM_ID,
  deriveDammPoolAddress,
  deriveLpMintAddress,
  deriveProtocolFeeAddress,
  deriveVaultLPAddress,
  deriveVirtualPoolMetadata,
  getVaultPdas,
  METAPLEX_PROGRAM_ID,
  processTransactionMaybeThrow,
  VAULT_PROGRAM_ID,
} from "../utils";
import {
  getConfig,
  getVirtualPool,
  getVirtualPoolMetadata,
} from "../utils/fetcher";
import {
  getOrCreateAssociatedTokenAccount,
  getTokenAccount,
  unwrapSOLInstruction,
  wrapSOLInstruction,
} from "../utils";
import { expect } from "chai";

export type InitializePoolParameters = {
  name: string;
  symbol: string;
  uri: string;
};
export type CreatePoolSplTokenParams = {
  payer: Keypair;
  poolCreator: Keypair;
  quoteMint: PublicKey;
  config: PublicKey;
  instructionParams: InitializePoolParameters;
};

export type CreatePoolToken2022Params = CreatePoolSplTokenParams;

export async function createPoolWithSplToken(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  params: CreatePoolSplTokenParams
): Promise<PublicKey> {
  const { payer, quoteMint, poolCreator, config, instructionParams } = params;
  const configState = await getConfig(banksClient, program, config);

  const poolAuthority = derivePoolAuthority();
  const baseMintKP = Keypair.generate();
  const pool = derivePoolAddress(config, baseMintKP.publicKey, quoteMint);
  const baseVault = deriveTokenVaultAddress(baseMintKP.publicKey, pool);
  const quoteVault = deriveTokenVaultAddress(quoteMint, pool);

  const mintMetadata = deriveMetadataAccount(baseMintKP.publicKey);

  const tokenProgram =
    configState.tokenType == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
  const transaction = await program.methods
    .initializeVirtualPoolWithSplToken(instructionParams)
    .accountsPartial({
      config,
      baseMint: baseMintKP.publicKey,
      quoteMint,
      pool,
      payer: payer.publicKey,
      creator: poolCreator.publicKey,
      poolAuthority,
      baseVault,
      quoteVault,
      mintMetadata,
      metadataProgram: METAPLEX_PROGRAM_ID,
      tokenQuoteProgram: TOKEN_PROGRAM_ID,
      tokenProgram,
    })
    .transaction();
  transaction.add(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: 400_000,
    })
  );
  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(payer, baseMintKP, poolCreator);

  await processTransactionMaybeThrow(banksClient, transaction);

  return pool;
}

export async function createPoolWithToken2022(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  params: CreatePoolToken2022Params
): Promise<PublicKey> {
  const { payer, quoteMint, config, instructionParams, poolCreator } = params;

  const poolAuthority = derivePoolAuthority();
  const baseMintKP = Keypair.generate();
  const pool = derivePoolAddress(config, baseMintKP.publicKey, quoteMint);
  const baseVault = deriveTokenVaultAddress(baseMintKP.publicKey, pool);
  const quoteVault = deriveTokenVaultAddress(quoteMint, pool);
  const transaction = await program.methods
    .initializeVirtualPoolWithToken2022(instructionParams)
    .accountsPartial({
      config,
      baseMint: baseMintKP.publicKey,
      quoteMint,
      pool,
      payer: payer.publicKey,
      creator: poolCreator.publicKey,
      poolAuthority,
      baseVault,
      quoteVault,
      tokenQuoteProgram: TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .transaction();

  transaction.add(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: 400_000,
    })
  );

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(payer, baseMintKP, poolCreator);

  await processTransactionMaybeThrow(banksClient, transaction);

  return pool;
}

export type SwapParams = {
  config: PublicKey;
  payer: Keypair;
  pool: PublicKey;
  inputTokenMint: PublicKey;
  outputTokenMint: PublicKey;
  amountIn: BN;
  minimumAmountOut: BN;
  referralTokenAccount: PublicKey | null;
};

export type SwapParams2 = {
  config: PublicKey;
  payer: Keypair;
  pool: PublicKey;
  inputTokenMint: PublicKey;
  outputTokenMint: PublicKey;
  amount0: BN;
  amount1: BN;
  swapMode: number;
  referralTokenAccount: PublicKey | null;
};

export async function swapPartialFill(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  params: SwapParams
): Promise<{
  pool: PublicKey;
  computeUnitsConsumed: number;
  message: any;
  numInstructions: number;
  completed: boolean;
}> {
  const {
    config,
    payer,
    pool,
    inputTokenMint,
    outputTokenMint,
    amountIn,
    minimumAmountOut,
    referralTokenAccount,
  } = params;

  const poolAuthority = derivePoolAuthority();
  let poolState = await getVirtualPool(banksClient, program, pool);

  const configState = await getConfig(banksClient, program, config);

  const tokenBaseProgram =
    configState.tokenType == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  const isInputBaseMint = inputTokenMint.equals(poolState.baseMint);

  const quoteMint = isInputBaseMint ? outputTokenMint : inputTokenMint;
  const [inputTokenProgram, outputTokenProgram] = isInputBaseMint
    ? [tokenBaseProgram, TOKEN_PROGRAM_ID]
    : [TOKEN_PROGRAM_ID, tokenBaseProgram];

  const preInstructions: TransactionInstruction[] = [];
  const postInstructions: TransactionInstruction[] = [];

  const preUserQuoteTokenBalance = 0;
  const preBaseVaultBalance = (
    await getTokenAccount(banksClient, poolState.baseVault)
  ).amount;
  const [
    { ata: inputTokenAccount, ix: createInputTokenXIx },
    { ata: outputTokenAccount, ix: createOutputTokenYIx },
  ] = await Promise.all([
    getOrCreateAssociatedTokenAccount(
      banksClient,
      payer,
      inputTokenMint,
      payer.publicKey,
      inputTokenProgram
    ),
    getOrCreateAssociatedTokenAccount(
      banksClient,
      payer,
      outputTokenMint,
      payer.publicKey,
      outputTokenProgram
    ),
  ]);
  createInputTokenXIx && preInstructions.push(createInputTokenXIx);
  createOutputTokenYIx && preInstructions.push(createOutputTokenYIx);

  if (inputTokenMint.equals(NATIVE_MINT) && !amountIn.isZero()) {
    const wrapSOLIx = wrapSOLInstruction(
      payer.publicKey,
      inputTokenAccount,
      BigInt(amountIn.toString())
    );

    preInstructions.push(...wrapSOLIx);
  }

  if (outputTokenMint.equals(NATIVE_MINT)) {
    const unrapSOLIx = unwrapSOLInstruction(payer.publicKey);

    unrapSOLIx && postInstructions.push(unrapSOLIx);
  }

  const transaction = await program.methods
    .swap2({
      amount0: amountIn,
      amount1: minimumAmountOut,
      swapMode: 1,
    })
    .accountsPartial({
      poolAuthority,
      config,
      pool,
      inputTokenAccount,
      outputTokenAccount,
      baseVault: poolState.baseVault,
      quoteVault: poolState.quoteVault,
      baseMint: poolState.baseMint,
      quoteMint,
      payer: payer.publicKey,
      tokenBaseProgram,
      tokenQuoteProgram: TOKEN_PROGRAM_ID,
      referralTokenAccount,
    })
    .remainingAccounts(
      // TODO should check condition to add this in remaning accounts
      [
        {
          isSigner: false,
          isWritable: false,
          pubkey: SYSVAR_INSTRUCTIONS_PUBKEY,
        },
      ]
    )
    .preInstructions(preInstructions)
    .postInstructions(postInstructions)
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(payer);

  let simu = await banksClient.simulateTransaction(transaction);
  const consumedCUSwap = Number(simu.meta.computeUnitsConsumed);

  await processTransactionMaybeThrow(banksClient, transaction);

  poolState = await getVirtualPool(banksClient, program, pool);
  const configs = await getConfig(banksClient, program, config);
  return {
    pool,
    computeUnitsConsumed: consumedCUSwap,
    message: simu.meta.logMessages,
    numInstructions: transaction.instructions.length,
    completed:
      Number(poolState.quoteReserve) >= Number(configs.migrationQuoteThreshold),
  };
}

export async function swap(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  params: SwapParams
): Promise<{
  pool: PublicKey;
  computeUnitsConsumed: number;
  message: any;
  numInstructions: number;
  completed: boolean;
}> {
  const {
    config,
    payer,
    pool,
    inputTokenMint,
    outputTokenMint,
    amountIn,
    minimumAmountOut,
    referralTokenAccount,
  } = params;

  const poolAuthority = derivePoolAuthority();
  let poolState = await getVirtualPool(banksClient, program, pool);

  const configState = await getConfig(banksClient, program, config);

  const tokenBaseProgram =
    configState.tokenType == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  const isInputBaseMint = inputTokenMint.equals(poolState.baseMint);

  const quoteMint = isInputBaseMint ? outputTokenMint : inputTokenMint;
  const [inputTokenProgram, outputTokenProgram] = isInputBaseMint
    ? [tokenBaseProgram, TOKEN_PROGRAM_ID]
    : [TOKEN_PROGRAM_ID, tokenBaseProgram];

  const preInstructions: TransactionInstruction[] = [];
  const postInstructions: TransactionInstruction[] = [];

  const preUserQuoteTokenBalance = 0;
  const preBaseVaultBalance = (
    await getTokenAccount(banksClient, poolState.baseVault)
  ).amount;
  const [
    { ata: inputTokenAccount, ix: createInputTokenXIx },
    { ata: outputTokenAccount, ix: createOutputTokenYIx },
  ] = await Promise.all([
    getOrCreateAssociatedTokenAccount(
      banksClient,
      payer,
      inputTokenMint,
      payer.publicKey,
      inputTokenProgram
    ),
    getOrCreateAssociatedTokenAccount(
      banksClient,
      payer,
      outputTokenMint,
      payer.publicKey,
      outputTokenProgram
    ),
  ]);
  createInputTokenXIx && preInstructions.push(createInputTokenXIx);
  createOutputTokenYIx && preInstructions.push(createOutputTokenYIx);

  if (inputTokenMint.equals(NATIVE_MINT) && !amountIn.isZero()) {
    const wrapSOLIx = wrapSOLInstruction(
      payer.publicKey,
      inputTokenAccount,
      BigInt(amountIn.toString())
    );

    preInstructions.push(...wrapSOLIx);
  }

  if (outputTokenMint.equals(NATIVE_MINT)) {
    const unrapSOLIx = unwrapSOLInstruction(payer.publicKey);

    unrapSOLIx && postInstructions.push(unrapSOLIx);
  }

  const transaction = await program.methods
    .swap({ amountIn, minimumAmountOut })
    .accountsPartial({
      poolAuthority,
      config,
      pool,
      inputTokenAccount,
      outputTokenAccount,
      baseVault: poolState.baseVault,
      quoteVault: poolState.quoteVault,
      baseMint: poolState.baseMint,
      quoteMint,
      payer: payer.publicKey,
      tokenBaseProgram,
      tokenQuoteProgram: TOKEN_PROGRAM_ID,
      referralTokenAccount,
    })
    .remainingAccounts(
      // TODO should check condition to add this in remaning accounts
      [
        {
          isSigner: false,
          isWritable: false,
          pubkey: SYSVAR_INSTRUCTIONS_PUBKEY,
        },
      ]
    )
    .preInstructions(preInstructions)
    .postInstructions(postInstructions)
    .transaction();

  transaction.add(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: 400_000,
    })
  );

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(payer);

  let simu = await banksClient.simulateTransaction(transaction);
  const consumedCUSwap = Number(simu.meta.computeUnitsConsumed);

  await processTransactionMaybeThrow(banksClient, transaction);

  poolState = await getVirtualPool(banksClient, program, pool);
  const configs = await getConfig(banksClient, program, config);
  return {
    pool,
    computeUnitsConsumed: consumedCUSwap,
    message: simu.meta.logMessages,
    numInstructions: transaction.instructions.length,
    completed:
      Number(poolState.quoteReserve) >= Number(configs.migrationQuoteThreshold),
  };
}

export async function getSwapInstruction(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  params: SwapParams
): Promise<TransactionInstruction> {
  const {
    config,
    payer,
    pool,
    inputTokenMint,
    outputTokenMint,
    amountIn,
    minimumAmountOut,
    referralTokenAccount,
  } = params;

  const poolAuthority = derivePoolAuthority();
  let poolState = await getVirtualPool(banksClient, program, pool);

  const configState = await getConfig(banksClient, program, config);

  const tokenBaseProgram =
    configState.tokenType == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  const isInputBaseMint = inputTokenMint.equals(poolState.baseMint);

  const quoteMint = isInputBaseMint ? outputTokenMint : inputTokenMint;
  const [inputTokenProgram, outputTokenProgram] = isInputBaseMint
    ? [tokenBaseProgram, TOKEN_PROGRAM_ID]
    : [TOKEN_PROGRAM_ID, tokenBaseProgram];

  const [
    { ata: inputTokenAccount, ix: _createInputTokenXIx },
    { ata: outputTokenAccount, ix: _createOutputTokenYIx },
  ] = await Promise.all([
    getOrCreateAssociatedTokenAccount(
      banksClient,
      payer,
      inputTokenMint,
      payer.publicKey,
      inputTokenProgram
    ),
    getOrCreateAssociatedTokenAccount(
      banksClient,
      payer,
      outputTokenMint,
      payer.publicKey,
      outputTokenProgram
    ),
  ]);

  const instruction = await program.methods
    .swap2({
      amount0: amountIn,
      amount1: minimumAmountOut,
      swapMode: 0,
    })
    .accountsPartial({
      poolAuthority,
      config,
      pool,
      inputTokenAccount,
      outputTokenAccount,
      baseVault: poolState.baseVault,
      quoteVault: poolState.quoteVault,
      baseMint: poolState.baseMint,
      quoteMint,
      payer: payer.publicKey,
      tokenBaseProgram,
      tokenQuoteProgram: TOKEN_PROGRAM_ID,
      referralTokenAccount,
    })
    .remainingAccounts([
      {
        isSigner: false,
        isWritable: false,
        pubkey: SYSVAR_INSTRUCTIONS_PUBKEY,
      },
    ])
    .instruction();

  return instruction;
}

export async function swap2(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  params: SwapParams2
): Promise<{
  pool: PublicKey;
  computeUnitsConsumed: number;
  message: any;
  numInstructions: number;
  completed: boolean;
}> {
  const {
    config,
    payer,
    pool,
    inputTokenMint,
    outputTokenMint,
    amount0: amountIn,
    amount1: minimumAmountOut,
    referralTokenAccount,
    swapMode,
  } = params;

  const poolAuthority = derivePoolAuthority();
  let poolState = await getVirtualPool(banksClient, program, pool);

  const configState = await getConfig(banksClient, program, config);

  const tokenBaseProgram =
    configState.tokenType == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  const isInputBaseMint = inputTokenMint.equals(poolState.baseMint);

  const quoteMint = isInputBaseMint ? outputTokenMint : inputTokenMint;
  const [inputTokenProgram, outputTokenProgram] = isInputBaseMint
    ? [tokenBaseProgram, TOKEN_PROGRAM_ID]
    : [TOKEN_PROGRAM_ID, tokenBaseProgram];

  const preInstructions: TransactionInstruction[] = [];
  const postInstructions: TransactionInstruction[] = [];

  const preUserQuoteTokenBalance = 0;
  const preBaseVaultBalance = (
    await getTokenAccount(banksClient, poolState.baseVault)
  ).amount;
  const [
    { ata: inputTokenAccount, ix: createInputTokenXIx },
    { ata: outputTokenAccount, ix: createOutputTokenYIx },
  ] = await Promise.all([
    getOrCreateAssociatedTokenAccount(
      banksClient,
      payer,
      inputTokenMint,
      payer.publicKey,
      inputTokenProgram
    ),
    getOrCreateAssociatedTokenAccount(
      banksClient,
      payer,
      outputTokenMint,
      payer.publicKey,
      outputTokenProgram
    ),
  ]);
  createInputTokenXIx && preInstructions.push(createInputTokenXIx);
  createOutputTokenYIx && preInstructions.push(createOutputTokenYIx);

  if (inputTokenMint.equals(NATIVE_MINT) && !amountIn.isZero()) {
    const wrapSOLIx = wrapSOLInstruction(
      payer.publicKey,
      inputTokenAccount,
      BigInt(amountIn.toString())
    );

    preInstructions.push(...wrapSOLIx);
  }

  if (outputTokenMint.equals(NATIVE_MINT)) {
    const unrapSOLIx = unwrapSOLInstruction(payer.publicKey);

    unrapSOLIx && postInstructions.push(unrapSOLIx);
  }

  const transaction = await program.methods
    .swap2({
      amount0: amountIn,
      amount1: minimumAmountOut,
      swapMode,
    })
    .accountsPartial({
      poolAuthority,
      config,
      pool,
      inputTokenAccount,
      outputTokenAccount,
      baseVault: poolState.baseVault,
      quoteVault: poolState.quoteVault,
      baseMint: poolState.baseMint,
      quoteMint,
      payer: payer.publicKey,
      tokenBaseProgram,
      tokenQuoteProgram: TOKEN_PROGRAM_ID,
      referralTokenAccount,
    })
    .preInstructions(preInstructions)
    .postInstructions(postInstructions)
    .remainingAccounts([
      {
        pubkey: SYSVAR_INSTRUCTIONS_PUBKEY,
        isSigner: false,
        isWritable: false,
      },
    ])
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(payer);

  let simu = await banksClient.simulateTransaction(transaction);
  const consumedCUSwap = Number(simu.meta.computeUnitsConsumed);

  await processTransactionMaybeThrow(banksClient, transaction);

  poolState = await getVirtualPool(banksClient, program, pool);
  const configs = await getConfig(banksClient, program, config);
  return {
    pool,
    computeUnitsConsumed: consumedCUSwap,
    message: simu.meta.logMessages,
    numInstructions: transaction.instructions.length,
    completed:
      Number(poolState.quoteReserve) >= Number(configs.migrationQuoteThreshold),
  };
}

export async function swapSimulate(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  params: SwapParams
): Promise<{
  pool: PublicKey;
  computeUnitsConsumed: number;
  message: any;
  numInstructions: number;
  completed: boolean;
}> {
  const {
    config,
    payer,
    pool,
    inputTokenMint,
    outputTokenMint,
    amountIn,
    minimumAmountOut,
    referralTokenAccount,
  } = params;

  const poolAuthority = derivePoolAuthority();
  let poolState = await getVirtualPool(banksClient, program, pool);

  const configState = await getConfig(banksClient, program, config);

  const tokenBaseProgram =
    configState.tokenType == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  const isInputBaseMint = inputTokenMint.equals(poolState.baseMint);
  const [inputTokenProgram, outputTokenProgram] = isInputBaseMint
    ? [tokenBaseProgram, TOKEN_PROGRAM_ID]
    : [TOKEN_PROGRAM_ID, tokenBaseProgram];

  const quoteMint = isInputBaseMint ? outputTokenMint : inputTokenMint;

  const [
    { ata: inputTokenAccount, ix: createInputTokenXIx },
    { ata: outputTokenAccount, ix: createOutputTokenYIx },
  ] = await Promise.all([
    getOrCreateAssociatedTokenAccount(
      banksClient,
      payer,
      inputTokenMint,
      payer.publicKey,
      inputTokenProgram
    ),
    getOrCreateAssociatedTokenAccount(
      banksClient,
      payer,
      outputTokenMint,
      payer.publicKey,
      outputTokenProgram
    ),
  ]);
  const wrapSOLIx = wrapSOLInstruction(
    payer.publicKey,
    inputTokenAccount,
    BigInt(amountIn.toString())
  );
  const instructions: TransactionInstruction[] = [];
  createInputTokenXIx && instructions.push(createInputTokenXIx);
  createOutputTokenYIx && instructions.push(createOutputTokenYIx);
  instructions.push(...wrapSOLIx);
  const wrapSolTx = new Transaction().add(...instructions);
  wrapSolTx.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  wrapSolTx.sign(payer);

  await processTransactionMaybeThrow(banksClient, wrapSolTx);

  const transaction = await program.methods
    .swap({ amountIn, minimumAmountOut })
    .accountsPartial({
      poolAuthority,
      config,
      pool,
      inputTokenAccount,
      outputTokenAccount,
      baseVault: poolState.baseVault,
      quoteVault: poolState.quoteVault,
      baseMint: poolState.baseMint,
      quoteMint,
      payer: payer.publicKey,
      tokenBaseProgram,
      tokenQuoteProgram: TOKEN_PROGRAM_ID,
      referralTokenAccount,
    })
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(payer);

  let simu = await banksClient.simulateTransaction(transaction);
  const consumedCUSwap = Number(simu.meta.computeUnitsConsumed);

  await processTransactionMaybeThrow(banksClient, transaction);

  poolState = await getVirtualPool(banksClient, program, pool);
  const configs = await getConfig(banksClient, program, config);
  return {
    pool,
    computeUnitsConsumed: consumedCUSwap,
    message: simu.meta.logMessages,
    numInstructions: transaction.instructions.length,
    completed:
      Number(poolState.quoteReserve) >= Number(configs.migrationQuoteThreshold),
  };
}

export async function createVirtualPoolMetadata(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  params: {
    virtualPool: PublicKey;
    name: string;
    website: string;
    logo: string;
    creator: Keypair;
    payer: Keypair;
  }
) {
  const { virtualPool, creator, payer, name, website, logo } = params;
  const virtualPoolMetadata = deriveVirtualPoolMetadata(virtualPool);
  const transaction = await program.methods
    .createVirtualPoolMetadata({
      padding: new Array(96).fill(0),
      name,
      website,
      logo,
    })
    .accountsPartial({
      virtualPool,
      virtualPoolMetadata,
      creator: creator.publicKey,
      payer: payer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(payer, creator);

  await processTransactionMaybeThrow(banksClient, transaction);
  //
  const metadataState = await getVirtualPoolMetadata(
    banksClient,
    program,
    virtualPoolMetadata
  );
  expect(metadataState.virtualPool.toString()).equal(virtualPool.toString());
  expect(metadataState.name.toString()).equal(name.toString());
  expect(metadataState.website.toString()).equal(website.toString());
  expect(metadataState.logo.toString()).equal(logo.toString());
}
