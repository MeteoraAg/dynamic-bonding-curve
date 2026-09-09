import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  BaseFee,
  ConfigParameters,
  createConfig,
  createOperatorAccount,
  createPoolWithToken2022,
  createTokenBadge,
  OperatorPermission,
  swap,
  SwapMode,
  SwapParams,
} from "./instructions";
import {
  createMeteoraDammV2Metadata,
  migrateToDammV2,
} from "./instructions/dammV2Migration";
import {
  createDammV2Config,
  createDammV2Operator,
  createVirtualCurveProgram,
  DammV2ConfigPermission,
  DammV2OperatorPermission,
  derivePoolAuthority,
  encodeConfigPermissions,
  encodePermissions,
  generateAndFund,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  startSvm,
  U64_MAX,
} from "./utils";
import { deriveTokenBadgeAddress } from "./utils/accounts";
import { getVirtualPool } from "./utils/fetcher";
import { createToken2022Mint, mintToken2022To } from "./utils/token";
import { VirtualCurveProgram } from "./utils/types";

const MIGRATION_QUOTE_THRESHOLD = new BN(LAMPORTS_PER_SOL * 5);

function buildConfigParams(): ConfigParameters {
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

  return {
    poolFees: {
      baseFee,
      dynamicFee: null,
    },
    activationType: 0,
    collectFeeMode: 0,
    migrationOption: 1, // damm v2
    tokenType: 1, // token 2022
    tokenDecimal: 6,
    migrationQuoteThreshold: MIGRATION_QUOTE_THRESHOLD,
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
    migrationFeeOption: 0, // fixed 25 bps, matches createDammV2Config
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
    enableFirstSwapWithMinFee: false,
    compoundingFeeBps: 0,
    migratedPoolBaseFeeMode: 0,
    migratedPoolMarketCapFeeSchedulerParams: null,
    curve: curves,
  };
}

describe("Migrate to damm v2 with token badge and CreatePoolWithoutMintValidation config", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let poolCreator: Keypair;
  let user: Keypair;
  let program: VirtualCurveProgram;

  // token2022 quote mint with a permanent delegate extension, unsupported without a badge
  let badgedQuoteMint: PublicKey;
  let dammConfig: PublicKey;
  let config: PublicKey;
  let virtualPool: PublicKey;

  before(async () => {
    svm = startSvm();
    admin = generateAndFund(svm);
    operator = generateAndFund(svm);
    partner = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    user = generateAndFund(svm);
    program = createVirtualCurveProgram();

    await createDammV2Operator(svm, {
      whitelistAddress: admin.publicKey,
      admin,
      permission: encodePermissions([DammV2OperatorPermission.CreateConfigKey]),
    });

    await createOperatorAccount(svm, program, {
      admin,
      whitelistedAddress: operator.publicKey,
      permissions: [OperatorPermission.CreateTokenBadge],
    });

    badgedQuoteMint = createToken2022Mint(svm, admin, {
      permanentDelegate: admin.publicKey,
    });
  });

  it("Creates the damm v2 config with CreatePoolWithoutMintValidation", async () => {
    dammConfig = await createDammV2Config(
      svm,
      admin,
      derivePoolAuthority(),
      1, // timestamp
      encodeConfigPermissions([
        DammV2ConfigPermission.CreatePoolWithoutMintValidation,
      ])
    );
    expect(svm.getAccount(dammConfig)).not.eq(null);
  });

  it("Creates the dbc token badge", async () => {
    await createTokenBadge(svm, program, {
      operator,
      payer: operator,
      tokenMint: badgedQuoteMint,
    });
    expect(svm.getAccount(deriveTokenBadgeAddress(badgedQuoteMint))).not.eq(
      null
    );
  });

  it("Creates config and pool with the badged quote mint", async () => {
    config = await createConfig(svm, program, {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: badgedQuoteMint,
      instructionParams: buildConfigParams(),
      tokenBadge: deriveTokenBadgeAddress(badgedQuoteMint),
    });

    virtualPool = await createPoolWithToken2022(svm, program, {
      payer: poolCreator,
      poolCreator,
      quoteMint: badgedQuoteMint,
      config,
      instructionParams: {
        name: "badged",
        symbol: "BADGE",
        uri: "badge.com",
      },
      tokenQuoteProgram: TOKEN_2022_PROGRAM_ID,
      tokenBadge: deriveTokenBadgeAddress(badgedQuoteMint),
    });
    expect(svm.getAccount(virtualPool)).not.eq(null);
  });

  it("Swaps until the migration threshold is reached", async () => {
    mintToken2022To(
      svm,
      user,
      badgedQuoteMint,
      admin,
      user.publicKey,
      BigInt(LAMPORTS_PER_SOL * 10)
    );

    const poolState = getVirtualPool(svm, program, virtualPool);
    const params: SwapParams = {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: badgedQuoteMint,
      outputTokenMint: poolState.baseMint,
      amountIn: new BN(LAMPORTS_PER_SOL * 5.5),
      minimumAmountOut: new BN(0),
      swapMode: SwapMode.PartialFill,
      referralTokenAccount: null,
    };
    await swap(svm, program, params);

    const poolStateAfter = getVirtualPool(svm, program, virtualPool);
    expect(poolStateAfter.quoteReserve.gte(MIGRATION_QUOTE_THRESHOLD)).eq(true);
  });

  it("Creates the damm v2 migration metadata", async () => {
    await createMeteoraDammV2Metadata(svm, program, {
      payer: admin,
      virtualPool,
      config,
    });
  });

  it("Migrates to damm v2", async () => {
    const { dammPool } = await migrateToDammV2(svm, program, {
      payer: admin,
      virtualPool,
      dammConfig,
    });
    expect(svm.getAccount(dammPool)).not.eq(null);

    const poolState = getVirtualPool(svm, program, virtualPool);
    expect(poolState.isMigrated).eq(1);
  });
});
