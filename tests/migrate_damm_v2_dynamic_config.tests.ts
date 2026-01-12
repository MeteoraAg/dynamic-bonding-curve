import { NATIVE_MINT } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  BaseFee,
  ConfigParameters,
  createConfig,
  CreateConfigParams,
  createPoolWithSplToken,
  MigratedPoolMarketCapFeeSchedulerParams,
  swap,
  SwapMode,
} from "./instructions";
import {
  createDammV2DynamicConfig,
  createDammV2Operator,
  createDammV2Program,
  createVirtualCurveProgram,
  DammV2OperatorPermission,
  derivePoolAuthority,
  encodePermissions,
  FLASH_RENT_FUND,
  generateAndFund,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  startSvm,
  U64_MAX,
} from "./utils";
import { getConfig, getDammV2Pool, getVirtualPool } from "./utils/fetcher";
import {
  PodAlignedFeeMarketCapScheduler,
  PodAlignedFeeTimeScheduler,
  VirtualCurveProgram,
} from "./utils/types";

import { BN } from "@coral-xyz/anchor";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  convertCollectFeeModeToDammv2,
  createMeteoraDammV2Metadata,
  MigrateMeteoraDammV2Params,
  migrateToDammV2,
} from "./instructions/dammV2Migration";

describe("Migrate to damm v2 with dynamic config pool", () => {
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

    await createDammV2Operator(svm, {
      whitelistAddress: admin.publicKey,
      admin,
      permission: encodePermissions([DammV2OperatorPermission.CreateConfigKey]),
    });
  });

  it("Full flow migrated to damm v2 new create pool endpoint", async () => {
    const migratedPoolFee = {
      poolFeeBps: 100,
      collectFeeMode: 0,
      dynamicFee: 0,
    };

    const poolAuthority = derivePoolAuthority();

    const beforePoolAuthorityLamport = svm.getBalance(poolAuthority);

    expect(beforePoolAuthorityLamport.toString()).eq(
      FLASH_RENT_FUND.toString()
    );

    const { pool, poolConfig } = await fullFlow(
      svm,
      program,
      admin,
      partner,
      poolCreator,
      operator,
      user,
      migratedPoolFee,
      0,
      {
        schedulerExpirationDuration: 0,
        sqrtPriceStepBps: 0,
        reductionFactor: new BN(0),
        numberOfPeriod: 0,
      }
    );

    const afterPoolAuthorityLamport = svm.getBalance(poolAuthority);

    expect(afterPoolAuthorityLamport.toString()).eq(FLASH_RENT_FUND.toString());

    const dammPoolState = getDammV2Pool(svm, pool);
    const poolConfigState = getConfig(svm, program, poolConfig);
    // validate pool config
    expect(poolConfigState.migratedDynamicFee).eq(migratedPoolFee.dynamicFee);
    expect(poolConfigState.collectFeeMode).eq(migratedPoolFee.collectFeeMode);
    const feeBpsValue = poolConfigState.migratedPoolFeeBps;
    expect(feeBpsValue).eq(migratedPoolFee.poolFeeBps);

    // validate pool state
    const poolFeeNumerator =
      (migratedPoolFee.poolFeeBps * 1_000_000_000) / 10_000;

    const dammV2Program = createDammV2Program();
    const feeSchedulerInfo: PodAlignedFeeTimeScheduler =
      dammV2Program.coder.types.decode(
        "podAlignedFeeTimeScheduler",
        Buffer.from(dammPoolState.poolFees.baseFee.baseFeeInfo.data)
      );

    expect(feeSchedulerInfo.cliffFeeNumerator.toNumber()).eq(poolFeeNumerator);
    expect(dammPoolState.collectFeeMode).eq(
      convertCollectFeeModeToDammv2(migratedPoolFee.collectFeeMode)
    );
    expect(dammPoolState.poolFees.dynamicFee.initialized).eq(
      migratedPoolFee.dynamicFee
    );
  });

  it("Full flow migrated to damm v2 with fee market cap scheduler", async () => {
    const migratedPoolFee = {
      poolFeeBps: 1000,
      collectFeeMode: 0,
      dynamicFee: 1,
    };

    const poolAuthority = derivePoolAuthority();

    const beforePoolAuthorityLamport = svm.getBalance(poolAuthority);

    expect(beforePoolAuthorityLamport.toString()).eq(
      FLASH_RENT_FUND.toString()
    );

    const marketCapFeeSchedulerParams: MigratedPoolMarketCapFeeSchedulerParams =
      {
        schedulerExpirationDuration: 86400,
        sqrtPriceStepBps: 100,
        reductionFactor: new BN(900000),
        numberOfPeriod: 100,
      };

    const { pool, poolConfig } = await fullFlow(
      svm,
      program,
      admin,
      partner,
      poolCreator,
      operator,
      user,
      migratedPoolFee,
      3, // FeeMarketCap
      marketCapFeeSchedulerParams
    );

    const dammPoolState = getDammV2Pool(svm, pool);
    const poolConfigState = getConfig(svm, program, poolConfig);

    // validate pool config
    expect(poolConfigState.migratedDynamicFee).eq(migratedPoolFee.dynamicFee);
    expect(poolConfigState.collectFeeMode).eq(migratedPoolFee.collectFeeMode);
    const feeBpsValue = poolConfigState.migratedPoolFeeBps;
    expect(feeBpsValue).eq(migratedPoolFee.poolFeeBps);

    // validate pool state
    const poolFeeNumerator =
      (migratedPoolFee.poolFeeBps * 1_000_000_000) / 10_000;

    const dammV2Program = createDammV2Program();
    const feeSchedulerInfo: PodAlignedFeeMarketCapScheduler =
      dammV2Program.coder.types.decode(
        "podAlignedFeeMarketCapScheduler",
        Buffer.from(dammPoolState.poolFees.baseFee.baseFeeInfo.data)
      );

    expect(feeSchedulerInfo.cliffFeeNumerator.toNumber()).eq(poolFeeNumerator);
    expect(feeSchedulerInfo.baseFeeMode).eq(3); // FeeMarketCap
    expect(feeSchedulerInfo.schedulerExpirationDuration).eq(
      marketCapFeeSchedulerParams.schedulerExpirationDuration
    );
    expect(feeSchedulerInfo.sqrtPriceStepBps).eq(
      marketCapFeeSchedulerParams.sqrtPriceStepBps
    );
    expect(
      feeSchedulerInfo.reductionFactor.eq(
        marketCapFeeSchedulerParams.reductionFactor
      )
    ).to.be.true;
    expect(feeSchedulerInfo.numberOfPeriod).to.eq(
      marketCapFeeSchedulerParams.numberOfPeriod
    );

    expect(dammPoolState.collectFeeMode).eq(
      convertCollectFeeModeToDammv2(migratedPoolFee.collectFeeMode)
    );
    expect(dammPoolState.poolFees.dynamicFee.initialized).eq(
      migratedPoolFee.dynamicFee
    );
  });
});

