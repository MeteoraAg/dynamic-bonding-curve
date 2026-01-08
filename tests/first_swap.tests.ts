import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import {
  BaseFee,
  ConfigParameters,
  createConfig,
  CreateConfigParams,
  createInitializePoolWithSplTokenIx,
} from "./instructions";
import {
  createVirtualCurveProgram,
  derivePoolAuthority,
  deriveTokenVaultAddress,
  FEE_DENOMINATOR,
  generateAndFund,
  getVirtualPool,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  startSvm,
  U64_MAX,
} from "./utils";
import { VirtualCurveProgram } from "./utils/types";

import { BN } from "@coral-xyz/anchor";
import { expect } from "chai";
import { LiteSVM, TransactionMetadata } from "litesvm";
import { wrapSOL } from "./utils/token";

describe.only("First swap", () => {
  let svm: LiteSVM;
  let partner: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;

  beforeEach(async () => {
    svm = startSvm();
    partner = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    program = createVirtualCurveProgram();

    await wrapSOL(svm, poolCreator, new BN(LAMPORTS_PER_SOL * 10));
    await wrapSOL(svm, partner, new BN(LAMPORTS_PER_SOL * 10));
  });

  it("Charge min fee for bundled swap ix", async () => {
    const {
      baseMintKP,
      instruction: initPoolIx,
      pool,
      config,
      cliffFeeNumerator,
      endFeeNumerator,
    } = await createInitializePoolIx(partner, poolCreator, svm, program);

    const amountIn = new BN(LAMPORTS_PER_SOL);

    let swapIxs = await createSwapIx(
      pool,
      poolCreator.publicKey,
      program,
      amountIn,
      config,
      baseMintKP.publicKey,
      NATIVE_MINT
    );

    let tx = new Transaction().add(initPoolIx, ...swapIxs);
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = poolCreator.publicKey;
    tx.sign(poolCreator, baseMintKP);

    const res = svm.sendTransaction(tx);
    expect(res instanceof TransactionMetadata);

    const expectedFee = amountIn.mul(endFeeNumerator).div(FEE_DENOMINATOR);
    const poolState = await getVirtualPool(svm, program, pool);

    const totalTradingFee0 = poolState.metrics.totalProtocolQuoteFee.add(
      poolState.metrics.totalTradingQuoteFee
    );

    expect(totalTradingFee0.eq(expectedFee)).to.be.true;

    swapIxs = await createSwapIx(
      pool,
      poolCreator.publicKey,
      program,
      amountIn,
      config,
      baseMintKP.publicKey,
      NATIVE_MINT
    );
    tx = new Transaction().add(...swapIxs);
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = poolCreator.publicKey;
    tx.sign(poolCreator);

    const res2 = svm.sendTransaction(tx);
    expect(res2 instanceof TransactionMetadata);

    const expectedFee2 = amountIn.mul(cliffFeeNumerator).div(FEE_DENOMINATOR);
    const poolState2 = await getVirtualPool(svm, program, pool);
    const totalTradingFee2 = poolState2.metrics.totalProtocolQuoteFee.add(
      poolState2.metrics.totalTradingQuoteFee
    );

    const totalFeeCharged = totalTradingFee2.sub(totalTradingFee0);
    expect(totalFeeCharged.eq(expectedFee2)).to.be.true;
  });

  it("Charge min fee for multiple bundled swap ix", async () => {
    const {
      baseMintKP,
      instruction: initPoolIx,
      pool,
      config,
      endFeeNumerator,
    } = await createInitializePoolIx(partner, poolCreator, svm, program);

    const amountIn = new BN(LAMPORTS_PER_SOL);

    let swapIxs = await createSwapIx(
      pool,
      poolCreator.publicKey,
      program,
      amountIn,
      config,
      baseMintKP.publicKey,
      NATIVE_MINT
    );

    let tx = new Transaction().add(initPoolIx, ...swapIxs);
    tx.add(...swapIxs);
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = poolCreator.publicKey;
    tx.sign(poolCreator, baseMintKP);

    const res = svm.sendTransaction(tx);
    expect(res instanceof TransactionMetadata);

    const expectedFee = amountIn
      .mul(endFeeNumerator)
      .div(FEE_DENOMINATOR)
      .muln(2);
    const poolState = await getVirtualPool(svm, program, pool);

    const totalTradingFee0 = poolState.metrics.totalProtocolQuoteFee.add(
      poolState.metrics.totalTradingQuoteFee
    );

    expect(totalTradingFee0.eq(expectedFee)).to.be.true;
  });

  it("Charge cliff fee if no sysvar instruction passed in", async () => {
    const {
      baseMintKP,
      instruction: initPoolIx,
      pool,
      config,
      cliffFeeNumerator,
    } = await createInitializePoolIx(partner, poolCreator, svm, program);

    const amountIn = new BN(LAMPORTS_PER_SOL);

    let swapIxs = await createSwapIx(
      pool,
      poolCreator.publicKey,
      program,
      amountIn,
      config,
      baseMintKP.publicKey,
      NATIVE_MINT,
      true
    );

    let tx = new Transaction().add(initPoolIx, ...swapIxs);
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = poolCreator.publicKey;
    tx.sign(poolCreator, baseMintKP);

    const res = svm.sendTransaction(tx);
    expect(res instanceof TransactionMetadata);

    const expectedFee = amountIn.mul(cliffFeeNumerator).div(FEE_DENOMINATOR);
    const poolState = await getVirtualPool(svm, program, pool);

    const totalTradingFee0 = poolState.metrics.totalProtocolQuoteFee.add(
      poolState.metrics.totalTradingQuoteFee
    );

    expect(totalTradingFee0.eq(expectedFee)).to.be.true;
  });
});

