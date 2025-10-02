import BN from "bn.js";
import { BanksClient, ProgramTestContext } from "solana-bankrun";
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
import { VirtualCurveProgram } from "./utils/types";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  designCurve,
  fundSol,
  getTokenAccount,
  getTokenProgram,
  startTest,
} from "./utils";
import {
  createDammConfig,
  createVirtualCurveProgram,
  derivePoolAuthority,
} from "./utils";
import { getConfig, getVirtualPool } from "./utils/fetcher";
import {
  createMeteoraMetadata,
  MigrateMeteoraParams,
  migrateToMeteoraDamm,
} from "./instructions/meteoraMigration";
import { expect } from "chai";
import { createToken, mintSplTokenTo } from "./utils/token";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

describe("Migration fee", () => {
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
    const creatorTokenAccountState = await getTokenAccount(
      context.banksClient,
      creatorTokenQuoteAccount
    );
    const preCreatorBalance = creatorTokenAccountState
      ? Number(creatorTokenAccountState.amount)
      : 0;

    const partnerTokenAccountState = await getTokenAccount(
      context.banksClient,
      partnerTokenQuoteAccount
    );
    const prePartnerBalance = partnerTokenAccountState
      ? Number(partnerTokenAccountState.amount)
      : 0;

    await fullFlow(
      context.banksClient,
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
      (await getTokenAccount(context.banksClient, creatorTokenQuoteAccount))
        .amount ?? 0
    );

    const postPartnerBalance = Number(
      (await getTokenAccount(context.banksClient, partnerTokenQuoteAccount))
        .amount ?? 0
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
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  config: PublicKey,
  poolCreator: Keypair,
  user: Keypair,
  admin: Keypair,
  quoteMint: PublicKey,
  partner: Keypair
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
    swapMode: SwapMode.ExactIn,
    referralTokenAccount: null,
  };
  await swap(banksClient, program, params);

  virtualPoolState = await getVirtualPool(banksClient, program, virtualPool);

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

  // withdraw migration fee
  // creator withdraw migration fee
  await creatorWithdrawMigrationFee(banksClient, program, {
    creator: poolCreator,
    virtualPool,
  });

  // partner withdraw migration fee
  await partnerWithdrawMigrationFee(banksClient, program, {
    partner,
    virtualPool,
  });
}
