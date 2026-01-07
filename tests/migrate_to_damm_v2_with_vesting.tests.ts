import { NATIVE_MINT } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  ConfigParameters,
  createConfig,
  CreateConfigParams,
  createPoolWithSplToken,
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
  designGraphCurve,
  encodePermissions,
  generateAndFund,
  startSvm,
} from "./utils";
import { getVirtualPool } from "./utils/fetcher";
import { PoolConfig, VirtualCurveProgram } from "./utils/types";

import { BN, IdlAccounts } from "@coral-xyz/anchor";
import { expect } from "chai";
import Decimal from "decimal.js";
import { LiteSVM } from "litesvm";
import {
  MigrateMeteoraDammV2Params,
  migrateToDammV2,
} from "./instructions/dammV2Migration";
import { CpAmm } from "./utils/idl/damm_v2";

type DammV2Pool = IdlAccounts<CpAmm>["pool"];
type DammV2Position = IdlAccounts<CpAmm>["position"];

describe("Migrate to damm v2 with vesting", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let user: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;

  let totalTokenSupply = 1_000_000_000; // 1 billion
  let initialMarketcap = 30; // 30 SOL;
  let migrationMarketcap = 300; // 300 SOL;
  let tokenBaseDecimal = 6;
  let tokenQuoteDecimal = 9;
  let kFactor = 1.2;

  let leftOver = 10_000;

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

  it("Full flow migrated to damm v2 with vesting", async () => {
    const migratedPoolFee = {
      poolFeeBps: 100,
      collectFeeMode: 0,
      dynamicFee: 0,
    };

    const { pool, firstPosition, secondPosition, poolConfig } = await fullFlow(
      svm,
      program,
      admin,
      partner,
      poolCreator,
      operator,
      user,
      migratedPoolFee,
      totalTokenSupply,
      initialMarketcap,
      migrationMarketcap,
      tokenBaseDecimal,
      tokenQuoteDecimal,
      kFactor,
      leftOver
    );

    const poolConfigAccount = await svm.getAccount(poolConfig);
    const poolConfigState: PoolConfig = program.coder.accounts.decode(
      "poolConfig",
      Buffer.from(poolConfigAccount!.data)
    );

    const dammV2Program = createDammV2Program();
    const poolAccount = await svm.getAccount(pool);
    const firstPositionAccount = await svm.getAccount(firstPosition);
    const secondPositionAccount = await svm.getAccount(secondPosition);

    const poolState: DammV2Pool = dammV2Program.coder.accounts.decode(
      "pool",
      Buffer.from(poolAccount!.data)
    );

    const firstPositionState: DammV2Position =
      dammV2Program.coder.accounts.decode(
        "position",
        Buffer.from(firstPositionAccount!.data)
      );
    const secondPositionState: DammV2Position =
      dammV2Program.coder.accounts.decode(
        "position",
        Buffer.from(secondPositionAccount!.data)
      );

    const firstPositionTotalLiquidity = firstPositionState.vestedLiquidity
      .add(firstPositionState.unlockedLiquidity)
      .add(firstPositionState.permanentLockedLiquidity);

    const secondPositionTotalLiquidity = secondPositionState.vestedLiquidity
      .add(secondPositionState.unlockedLiquidity)
      .add(secondPositionState.permanentLockedLiquidity);

    expect(poolState.liquidity.toString()).equal(
      firstPositionTotalLiquidity.add(secondPositionTotalLiquidity).toString()
    );

    const totalLockedLiquidityPct = new Decimal(
      poolState.permanentLockLiquidity.toString()
    )
      .mul(100)
      .div(poolState.liquidity.toString())
      .round();

    const expectedTotalLockedLiquidityPct =
      poolConfigState.creatorPermanentLockedLiquidityPercentage +
      poolConfigState.partnerPermanentLockedLiquidityPercentage;

    expect(totalLockedLiquidityPct.toNumber()).equal(
      expectedTotalLockedLiquidityPct
    );

    const totalVestedLiquidityPct = new Decimal(
      firstPositionState.vestedLiquidity.toString()
    )
      .add(new Decimal(secondPositionState.vestedLiquidity.toString()))
      .mul(100)
      .div(poolState.liquidity.toString())
      .round();

    const expectedTotalVestedLiquidityPct =
      poolConfigState.creatorLiquidityVestingInfo.vestingPercentage +
      poolConfigState.partnerLiquidityVestingInfo.vestingPercentage;

    expect(totalVestedLiquidityPct.toNumber()).equal(
      expectedTotalVestedLiquidityPct
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
  totalTokenSupply: number,
  initialMarketcap: number,
  migrationMarketcap: number,
  tokenBaseDecimal: number,
  tokenQuoteDecimal: number,
  kFactor: number,
  leftOver: number
): Promise<{
  pool: PublicKey;
  poolConfig: PublicKey;
  dammConfig: PublicKey;
  firstPosition: PublicKey;
  secondPosition: PublicKey;
}> {
  let instructionParams = designGraphCurve(
    totalTokenSupply,
    initialMarketcap,
    migrationMarketcap,
    0,
    tokenBaseDecimal,
    tokenQuoteDecimal,
    0,
    0,
    {
      amountPerPeriod: new BN(0),
      cliffDurationFromMigrationTime: new BN(0),
      frequency: new BN(0),
      numberOfPeriod: new BN(0),
      cliffUnlockAmount: new BN(0),
    },
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

  const configParams: ConfigParameters = {
    ...instructionParams,
    creatorLiquidityPercentage: 5,
    creatorPermanentLockedLiquidityPercentage: 5,
    creatorLiquidityVestingInfo: {
      cliffDurationFromMigrationTime: 86400 / 2,
      vestingPercentage: 40,
      bpsPerPeriod: 100,
      frequency: 3600,
      // 20% cliff unlock
      numberOfPeriods: (10_000 - 2_000) / 100,
    },
    partnerLiquidityPercentage: 5,
    partnerPermanentLockedLiquidityPercentage: 5,
    partnerLiquidityVestingInfo: {
      cliffDurationFromMigrationTime: 86400 / 2,
      vestingPercentage: 40,
      bpsPerPeriod: 100,
      frequency: 3600,
      // 20% cliff unlock
      numberOfPeriods: (10_000 - 2_000) / 100,
    },
    migrationOption: 1,
    migrationFeeOption: 6, // customizable
    migratedPoolFee: {
      poolFeeBps: 100,
      collectFeeMode: 0,
      dynamicFee: 0,
    },
  };

  const params: CreateConfigParams<ConfigParameters> = {
    payer: partner,
    leftoverReceiver: partner.publicKey,
    feeClaimer: partner.publicKey,
    quoteMint: NATIVE_MINT,
    instructionParams: configParams,
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
  const virtualPoolState = await getVirtualPool(svm, program, virtualPool);

  console.log("swap full curve");
  await swap(svm, program, {
    config,
    payer: user,
    pool: virtualPool,
    inputTokenMint: NATIVE_MINT,
    outputTokenMint: virtualPoolState.baseMint,
    amountIn: instructionParams.migrationQuoteThreshold
      .mul(new BN(120))
      .div(new BN(100)),
    minimumAmountOut: new BN(0),
    swapMode: SwapMode.PartialFill,
    referralTokenAccount: null,
  });

  const poolAuthority = derivePoolAuthority();
  const dammConfig = await createDammV2DynamicConfig(svm, admin, poolAuthority);
  const migrationParams: MigrateMeteoraDammV2Params = {
    payer: admin,
    virtualPool,
    dammConfig,
  };

  const {
    dammPool: pool,
    firstPosition,
    secondPosition,
  } = await migrateToDammV2(svm, program, migrationParams);

  return {
    pool,
    poolConfig: config,
    dammConfig,
    firstPosition,
    secondPosition,
  };
}
