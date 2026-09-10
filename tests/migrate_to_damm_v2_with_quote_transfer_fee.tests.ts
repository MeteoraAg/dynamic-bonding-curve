import {
  calculateFee,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TransferFee,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  BaseFee,
  ConfigParameters,
  createConfig,
  createMeteoraDammV2Metadata,
  createOperatorAccount,
  createPoolWithToken2022,
  createTokenBadge,
  migrateToDammV2,
  OperatorPermission,
  swap,
  SwapMode,
  withdrawLeftover,
} from "./instructions";
import {
  createDammV2Config,
  createDammV2DynamicConfig,
  createDammV2Operator,
  createVirtualCurveProgram,
  DammV2ConfigPermission,
  DammV2OperatorPermission,
  derivePoolAuthority,
  encodeConfigPermissions,
  encodePermissions,
  expectThrowsAsync,
  generateAndFund,
  getDbcProgramErrorCodeHexString,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  startSvm,
  U64_MAX,
  warpEpochBy,
} from "./utils";
import { deriveTokenBadgeAddress } from "./utils/accounts";
import { getConfig, getDammV2Pool, getVirtualPool } from "./utils/fetcher";
import {
  createToken2022Mint,
  getMint,
  getTokenAccount,
  mintToken2022To,
  setTransferFee,
} from "./utils/token";
import { VirtualCurveProgram } from "./utils/types";

const MIGRATION_QUOTE_THRESHOLD = new BN(LAMPORTS_PER_SOL * 5);
const PRE_MIGRATION_TOKEN_SUPPLY = new BN(2_500_000_000);
const POST_MIGRATION_TOKEN_SUPPLY = new BN(2_200_000_000);
const USER_QUOTE_BALANCE = BigInt(LAMPORTS_PER_SOL) * BigInt(100);

const CONCENTRATED = 0;
const COMPOUNDING = 2;

type Scenario = {
  fixedSupply: boolean;
  collectFeeMode: number;
  feeBasisPoints: number;
  maximumFee: bigint;
};

type MigratedState = {
  svm: LiteSVM;
  program: VirtualCurveProgram;
  admin: Keypair;
  config: PublicKey;
  virtualPool: PublicKey;
  dammPool: PublicKey;
  quoteMint: PublicKey;
  baseMint: PublicKey;
  quoteVault: PublicKey;
  baseVault: PublicKey;
  leftoverReceiver: PublicKey;
};

function buildConfigParams(scenario: Scenario): ConfigParameters {
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
    // compounding is only available on customizable migrated pools, which use a damm v2 dynamic config
    migrationFeeOption: scenario.collectFeeMode === COMPOUNDING ? 6 : 0,
    tokenSupply: scenario.fixedSupply
      ? {
          preMigrationTokenSupply: PRE_MIGRATION_TOKEN_SUPPLY,
          postMigrationTokenSupply: POST_MIGRATION_TOKEN_SUPPLY,
        }
      : null,
    creatorTradingFeePercentage: 0,
    tokenUpdateAuthority: 0,
    migrationFee: {
      feePercentage: 0,
      creatorFeePercentage: 0,
    },
    migratedPoolFee: {
      collectFeeMode: scenario.collectFeeMode,
      dynamicFee: 0,
      poolFeeBps: scenario.collectFeeMode === COMPOUNDING ? 100 : 0,
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
    compoundingFeeBps: scenario.collectFeeMode === COMPOUNDING ? 500 : 0,
    migratedPoolBaseFeeMode: 0,
    migratedPoolMarketCapFeeSchedulerParams: null,
    curve: curves,
  };
}

