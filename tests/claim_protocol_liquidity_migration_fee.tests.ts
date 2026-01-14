import {
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  unpackAccount,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  BaseFee,
  ConfigParameters,
  createClaimProtocolFeeOperator,
  createConfig,
  CreateConfigParams,
  createMeteoraMetadata,
  createPoolWithSplToken,
  MigrateMeteoraParams,
  migrateToMeteoraDamm,
  swap,
  SwapMode,
} from "./instructions";
import {
  claimProtocolLiquidityMigrationFee,
  createDammConfig,
  createDammV2DynamicConfig,
  createDammV2Operator,
  createVirtualCurveProgram,
  DammV2OperatorPermission,
  derivePoolAuthority,
  encodePermissions,
  generateAndFund,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  startSvm,
  TREASURY,
  U64_MAX,
} from "./utils";
import { getConfig, getVirtualPool } from "./utils/fetcher";
import { VirtualCurveProgram } from "./utils/types";

import { BN } from "@coral-xyz/anchor";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  createMeteoraDammV2Metadata,
  MigrateMeteoraDammV2Params,
  migrateToDammV2,
} from "./instructions/dammV2Migration";

describe("Claim protocol liquidity migration fee", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;

  before(async () => {
    svm = startSvm();
    admin = generateAndFund(svm);
    operator = generateAndFund(svm);
    partner = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    program = createVirtualCurveProgram();

    await createClaimProtocolFeeOperator(svm, program, {
      operator: operator.publicKey,
      admin,
    });

    await createDammV2Operator(svm, {
      whitelistAddress: admin.publicKey,
      admin,
      permission: encodePermissions([DammV2OperatorPermission.CreateConfigKey]),
    });
  });

  it("Claim protocol liquidity migration fee after migrate to damm v2", async () => {
    const migrationOptionDammV2 = 1;
    const customizableMigrationFeeOption = 6;

    const config = await createDbcConfig(
      svm,
      program,
      migrationOptionDammV2,
      customizableMigrationFeeOption,
      {
        poolFeeBps: 100,
        collectFeeMode: 0,
        dynamicFee: 0,
      },
      partner
    );

    const virtualPoolAddress = await createPoolAndSwapForMigration(
      svm,
      program,
      config,
      poolCreator
    );

    await dammV2Migration(
      svm,
      program,
      poolCreator,
      admin,
      virtualPoolAddress,
      config
    );

    await claimProtocolLiquidityMigrationFeeAndAssert(
      svm,
      program,
      operator,
      config,
      virtualPoolAddress
    );
  });

  it("Claim protocol liquidity migration fee after migrate to damm", async () => {
    const migrationOptionDamm = 0;
    const fixedFeeBps0MigrationFeeOption = 0;

    const config = await createDbcConfig(
      svm,
      program,
      migrationOptionDamm,
      fixedFeeBps0MigrationFeeOption,
      {
        poolFeeBps: 0,
        collectFeeMode: 0,
        dynamicFee: 0,
      },
      partner
    );

    const virtualPoolAddress = await createPoolAndSwapForMigration(
      svm,
      program,
      config,
      poolCreator
    );

    await dammMigration(
      svm,
      admin,
      poolCreator,
      program,
      virtualPoolAddress,
      config
    );

    await claimProtocolLiquidityMigrationFeeAndAssert(
      svm,
      program,
      operator,
      config,
      virtualPoolAddress
    );
  });
});

