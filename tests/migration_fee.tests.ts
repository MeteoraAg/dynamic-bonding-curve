import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  createConfig,
  CreateConfigParams,
  createLocker,
  createPoolWithSplToken,
  creatorWithdrawMigrationFee,
  partnerWithdrawMigrationFee,
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
  generateAndFund,
  getTokenAccount,
  getTokenProgram,
  startSvm,
} from "./utils";
import { getConfig, getVirtualPool } from "./utils/fetcher";
import { createToken, mintSplTokenTo } from "./utils/token";
import { VirtualCurveProgram } from "./utils/types";

describe("Migration fee", () => {
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

  it("Creator and partner withdraw migration fee", async () => {
    let totalTokenSupply = 1_000_000_000; // 1 billion
    let percentageSupplyOnMigration = 0.9; // 0.9%;
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
        feePercentage: 99,
        creatorFeePercentage: 80,
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

    const creatorTokenQuoteAccount = getAssociatedTokenAddressSync(
      configState.quoteMint,
      poolCreator.publicKey,
      true,
      getTokenProgram(configState.quoteTokenFlag)
    );

    const partnerTokenQuoteAccount = getAssociatedTokenAddressSync(
      configState.quoteMint,
      partner.publicKey,
      true,
      getTokenProgram(configState.quoteTokenFlag)
    );
    const creatorTokenAccountState = getTokenAccount(
      svm,
      creatorTokenQuoteAccount
    );
    const preCreatorBalance = creatorTokenAccountState
      ? Number(creatorTokenAccountState.amount)
      : 0;

    const partnerTokenAccountState = getTokenAccount(
      svm,
      partnerTokenQuoteAccount
    );
    const prePartnerBalance = partnerTokenAccountState
      ? Number(partnerTokenAccountState.amount)
      : 0;

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

    // calculate migration fee
    const product = configState.migrationQuoteThreshold.muln(
      100 - instructionParams.migrationFee.feePercentage
    );
    const quoteAmount = product.addn(99).divn(100);
    const totalMigrationFee =
      configState.migrationQuoteThreshold.sub(quoteAmount);
    const creatorMigrationFee = totalMigrationFee
      .muln(instructionParams.migrationFee.creatorFeePercentage)
      .divn(100);
    const partnerMigrationFee = totalMigrationFee.sub(creatorMigrationFee);

    const postCreatorBalance = Number(
      getTokenAccount(svm, creatorTokenQuoteAccount).amount ?? 0
    );

    const postPartnerBalance = Number(
      getTokenAccount(svm, partnerTokenQuoteAccount).amount ?? 0
    );

    expect(postCreatorBalance - preCreatorBalance).eq(
      Number(creatorMigrationFee)
    );

    expect(postPartnerBalance - prePartnerBalance).eq(
      Number(partnerMigrationFee)
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
    swapMode: SwapMode.ExactIn,
    referralTokenAccount: null,
  };
  await swap(svm, program, params);

  virtualPoolState = getVirtualPool(svm, program, virtualPool);

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

  // withdraw migration fee
  // creator withdraw migration fee
  await creatorWithdrawMigrationFee(svm, program, {
    creator: poolCreator,
    virtualPool,
  });

  // partner withdraw migration fee
  await partnerWithdrawMigrationFee(svm, program, {
    partner,
    virtualPool,
  });
}