// Drives a fee-bearing quote pool through badge, config, pool, curve completion, and migration.
// When `migrate` is false the pool is left complete but unmigrated so the caller can adjust the fee first.
async function setupPool(
  scenario: Scenario,
  migrate: boolean
): Promise<MigratedState> {
  const svm = startSvm();
  const admin = generateAndFund(svm);
  const operator = generateAndFund(svm);
  const partner = generateAndFund(svm);
  const poolCreator = generateAndFund(svm);
  const user = generateAndFund(svm);
  const program = createVirtualCurveProgram();

  await createOperatorAccount(svm, program, {
    admin,
    whitelistedAddress: operator.publicKey,
    permissions: [OperatorPermission.CreateTokenBadge],
  });
  await createDammV2Operator(svm, {
    whitelistAddress: admin.publicKey,
    admin,
    permission: encodePermissions([DammV2OperatorPermission.CreateConfigKey]),
  });

  const quoteMint = createToken2022Mint(svm, admin, {
    transferFeeConfig: {
      feeBasisPoints: scenario.feeBasisPoints,
      maximumFee: scenario.maximumFee,
      transferFeeConfigAuthority: admin.publicKey,
    },
  });
  mintToken2022To(
    svm,
    admin,
    quoteMint,
    admin,
    user.publicKey,
    USER_QUOTE_BALANCE
  );
  await createTokenBadge(svm, program, {
    operator,
    payer: operator,
    tokenMint: quoteMint,
  });

  const config = await createConfig(svm, program, {
    payer: partner,
    leftoverReceiver: partner.publicKey,
    feeClaimer: partner.publicKey,
    quoteMint,
    instructionParams: buildConfigParams(scenario),
    tokenBadge: deriveTokenBadgeAddress(quoteMint),
  });
  const virtualPool = await createPoolWithToken2022(svm, program, {
    payer: poolCreator,
    poolCreator,
    quoteMint,
    config,
    instructionParams: {
      name: "fee quote",
      symbol: "FEEQ",
      uri: "feequote.com",
    },
    tokenQuoteProgram: TOKEN_2022_PROGRAM_ID,
    tokenBadge: deriveTokenBadgeAddress(quoteMint),
  });
  const poolState = getVirtualPool(svm, program, virtualPool);

  const { completed } = await swap(svm, program, {
    config,
    payer: user,
    pool: virtualPool,
    inputTokenMint: quoteMint,
    outputTokenMint: poolState.baseMint,
    amountIn: new BN(USER_QUOTE_BALANCE.toString()),
    minimumAmountOut: new BN(0),
    swapMode: SwapMode.PartialFill,
    referralTokenAccount: null,
  });
  expect(completed).eq(true);

  await createMeteoraDammV2Metadata(svm, program, {
    payer: admin,
    virtualPool,
    config,
  });

  let dammPool = PublicKey.default;
  if (migrate) {
    dammPool = await migrate_(
      svm,
      program,
      admin,
      virtualPool,
      scenario.collectFeeMode
    );
  }

  return {
    svm,
    program,
    admin,
    config,
    virtualPool,
    dammPool,
    quoteMint,
    baseMint: poolState.baseMint,
    quoteVault: poolState.quoteVault,
    baseVault: poolState.baseVault,
    leftoverReceiver: partner.publicKey,
  };
}

async function migrate_(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  admin: Keypair,
  virtualPool: PublicKey,
  collectFeeMode: number
): Promise<PublicKey> {
  const permission = encodeConfigPermissions([
    DammV2ConfigPermission.CreatePoolWithoutMintValidation,
  ]);
  const dammConfig =
    collectFeeMode === COMPOUNDING
      ? await createDammV2DynamicConfig(
          svm,
          admin,
          derivePoolAuthority(),
          permission
        )
      : await createDammV2Config(
          svm,
          admin,
          derivePoolAuthority(),
          1, // timestamp
          permission
        );
  const { dammPool } = await migrateToDammV2(svm, program, {
    payer: admin,
    virtualPool,
    dammConfig,
  });
  return dammPool;
}

