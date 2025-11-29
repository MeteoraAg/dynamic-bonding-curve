import { BN } from "@coral-xyz/anchor";
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
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  deriveVirtualPoolMetadata,
  getOrCreateAssociatedTokenAccount,
  getTokenAccount,
  METAPLEX_PROGRAM_ID,
  sendTransactionMaybeThrow,
  unwrapSOLInstruction,
  wrapSOLInstruction,
} from "../utils";
import {
  deriveMetadataAccount,
  derivePoolAddress,
  derivePoolAuthority,
  deriveTokenVaultAddress,
} from "../utils/accounts";
import {
  getConfig,
  getVirtualPool,
  getVirtualPoolMetadata,
} from "../utils/fetcher";
import { VirtualCurveProgram } from "../utils/types";

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
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: CreatePoolSplTokenParams
): Promise<PublicKey> {
  const { payer, quoteMint, poolCreator, config, instructionParams } = params;
  const configState = getConfig(svm, program, config);

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
  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.sign(payer, baseMintKP, poolCreator);
  sendTransactionMaybeThrow(svm, transaction);

  return pool;
}

export async function createPoolWithToken2022(
  svm: LiteSVM,
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

  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.sign(payer, baseMintKP, poolCreator);
  sendTransactionMaybeThrow(svm, transaction);

  return pool;
}

export enum SwapMode {
  ExactIn,
  PartialFill,
  ExactOut,
}

export type SwapParams = {
  config: PublicKey;
  payer: Keypair;
  pool: PublicKey;
  inputTokenMint: PublicKey;
  outputTokenMint: PublicKey;
  amountIn: BN;
  minimumAmountOut: BN;
  swapMode: SwapMode;
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
  svm: LiteSVM,
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
  let poolState = getVirtualPool(svm, program, pool);

  const configState = getConfig(svm, program, config);

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
  const preBaseVaultBalance = getTokenAccount(svm, poolState.baseVault).amount;
  const [
    { ata: inputTokenAccount, ix: createInputTokenXIx },
    { ata: outputTokenAccount, ix: createOutputTokenYIx },
  ] = [
    getOrCreateAssociatedTokenAccount(
      svm,
      payer,
      inputTokenMint,
      payer.publicKey,
      inputTokenProgram
    ),
    getOrCreateAssociatedTokenAccount(
      svm,
      payer,
      outputTokenMint,
      payer.publicKey,
      outputTokenProgram
    ),
  ];
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

  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.sign(payer);

  let simu = svm.simulateTransaction(transaction);
  const consumedCUSwap = Number(simu.meta().computeUnitsConsumed);
  sendTransactionMaybeThrow(svm, transaction);

  poolState = getVirtualPool(svm, program, pool);
  const configs = getConfig(svm, program, config);
  return {
    pool,
    computeUnitsConsumed: consumedCUSwap,
    message: simu.meta().logs[0],
    numInstructions: transaction.instructions.length,
    completed:
      Number(poolState.quoteReserve) >= Number(configs.migrationQuoteThreshold),
  };
}

export async function swap(
  svm: LiteSVM,
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
    swapMode,
    referralTokenAccount,
  } = params;

  const poolAuthority = derivePoolAuthority();
  let poolState = getVirtualPool(svm, program, pool);

  const configState = getConfig(svm, program, config);

  const tokenBaseProgram =
    configState.tokenType == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  const isInputBaseMint = inputTokenMint.equals(poolState.baseMint);

  const quoteMint = isInputBaseMint ? outputTokenMint : inputTokenMint;
  const [inputTokenProgram, outputTokenProgram] = isInputBaseMint
    ? [tokenBaseProgram, TOKEN_PROGRAM_ID]
    : [TOKEN_PROGRAM_ID, tokenBaseProgram];

  const preInstructions: TransactionInstruction[] = [];
  const postInstructions: TransactionInstruction[] = [];

  const [
    { ata: inputTokenAccount, ix: createInputTokenXIx },
    { ata: outputTokenAccount, ix: createOutputTokenYIx },
  ] = [
    getOrCreateAssociatedTokenAccount(
      svm,
      payer,
      inputTokenMint,
      payer.publicKey,
      inputTokenProgram
    ),
    getOrCreateAssociatedTokenAccount(
      svm,
      payer,
      outputTokenMint,
      payer.publicKey,
      outputTokenProgram
    ),
  ];
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

  console.log("base vault balance: ", svm.getAccount(poolState.quoteVault));

  const transaction = await program.methods
    .swap2({ amount0: amountIn, amount1: minimumAmountOut, swapMode: swapMode })
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

  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.sign(payer);

  let simu = svm.simulateTransaction(transaction);
  const consumedCUSwap = Number(simu.meta().computeUnitsConsumed);
  sendTransactionMaybeThrow(svm, transaction);

  poolState = getVirtualPool(svm, program, pool);
  const configs = getConfig(svm, program, config);
  return {
    pool,
    computeUnitsConsumed: consumedCUSwap,
    message: simu.meta().logs()[0],
    numInstructions: transaction.instructions.length,
    completed:
      Number(poolState.quoteReserve) >= Number(configs.migrationQuoteThreshold),
  };
}