async function claimProtocolLiquidityMigrationFeeAndAssert(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  operator: Keypair,
  config: PublicKey,
  virtualPoolAddress: PublicKey
) {
  let virtualPoolState = getVirtualPool(svm, program, virtualPoolAddress);

  const configState = getConfig(svm, program, config);

  const treasuryBaseTokenAddress = getAssociatedTokenAddressSync(
    virtualPoolState.baseMint,
    TREASURY,
    true
  );

  const treasuryQuoteTokenAddress = getAssociatedTokenAddressSync(
    configState.quoteMint,
    TREASURY,
    true
  );

  const beforeBaseTokenAccount = svm.getAccount(treasuryBaseTokenAddress);
  const beforeQuoteTokenAccount = svm.getAccount(treasuryQuoteTokenAddress);

  await claimProtocolLiquidityMigrationFee(
    svm,
    operator,
    config,
    virtualPoolAddress
  );

  const afterBaseTokenAccount = svm.getAccount(treasuryBaseTokenAddress);
  const afterQuoteTokenAccount = svm.getAccount(treasuryQuoteTokenAddress);

  const beforeBaseBalance = beforeBaseTokenAccount
    ? unpackAccount(treasuryBaseTokenAddress, {
      ...beforeBaseTokenAccount,
      data: Buffer.from(beforeBaseTokenAccount.data),
    }).amount
    : BigInt(0);

  const beforeQuoteBalance = beforeQuoteTokenAccount
    ? unpackAccount(treasuryQuoteTokenAddress, {
      ...beforeQuoteTokenAccount,
      data: Buffer.from(beforeQuoteTokenAccount.data),
    }).amount
    : BigInt(0);

  const afterBaseBalance = unpackAccount(treasuryBaseTokenAddress, {
    ...afterBaseTokenAccount,
    data: Buffer.from(afterBaseTokenAccount.data),
  }).amount;

  const afterQuoteBalance = unpackAccount(treasuryQuoteTokenAddress, {
    ...afterQuoteTokenAccount,
    data: Buffer.from(afterQuoteTokenAccount.data),
  }).amount;

  expect(afterBaseBalance > beforeBaseBalance).to.be.true;
  expect(afterQuoteBalance > beforeQuoteBalance).to.be.true;
}

async function createDbcConfig(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  migrationOption: number,
  migrationFeeOption: number,
  migratedPoolFee: {
    poolFeeBps: number;
    collectFeeMode: number;
    dynamicFee: number;
  },
  partner: Keypair
): Promise<PublicKey> {
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
    migrationOption,
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
    migrationFeeOption,
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
    migratedPoolBaseFeeMode: 0,
    migratedPoolMarketCapFeeSchedulerParams: null,
    enableFirstSwapWithMinFee: false,
  };
  const params: CreateConfigParams<ConfigParameters> = {
    payer: partner,
    leftoverReceiver: partner.publicKey,
    feeClaimer: partner.publicKey,
    quoteMint: NATIVE_MINT,
    instructionParams,
  };
  const config = await createConfig(svm, program, params);

  return config;
}

async function createPoolAndSwapForMigration(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  config: PublicKey,
  poolCreator: Keypair
) {
  const virtualPool = await createPoolWithSplToken(svm, program, {
    poolCreator,
    payer: poolCreator,
    quoteMint: NATIVE_MINT,
    config,
    instructionParams: {
      name: "test token spl",
      symbol: "TEST",
      uri: "abc.com",
    },
  });
  const virtualPoolState = getVirtualPool(svm, program, virtualPool);

  await swap(svm, program, {
    config,
    payer: poolCreator,
    pool: virtualPool,
    inputTokenMint: NATIVE_MINT,
    outputTokenMint: virtualPoolState.baseMint,
    amountIn: new BN(LAMPORTS_PER_SOL * 5.5),
    minimumAmountOut: new BN(0),
    swapMode: SwapMode.PartialFill,
    referralTokenAccount: null,
  });

  return virtualPool;
}

async function dammV2Migration(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  poolCreator: Keypair,
  admin: Keypair,
  virtualPoolAddress: PublicKey,
  config: PublicKey
) {
  await createMeteoraDammV2Metadata(svm, program, {
    payer: poolCreator,
    virtualPool: virtualPoolAddress,
    config,
  });

  const poolAuthority = derivePoolAuthority();
  const dammConfig = await createDammV2DynamicConfig(svm, admin, poolAuthority);
  const migrationParams: MigrateMeteoraDammV2Params = {
    payer: admin,
    virtualPool: virtualPoolAddress,
    dammConfig,
  };

  await migrateToDammV2(svm, program, migrationParams);
}

async function dammMigration(
  svm: LiteSVM,
  admin: Keypair,
  poolCreator: Keypair,
  program: VirtualCurveProgram,
  virtualPool: PublicKey,
  config: PublicKey
) {
  const poolAuthority = derivePoolAuthority();
  const dammConfig = await createDammConfig(svm, admin, poolAuthority);
  const migrationParams: MigrateMeteoraParams = {
    payer: poolCreator,
    virtualPool,
    dammConfig,
  };
  await createMeteoraMetadata(svm, program, {
    payer: admin,
    virtualPool,
    config,
  });

  await migrateToMeteoraDamm(svm, program, migrationParams);
}
