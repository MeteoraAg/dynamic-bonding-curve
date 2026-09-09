import { NATIVE_MINT } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  BaseFee,
  ClaimCreatorTradeFeeParams,
  claimCreatorTradingFee,
  claimTradingFee,
  ClaimTradeFeeParams,
  ConfigParameters,
  createConfig,
  CreateConfigParams,
  createLocker,
  createPoolWithSplToken,
  creatorWithdrawMigrationFee,
  creatorWithdrawSurplus,
  partnerWithdrawMigrationFee,
  partnerWithdrawSurplus,
  swap,
  SwapMode,
  SwapParams,
  transferCreator,
  withdrawLeftover,
} from "./instructions";
import {
  createMeteoraMetadata,
  creatorClaimLpDamm,
  lockLpForCreatorDamm,
  lockLpForPartnerDamm,
  MigrateMeteoraParams,
  migrateToMeteoraDamm,
  partnerClaimLpDamm,
} from "./instructions/meteoraMigration";
import {
  createDammConfig,
  createVirtualCurveProgram,
  derivePoolAuthority,
  designCurve,
  expectThrowsAsync,
  generateAndFund,
  getDbcProgramErrorCodeHexString,
  MAX_SQRT_PRICE,
  METEORA_DAMM_MIGRATION_OPTION,
  MIN_SQRT_PRICE,
  setDeprecatedMeteoraDammConfig,
  startSvm,
  U64_MAX,
} from "./utils";
import { getConfig, getVirtualPool } from "./utils/fetcher";
import { createToken, mintSplTokenTo } from "./utils/token";
import { VirtualCurveProgram } from "./utils/types";

const DAMM_V2_MIGRATION_OPTION = 1;

const DEPRECATED_MIGRATION_OPTION = getDbcProgramErrorCodeHexString(
  "DeprecatedMigrationOption"
);
const NOT_PERMIT_TO_DO_THIS_ACTION = getDbcProgramErrorCodeHexString(
  "NotPermitToDoThisAction"
);

const poolParams = {
  name: "test token",
  symbol: "TEST",
  uri: "abc.com",
};

describe("Deprecated meteora damm migration", () => {
  let svm: LiteSVM;
  let partner: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;
  let instructionParams: ConfigParameters;

  beforeEach(async () => {
    svm = startSvm();
    partner = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    program = createVirtualCurveProgram();

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

    const baseFee: BaseFee = {
      cliffFeeNumerator: new BN(2_500_000),
      firstFactor: 0,
      secondFactor: new BN(0),
      thirdFactor: new BN(0),
      baseFeeMode: 0,
    };

    instructionParams = {
      poolFees: {
        baseFee,
        dynamicFee: null,
      },
      activationType: 0,
      collectFeeMode: 0,
      migrationOption: DAMM_V2_MIGRATION_OPTION,
      tokenType: 0, // spl token
      tokenDecimal: 6,
      migrationQuoteThreshold: new BN(LAMPORTS_PER_SOL * 5),
      partnerLiquidityPercentage: 0,
      creatorLiquidityPercentage: 0,
      partnerPermanentLockedLiquidityPercentage: 95,
      creatorPermanentLockedLiquidityPercentage: 5,
      sqrtStartPrice: MIN_SQRT_PRICE.shln(32),
      lockedVesting: {
        amountPerPeriod: new BN(0),
        cliffDurationFromMigrationTime: new BN(0),
        frequency: new BN(0),
        numberOfPeriod: new BN(0),
        cliffUnlockAmount: new BN(0),
      },
      migrationFeeOption: 0,
      tokenSupply: null,
      creatorTradingFeePercentage: 0,
      tokenUpdateAuthority: 0,
      migrationFee: {
        feePercentage: 0,
        creatorFeePercentage: 0,
      },
      migratedPoolFee: {
        collectFeeMode: 0,
        dynamicFee: 0,
        poolFeeBps: 0,
      },
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
      poolCreationFee: new BN(0),
      migratedPoolBaseFeeMode: 0,
      migratedPoolMarketCapFeeSchedulerParams: null,
      enableFirstSwapWithMinFee: false,
      compoundingFeeBps: 0,
      curve: curves,
    };
  });

  it("Patches an existing config into meteora damm migration option", async () => {
    const config = await createConfig(svm, program, {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: NATIVE_MINT,
      instructionParams,
    });

    const beforePatch = getConfig(svm, program, config);
    expect(beforePatch.migrationOption).eq(DAMM_V2_MIGRATION_OPTION);

    setDeprecatedMeteoraDammConfig(svm, config);

    const afterPatch = getConfig(svm, program, config);
    expect(afterPatch.migrationOption).eq(METEORA_DAMM_MIGRATION_OPTION);
    expect(afterPatch.collectFeeMode).eq(beforePatch.collectFeeMode);
    expect(afterPatch.activationType).eq(beforePatch.activationType);
    expect(afterPatch.tokenType).eq(beforePatch.tokenType);
  });

  it("Fails to create config with meteora damm migration option", async () => {
    instructionParams.migrationOption = METEORA_DAMM_MIGRATION_OPTION;

    const params: CreateConfigParams<ConfigParameters> = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: NATIVE_MINT,
      instructionParams,
    };

    await expectThrowsAsync(async () => {
      await createConfig(svm, program, params);
    }, DEPRECATED_MIGRATION_OPTION);
  });

  it("Fails to create spl token pool from a meteora damm config", async () => {
    const config = await createConfig(svm, program, {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: NATIVE_MINT,
      instructionParams,
    });
    setDeprecatedMeteoraDammConfig(svm, config);

    await expectThrowsAsync(async () => {
      await createPoolWithSplToken(svm, program, {
        poolCreator,
        payer: poolCreator,
        quoteMint: NATIVE_MINT,
        config,
        instructionParams: poolParams,
      });
    }, DEPRECATED_MIGRATION_OPTION);
  });
});

