import { NATIVE_MINT } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
import { assert, expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  BaseFee,
  claimProtocolFee,
  ClaimTradeFeeParams,
  claimTradingFee,
  ConfigParameters,
  createClaimProtocolFeeOperator,
  createConfig,
  CreateConfigParams,
  createPoolWithSplToken,
  partnerWithdrawSurplus,
  protocolWithdrawSurplus,
  swap,
  SwapMode,
  SwapParams,
} from "./instructions";
import {
  createMeteoraMetadata,
  lockLpForCreatorDamm,
  lockLpForPartnerDamm,
  MigrateMeteoraParams,
  migrateToMeteoraDamm,
} from "./instructions/meteoraMigration";
import {
  createDammConfig,
  createVirtualCurveProgram,
  derivePoolAuthority,
  FLASH_RENT_FUND,
  generateAndFund,
  getMint,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  startSvm,
  U64_MAX,
} from "./utils";
import { getVirtualPool } from "./utils/fetcher";
import { Pool, VirtualCurveProgram } from "./utils/types";

describe("Full flow with spl-token", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let user: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;
  let config: PublicKey;
  let virtualPool: PublicKey;
  let virtualPoolState: Pool;
  let dammConfig: PublicKey;
  let claimFeeOperator: PublicKey;

  before(async () => {
    svm = startSvm();
    admin = generateAndFund(svm);
    operator = generateAndFund(svm);
    partner = generateAndFund(svm);
    user = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    program = createVirtualCurveProgram();
  });

  it("Admin create claim fee operator", async () => {
    claimFeeOperator = await createClaimProtocolFeeOperator(svm, program, {
      admin,
      operator: operator.publicKey,
    });
  });

  it("Partner create config", async () => {
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
      migrationOption: 0,
      tokenType: 0, // spl_token
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
      poolCreationFee: new BN(0),
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
      curve: curves,
    };
    const params: CreateConfigParams<ConfigParameters> = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: NATIVE_MINT,
      instructionParams,
    };
    config = await createConfig(svm, program, params);
  });

  it("Create spl pool from config", async () => {
    virtualPool = await createPoolWithSplToken(svm, program, {
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
    virtualPoolState = getVirtualPool(svm, program, virtualPool);

    // validate freeze authority
    const baseMintData = getMint(svm, virtualPoolState.baseMint);
    expect(baseMintData.freezeAuthority.toString()).eq(
      PublicKey.default.toString()
    );
    expect(baseMintData.mintAuthorityOption).eq(0);
  });

  it("Swap", async () => {
    const params: SwapParams = {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: NATIVE_MINT,
      outputTokenMint: virtualPoolState.baseMint,
      amountIn: new BN(LAMPORTS_PER_SOL * 5.5),
      minimumAmountOut: new BN(0),
      swapMode: SwapMode.PartialFill,
      referralTokenAccount: null,
    };
    await swap(svm, program, params);
  });

  it("Create meteora metadata", async () => {
    await createMeteoraMetadata(svm, program, {
      payer: admin,
      virtualPool,
      config,
    });
  });

  it("Migrate to Meteora Damm Pool", async () => {
    const poolAuthority = derivePoolAuthority();
    dammConfig = await createDammConfig(svm, admin, poolAuthority);
    const migrationParams: MigrateMeteoraParams = {
      payer: admin,
      virtualPool,
      dammConfig,
    };

    const beforePoolAuthorityLamport = svm.getBalance(poolAuthority);

    expect(beforePoolAuthorityLamport.toString()).eq(
      FLASH_RENT_FUND.toString()
    );

    await migrateToMeteoraDamm(svm, program, migrationParams);

    const afterPoolAuthorityLamport = svm.getBalance(poolAuthority);

    expect(afterPoolAuthorityLamport.toString()).eq(FLASH_RENT_FUND.toString());

    // validate mint authority
    const baseMintData = getMint(svm, virtualPoolState.baseMint);
    expect(baseMintData.mintAuthorityOption).eq(0);
  });

  it("Partner lock LP", async () => {
    await lockLpForPartnerDamm(svm, program, {
      payer: partner,
      dammConfig,
      virtualPool,
    });
  });

  it("Creator lock LP", async () => {
    await lockLpForCreatorDamm(svm, program, {
      payer: poolCreator,
      dammConfig,
      virtualPool,
    });
  });

  it("Partner withdraw surplus", async () => {
    // partner withdraw surplus
    await partnerWithdrawSurplus(svm, program, {
      feeClaimer: partner,
      virtualPool,
    });
  });

  it("Parner can not withdraw again", async () => {
    try {
      await partnerWithdrawSurplus(svm, program, {
        feeClaimer: partner,
        virtualPool,
      });
      assert.ok(false);
    } catch (e) {
      //
    }
  });
  it("Protocol withdraw surplus", async () => {
    await protocolWithdrawSurplus(svm, program, {
      operator: operator,
      virtualPool,
    });
  });

  it("Protocol can not withdraw surplus again", async () => {
    try {
      await protocolWithdrawSurplus(svm, program, {
        operator: operator,
        virtualPool,
      });
      assert.ok(false);
    } catch (e) {
      //
    }
  });

  it("Partner claim trading fee", async () => {
    const claimTradingFeeParams: ClaimTradeFeeParams = {
      feeClaimer: partner,
      pool: virtualPool,
      maxBaseAmount: new BN(U64_MAX),
      maxQuoteAmount: new BN(U64_MAX),
    };
    await claimTradingFee(svm, program, claimTradingFeeParams);
  });

  it("Operator claim protocol fee", async () => {
    await claimProtocolFee(svm, program, {
      pool: virtualPool,
      operator: operator,
    });
  });
});
