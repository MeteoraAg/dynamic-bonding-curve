import { ProgramTestContext } from "solana-bankrun";
import {
  createConfig,
  CreateConfigParams,
  createPoolWithSplToken,
  swap2,
  SwapParams2,
} from "./instructions";
import { VirtualCurveProgram } from "./utils/types";
import { Keypair } from "@solana/web3.js";
import {
  designCurve,
  fundSol,
  getTokenAccount,
  startTest,
  U64_MAX,
} from "./utils";
import { createVirtualCurveProgram } from "./utils";
import { getVirtualPool } from "./utils/fetcher";

import { createToken, mintSplTokenTo } from "./utils/token";
import { expect } from "chai";
import { BN } from "bn.js";
import {
  getAssociatedTokenAddressSync,
  unpackAccount,
} from "@solana/spl-token";

describe("Swap V2", () => {
  let context: ProgramTestContext;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let user: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;

  before(async () => {
    context = await startTest();
    admin = context.payer;
    operator = Keypair.generate();
    partner = Keypair.generate();
    user = Keypair.generate();
    poolCreator = Keypair.generate();
    const receivers = [
      operator.publicKey,
      partner.publicKey,
      user.publicKey,
      poolCreator.publicKey,
    ];
    await fundSol(context.banksClient, admin, receivers);
    program = createVirtualCurveProgram();
  });
  it("Swap over the curve exact in collect fee mode both tokens", async () => {
    let totalTokenSupply = 1_000_000_000; // 1 billion
    let percentageSupplyOnMigration = 10; // 10%;
    let migrationQuoteThreshold = 300; // 300 sol
    let tokenBaseDecimal = 6;
    let tokenQuoteDecimal = 9;
    let migrationOption = 0; // damm v1
    let lockedVesting = {
      amountPerPeriod: new BN(0),
      cliffDurationFromMigrationTime: new BN(0),
      frequency: new BN(0),
      numberOfPeriod: new BN(0),
      cliffUnlockAmount: new BN(0),
    };
    let collectFeeMode = 1;
    let quoteMint = await createToken(
      context.banksClient,
      admin,
      admin.publicKey,
      tokenQuoteDecimal
    );
    let instructionParams = designCurve(
      totalTokenSupply,
      percentageSupplyOnMigration,
      migrationQuoteThreshold,
      migrationOption,
      tokenBaseDecimal,
      tokenQuoteDecimal,
      0,
      collectFeeMode,
      lockedVesting
    );

    const params: CreateConfigParams = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint,
      instructionParams,
    };
    let config = await createConfig(context.banksClient, program, params);
    let swapAmount = instructionParams.migrationQuoteThreshold
      .mul(new BN(120))
      .div(new BN(100)); // swap more 20%

    await mintSplTokenTo(
      context.banksClient,
      user,
      quoteMint,
      admin,
      user.publicKey,
      swapAmount.toNumber()
    );

    // create pool
    let virtualPool = await createPoolWithSplToken(
      context.banksClient,
      program,
      {
        poolCreator,
        payer: operator,
        quoteMint,
        config,
        instructionParams: {
          name: "test token spl",
          symbol: "TEST",
          uri: "abc.com",
        },
      }
    );
    let virtualPoolState = await getVirtualPool(
      context.banksClient,
      program,
      virtualPool
    );

    // swap
    const preVaultBalance =
      (await getTokenAccount(context.banksClient, virtualPoolState.quoteVault))
        .amount ?? 0;
    const swapParams: SwapParams2 = {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: quoteMint,
      outputTokenMint: virtualPoolState.baseMint,
      amount0: swapAmount,
      amount1: new BN(0),
      referralTokenAccount: null,
      swapMode: 0, //exact in
    };
    await swap2(context.banksClient, program, swapParams);
    const postVaultBalance =
      (await getTokenAccount(context.banksClient, virtualPoolState.quoteVault))
        .amount ?? 0;

    expect(Number(postVaultBalance) - Number(preVaultBalance)).eq(
      swapAmount.toNumber()
    );
    virtualPoolState = await getVirtualPool(
      context.banksClient,
      program,
      virtualPool
    );

    expect(virtualPoolState.quoteReserve.toNumber()).greaterThan(
      instructionParams.migrationQuoteThreshold.toNumber()
    );
  });

  it("Swap over the curve exact in collect fee only quote token", async () => {
    let totalTokenSupply = 1_000_000_000; // 1 billion
    let percentageSupplyOnMigration = 10; // 10%;
    let migrationQuoteThreshold = 300; // 300 sol
    let tokenBaseDecimal = 6;
    let tokenQuoteDecimal = 9;
    let migrationOption = 0; // damm v1
    let lockedVesting = {
      amountPerPeriod: new BN(0),
      cliffDurationFromMigrationTime: new BN(0),
      frequency: new BN(0),
      numberOfPeriod: new BN(0),
      cliffUnlockAmount: new BN(0),
    };
    let collectFeeMode = 0;
    let quoteMint = await createToken(
      context.banksClient,
      admin,
      admin.publicKey,
      tokenQuoteDecimal
    );
    let instructionParams = designCurve(
      totalTokenSupply,
      percentageSupplyOnMigration,
      migrationQuoteThreshold,
      migrationOption,
      tokenBaseDecimal,
      tokenQuoteDecimal,
      0,
      collectFeeMode,
      lockedVesting
    );

    const params: CreateConfigParams = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint,
      instructionParams,
    };
    let config = await createConfig(context.banksClient, program, params);
    let swapAmount = instructionParams.migrationQuoteThreshold
      .mul(new BN(120))
      .div(new BN(100)); // swap more 20%

    await mintSplTokenTo(
      context.banksClient,
      user,
      quoteMint,
      admin,
      user.publicKey,
      swapAmount.toNumber()
    );

    // create pool
    let virtualPool = await createPoolWithSplToken(
      context.banksClient,
      program,
      {
        poolCreator,
        payer: operator,
        quoteMint,
        config,
        instructionParams: {
          name: "test token spl",
          symbol: "TEST",
          uri: "abc.com",
        },
      }
    );
    let virtualPoolState = await getVirtualPool(
      context.banksClient,
      program,
      virtualPool
    );

    // swap
    const preVaultBalance =
      (await getTokenAccount(context.banksClient, virtualPoolState.quoteVault))
        .amount ?? 0;
    const swapParams: SwapParams2 = {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: quoteMint,
      outputTokenMint: virtualPoolState.baseMint,
      amount0: swapAmount,
      amount1: new BN(0),
      referralTokenAccount: null,
      swapMode: 0, //exact in
    };
    await swap2(context.banksClient, program, swapParams);
    const postVaultBalance =
      (await getTokenAccount(context.banksClient, virtualPoolState.quoteVault))
        .amount ?? 0;

    expect(Number(postVaultBalance) - Number(preVaultBalance)).eq(
      swapAmount.toNumber()
    );
    virtualPoolState = await getVirtualPool(
      context.banksClient,
      program,
      virtualPool
    );

    expect(virtualPoolState.quoteReserve.toNumber()).greaterThan(
      instructionParams.migrationQuoteThreshold.toNumber()
    );
  });

  it("Swap over the curve partial fill collect fee mode both tokens", async () => {
    let totalTokenSupply = 1_000_000_000; // 1 billion
    let percentageSupplyOnMigration = 10; // 10%;
    let migrationQuoteThreshold = 300; // 300 sol
    let tokenBaseDecimal = 6;
    let tokenQuoteDecimal = 9;
    let migrationOption = 0; // damm v1
    let lockedVesting = {
      amountPerPeriod: new BN(0),
      cliffDurationFromMigrationTime: new BN(0),
      frequency: new BN(0),
      numberOfPeriod: new BN(0),
      cliffUnlockAmount: new BN(0),
    };
    let collectFeeMode = 1;
    let quoteMint = await createToken(
      context.banksClient,
      admin,
      admin.publicKey,
      tokenQuoteDecimal
    );
    let instructionParams = designCurve(
      totalTokenSupply,
      percentageSupplyOnMigration,
      migrationQuoteThreshold,
      migrationOption,
      tokenBaseDecimal,
      tokenQuoteDecimal,
      0,
      collectFeeMode,
      lockedVesting
    );

    const params: CreateConfigParams = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint,
      instructionParams,
    };
    let config = await createConfig(context.banksClient, program, params);
    let swapAmount = instructionParams.migrationQuoteThreshold
      .mul(new BN(120))
      .div(new BN(100)); // swap more 20%

    await mintSplTokenTo(
      context.banksClient,
      user,
      quoteMint,
      admin,
      user.publicKey,
      swapAmount.toNumber()
    );

    // create pool
    let virtualPool = await createPoolWithSplToken(
      context.banksClient,
      program,
      {
        poolCreator,
        payer: operator,
        quoteMint,
        config,
        instructionParams: {
          name: "test token spl",
          symbol: "TEST",
          uri: "abc.com",
        },
      }
    );
    let virtualPoolState = await getVirtualPool(
      context.banksClient,
      program,
      virtualPool
    );

    // swap
    const preVaultBalance =
      (await getTokenAccount(context.banksClient, virtualPoolState.quoteVault))
        .amount ?? 0;
    const swapParams: SwapParams2 = {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: quoteMint,
      outputTokenMint: virtualPoolState.baseMint,
      amount0: swapAmount,
      amount1: new BN(0),
      referralTokenAccount: null,
      swapMode: 1, //partial fill
    };
    await swap2(context.banksClient, program, swapParams);
    const postVaultBalance =
      (await getTokenAccount(context.banksClient, virtualPoolState.quoteVault))
        .amount ?? 0;

    expect(Number(postVaultBalance) - Number(preVaultBalance)).lt(
      swapAmount.toNumber()
    );
    virtualPoolState = await getVirtualPool(
      context.banksClient,
      program,
      virtualPool
    );
    console.log(
      "diffBalance %d swapAmount %d",
      Number(postVaultBalance) - Number(preVaultBalance),
      swapAmount.toString()
    );
    console.log(
      "quoteReserve %d migrationQuoteThreshold %d",
      virtualPoolState.quoteReserve.toString(),
      instructionParams.migrationQuoteThreshold.toString()
    );
    expect(virtualPoolState.quoteReserve.toNumber()).eq(
      instructionParams.migrationQuoteThreshold.toNumber()
    );
  });

  it("Swap over the curve partial fill collect fee mode only quote token", async () => {
    let totalTokenSupply = 1_000_000_000; // 1 billion
    let percentageSupplyOnMigration = 10; // 10%;
    let migrationQuoteThreshold = 300; // 300 sol
    let tokenBaseDecimal = 6;
    let tokenQuoteDecimal = 9;
    let migrationOption = 0; // damm v1
    let lockedVesting = {
      amountPerPeriod: new BN(0),
      cliffDurationFromMigrationTime: new BN(0),
      frequency: new BN(0),
      numberOfPeriod: new BN(0),
      cliffUnlockAmount: new BN(0),
    };
    let collectFeeMode = 0;
    let quoteMint = await createToken(
      context.banksClient,
      admin,
      admin.publicKey,
      tokenQuoteDecimal
    );
    let instructionParams = designCurve(
      totalTokenSupply,
      percentageSupplyOnMigration,
      migrationQuoteThreshold,
      migrationOption,
      tokenBaseDecimal,
      tokenQuoteDecimal,
      0,
      collectFeeMode,
      lockedVesting
    );

    const params: CreateConfigParams = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint,
      instructionParams,
    };
    let config = await createConfig(context.banksClient, program, params);
    let swapAmount = instructionParams.migrationQuoteThreshold
      .mul(new BN(120))
      .div(new BN(100)); // swap more 20%

    await mintSplTokenTo(
      context.banksClient,
      user,
      quoteMint,
      admin,
      user.publicKey,
      swapAmount.toNumber()
    );

    // create pool
    let virtualPool = await createPoolWithSplToken(
      context.banksClient,
      program,
      {
        poolCreator,
        payer: operator,
        quoteMint,
        config,
        instructionParams: {
          name: "test token spl",
          symbol: "TEST",
          uri: "abc.com",
        },
      }
    );
    let virtualPoolState = await getVirtualPool(
      context.banksClient,
      program,
      virtualPool
    );

    // swap
    const preVaultBalance =
      (await getTokenAccount(context.banksClient, virtualPoolState.quoteVault))
        .amount ?? 0;
    const swapParams: SwapParams2 = {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: quoteMint,
      outputTokenMint: virtualPoolState.baseMint,
      amount0: swapAmount,
      amount1: new BN(0),
      referralTokenAccount: null,
      swapMode: 1, //partial fill
    };
    await swap2(context.banksClient, program, swapParams);
    const postVaultBalance =
      (await getTokenAccount(context.banksClient, virtualPoolState.quoteVault))
        .amount ?? 0;

    expect(Number(postVaultBalance) - Number(preVaultBalance)).lt(
      swapAmount.toNumber()
    );
    virtualPoolState = await getVirtualPool(
      context.banksClient,
      program,
      virtualPool
    );
    console.log(
      "diffBalance %d swapAmount %d",
      Number(postVaultBalance) - Number(preVaultBalance),
      swapAmount.toString()
    );
    console.log(
      "quoteReserve %d migrationQuoteThreshold %d",
      virtualPoolState.quoteReserve.toString(),
      instructionParams.migrationQuoteThreshold.toString()
    );
    expect(virtualPoolState.quoteReserve.toNumber()).eq(
      instructionParams.migrationQuoteThreshold.toNumber()
    );
  });

  it("Swap exact out", async () => {
    let totalTokenSupply = 1_000_000_000; // 1 billion
    let percentageSupplyOnMigration = 10; // 10%;
    let migrationQuoteThreshold = 300; // 300 sol
    let tokenBaseDecimal = 6;
    let tokenQuoteDecimal = 9;
    let migrationOption = 0; // damm v1
    let lockedVesting = {
      amountPerPeriod: new BN(0),
      cliffDurationFromMigrationTime: new BN(0),
      frequency: new BN(0),
      numberOfPeriod: new BN(0),
      cliffUnlockAmount: new BN(0),
    };
    let collectFeeMode = 0;
    let quoteMint = await createToken(
      context.banksClient,
      admin,
      admin.publicKey,
      tokenQuoteDecimal
    );
    const feeIncrementBps = 100;
    const maxLimiterDuration = 86400;
    const referenceAmount = 1_000_000;
    let instructionParams = designCurve(
      totalTokenSupply,
      percentageSupplyOnMigration,
      migrationQuoteThreshold,
      migrationOption,
      tokenBaseDecimal,
      tokenQuoteDecimal,
      0,
      collectFeeMode,
      lockedVesting,
      {
        baseFeeOption: {
          cliffFeeNumerator: new BN(2_500_000),
          firstFactor: feeIncrementBps,
          secondFactor: new BN(maxLimiterDuration),
          thirdFactor: new BN(referenceAmount),
          baseFeeMode: 2, // Rate limiter
        },
      }
    );

    const params: CreateConfigParams = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint,
      instructionParams,
    };
    let config = await createConfig(context.banksClient, program, params);
    let swapAmount = instructionParams.migrationQuoteThreshold
      .mul(new BN(120))
      .div(new BN(100)); // swap more 20%

    await mintSplTokenTo(
      context.banksClient,
      user,
      quoteMint,
      admin,
      user.publicKey,
      swapAmount.toNumber()
    );

    // create pool
    let virtualPool = await createPoolWithSplToken(
      context.banksClient,
      program,
      {
        poolCreator,
        payer: operator,
        quoteMint,
        config,
        instructionParams: {
          name: "test token spl",
          symbol: "TEST",
          uri: "abc.com",
        },
      }
    );
    let virtualPoolState = await getVirtualPool(
      context.banksClient,
      program,
      virtualPool
    );

    // 90% of base
    const outAmount = new BN(totalTokenSupply).muln(90).divn(100);

    const swapParams: SwapParams2 = {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: quoteMint,
      outputTokenMint: virtualPoolState.baseMint,
      amount0: outAmount,
      amount1: U64_MAX, // yolo
      referralTokenAccount: null,
      swapMode: 2, // exact out
    };

    const { computeUnitsConsumed } = await swap2(
      context.banksClient,
      program,
      swapParams
    );

    console.log(`CU used ${computeUnitsConsumed}`);

    const userOutTokenAccount = getAssociatedTokenAddressSync(
      swapParams.outputTokenMint,
      swapParams.payer.publicKey,
      false
    );
    const userOutRawTokenAccount = await context.banksClient.getAccount(
      userOutTokenAccount
    );
    const userOutTokenBal = unpackAccount(
      userOutTokenAccount,
      // @ts-expect-error
      userOutRawTokenAccount
    ).amount;
    expect(new BN(userOutTokenBal.toString()).eq(outAmount)).to.be.true;
  });
});
