import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  ClaimCreatorTradeFeeParams,
  claimCreatorTradingFee,
  ConfigParameters,
  createConfig,
  CreateConfigParams,
  createLocker,
  createPoolWithSplToken,
  creatorWithdrawSurplus,
  swap,
  SwapMode,
  SwapParams,
  transferCreator,
} from "./instructions";
import {
  createMeteoraMetadata,
  lockLpForPartnerDamm,
  MigrateMeteoraParams,
  migrateToMeteoraDamm,
} from "./instructions/meteoraMigration";
import {
  createDammConfig,
  createVirtualCurveProgram,
  derivePoolAuthority,
  designCurve,
  generateAndFund,
  startSvm,
  U64_MAX,
} from "./utils";
import { getConfig, getVirtualPool } from "./utils/fetcher";
import { createToken, mintSplTokenTo } from "./utils/token";
import { VirtualCurveProgram } from "./utils/types";

describe("Update creator", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let user: Keypair;
  let poolCreator: Keypair;
  let newPoolCreator: Keypair;
  let program: VirtualCurveProgram;

  before(async () => {
    svm = startSvm();
    admin = generateAndFund(svm);
    operator = generateAndFund(svm);
    partner = generateAndFund(svm);
    user = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    newPoolCreator = generateAndFund(svm);
    program = createVirtualCurveProgram();
  });

  it("transfer new creator pre-bonding curve claim fee and surplus", async () => {
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

    await fullFlowUpdateCreatorInPreBondingCurve(
      svm,
      program,
      config,
      poolCreator,
      newPoolCreator,
      user,
      quoteMint
    );
  });

  it("transfer new creator when pool created claim fee and surplus", async () => {
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

    await fullFlowUpdateCreatorPoolCreated(
      svm,
      program,
      config,
      admin,
      poolCreator,
      newPoolCreator,
      user,
      quoteMint
    );
  });
});

async function fullFlowUpdateCreatorInPreBondingCurve(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  config: PublicKey,
  poolCreator: Keypair,
  newCreator: Keypair,
  user: Keypair,
  quoteMint: PublicKey
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

  expect(virtualPoolState.migrationProgress).eq(0);

  await transferCreator(
    svm,
    program,
    virtualPool,
    poolCreator,
    newCreator.publicKey
  );

  let configState = getConfig(svm, program, config);

  let amountIn: BN;
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
    swapMode: SwapMode.PartialFill,
    minimumAmountOut: new BN(0),
    referralTokenAccount: null,
  };
  await swap(svm, program, params);

  // creator claim trading fee
  const claimTradingFeeParams: ClaimCreatorTradeFeeParams = {
    creator: newCreator,
    pool: virtualPool,
    maxBaseAmount: new BN(U64_MAX),
    maxQuoteAmount: new BN(U64_MAX),
  };
  await claimCreatorTradingFee(svm, program, claimTradingFeeParams);

  // creator withdraw surplus
  await creatorWithdrawSurplus(svm, program, {
    creator: newCreator,
    virtualPool,
  });
}

async function fullFlowUpdateCreatorPoolCreated(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  config: PublicKey,
  admin: Keypair,
  poolCreator: Keypair,
  newCreator: Keypair,
  user: Keypair,
  quoteMint: PublicKey
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

  let amountIn: BN;
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

  await lockLpForPartnerDamm(svm, program, {
    payer: admin,
    dammConfig,
    virtualPool,
  });

  virtualPoolState = getVirtualPool(svm, program, virtualPool);

  expect(virtualPoolState.migrationProgress).eq(3);

  await transferCreator(
    svm,
    program,
    virtualPool,
    poolCreator,
    newCreator.publicKey
  );

  //  new creator claim trading fee
  const claimTradingFeeParams: ClaimCreatorTradeFeeParams = {
    creator: newCreator,
    pool: virtualPool,
    maxBaseAmount: new BN(U64_MAX),
    maxQuoteAmount: new BN(U64_MAX),
  };
  await claimCreatorTradingFee(svm, program, claimTradingFeeParams);

  //  new creator withdraw surplus
  await creatorWithdrawSurplus(svm, program, {
    creator: newCreator,
    virtualPool,
  });
}