async function fullFlow(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  admin: Keypair,
  partner: Keypair,
  poolCreator: Keypair,
  operator: Keypair,
  user: Keypair,
  migratedPoolFee: {
    poolFeeBps: number;
    collectFeeMode: number;
    dynamicFee: number;
  },
  migratedPoolBaseFeeMode: number,
  migratedPoolMarketCapFeeSchedulerParams: MigratedPoolMarketCapFeeSchedulerParams
): Promise<{
  pool: PublicKey;
  poolConfig: PublicKey;
  dammConfig: PublicKey;
}> {
  // partner create config
  const baseFee: BaseFee = {
    cliffFeeNumerator: new BN(2_500_000),
    firstFactor: 0,
    secondFactor: new BN(0),
    thirdFactor: new BN(0),
    baseFeeMode: 0,
  };

  const curves = [];

  for (let i = 1; i <= 16; i++) {
    if (i == 16) {
      curves.push({
        sqrtPrice: MAX_SQRT_PRICE,
        liquidity: U64_MAX.shln(30 + i),
      });
    } else {
      curves.push({
        sqrtPrice: MAX_SQRT_PRICE.muln(i * 5).divn(100),
        liquidity: U64_MAX.shln(30 + i),
      });
    }
  }

  const instructionParams: ConfigParameters = {
    poolFees: {
      baseFee,
      dynamicFee: null,
    },
    activationType: 0,
    collectFeeMode: 0,
    migrationOption: 1, // damm v2
    tokenType: 0, // spl_token
    tokenDecimal: 6,
    migrationQuoteThreshold: new BN(LAMPORTS_PER_SOL * 5),
    partnerLiquidityPercentage: 20,
    creatorLiquidityPercentage: 20,
    partnerPermanentLockedLiquidityPercentage: 55,
    creatorPermanentLockedLiquidityPercentage: 5,
    sqrtStartPrice: MIN_SQRT_PRICE.shln(32),
    lockedVesting: {
      amountPerPeriod: new BN(0),
      cliffDurationFromMigrationTime: new BN(0),
      frequency: new BN(0),
      numberOfPeriod: new BN(0),
      cliffUnlockAmount: new BN(0),
    },
    migrationFeeOption: 6, // customizable
    tokenSupply: null,
    creatorTradingFeePercentage: 0,
    tokenUpdateAuthority: 0,
    migrationFee: {
      feePercentage: 0,
      creatorFeePercentage: 0,
    },
    poolCreationFee: new BN(0),
    migratedPoolFee,
    curve: curves,
    creatorLiquidityVestingInfo: {
      vestingPercentage: 0,
      cliffDurationFromMigrationTime: 0,
      bpsPerPeriod: 0,
      numberOfPeriods: 0,
      frequency: 0,
    },
    partnerLiquidityVestingInfo: {
      vestingPercentage: 0,
      cliffDurationFromMigrationTime: 0,
      bpsPerPeriod: 0,
      numberOfPeriods: 0,
      frequency: 0,
    },
    enableFirstSwapWithMinFee: false,
    migratedPoolBaseFeeMode,
    migratedPoolMarketCapFeeSchedulerParams,
  };
  const params: CreateConfigParams<ConfigParameters> = {
    payer: partner,
    leftoverReceiver: partner.publicKey,
    feeClaimer: partner.publicKey,
    quoteMint: NATIVE_MINT,
    instructionParams,
  };
  const config = await createConfig(svm, program, params);

  console.log("create pool");
  const virtualPool = await createPoolWithSplToken(svm, program, {
    poolCreator,
    payer: operator,
    quoteMint: NATIVE_MINT,
    config,
    instructionParams: {
      name: "test token spl",
      symbol: "TEST",
      uri: "abc.com",
    },
  });
  const virtualPoolState = getVirtualPool(svm, program, virtualPool);

  console.log("swap full curve");
  await swap(svm, program, {
    config,
    payer: user,
    pool: virtualPool,
    inputTokenMint: NATIVE_MINT,
    outputTokenMint: virtualPoolState.baseMint,
    amountIn: new BN(LAMPORTS_PER_SOL * 5.5),
    minimumAmountOut: new BN(0),
    swapMode: SwapMode.PartialFill,
    referralTokenAccount: null,
  });

  console.log("Create meteora damm v2 metadata");
  await createMeteoraDammV2Metadata(svm, program, {
    payer: admin,
    virtualPool,
    config,
  });

  console.log("Create meteora damm v2 dynamic config");
  const poolAuthority = derivePoolAuthority();
  const dammConfig = await createDammV2DynamicConfig(svm, admin, poolAuthority);
  const migrationParams: MigrateMeteoraDammV2Params = {
    payer: admin,
    virtualPool,
    dammConfig,
  };

  console.log("migrate to damm v2");
  const { dammPool: pool } = await migrateToDammV2(
    svm,
    program,
    migrationParams
  );

  return { pool, poolConfig: config, dammConfig };
}