function owedQuote(state: MigratedState): bigint {
  const pool = getVirtualPool(state.svm, state.program, state.virtualPool);
  // migration fee percentage is 0 in every scenario, so these are all the outstanding quote claims
  return (
    BigInt(pool.protocolQuoteFee.toString()) +
    BigInt(pool.partnerQuoteFee.toString()) +
    BigInt(pool.creatorQuoteFee.toString()) +
    BigInt(pool.protocolMigrationQuoteFeeAmount.toString())
  );
}

function owedBase(state: MigratedState): bigint {
  const pool = getVirtualPool(state.svm, state.program, state.virtualPool);
  return (
    BigInt(pool.protocolBaseFee.toString()) +
    BigInt(pool.partnerBaseFee.toString()) +
    BigInt(pool.creatorBaseFee.toString()) +
    BigInt(pool.protocolMigrationBaseFeeAmount.toString())
  );
}

function balanceOf(svm: LiteSVM, tokenAccount: PublicKey): bigint {
  if (svm.getAccount(tokenAccount) === null) {
    return BigInt(0);
  }
  return getTokenAccount(svm, tokenAccount).amount;
}

// Base left in the vault beyond fee claims: the leftover the burn rule and withdraw_leftover act on.
function baseLeftover(state: MigratedState): bigint {
  return balanceOf(state.svm, state.baseVault) - owedBase(state);
}

// Expected base surplus from the fee: base_budget - floor(base_budget * excluded(quote_budget) / quote_budget)
function expectedSurplus(state: MigratedState, scenario: Scenario): bigint {
  const config = getConfig(state.svm, state.program, state.config);
  const pool = getVirtualPool(state.svm, state.program, state.virtualPool);
  const baseBudget =
    BigInt(config.migrationBaseThreshold.toString()) -
    BigInt(pool.protocolMigrationBaseFeeAmount.toString());
  const quoteBudget =
    BigInt(config.migrationQuoteThreshold.toString()) -
    BigInt(pool.protocolMigrationQuoteFeeAmount.toString());
  const fee: TransferFee = {
    epoch: BigInt(0),
    maximumFee: scenario.maximumFee,
    transferFeeBasisPoints: scenario.feeBasisPoints,
  };
  const quoteToDamm = quoteBudget - calculateFee(fee, quoteBudget);
  return baseBudget - (baseBudget * quoteToDamm) / quoteBudget;
}

function expectWithinRelative(actual: bigint, expected: bigint, ppm: bigint) {
  const diff = actual > expected ? actual - expected : expected - actual;
  expect(
    diff * BigInt(1_000_000) <= expected * ppm,
    `${actual} not within ${ppm} ppm of ${expected}`
  ).eq(true);
}

