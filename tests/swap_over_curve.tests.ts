import { Keypair } from "@solana/web3.js";
import {
  ConfigParameters,
  createConfig,
  CreateConfigParams,
  createLocker,
  createMeteoraMetadata,
  createPoolWithSplToken,
  MigrateMeteoraParams,
  migrateToMeteoraDamm,
  partnerWithdrawSurplus,
  swap,
  SwapMode,
  SwapParams,
  swapPartialFill,
  claimProtocolFee,
  createOperatorAccount,
  OperatorPermission,
} from "./instructions";
import {
  createDammConfig,
  createVirtualCurveProgram,
  derivePoolAuthority,
  designCurve,
  generateAndFund,
  getMint,
  startSvm,
} from "./utils";
import { getConfig, getVirtualPool } from "./utils/fetcher";
import { VirtualCurveProgram } from "./utils/types";

import { BN } from "bn.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import { createToken, mintSplTokenTo } from "./utils/token";

describe("Swap Over the Curve", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let user: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;

  beforeEach(async () => {
    svm = startSvm();
    admin = generateAndFund(svm);
    operator = generateAndFund(svm);
    partner = generateAndFund(svm);
    user = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    program = createVirtualCurveProgram();

    await createOperatorAccount(svm, program, {
      admin,
      whitelistedAddress: operator.publicKey,
      permissions: [OperatorPermission.ClaimProtocolFee],
    });
  });

  it("Swap exact in over the curve", async () => {
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
    let quoteMint = createToken(svm, admin, admin.publicKey, tokenQuoteDecimal);
    let instructionParams = designCurve(
      totalTokenSupply,
      percentageSupplyOnMigration,
      migrationQuoteThreshold,
      migrationOption,
      tokenBaseDecimal,
      tokenQuoteDecimal,
      0,
      1,
      lockedVesting,
      {
        feePercentage: 0,
        creatorFeePercentage: 0,
      }
    );

    const params: CreateConfigParams<ConfigParameters> = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint,
      instructionParams,
    };
    let config = await createConfig(svm, program, params);
    let configState = getConfig(svm, program, config);
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
    const swapParams: SwapParams = {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: quoteMint,
      outputTokenMint: virtualPoolState.baseMint,
      amountIn: swapAmount,
      minimumAmountOut: new BN(0),
      swapMode: SwapMode.PartialFill,
      referralTokenAccount: null,
    };
    await swap(svm, program, swapParams);

    // migrate
    const poolAuthority = derivePoolAuthority();
    let dammConfig = await createDammConfig(svm, admin, poolAuthority);
    const migrationParams: MigrateMeteoraParams = {
      payer: admin,
      virtualPool,
      dammConfig,
    };
    await createMeteoraMetadata(svm, program, {
      payer: admin,
      virtualPool,
      config,
    });

    if (configState.lockedVestingConfig.frequency.toNumber() != 0) {
      await createLocker(svm, program, {
        payer: admin,
        virtualPool,
      });
    }
    await migrateToMeteoraDamm(svm, program, migrationParams);

    await claimProtocolFee(svm, program, {
      operator: operator,
      pool: virtualPool,
    });

    await partnerWithdrawSurplus(svm, program, {
      feeClaimer: partner,
      virtualPool,
    });

    const baseMintData = getMint(svm, virtualPoolState.baseMint);

    expect(baseMintData.supply.toString()).eq(
      new BN(totalTokenSupply * 10 ** tokenBaseDecimal).toString()
    );
  });

  it("Partial fill over the curve", async () => {
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
    let quoteMint = createToken(svm, admin, admin.publicKey, tokenQuoteDecimal);

    const feeIncrementBps = 10;
    const maxLimiterDuration = 86400;
    const referenceAmount = 1_000_000_000;
    const collectFeeMode = 0;

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

    const params: CreateConfigParams<ConfigParameters> = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint,
      instructionParams,
    };
    let config = await createConfig(svm, program, params);
    let configState = getConfig(svm, program, config);

    let swapAmount = instructionParams.migrationQuoteThreshold
      .mul(new BN(150))
      .div(new BN(100)); // swap more 150%

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
    const swapParams: SwapParams = {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: quoteMint,
      outputTokenMint: virtualPoolState.baseMint,
      amountIn: swapAmount,
      minimumAmountOut: new BN(0),
      swapMode: SwapMode.PartialFill,
      referralTokenAccount: null,
    };

    const beforeAmount = svm.getBalance(swapParams.payer.publicKey);

    const { computeUnitsConsumed } = await swapPartialFill(
      svm,
      program,
      swapParams
    );
    console.log(`CU used ${computeUnitsConsumed}`);

    const afterAmount = svm.getBalance(swapParams.payer.publicKey);

    // Make sure it's partial fill
    const consumedAmount = beforeAmount - afterAmount;
    expect(new BN(consumedAmount.toString()).lt(swapAmount)).to.be.true;

    // migrate
    const poolAuthority = derivePoolAuthority();
    let dammConfig = await createDammConfig(svm, admin, poolAuthority);
    const migrationParams: MigrateMeteoraParams = {
      payer: admin,
      virtualPool,
      dammConfig,
    };
    await createMeteoraMetadata(svm, program, {
      payer: admin,
      virtualPool,
      config,
    });

    if (configState.lockedVestingConfig.frequency.toNumber() != 0) {
      await createLocker(svm, program, {
        payer: admin,
        virtualPool,
      });
    }
    await migrateToMeteoraDamm(svm, program, migrationParams);

    await claimProtocolFee(svm, program, {
      operator: operator,
      pool: virtualPool,
    });

    await partnerWithdrawSurplus(svm, program, {
      feeClaimer: partner,
      virtualPool,
    });

    const baseMintData = getMint(svm, virtualPoolState.baseMint);

    expect(baseMintData.supply.toString()).eq(
      new BN(totalTokenSupply * 10 ** tokenBaseDecimal).toString()
    );
  });
});
