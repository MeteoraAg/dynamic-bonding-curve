import { NATIVE_MINT } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { BN } from "bn.js";
import { LiteSVM } from "litesvm";
import {
  BaseFee,
  ConfigParameters,
  createConfig,
  CreateConfigParams,
} from "./instructions";
import {
  createVirtualCurveProgram,
  expectThrowsAsync,
  generateAndFund,
  getDbcProgramErrorCodeHexString,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  startSvm,
  U64_MAX,
} from "./utils";
import { VirtualCurveProgram } from "./utils/types";

describe("Create config", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let partner: Keypair;
  let program: VirtualCurveProgram;
  let instructionParams: ConfigParameters;

  beforeEach(async () => {
    svm = startSvm();
    admin = generateAndFund(svm);
    partner = generateAndFund(svm);
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
      tokenType: 1, // token 2022
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
      curve: curves,
    };
  });

  it("create config", async () => {
    const params: CreateConfigParams<ConfigParameters> = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: NATIVE_MINT,
      instructionParams,
    };

    await createConfig(svm, program, params);
  });

  it("Fail to create config less than min base fee (25 bps)", async () => {
    const baseFee: BaseFee = {
      cliffFeeNumerator: new BN(2_499_999),
      firstFactor: 0,
      secondFactor: new BN(0),
      thirdFactor: new BN(0),
      baseFeeMode: 0,
    };

    instructionParams.poolFees.baseFee = baseFee;
    const params: CreateConfigParams<ConfigParameters> = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: NATIVE_MINT,
      instructionParams,
    };

    const errorCode = getDbcProgramErrorCodeHexString("ExceedMaxFeeBps");
    await expectThrowsAsync(async () => {
      await createConfig(svm, program, params);
    }, errorCode);
  });
});
