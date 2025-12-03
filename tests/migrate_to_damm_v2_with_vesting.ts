import { NATIVE_MINT } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  CreateConfigParams,
  createDammV2OnlyConfig,
  createPoolWithSplToken,
  DammV2ConfigParameters,
  swap,
  SwapMode,
} from "./instructions";
import {
  createDammV2DynamicConfig,
  createDammV2Program,
  createVirtualCurveProgram,
  derivePoolAuthority,
  designGraphCurve,
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
      poolConfigState.creatorLockedLpPercentage +
      poolConfigState.partnerLockedLpPercentage;

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
      poolConfigState.creatorLpVestingInfo.vestingPercentage +
      poolConfigState.partnerLpVestingInfo.vestingPercentage;

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

  const dammV2ConfigsParams: DammV2ConfigParameters = {
    virtualPoolConfiguration: {
      sqrtStartPrice: instructionParams.sqrtStartPrice,
      migrationQuoteThreshold: instructionParams.migrationQuoteThreshold,
      activationType: instructionParams.activationType,
    },
    virtualPoolFeesConfiguration: {
      baseFee: instructionParams.poolFees.baseFee,
      dynamicFee: instructionParams.poolFees.dynamicFee,
      collectFeeMode: instructionParams.collectFeeMode,
      creatorTradingFeePercentage:
        instructionParams.creatorTradingFeePercentage,
      poolCreationFee: new BN(0),
    },
    mintConfiguration: {
      tokenDecimal: instructionParams.tokenDecimal,
      tokenSupply: instructionParams.tokenSupply,
      tokenUpdateAuthority: instructionParams.tokenUpdateAuthority,
      tokenType: instructionParams.tokenType,
      lockedVesting: instructionParams.lockedVesting,
    },
    liquidityDistributionConfiguration: {
      creatorLpInfo: {
        // 5% liquid
        lpPercentage: 5,
        // 5% permanent lock
        lpPermanentLockPercentage: 5,
        lpVestingInfo: {
          cliffDurationFromMigrationTime: 86400 / 2,
          vestingPercentage: 40,
          bpsPerPeriod: 100,
          frequency: new BN(3600),
          // 20% cliff unlock
          numberOfPeriods: (10_000 - 2_000) / 100,
        },
      },
      partnerLpInfo: {
        // 5% liquid
        lpPercentage: 5,
        // 5% permanent lock
        lpPermanentLockPercentage: 5,
        lpVestingInfo: {
          cliffDurationFromMigrationTime: 86400 / 2,
          vestingPercentage: 40,
          bpsPerPeriod: 100,
          frequency: new BN(3600),
          // 20% cliff unlock
          numberOfPeriods: (10_000 - 2_000) / 100,
        },
      },
    },
    dammV2MigrationConfiguration: {
      migrationFee: {
        feePercentage: 0,
        creatorFeePercentage: 0,
      },
      migratedPoolFee,
    },
    curve: instructionParams.curve,
  };

  const params: CreateConfigParams<DammV2ConfigParameters> = {
    payer: partner,
    leftoverReceiver: partner.publicKey,
    feeClaimer: partner.publicKey,
    quoteMint: NATIVE_MINT,
    instructionParams: dammV2ConfigsParams,
  };
  const config = await createDammV2OnlyConfig(svm, program, params);

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