// A pool created before the deprecation, against a config that still holds
// MigrationOption::MeteoraDamm, must be able to run the whole DAMM v1 lifecycle.
// The config is created as DAMM v2 and patched to DAMM v1 after the pool exists,
// because create_config and initialize_pool now reject DAMM v1.
describe("Existing meteora damm pool lifecycle", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let partner: Keypair;
  let poolCreator: Keypair;
  let newCreator: Keypair;
  let user: Keypair;
  let program: VirtualCurveProgram;
  let quoteMint: PublicKey;
  let config: PublicKey;
  let virtualPool: PublicKey;
  let dammConfig: PublicKey;

  const totalTokenSupply = 1_000_000_000; // 1 billion
  // 0.9% keeps designCurve fixed-supply math consistent with a migration fee
  const percentageSupplyOnMigration = 0.9;
  const migrationQuoteThreshold = 300; // 300 quote tokens
  const tokenBaseDecimal = 6;
  const tokenQuoteDecimal = 9;
  const creatorTradingFeePercentage = 50;
  const collectFeeMode = 0; // both tokens, so the pool ends with a surplus
  const lockedVesting = {
    amountPerPeriod: new BN(123456),
    cliffDurationFromMigrationTime: new BN(0),
    frequency: new BN(1),
    numberOfPeriod: new BN(120),
    cliffUnlockAmount: new BN(123456),
  };
  const migrationFee = {
    feePercentage: 10,
    creatorFeePercentage: 50,
  };

  before(async () => {
    svm = startSvm();
    admin = generateAndFund(svm);
    partner = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    newCreator = generateAndFund(svm);
    user = generateAndFund(svm);
    program = createVirtualCurveProgram();
    quoteMint = createToken(svm, admin, admin.publicKey, tokenQuoteDecimal);
  });

  it("Partner creates a config with fixed supply, locked vesting and migration fee", async () => {
    const instructionParams = designCurve(
      totalTokenSupply,
      percentageSupplyOnMigration,
      migrationQuoteThreshold,
      DAMM_V2_MIGRATION_OPTION,
      tokenBaseDecimal,
      tokenQuoteDecimal,
      creatorTradingFeePercentage,
      collectFeeMode,
      lockedVesting,
      migrationFee
    );
    // give partner and creator both locked and claimable LP so every
    // lock and claim instruction has something to do
    instructionParams.partnerLiquidityPercentage = 20;
    instructionParams.creatorLiquidityPercentage = 20;
    instructionParams.partnerPermanentLockedLiquidityPercentage = 55;
    instructionParams.creatorPermanentLockedLiquidityPercentage = 5;

    const params: CreateConfigParams<ConfigParameters> = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint,
      instructionParams,
    };
    config = await createConfig(svm, program, params);

    const configState = getConfig(svm, program, config);
    expect(configState.migrationOption).eq(DAMM_V2_MIGRATION_OPTION);
    expect(configState.fixedTokenSupplyFlag).eq(1);
    expect(configState.lockedVestingConfig.frequency.toNumber()).eq(1);
    expect(configState.migrationFeePercentage).eq(migrationFee.feePercentage);
  });

  it("Creates the pool, then the config becomes a meteora damm config", async () => {
    virtualPool = await createPoolWithSplToken(svm, program, {
      payer: poolCreator,
      poolCreator,
      quoteMint,
      config,
      instructionParams: poolParams,
    });
    setDeprecatedMeteoraDammConfig(svm, config);

    expect(getConfig(svm, program, config).migrationOption).eq(
      METEORA_DAMM_MIGRATION_OPTION
    );
  });

  it("Swaps over the curve", async () => {
    const configState = getConfig(svm, program, config);
    const virtualPoolState = getVirtualPool(svm, program, virtualPool);
    // 20% over the threshold so that a surplus exists after migration
    const amountIn = configState.migrationQuoteThreshold
      .mul(new BN(6))
      .div(new BN(5));
    mintSplTokenTo(
      svm,
      user,
      quoteMint,
      admin,
      user.publicKey,
      amountIn.toNumber()
    );

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
  });

  it("Creates the locker for locked vesting", async () => {
    await createLocker(svm, program, {
      payer: admin,
      virtualPool,
    });
    expect(getVirtualPool(svm, program, virtualPool).migrationProgress).eq(2);
  });

  it("Creates meteora damm migration metadata", async () => {
    await createMeteoraMetadata(svm, program, {
      payer: admin,
      virtualPool,
      config,
    });
  });

  it("Migrates to meteora damm", async () => {
    const poolAuthority = derivePoolAuthority();
    dammConfig = await createDammConfig(svm, admin, poolAuthority);
    const migrationParams: MigrateMeteoraParams = {
      payer: admin,
      virtualPool,
      dammConfig,
    };
    await migrateToMeteoraDamm(svm, program, migrationParams);
    expect(getVirtualPool(svm, program, virtualPool).migrationProgress).eq(3);
  });

  it("Rejects transfer pool creator before LP is locked and claimed", async () => {
    await expectThrowsAsync(async () => {
      await transferCreator(
        svm,
        program,
        virtualPool,
        poolCreator,
        newCreator.publicKey
      );
    }, NOT_PERMIT_TO_DO_THIS_ACTION);
  });

  it("Partner locks LP", async () => {
    await lockLpForPartnerDamm(svm, program, {
      payer: admin,
      dammConfig,
      virtualPool,
    });
  });

  it("Creator locks LP", async () => {
    await lockLpForCreatorDamm(svm, program, {
      payer: admin,
      dammConfig,
      virtualPool,
    });
  });

  it("Partner claims LP", async () => {
    await partnerClaimLpDamm(svm, program, {
      payer: partner,
      dammConfig,
      virtualPool,
    });
  });

  it("Creator claims LP", async () => {
    await creatorClaimLpDamm(svm, program, {
      payer: poolCreator,
      dammConfig,
      virtualPool,
    });
  });

  it("Transfers pool creator after LP is locked and claimed", async () => {
    await transferCreator(
      svm,
      program,
      virtualPool,
      poolCreator,
      newCreator.publicKey
    );
    expect(getVirtualPool(svm, program, virtualPool).creator.toString()).eq(
      newCreator.publicKey.toString()
    );
  });

  it("Partner and new creator claim trading fees", async () => {
    const partnerParams: ClaimTradeFeeParams = {
      feeClaimer: partner,
      pool: virtualPool,
      maxBaseAmount: new BN(U64_MAX),
      maxQuoteAmount: new BN(U64_MAX),
    };
    await claimTradingFee(svm, program, partnerParams);

    const creatorParams: ClaimCreatorTradeFeeParams = {
      creator: newCreator,
      pool: virtualPool,
      maxBaseAmount: new BN(U64_MAX),
      maxQuoteAmount: new BN(U64_MAX),
    };
    await claimCreatorTradingFee(svm, program, creatorParams);
  });

  it("Partner and new creator withdraw surplus", async () => {
    await partnerWithdrawSurplus(svm, program, {
      feeClaimer: partner,
      virtualPool,
    });
    await creatorWithdrawSurplus(svm, program, {
      creator: newCreator,
      virtualPool,
    });
  });

  it("Partner and new creator withdraw migration fee", async () => {
    await partnerWithdrawMigrationFee(svm, program, {
      partner,
      virtualPool,
    });
    await creatorWithdrawMigrationFee(svm, program, {
      creator: newCreator,
      virtualPool,
    });
  });

  it("Withdraws leftover", async () => {
    await withdrawLeftover(svm, program, {
      payer: admin,
      virtualPool,
    });
  });
});
