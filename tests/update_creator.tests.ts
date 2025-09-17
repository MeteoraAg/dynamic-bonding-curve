import { BanksClient, ProgramTestContext } from "solana-bankrun";
import {
  ClaimCreatorTradeFeeParams,
  claimCreatorTradingFee,
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
import { VirtualCurveProgram } from "./utils/types";
import { Keypair, PublicKey } from "@solana/web3.js";
import { designCurve, fundSol, startTest } from "./utils";
import {
  createDammConfig,
  createVirtualCurveProgram,
  derivePoolAuthority,
  U64_MAX,
} from "./utils";
import { getConfig, getVirtualPool } from "./utils/fetcher";
import {
  createMeteoraMetadata,
  lockLpForPartnerDamm,
  MigrateMeteoraParams,
  migrateToMeteoraDamm,
} from "./instructions/meteoraMigration";
import { expect } from "chai";
import { createToken, mintSplTokenTo } from "./utils/token";
import BN from "bn.js";

describe("Update creator", () => {
  let context: ProgramTestContext;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let user: Keypair;
  let poolCreator: Keypair;
  let newPoolCreator: Keypair;
  let program: VirtualCurveProgram;

  before(async () => {
    context = await startTest();
    admin = context.payer;
    operator = Keypair.generate();
    partner = Keypair.generate();
    user = Keypair.generate();
    poolCreator = Keypair.generate();
    newPoolCreator = Keypair.generate();
    const receivers = [
      operator.publicKey,
      partner.publicKey,
      user.publicKey,
      poolCreator.publicKey,
      newPoolCreator.publicKey,
    ];
    await fundSol(context.banksClient, admin, receivers);
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
      creatorTradingFeePercentage,
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
    let configState = await getConfig(context.banksClient, program, config);
    expect(configState.creatorTradingFeePercentage).eq(
      creatorTradingFeePercentage
    );
    await mintSplTokenTo(
      context.banksClient,
      user,
      quoteMint,
      admin,
      user.publicKey,
      instructionParams.migrationQuoteThreshold.mul(new BN(2)).toNumber()
    );

    await fullFlowUpdateCreatorInPreBondingCurve(
      context.banksClient,
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
      creatorTradingFeePercentage,
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
    let configState = await getConfig(context.banksClient, program, config);
    expect(configState.creatorTradingFeePercentage).eq(
      creatorTradingFeePercentage
    );
    await mintSplTokenTo(
      context.banksClient,
      user,
      quoteMint,
      admin,
      user.publicKey,
      instructionParams.migrationQuoteThreshold.mul(new BN(2)).toNumber()
    );

    await fullFlowUpdateCreatorPoolCreated(
      context.banksClient,
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
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  config: PublicKey,
  poolCreator: Keypair,
  newCreator: Keypair,
  user: Keypair,
  quoteMint: PublicKey
) {
  // create pool
  let virtualPool = await createPoolWithSplToken(banksClient, program, {
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
  let virtualPoolState = await getVirtualPool(
    banksClient,
    program,
    virtualPool
  );

  expect(virtualPoolState.migrationProgress).eq(0);

  await transferCreator(
    banksClient,
    program,
    virtualPool,
    poolCreator,
    newCreator.publicKey
  );

  let configState = await getConfig(banksClient, program, config);

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
  await swap(banksClient, program, params);

  // creator claim trading fee
  const claimTradingFeeParams: ClaimCreatorTradeFeeParams = {
    creator: newCreator,
    pool: virtualPool,
    maxBaseAmount: new BN(U64_MAX),
    maxQuoteAmount: new BN(U64_MAX),
  };
  await claimCreatorTradingFee(banksClient, program, claimTradingFeeParams);

  // creator withdraw surplus
  await creatorWithdrawSurplus(banksClient, program, {
    creator: newCreator,
    virtualPool,
  });
}

async function fullFlowUpdateCreatorPoolCreated(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  config: PublicKey,
  admin: Keypair,
  poolCreator: Keypair,
  newCreator: Keypair,
  user: Keypair,
  quoteMint: PublicKey
) {
  // create pool
  let virtualPool = await createPoolWithSplToken(banksClient, program, {
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
  let virtualPoolState = await getVirtualPool(
    banksClient,
    program,
    virtualPool
  );

  let configState = await getConfig(banksClient, program, config);

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
  await swap(banksClient, program, params);

  // migrate
  const poolAuthority = derivePoolAuthority();
  let dammConfig = await createDammConfig(banksClient, admin, poolAuthority);
  const migrationParams: MigrateMeteoraParams = {
    payer: admin,
    virtualPool,
    dammConfig,
  };
  await createMeteoraMetadata(banksClient, program, {
    payer: admin,
    virtualPool,
    config,
  });

  if (configState.lockedVestingConfig.frequency.toNumber() != 0) {
    await createLocker(banksClient, program, {
      payer: admin,
      virtualPool,
    });
  }
  await migrateToMeteoraDamm(banksClient, program, migrationParams);

  await lockLpForPartnerDamm(banksClient, program, {
    payer: admin,
    dammConfig,
    virtualPool,
  });

  virtualPoolState = await getVirtualPool(banksClient, program, virtualPool);

  expect(virtualPoolState.migrationProgress).eq(3);

  await transferCreator(
    banksClient,
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
  await claimCreatorTradingFee(banksClient, program, claimTradingFeeParams);

  //  new creator withdraw surplus
  await creatorWithdrawSurplus(banksClient, program, {
    creator: newCreator,
    virtualPool,
  });
}