async function createSwapIx(
  pool: PublicKey,
  user: PublicKey,
  program: VirtualCurveProgram,
  amountIn: BN,
  config: PublicKey,
  baseMint: PublicKey,
  quoteMint: PublicKey,
  skipSysvarInstruction: boolean = false
) {
  const poolAuthority = derivePoolAuthority();
  const inputTokenAccount = getAssociatedTokenAddressSync(quoteMint, user);
  const outputTokenAccount = getAssociatedTokenAddressSync(baseMint, user);
  const baseVault = deriveTokenVaultAddress(baseMint, pool);
  const quoteVault = deriveTokenVaultAddress(quoteMint, pool);

  const createInputAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    user,
    inputTokenAccount,
    user,
    quoteMint
  );

  const createOutputAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    user,
    outputTokenAccount,
    user,
    baseMint
  );

  const remainingAccounts = [];

  if (!skipSysvarInstruction) {
    remainingAccounts.push({
      pubkey: SYSVAR_INSTRUCTIONS_PUBKEY,
      isSigner: false,
      isWritable: false,
    });
  }

  const tx = await program.methods
    .swap2({
      amount0: amountIn,
      amount1: new BN(0),
      swapMode: 0,
    })
    .accountsPartial({
      pool,
      poolAuthority,
      payer: user,
      inputTokenAccount,
      outputTokenAccount,
      baseVault,
      quoteVault,
      config,
      baseMint,
      quoteMint,
      tokenBaseProgram: TOKEN_PROGRAM_ID,
      tokenQuoteProgram: TOKEN_PROGRAM_ID,
      referralTokenAccount: program.programId,
    })
    .remainingAccounts(remainingAccounts)
    .preInstructions([createInputAtaIx, createOutputAtaIx])
    .transaction();

  return tx.instructions;
}

