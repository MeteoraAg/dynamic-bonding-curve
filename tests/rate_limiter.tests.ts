import { ProgramTestContext } from "solana-bankrun";
import {
  createConfig,
  createPoolWithSplToken,
  getSwap2Instruction,
  getSwapInstruction,
  swap,
} from "./instructions";
import { VirtualCurveProgram } from "./utils/types";
import { Keypair, Transaction } from "@solana/web3.js";
import {
  designGraphCurve,
  fundSol,
  getOrCreateAta,
  processTransactionMaybeThrow,
  startTest,
  warpSlotBy,
} from "./utils";
import { createVirtualCurveProgram } from "./utils";
import { getVirtualPool } from "./utils/fetcher";

import { assert, expect } from "chai";
import { createToken, mintSplTokenTo } from "./utils/token";
import { BN } from "bn.js";

describe.only("Rate limiter", () => {
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

  it("Rate limiter", async () => {
    let totalTokenSupply = 1_000_000_000; // 1 billion
    let initialMarketcap = 30; // 30 SOL;
    let migrationMarketcap = 300; // 300 SOL;
    let tokenBaseDecimal = 6;
    let tokenQuoteDecimal = 9;
    let kFactor = 1.2;
    let lockedVesting = {
      amountPerPeriod: new BN(123456),
      cliffDurationFromMigrationTime: new BN(0),
      frequency: new BN(1),
      numberOfPeriod: new BN(120),
      cliffUnlockAmount: new BN(123456),
    };
    let leftOver = 10_000;
    let migrationOption = 0;
    let quoteMint = await createToken(
      context.banksClient,
      admin,
      admin.publicKey,
      tokenQuoteDecimal
    );
    let referenceAmount = new BN(1_000_000_000);
    let maxRateLimiterDuration = new BN(10);
    let instructionParams = designGraphCurve(
      totalTokenSupply,
      initialMarketcap,
      migrationMarketcap,
      migrationOption,
      tokenBaseDecimal,
      tokenQuoteDecimal,
      0,
      0,
      lockedVesting,
      leftOver,
      kFactor,
      {
        cliffFeeNumerator: new BN(10_000_000), // 100bps
        firstFactor: 10, // 10 bps
        secondFactor: maxRateLimiterDuration, // 10 slot
        thirdFactor: referenceAmount, // 1 sol
        baseFeeMode: 2, // rate limiter mode
      }
    );
    let config = await createConfig(context.banksClient, program, {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint,
      instructionParams,
    });
    await mintSplTokenTo(
      context.banksClient,
      user,
      quoteMint,
      admin,
      user.publicKey,
      instructionParams.migrationQuoteThreshold.toNumber()
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

    // swap with 1 SOL
    await swap(context.banksClient, program, {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: quoteMint,
      outputTokenMint: virtualPoolState.baseMint,
      amountIn: referenceAmount,
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    });

    virtualPoolState = await getVirtualPool(
      context.banksClient,
      program,
      virtualPool
    );

    let totalTradingFee = virtualPoolState.partnerQuoteFee.add(
      virtualPoolState.protocolQuoteFee
    );
    expect(totalTradingFee.toNumber()).eq(
      referenceAmount.div(new BN(100)).toNumber()
    );

    // swap with 2 SOL
    await swap(context.banksClient, program, {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: quoteMint,
      outputTokenMint: virtualPoolState.baseMint,
      amountIn: referenceAmount.mul(new BN(2)),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    });

    virtualPoolState = await getVirtualPool(
      context.banksClient,
      program,
      virtualPool
    );

    let totalTradingFee1 = virtualPoolState.partnerQuoteFee.add(
      virtualPoolState.protocolQuoteFee
    );
    let deltaTradingFee = totalTradingFee1.sub(totalTradingFee);
    expect(deltaTradingFee.toNumber()).gt(
      referenceAmount.mul(new BN(2)).div(new BN(100)).toNumber()
    );

    // wait until time pass the 10 slot
    await warpSlotBy(context, maxRateLimiterDuration.add(new BN(1)));

    // swap with 2 SOL
    await swap(context.banksClient, program, {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: quoteMint,
      outputTokenMint: virtualPoolState.baseMint,
      amountIn: referenceAmount.mul(new BN(2)),
      minimumAmountOut: new BN(0),
      referralTokenAccount: null,
    });

    virtualPoolState = await getVirtualPool(
      context.banksClient,
      program,
      virtualPool
    );

    let totalTradingFee2 = virtualPoolState.partnerQuoteFee.add(
      virtualPoolState.protocolQuoteFee
    );
    let deltaTradingFee1 = totalTradingFee2.sub(totalTradingFee1);
    expect(deltaTradingFee1.toNumber()).eq(
      referenceAmount.mul(new BN(2)).div(new BN(100)).toNumber()
    );
  });

  it.only("Try to send multiple instructions", async () => {
    let totalTokenSupply = 1_000_000_000; // 1 billion
    let initialMarketcap = 30; // 30 SOL;
    let migrationMarketcap = 300; // 300 SOL;
    let tokenBaseDecimal = 6;
    let tokenQuoteDecimal = 9;
    let kFactor = 1.2;
    let lockedVesting = {
      amountPerPeriod: new BN(123456),
      cliffDurationFromMigrationTime: new BN(0),
      frequency: new BN(1),
      numberOfPeriod: new BN(120),
      cliffUnlockAmount: new BN(123456),
    };
    let leftOver = 10_000;
    let migrationOption = 0;
    let quoteMint = await createToken(
      context.banksClient,
      admin,
      admin.publicKey,
      tokenQuoteDecimal
    );
    let referenceAmount = new BN(1_000_000_000);
    let maxRateLimiterDuration = new BN(10);
    let instructionParams = designGraphCurve(
      totalTokenSupply,
      initialMarketcap,
      migrationMarketcap,
      migrationOption,
      tokenBaseDecimal,
      tokenQuoteDecimal,
      0,
      0,
      lockedVesting,
      leftOver,
      kFactor,
      {
        cliffFeeNumerator: new BN(10_000_000), // 100bps
        firstFactor: 10, // 10 bps
        secondFactor: maxRateLimiterDuration, // 10 slot
        thirdFactor: referenceAmount, // 1 sol
        baseFeeMode: 2, // rate limiter mode
      }
    );
    let config = await createConfig(context.banksClient, program, {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint,
      instructionParams,
    });
    await mintSplTokenTo(
      context.banksClient,
      user,
      quoteMint,
      admin,
      user.publicKey,
      instructionParams.migrationQuoteThreshold.toNumber()
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

    await getOrCreateAta(
      context.banksClient,
      user,
      virtualPoolState.baseMint,
      user.publicKey
    );

    // swap with 1 SOL
    const swapInstruction = await getSwapInstruction(
      context.banksClient,
      program,
      {
        config,
        payer: user,
        pool: virtualPool,
        inputTokenMint: quoteMint,
        outputTokenMint: virtualPoolState.baseMint,
        amountIn: referenceAmount,
        minimumAmountOut: new BN(0),
        referralTokenAccount: null,
      }
    );

    const swap2Instruction = await getSwap2Instruction(
      context.banksClient,
      program,
      {
        config,
        payer: user,
        pool: virtualPool,
        inputTokenMint: quoteMint,
        outputTokenMint: virtualPoolState.baseMint,
        amountIn: referenceAmount,
        minimumAmountOut: new BN(0),
        referralTokenAccount: null,
      }
    );

    let transaction = new Transaction();
    transaction.add(swapInstruction);
    transaction.add(swap2Instruction);

    transaction.recentBlockhash = (
      await context.banksClient.getLatestBlockhash()
    )[0];
    transaction.sign(user);

    const transactionMeta = await context.banksClient.tryProcessTransaction(
      transaction
    );

    expect(
      transactionMeta.meta.logMessages.filter((log) =>
        log.includes("Fail to validate single swap instruction in rate limiter")
      ).length
    ).eq(1);
  });
});
