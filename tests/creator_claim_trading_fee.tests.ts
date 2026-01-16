import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  ClaimCreatorTradeFeeParams,
  claimCreatorTradingFee,
  claimTradingFee,
  ConfigParameters,
  createConfig,
  CreateConfigParams,
  createLocker,
  createPoolWithSplToken,
  creatorWithdrawSurplus,
  partnerWithdrawSurplus,
  swap,
  SwapMode,
  SwapParams,
} from "./instructions";
import {
  createMeteoraMetadata,
  MigrateMeteoraParams,
  migrateToMeteoraDamm,
} from "./instructions/meteoraMigration";
import {
  createDammConfig,
  createVirtualCurveProgram,
  derivePoolAuthority,
  designCurve,
  expectThrowsAsync,
  generateAndFund,
  getDbcProgramErrorCodeHexString,
  startSvm,
  U64_MAX,
} from "./utils";
import { getConfig, getVirtualPool } from "./utils/fetcher";
import { createToken, mintSplTokenTo } from "./utils/token";
import { VirtualCurveProgram } from "./utils/types";

describe("Creator and Partner share trading fees and surplus", () => {
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

  it("50-50 fee between partner and creator", async () => {
    let totalTokenSupply = 1_000_000_000; // 1 billion
    let percentageSupplyOnMigration = 10; // 10%;
    let migrationQuoteThreshold = 300; // 300 sol
    let migrationOption = 0;
    let tokenBaseDecimal = 6;
    let tokenQuoteDecimal = 9;
    let lockedVesting = {
      amountPerPeriod: new BN(0),
      cliffDurationFromMigrationTime: new BN(0),
      frequency: new BN(0),
      numberOfPeriod: new BN(0),
      cliffUnlockAmount: new BN(0),
    };
    let creatorTradingFeePercentage = 50;
    let collectFeeMode = 1;
    let quoteMint = createToken(svm, admin, admin.publicKey, tokenQuoteDecimal);
    let instructionParams = designCurve(
      totalTokenSupply,
      percentageSupplyOnMigration,
      migrationQuoteThreshold,
      migrationOption,
      tokenBaseDecimal,
      tokenQuoteDecimal,
      creatorTradingFeePercentage,
      collectFeeMode,
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
    expect(configState.creatorTradingFeePercentage).eq(
      creatorTradingFeePercentage
    );
    mintSplTokenTo(
      svm,
      user,
      quoteMint,
      admin,
      user.publicKey,
      instructionParams.migrationQuoteThreshold.mul(new BN(2)).toNumber()
    );
    await fullFlow(
      svm,
      program,
      config,
      poolCreator,
      user,
      admin,
      quoteMint,
      partner
    );
  });

  it("0-100 fee between partner and creator", async () => {
    let totalTokenSupply = 1_000_000_000; // 1 billion
    let percentageSupplyOnMigration = 10; // 10%;
    let migrationQuoteThreshold = 300; // 300 sol
    let migrationOption = 0;
    let tokenBaseDecimal = 6;
    let tokenQuoteDecimal = 9;
    let lockedVesting = {
      amountPerPeriod: new BN(0),
      cliffDurationFromMigrationTime: new BN(0),
      frequency: new BN(0),
      numberOfPeriod: new BN(0),
      cliffUnlockAmount: new BN(0),
    };
    let creatorTradingFeePercentage = 100;
    let collectFeeMode = 0;
    let quoteMint = createToken(svm, admin, admin.publicKey, tokenQuoteDecimal);
    let instructionParams = designCurve(
      totalTokenSupply,
      percentageSupplyOnMigration,
      migrationQuoteThreshold,
      migrationOption,
      tokenBaseDecimal,
      tokenQuoteDecimal,
      creatorTradingFeePercentage,
      collectFeeMode,
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
    expect(configState.creatorTradingFeePercentage).eq(
      creatorTradingFeePercentage
    );
    mintSplTokenTo(
      svm,
      user,
      quoteMint,
      admin,
      user.publicKey,
      instructionParams.migrationQuoteThreshold.mul(new BN(2)).toNumber()
    );
    await fullFlow(
      svm,
      program,
      config,
      poolCreator,
      user,
      admin,
      quoteMint,
      partner
    );
  });

  it("100-0 fee between partner and creator", async () => {
    let totalTokenSupply = 1_000_000_000; // 1 billion
    let percentageSupplyOnMigration = 10; // 10%;
    let migrationQuoteThreshold = 300; // 300 sol
    let migrationOption = 0;
    let tokenBaseDecimal = 6;
    let tokenQuoteDecimal = 9;
    let lockedVesting = {
      amountPerPeriod: new BN(0),
      cliffDurationFromMigrationTime: new BN(0),
      frequency: new BN(0),
      numberOfPeriod: new BN(0),
      cliffUnlockAmount: new BN(0),
    };
    let creatorTradingFeePercentage = 0;
    let collectFeeMode = 1;
    let quoteMint = createToken(svm, admin, admin.publicKey, tokenQuoteDecimal);
    let instructionParams = designCurve(
      totalTokenSupply,
      percentageSupplyOnMigration,
      migrationQuoteThreshold,
      migrationOption,
      tokenBaseDecimal,
      tokenQuoteDecimal,
      creatorTradingFeePercentage,
      collectFeeMode,
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
    expect(configState.creatorTradingFeePercentage).eq(
      creatorTradingFeePercentage
    );
    mintSplTokenTo(
      svm,
      user,
      quoteMint,
      admin,
      user.publicKey,
      instructionParams.migrationQuoteThreshold.mul(new BN(2)).toNumber()
    );
    await fullFlow(
      svm,
      program,
      config,
      poolCreator,
      user,
      admin,
      quoteMint,
      partner
    );
  });

  it("20-80 fee between partner and creator", async () => {
    let totalTokenSupply = 1_000_000_000; // 1 billion
    let percentageSupplyOnMigration = 10; // 10%;
    let migrationQuoteThreshold = 300; // 300 sol
    let migrationOption = 0;
    let tokenBaseDecimal = 6;
    let tokenQuoteDecimal = 9;
    let lockedVesting = {
      amountPerPeriod: new BN(0),
      cliffDurationFromMigrationTime: new BN(0),
      frequency: new BN(0),
      numberOfPeriod: new BN(0),
      cliffUnlockAmount: new BN(0),
    };
    let creatorTradingFeePercentage = 80;
    let collectFeeMode = 0;
    let quoteMint = createToken(svm, admin, admin.publicKey, tokenQuoteDecimal);
    let instructionParams = designCurve(
      totalTokenSupply,
      percentageSupplyOnMigration,
      migrationQuoteThreshold,
      migrationOption,
      tokenBaseDecimal,
      tokenQuoteDecimal,
      creatorTradingFeePercentage,
      collectFeeMode,
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
    expect(configState.creatorTradingFeePercentage).eq(
      creatorTradingFeePercentage
    );
    mintSplTokenTo(
      svm,
      user,
      quoteMint,
      admin,
      user.publicKey,
      instructionParams.migrationQuoteThreshold.mul(new BN(2)).toNumber()
    );
    await fullFlow(
      svm,
      program,
      config,
      poolCreator,
      user,
      admin,
      quoteMint,
      partner
    );
  });
});

async function fullFlow(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  config: PublicKey,
  poolCreator: Keypair,
  user: Keypair,
  admin: Keypair,
  quoteMint: PublicKey,
  partner: Keypair
) {
  // create pool
  let virtualPool = await createPoolWithSplToken(svm, program, {
    payer: poolCreator,
    poolCreator: poolCreator,
    quoteMint,
    config,
    instructionParams: {
      name: "test token spl",
      symbol: "TEST",
      uri: "abc.com",
    },
  });
  let virtualPoolState = getVirtualPool(svm, program, virtualPool);

  let configState = getConfig(svm, program, config);

  let amountIn;
  if (configState.collectFeeMode == 0) {
    // over 20%
    amountIn = configState.migrationQuoteThreshold
      .mul(new BN(6))
      .div(new BN(5));
  } else {
    amountIn = configState.migrationQuoteThreshold;
  }
  // swap
  const params: SwapParams = {
    config,
    payer: user,
    pool: virtualPool,
    inputTokenMint: quoteMint,
    outputTokenMint: virtualPoolState.baseMint,
    amountIn,
    minimumAmountOut: new BN(0),
    swapMode: SwapMode.PartialFill,
    referralTokenAccount: null,
  };
  await swap(svm, program, params);

  let creatorTradingFeePercentage = configState.creatorTradingFeePercentage;
  let partnerTradingFeePercentage = 100 - creatorTradingFeePercentage;
  virtualPoolState = getVirtualPool(svm, program, virtualPool);

  if (creatorTradingFeePercentage == 0) {
    expect(virtualPoolState.creatorBaseFee.toString()).eq("0");
    expect(virtualPoolState.creatorQuoteFee.toString()).eq("0");
  } else if (partnerTradingFeePercentage == 0) {
    expect(virtualPoolState.partnerBaseFee.toString()).eq("0");
    expect(virtualPoolState.partnerQuoteFee.toString()).eq("0");
  } else {
    expect(
      virtualPoolState.creatorBaseFee
        .mul(new BN(partnerTradingFeePercentage))
        .toString()
    ).eq(
      virtualPoolState.partnerBaseFee
        .mul(new BN(creatorTradingFeePercentage))
        .toString()
    );
    expect(
      virtualPoolState.creatorQuoteFee
        .mul(new BN(partnerTradingFeePercentage))
        .toString()
    ).eq(
      virtualPoolState.partnerQuoteFee
        .mul(new BN(creatorTradingFeePercentage))
        .toString()
    );
  }

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

  const errorCodeUnauthorized = getDbcProgramErrorCodeHexString("Unauthorized");

  // unauthorized pool creator claim trading fee
  expectThrowsAsync(async () => {
    await claimCreatorTradingFee(svm, program, {
      creator: partner,
      pool: virtualPool,
      maxBaseAmount: new BN(U64_MAX),
      maxQuoteAmount: new BN(U64_MAX),
    });
  }, errorCodeUnauthorized);

  // creator claim trading fee
  const claimTradingFeeParams: ClaimCreatorTradeFeeParams = {
    creator: poolCreator,
    pool: virtualPool,
    maxBaseAmount: new BN(U64_MAX),
    maxQuoteAmount: new BN(U64_MAX),
  };
  await claimCreatorTradingFee(svm, program, claimTradingFeeParams);

  // unauthorized partner claim trading fee
  expectThrowsAsync(async () => {
    await claimTradingFee(svm, program, {
      feeClaimer: poolCreator,
      pool: virtualPool,
      maxBaseAmount: new BN(U64_MAX),
      maxQuoteAmount: new BN(U64_MAX),
    });
  }, errorCodeUnauthorized);
  // partner claim trading fee
  await claimTradingFee(svm, program, {
    feeClaimer: partner,
    pool: virtualPool,
    maxBaseAmount: new BN(U64_MAX),
    maxQuoteAmount: new BN(U64_MAX),
  });

  // unauthorized creator
  expectThrowsAsync(async () => {
    await creatorWithdrawSurplus(svm, program, {
      creator: partner,
      virtualPool,
    });
  }, errorCodeUnauthorized);
  // creator withdraw surplus
  await creatorWithdrawSurplus(svm, program, {
    creator: poolCreator,
    virtualPool,
  });

  // unauthorized partner
  expectThrowsAsync(async () => {
    await partnerWithdrawSurplus(svm, program, {
      feeClaimer: poolCreator,
      virtualPool,
    });
  }, errorCodeUnauthorized);
  // partner withdraw surplus
  await partnerWithdrawSurplus(svm, program, {
    feeClaimer: partner,
    virtualPool,
  });
}