async function createInitializePoolIx(
  partner: Keypair,
  poolCreator: Keypair,
  svm: LiteSVM,
  program: VirtualCurveProgram
) {
  // partner create config

  const cliffFeeNumerator = new BN(20_000_000);
  const endFeeNumerator = new BN(3_000_000);
  const numberOfPeriod = 60;
  const periodFrequency = new BN(1);

  const reductionFactor = cliffFeeNumerator
    .sub(endFeeNumerator)
    .div(new BN(numberOfPeriod));

  const refinedEndFeeNumerator = cliffFeeNumerator.sub(
    reductionFactor.mul(new BN(numberOfPeriod))
  );

  const baseFee: BaseFee = {
    cliffFeeNumerator: cliffFeeNumerator,
    firstFactor: numberOfPeriod,
    secondFactor: periodFrequency,
    thirdFactor: reductionFactor,
    baseFeeMode: 0,
  };

  const curves = [];

  for (let i = 1; i <= 16; i++) {
    if (i == 16) {
      curves.push({
        sqrtPrice: MAX_SQRT_PRICE,
        liquidity: U64_MAX.shln(30 + i),
      });
    } else {
      curves.push({
        sqrtPrice: MAX_SQRT_PRICE.muln(i * 5).divn(100),
        liquidity: U64_MAX.shln(30 + i),
      });
    }
  }

  const migratedPoolFee = {
    poolFeeBps: 100,
    collectFeeMode: 0,
    dynamicFee: 0,
  };

  const instructionParams: ConfigParameters = {
    poolFees: {
      baseFee,
      dynamicFee: null,
    },
    activationType: 0,
    collectFeeMode: 0,
    migrationOption: 1, // damm v2
    tokenType: 0, // spl_token
    tokenDecimal: 6,
    migrationQuoteThreshold: new BN(LAMPORTS_PER_SOL * 5),
    partnerLiquidityPercentage: 20,
    creatorLiquidityPercentage: 20,
    partnerPermanentLockedLiquidityPercentage: 55,
    creatorPermanentLockedLiquidityPercentage: 5,
    sqrtStartPrice: MIN_SQRT_PRICE.shln(32),
    lockedVesting: {
      amountPerPeriod: new BN(0),
      cliffDurationFromMigrationTime: new BN(0),
      frequency: new BN(0),
      numberOfPeriod: new BN(0),
      cliffUnlockAmount: new BN(0),
    },
    migrationFeeOption: 6, // customizable
    tokenSupply: null,
    creatorTradingFeePercentage: 0,
    tokenUpdateAuthority: 0,
    migrationFee: {
      feePercentage: 0,
      creatorFeePercentage: 0,
    },
    poolCreationFee: new BN(0),
    migratedPoolFee,
    curve: curves,
    creatorLiquidityVestingInfo: {
      vestingPercentage: 0,
      cliffDurationFromMigrationTime: 0,
      bpsPerPeriod: 0,
      numberOfPeriods: 0,
      frequency: 0,
    },
    partnerLiquidityVestingInfo: {
      vestingPercentage: 0,
      cliffDurationFromMigrationTime: 0,
      bpsPerPeriod: 0,
      numberOfPeriods: 0,
      frequency: 0,
    },
    enableFirstSwapWithMinFee: true,
    migratedPoolBaseFeeMode: 0,
    migratedPoolMarketCapFeeSchedulerParams: null,
  };

  const quoteMint = NATIVE_MINT;

  const params: CreateConfigParams<ConfigParameters> = {
    payer: partner,
    leftoverReceiver: partner.publicKey,
    feeClaimer: partner.publicKey,
    quoteMint,
    instructionParams,
  };
  const config = await createConfig(svm, program, params);

  return createInitializePoolWithSplTokenIx(svm, program, {
    poolCreator,
    payer: poolCreator,
    quoteMint: NATIVE_MINT,
    config,
    instructionParams: {
      name: "test token spl",
      symbol: "TEST",
      uri: "abc.com",
    },
  }).then((res) => {
    return {
      ...res,
      config,
      quoteMint,
      cliffFeeNumerator,
      endFeeNumerator: refinedEndFeeNumerator,
    };
  });
}
