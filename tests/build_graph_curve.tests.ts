import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createConfig,
  CreateConfigParams,
  createLocker,
  createMeteoraMetadata,
  createPoolWithSplToken,
  MigrateMeteoraParams,
  migrateToMeteoraDamm,
  swap,
  SwapMode,
  SwapParams,
} from "./instructions";
import {
  createDammConfig,
  createVirtualCurveProgram,
  derivePoolAuthority,
  designGraphCurve,
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

describe("Build graph curve", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let user: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;

  before(async () => {
    svm = startSvm();
    operator = generateAndFund(svm);
    partner = generateAndFund(svm);
    user = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    program = createVirtualCurveProgram();
  });

  it("Graph curve with k > 1", async () => {
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
    let quoteMint = createToken(svm, admin, admin.publicKey, tokenQuoteDecimal);
    let instructionParams = designGraphCurve(
      totalTokenSupply,
      initialMarketcap,
      migrationMarketcap,
      migrationOption,
      tokenBaseDecimal,
      tokenQuoteDecimal,
      0,
      1,
      lockedVesting,
      leftOver,
      kFactor,
      {
        cliffFeeNumerator: new BN(2_500_000),
        firstFactor: 0,
        secondFactor: new BN(0),
        thirdFactor: new BN(0),
        baseFeeMode: 0,
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
    mintSplTokenTo(
      svm,
      user,
      quoteMint,
      admin,
      user.publicKey,
      instructionParams.migrationQuoteThreshold.toNumber()
    );
    await fullFlow(
      svm,
      program,
      config,
      operator,
      poolCreator,
      user,
      admin,
      quoteMint
    );
  });

  it("Graph curve with k < 1", async () => {
    let totalTokenSupply = 1_000_000_000; // 1 billion
    let initialMarketcap = 30; // 30 SOL;
    let migrationMarketcap = 300; // 300 SOL;
    let tokenBaseDecimal = 6;
    let tokenQuoteDecimal = 9;
    let kFactor = 0.6;
    let lockedVesting = {
      amountPerPeriod: new BN(123456),
      cliffDurationFromMigrationTime: new BN(0),
      frequency: new BN(1),
      numberOfPeriod: new BN(120),
      cliffUnlockAmount: new BN(123456),
    };
    let leftOver = 10_000;
    let migrationOption = 0;
    let quoteMint = createToken(svm, admin, admin.publicKey, tokenQuoteDecimal);
    let instructionParams = designGraphCurve(
      totalTokenSupply,
      initialMarketcap,
      migrationMarketcap,
      migrationOption,
      tokenBaseDecimal,
      tokenQuoteDecimal,
      0,
      1,
      lockedVesting,
      leftOver,
      kFactor,
      {
        cliffFeeNumerator: new BN(2_500_000),
        firstFactor: 0,
        secondFactor: new BN(0),
        thirdFactor: new BN(0),
        baseFeeMode: 0,
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
    mintSplTokenTo(
      svm,
      user,
      quoteMint,
      admin,
      user.publicKey,
      instructionParams.migrationQuoteThreshold.toNumber()
    );
    await fullFlow(
      svm,
      program,
      config,
      operator,
      poolCreator,
      user,
      admin,
      quoteMint
    );
  });
});

async function fullFlow(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  config: PublicKey,
  operator: Keypair,
  poolCreator: Keypair,
  user: Keypair,
  admin: Keypair,
  quoteMint: PublicKey
) {
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

  let configState = getConfig(svm, program, config);

  // swap
  const params: SwapParams = {
    config,
    payer: user,
    pool: virtualPool,
    inputTokenMint: quoteMint,
    outputTokenMint: virtualPoolState.baseMint,
    amountIn: configState.migrationQuoteThreshold,
    minimumAmountOut: new BN(0),
    swapMode: SwapMode.ExactIn,
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
  const baseMintData = getMint(svm, virtualPoolState.baseMint);

  expect(baseMintData.supply.toString()).eq(
    configState.postMigrationTokenSupply.toString()
  );
}
