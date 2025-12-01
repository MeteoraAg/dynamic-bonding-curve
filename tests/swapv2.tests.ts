import { Keypair } from "@solana/web3.js";
import {
  createConfig,
  CreateConfigParams,
  createPoolWithSplToken,
  swap2,
  SwapMode,
  SwapParams2,
} from "./instructions";
import {
  createVirtualCurveProgram,
  designCurve,
  FEE_DENOMINATOR,
  generateAndFund,
  getTokenAccount,
  startSvm,
  U64_MAX,
} from "./utils";
import { getVirtualPool } from "./utils/fetcher";
import { VirtualCurveProgram } from "./utils/types";

import {
  getAssociatedTokenAddressSync,
  unpackAccount,
} from "@solana/spl-token";
import { BN } from "bn.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import { createToken, mintSplTokenTo } from "./utils/token";

describe("Swap V2", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let user: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;

  before(async () => {
    svm = startSvm();
    admin = generateAndFund(svm);
    operator = generateAndFund(svm);
    partner = generateAndFund(svm);
    user = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
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
    let quoteMint = createToken(svm, admin, admin.publicKey, tokenQuoteDecimal);
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
        feePercentage: 0,
        creatorFeePercentage: 0,
      }
    );

    const params: CreateConfigParams = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint,
      instructionParams,
    };
    let config = await createConfig(svm, program, params);
    // exact amount in is migration quote threshold amount
    let swapAmount = instructionParams.migrationQuoteThreshold;

    mintSplTokenTo(
      svm,
      user,
      quoteMint,
      admin,
      user.publicKey,
      swapAmount.toNumber()
    );

    // create pool
    let virtualPool = await createPoolWithSplToken(svm, program, {
      poolCreator,
      payer: operator,
      quoteMint,
      config,
      instructionParams: {
        name: "test token spl",
        symbol: "TEST",
        uri: "abc.com",
      },
    });
    let virtualPoolState = getVirtualPool(svm, program, virtualPool);

    // swap
    const preVaultBalance =
      getTokenAccount(svm, virtualPoolState.quoteVault).amount ?? 0;
    const swapParams: SwapParams2 = {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: quoteMint,
      outputTokenMint: virtualPoolState.baseMint,
      amount0: swapAmount,
      amount1: new BN(0),
      referralTokenAccount: null,
      swapMode: SwapMode.ExactIn,
    };
    await swap2(svm, program, swapParams);
    const postVaultBalance =
      getTokenAccount(svm, virtualPoolState.quoteVault).amount ?? 0;

    expect(Number(postVaultBalance) - Number(preVaultBalance)).eq(
      swapAmount.toNumber()
    );
    virtualPoolState = getVirtualPool(svm, program, virtualPool);

    expect(virtualPoolState.quoteReserve.toNumber()).eq(
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
    let quoteMint = createToken(svm, admin, admin.publicKey, tokenQuoteDecimal);
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
        feePercentage: 0,
        creatorFeePercentage: 0,
      }
    );

    const params: CreateConfigParams = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint,
      instructionParams,
    };
    let config = await createConfig(svm, program, params);

    const tradeFeeNumerator =
      instructionParams.poolFees.baseFee.cliffFeeNumerator;
    // swapAmount - swapAmount * fee_numerator / denominator = migration_quote_threshold;
    let { div, mod } = instructionParams.migrationQuoteThreshold
      .mul(FEE_DENOMINATOR)
      .divmod(FEE_DENOMINATOR.sub(tradeFeeNumerator));
    const swapAmount = mod.isZero() ? div : div.add(new BN(1)); // round up

    mintSplTokenTo(
      svm,
      user,
      quoteMint,
      admin,
      user.publicKey,
      swapAmount.toNumber()
    );

    // create pool
    let virtualPool = await createPoolWithSplToken(svm, program, {
      poolCreator,
      payer: operator,
      quoteMint,
      config,
      instructionParams: {
        name: "test token spl",
        symbol: "TEST",
        uri: "abc.com",
      },
    });
    let virtualPoolState = getVirtualPool(svm, program, virtualPool);

    // swap
    const preVaultBalance =
      getTokenAccount(svm, virtualPoolState.quoteVault).amount ?? 0;
    const swapParams: SwapParams2 = {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: quoteMint,
      outputTokenMint: virtualPoolState.baseMint,
      amount0: swapAmount,
      amount1: new BN(0),
      referralTokenAccount: null,
      swapMode: SwapMode.ExactIn,
    };

    await swap2(svm, program, swapParams);
    const postVaultBalance =
      getTokenAccount(svm, virtualPoolState.quoteVault).amount ?? 0;

    expect(Number(postVaultBalance) - Number(preVaultBalance)).eq(
      swapAmount.toNumber()
    );
    virtualPoolState = getVirtualPool(svm, program, virtualPool);

    expect(virtualPoolState.quoteReserve.toNumber()).eq(
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
    let quoteMint = createToken(svm, admin, admin.publicKey, tokenQuoteDecimal);
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
        feePercentage: 0,
        creatorFeePercentage: 0,
      }
    );

    const params: CreateConfigParams = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint,
      instructionParams,
    };
    let config = await createConfig(svm, program, params);
    let swapAmount = instructionParams.migrationQuoteThreshold
      .mul(new BN(120))
      .div(new BN(100)); // swap more 20%

    mintSplTokenTo(
      svm,
      user,
      quoteMint,
      admin,
      user.publicKey,
      swapAmount.toNumber()
    );

    // create pool
    let virtualPool = await createPoolWithSplToken(svm, program, {
      poolCreator,
      payer: operator,
      quoteMint,
      config,
      instructionParams: {
        name: "test token spl",
        symbol: "TEST",
        uri: "abc.com",
      },
    });
    let virtualPoolState = getVirtualPool(svm, program, virtualPool);

    // swap
    const preVaultBalance =
      getTokenAccount(svm, virtualPoolState.quoteVault).amount ?? 0;
    const swapParams: SwapParams2 = {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: quoteMint,
      outputTokenMint: virtualPoolState.baseMint,
      amount0: swapAmount,
      amount1: new BN(0),
      referralTokenAccount: null,
      swapMode: SwapMode.PartialFill,
    };
    await swap2(svm, program, swapParams);
    const postVaultBalance =
      getTokenAccount(svm, virtualPoolState.quoteVault).amount ?? 0;

    expect(Number(postVaultBalance) - Number(preVaultBalance)).lt(
      swapAmount.toNumber()
    );
    virtualPoolState = getVirtualPool(svm, program, virtualPool);
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
    let quoteMint = createToken(svm, admin, admin.publicKey, tokenQuoteDecimal);
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
        feePercentage: 0,
        creatorFeePercentage: 0,
      }
    );

    const params: CreateConfigParams = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint,
      instructionParams,
    };
    let config = await createConfig(svm, program, params);
    let swapAmount = instructionParams.migrationQuoteThreshold
      .mul(new BN(120))
      .div(new BN(100)); // swap more 20%

    mintSplTokenTo(
      svm,
      user,
      quoteMint,
      admin,
      user.publicKey,
      swapAmount.toNumber()
    );

    // create pool
    let virtualPool = await createPoolWithSplToken(svm, program, {
      poolCreator,
      payer: operator,
      quoteMint,
      config,
      instructionParams: {
        name: "test token spl",
        symbol: "TEST",
        uri: "abc.com",
      },
    });
    let virtualPoolState = getVirtualPool(svm, program, virtualPool);

    // swap
    const preVaultBalance =
      getTokenAccount(svm, virtualPoolState.quoteVault).amount ?? 0;
    const swapParams: SwapParams2 = {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: quoteMint,
      outputTokenMint: virtualPoolState.baseMint,
      amount0: swapAmount,
      amount1: new BN(0),
      referralTokenAccount: null,
      swapMode: SwapMode.PartialFill,
    };
    await swap2(svm, program, swapParams);
    const postVaultBalance =
      getTokenAccount(svm, virtualPoolState.quoteVault).amount ?? 0;

    expect(Number(postVaultBalance) - Number(preVaultBalance)).lt(
      swapAmount.toNumber()
    );
    virtualPoolState = getVirtualPool(svm, program, virtualPool);
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
    let quoteMint = createToken(svm, admin, admin.publicKey, tokenQuoteDecimal);
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
        feePercentage: 0,
        creatorFeePercentage: 0,
      },
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
    let config = await createConfig(svm, program, params);
    let swapAmount = instructionParams.migrationQuoteThreshold
      .mul(new BN(120))
      .div(new BN(100)); // swap more 20%

    mintSplTokenTo(
      svm,
      user,
      quoteMint,
      admin,
      user.publicKey,
      swapAmount.toNumber()
    );

    // create pool
    let virtualPool = await createPoolWithSplToken(svm, program, {
      poolCreator,
      payer: operator,
      quoteMint,
      config,
      instructionParams: {
        name: "test token spl",
        symbol: "TEST",
        uri: "abc.com",
      },
    });
    let virtualPoolState = getVirtualPool(svm, program, virtualPool);

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
      swapMode: SwapMode.ExactOut,
    };

    const { computeUnitsConsumed } = await swap2(svm, program, swapParams);

    console.log(`CU used ${computeUnitsConsumed}`);

    const userOutTokenAccount = getAssociatedTokenAddressSync(
      swapParams.outputTokenMint,
      swapParams.payer.publicKey,
      false
    );
    const userOutRawTokenAccount = svm.getAccount(userOutTokenAccount);
    const userOutTokenBal = unpackAccount(
      userOutTokenAccount,
      // @ts-expect-error
      userOutRawTokenAccount
    ).amount;
    expect(new BN(userOutTokenBal.toString()).eq(outAmount)).to.be.true;
  });
});