export async function getSwap2Instruction(
  svm: LiteSVM,
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
  let poolState = getVirtualPool(svm, program, pool);

  const configState = getConfig(svm, program, config);

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
  ] = [
    getOrCreateAssociatedTokenAccount(
      svm,
      payer,
      inputTokenMint,
      payer.publicKey,
      inputTokenProgram
    ),
    getOrCreateAssociatedTokenAccount(
      svm,
      payer,
      outputTokenMint,
      payer.publicKey,
      outputTokenProgram
    ),
  ];

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

export async function getSwapInstruction(
  svm: LiteSVM,
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
  let poolState = getVirtualPool(svm, program, pool);

  const configState = getConfig(svm, program, config);

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
  ] = [
    getOrCreateAssociatedTokenAccount(
      svm,
      payer,
      inputTokenMint,
      payer.publicKey,
      inputTokenProgram
    ),
    getOrCreateAssociatedTokenAccount(
      svm,
      payer,
      outputTokenMint,
      payer.publicKey,
      outputTokenProgram
    ),
  ];

  const instruction = await program.methods
    .swap({
      amountIn,
      minimumAmountOut,
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
  svm: LiteSVM,
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
  let poolState = getVirtualPool(svm, program, pool);

  const configState = getConfig(svm, program, config);

  const tokenBaseProgram =
    configState.tokenType == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  const isInputBaseMint = inputTokenMint.equals(poolState.baseMint);

  const quoteMint = isInputBaseMint ? outputTokenMint : inputTokenMint;
  const [inputTokenProgram, outputTokenProgram] = isInputBaseMint
    ? [tokenBaseProgram, TOKEN_PROGRAM_ID]
    : [TOKEN_PROGRAM_ID, tokenBaseProgram];

  const preInstructions: TransactionInstruction[] = [];
  const postInstructions: TransactionInstruction[] = [];

  const [
    { ata: inputTokenAccount, ix: createInputTokenXIx },
    { ata: outputTokenAccount, ix: createOutputTokenYIx },
  ] = [
    getOrCreateAssociatedTokenAccount(
      svm,
      payer,
      inputTokenMint,
      payer.publicKey,
      inputTokenProgram
    ),
    getOrCreateAssociatedTokenAccount(
      svm,
      payer,
      outputTokenMint,
      payer.publicKey,
      outputTokenProgram
    ),
  ];
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

  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.sign(payer);

  let simu = svm.simulateTransaction(transaction);
  const consumedCUSwap = Number(simu.meta().computeUnitsConsumed);
  sendTransactionMaybeThrow(svm, transaction);

  poolState = getVirtualPool(svm, program, pool);
  const configs = getConfig(svm, program, config);
  return {
    pool,
    computeUnitsConsumed: consumedCUSwap,
    message: simu.meta().logs()[0],
    numInstructions: transaction.instructions.length,
    completed:
      Number(poolState.quoteReserve) >= Number(configs.migrationQuoteThreshold),
  };
}

export async function swapSimulate(
  svm: LiteSVM,
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
  let poolState = getVirtualPool(svm, program, pool);

  const configState = getConfig(svm, program, config);

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
  ] = [
    getOrCreateAssociatedTokenAccount(
      svm,
      payer,
      inputTokenMint,
      payer.publicKey,
      inputTokenProgram
    ),
    getOrCreateAssociatedTokenAccount(
      svm,
      payer,
      outputTokenMint,
      payer.publicKey,
      outputTokenProgram
    ),
  ];
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
  wrapSolTx.recentBlockhash = svm.latestBlockhash();
  wrapSolTx.sign(payer);

  sendTransactionMaybeThrow(svm, wrapSolTx);

  const transaction = await program.methods
    .swap2({
      amount0: amountIn,
      amount1: minimumAmountOut,
      swapMode: SwapMode.PartialFill,
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
    .transaction();

  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.sign(payer);

  let simu = svm.simulateTransaction(transaction);
  const consumedCUSwap = Number(simu.meta().computeUnitsConsumed);
  sendTransactionMaybeThrow(svm, transaction);

  poolState = getVirtualPool(svm, program, pool);
  const configs = getConfig(svm, program, config);
  return {
    pool,
    computeUnitsConsumed: consumedCUSwap,
    message: simu.meta().logs()[0],
    numInstructions: transaction.instructions.length,
    completed:
      Number(poolState.quoteReserve) >= Number(configs.migrationQuoteThreshold),
  };
}

export async function createVirtualPoolMetadata(
  svm: LiteSVM,
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

  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.sign(payer, creator);
  sendTransactionMaybeThrow(svm, transaction);
  //
  const metadataState = getVirtualPoolMetadata(
    svm,
    program,
    virtualPoolMetadata
  );
  expect(metadataState.virtualPool.toString()).equal(virtualPool.toString());
  expect(metadataState.name.toString()).equal(name.toString());
  expect(metadataState.website.toString()).equal(website.toString());
  expect(metadataState.logo.toString()).equal(logo.toString());
}
