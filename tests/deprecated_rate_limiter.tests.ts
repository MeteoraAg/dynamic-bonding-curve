import { NATIVE_MINT } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { BN } from "bn.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  BaseFee,
  ConfigParameters,
  createConfig,
  CreateConfigParams,
  createConfigWithTransferHook,
  CreateConfigWithTransferHookParams,
  createPoolWithSplToken,
  createPoolWithToken2022,
  createPoolWithToken2022TransferHook,
} from "./instructions";
import {
  createVirtualCurveProgram,
  expectThrowsAsync,
  generateAndFund,
  getDbcProgramErrorCodeHexString,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  RateLimiterParams,
  setDeprecatedRateLimiterConfig,
  startSvm,
  TRANSFER_HOOK_COUNTER_PROGRAM_ID,
  U64_MAX,
} from "./utils";
import { getConfig } from "./utils/fetcher";
import { VirtualCurveProgram } from "./utils/types";

const rateLimiterBaseFee: BaseFee = {
  cliffFeeNumerator: new BN(2_500_000),
  firstFactor: 10, // fee increment bps
  secondFactor: new BN(10), // max limiter duration
  thirdFactor: new BN(LAMPORTS_PER_SOL), // reference amount
  baseFeeMode: 2,
};

const rateLimiter: RateLimiterParams = {
  cliffFeeNumerator: new BN(2_500_000),
  feeIncrementBps: 10,
  maxLimiterDuration: new BN(10),
  referenceAmount: new BN(LAMPORTS_PER_SOL),
};

const DEPRECATED_BASE_FEE_MODE = getDbcProgramErrorCodeHexString(
  "DeprecatedBaseFeeMode"
);

const poolParams = {
  name: "test token",
  symbol: "TEST",
  uri: "abc.com",
};

describe("Deprecated rate limiter", () => {
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
      migrationOption: 1, // damm v2
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

  it("Patches an existing config into rate limiter mode", async () => {
    const params: CreateConfigParams<ConfigParameters> = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: NATIVE_MINT,
      instructionParams,
    };
    const config = await createConfig(svm, program, params);

    const beforePatch = getConfig(svm, program, config);
    expect(beforePatch.poolFees.baseFee.baseFeeMode).eq(0);

    setDeprecatedRateLimiterConfig(svm, config, rateLimiter);

    const afterPatch = getConfig(svm, program, config);
    expect(afterPatch.poolFees.baseFee.baseFeeMode).eq(2);
    expect(afterPatch.poolFees.baseFee.cliffFeeNumerator.toString()).eq(
      "2500000"
    );
    expect(afterPatch.poolFees.baseFee.firstFactor).eq(10);
    expect(afterPatch.poolFees.baseFee.secondFactor.toString()).eq("10");
    expect(afterPatch.poolFees.baseFee.thirdFactor.toString()).eq(
      LAMPORTS_PER_SOL.toString()
    );
  });

  it("Fails to create config with rate limiter base fee mode", async () => {
    instructionParams.poolFees.baseFee = rateLimiterBaseFee;

    const params: CreateConfigParams<ConfigParameters> = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: NATIVE_MINT,
      instructionParams,
    };

    await expectThrowsAsync(async () => {
      await createConfig(svm, program, params);
    }, DEPRECATED_BASE_FEE_MODE);
  });

  it("Fails to create transfer hook config with rate limiter base fee mode", async () => {
    instructionParams.poolFees.baseFee = rateLimiterBaseFee;
    instructionParams.tokenType = 1; // token 2022

    const params: CreateConfigWithTransferHookParams = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: NATIVE_MINT,
      instructionParams,
      transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
    };

    await expectThrowsAsync(async () => {
      await createConfigWithTransferHook(svm, program, params);
    }, DEPRECATED_BASE_FEE_MODE);
  });

  it("Fails to create spl token pool from a rate limiter config", async () => {
    const config = await createConfig(svm, program, {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: NATIVE_MINT,
      instructionParams,
    });
    setDeprecatedRateLimiterConfig(svm, config, rateLimiter);

    await expectThrowsAsync(async () => {
      await createPoolWithSplToken(svm, program, {
        poolCreator,
        payer: poolCreator,
        quoteMint: NATIVE_MINT,
        config,
        instructionParams: poolParams,
      });
    }, DEPRECATED_BASE_FEE_MODE);
  });

  it("Fails to create token2022 pool from a rate limiter config", async () => {
    instructionParams.tokenType = 1; // token 2022
    const config = await createConfig(svm, program, {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: NATIVE_MINT,
      instructionParams,
    });
    setDeprecatedRateLimiterConfig(svm, config, rateLimiter);

    await expectThrowsAsync(async () => {
      await createPoolWithToken2022(svm, program, {
        poolCreator,
        payer: poolCreator,
        quoteMint: NATIVE_MINT,
        config,
        instructionParams: poolParams,
      });
    }, DEPRECATED_BASE_FEE_MODE);
  });

  it("Fails to create transfer hook pool from a rate limiter config", async () => {
    instructionParams.tokenType = 1; // token 2022
    const config = await createConfigWithTransferHook(svm, program, {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: NATIVE_MINT,
      instructionParams,
      transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
    });
    setDeprecatedRateLimiterConfig(svm, config, rateLimiter);

    await expectThrowsAsync(async () => {
      await createPoolWithToken2022TransferHook(svm, program, {
        poolCreator,
        payer: poolCreator,
        quoteMint: NATIVE_MINT,
        config,
        instructionParams: poolParams,
        transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
      });
    }, DEPRECATED_BASE_FEE_MODE);
  });
});