describe("Migrate to damm v2 with a quote mint that has a non-zero transfer fee", () => {
  const FEE_BPS = 100; // 1%
  const NO_CAP = BigInt(U64_MAX.toString());

  for (const collectFeeMode of [CONCENTRATED, COMPOUNDING]) {
    const modeName =
      collectFeeMode === COMPOUNDING ? "compounding" : "concentrated";

    describe(`${modeName} handler`, () => {
      let zeroFeeFixed: MigratedState;
      let feeFixed: MigratedState;
      let feeNonFixed: MigratedState;

      before(async () => {
        zeroFeeFixed = await setupPool(
          {
            fixedSupply: true,
            collectFeeMode,
            feeBasisPoints: 0,
            maximumFee: BigInt(0),
          },
          true
        );
        feeFixed = await setupPool(
          {
            fixedSupply: true,
            collectFeeMode,
            feeBasisPoints: FEE_BPS,
            maximumFee: NO_CAP,
          },
          true
        );
        feeNonFixed = await setupPool(
          {
            fixedSupply: false,
            collectFeeMode,
            feeBasisPoints: FEE_BPS,
            maximumFee: NO_CAP,
          },
          true
        );
      });

      it("never overdraws the quote vault below the outstanding quote claims", () => {
        for (const state of [feeFixed, feeNonFixed]) {
          const vaultQuote = balanceOf(state.svm, state.quoteVault);
          expect(vaultQuote >= owedQuote(state)).eq(true);
          expect(
            getVirtualPool(state.svm, state.program, state.virtualPool)
              .isMigrated
          ).eq(1);
        }
      });

      it("preserves the migration price", () => {
        const feePrice = BigInt(
          getDammV2Pool(feeFixed.svm, feeFixed.dammPool).sqrtPrice.toString()
        );
        if (collectFeeMode === CONCENTRATED) {
          const migrationSqrtPrice = BigInt(
            getConfig(
              feeFixed.svm,
              feeFixed.program,
              feeFixed.config
            ).migrationSqrtPrice.toString()
          );
          expect(feePrice.toString()).eq(migrationSqrtPrice.toString());
        } else {
          const zeroFeePrice = BigInt(
            getDammV2Pool(
              zeroFeeFixed.svm,
              zeroFeeFixed.dammPool
            ).sqrtPrice.toString()
          );
          expectWithinRelative(feePrice, zeroFeePrice, BigInt(1));
        }
      });

      it("burns the surplus for a non-fixed-supply config", () => {
        expect(baseLeftover(feeNonFixed).toString()).eq("0");
      });

      it("leaves the surplus as leftover for a fixed-supply config and burns to the target supply", () => {
        const surplus = baseLeftover(feeFixed) - baseLeftover(zeroFeeFixed);
        expect(surplus > BigInt(0)).eq(true);
        expectWithinRelative(
          surplus,
          expectedSurplus(feeFixed, {
            fixedSupply: true,
            collectFeeMode,
            feeBasisPoints: FEE_BPS,
            maximumFee: NO_CAP,
          }),
          BigInt(1_000)
        );

        const supply = getMint(
          feeFixed.svm,
          feeFixed.baseMint,
          TOKEN_2022_PROGRAM_ID
        ).supply;
        expect(supply.toString()).eq(POST_MIGRATION_TOKEN_SUPPLY.toString());
      });

      it("pays the leftover, surplus included, to leftover_receiver", async () => {
        const leftover = baseLeftover(feeFixed);
        const receiverAccount = getAssociatedTokenAddressSync(
          feeFixed.baseMint,
          feeFixed.leftoverReceiver,
          true,
          TOKEN_2022_PROGRAM_ID
        );
        const preReceiver = balanceOf(feeFixed.svm, receiverAccount);

        await withdrawLeftover(feeFixed.svm, feeFixed.program, {
          payer: feeFixed.admin,
          virtualPool: feeFixed.virtualPool,
        });

        const received = balanceOf(feeFixed.svm, receiverAccount) - preReceiver;
        expect(received.toString()).eq(leftover.toString());
        expect(baseLeftover(feeFixed).toString()).eq("0");
      });
    });
  }

  describe("liquidity cliff", () => {
    it("fails cleanly when the fee leaves nothing for damm v2 to receive", async () => {
      const state = await setupPool(
        {
          fixedSupply: false,
          collectFeeMode: COMPOUNDING,
          feeBasisPoints: FEE_BPS,
          maximumFee: NO_CAP,
        },
        false
      );
      // 100% fee with no cap: excluded(quote_budget) is 0, so derived liquidity is 0
      setTransferFee(
        state.svm,
        state.admin,
        state.quoteMint,
        state.admin,
        10_000,
        NO_CAP
      );
      warpEpochBy(state.svm, 2);

      const before = getVirtualPool(
        state.svm,
        state.program,
        state.virtualPool
      );
      await expectThrowsAsync(
        () =>
          migrate_(
            state.svm,
            state.program,
            state.admin,
            state.virtualPool,
            COMPOUNDING
          ).then(() => {}),
        getDbcProgramErrorCodeHexString("AmountIsZero")
      );
      const after = getVirtualPool(state.svm, state.program, state.virtualPool);
      expect(after.migrationProgress).eq(before.migrationProgress);
      expect(after.isMigrated).eq(0);
    });
  });
});
