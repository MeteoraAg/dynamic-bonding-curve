import { NATIVE_MINT } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  BaseFee,
  ConfigParameters,
  createConfig,
  CreateConfigParams,
  createPoolWithSplToken,
  swap,
  SwapMode,
} from "./instructions";
import {
  createDammV2DynamicConfig,
  createVirtualCurveProgram,
  derivePoolAuthority,
  FLASH_RENT_FUND,
  generateAndFund,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  startSvm,
  U64_MAX,
} from "./utils";
import { getConfig, getDammV2Pool, getVirtualPool } from "./utils/fetcher";
import { VirtualCurveProgram } from "./utils/types";

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
      migratedPoolFee
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
    expect(dammPoolState.poolFees.baseFee.cliffFeeNumerator.toNumber()).eq(
      poolFeeNumerator
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
  }
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
    partnerLpPercentage: 20,
    creatorLpPercentage: 20,
    partnerLockedLpPercentage: 55,
    creatorLockedLpPercentage: 5,
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
    migratedPoolFee,
    padding: [],
    curve: curves,
  };
  const params: CreateConfigParams = {
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
