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
  createConfig2,
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
  createDammV2DynamicConfig,
  createDammV2Operator,
  createDammV2Program,
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
  MigratedCollectFeeMode,
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
  getTransferFeeIncludedAmount,
  mintToken2022To,
  setTransferFee,
  setTransferFeeConfigAuthority,
} from "./utils/token";
import { VirtualCurveProgram } from "./utils/types";

const MIGRATION_QUOTE_THRESHOLD = new BN(LAMPORTS_PER_SOL * 5);
const PRE_MIGRATION_TOKEN_SUPPLY = new BN(2_500_000_000);
const POST_MIGRATION_TOKEN_SUPPLY = new BN(2_200_000_000);
const USER_QUOTE_BALANCE = BigInt(LAMPORTS_PER_SOL) * BigInt(100);
const NO_CAP = BigInt(U64_MAX.toString());

const BASE_FEE_BPS = 250; // 2.5%
const QUOTE_FEE_BPS = 100; // 1%

type FeeCase = {
  name: string;
  baseFeeBasisPoints: number;
  quoteFeeBasisPoints: number;
};

const FEE_CASES: FeeCase[] = [
  {
    name: "quote fee",
    baseFeeBasisPoints: 0,
    quoteFeeBasisPoints: QUOTE_FEE_BPS,
  },
  {
    name: "base fee",
    baseFeeBasisPoints: BASE_FEE_BPS,
    quoteFeeBasisPoints: 0,
  },
  {
    name: "base and quote fees",
    baseFeeBasisPoints: BASE_FEE_BPS,
    quoteFeeBasisPoints: QUOTE_FEE_BPS,
  },
];

type Scenario = {
  fixedSupply: boolean;
  baseFeeBasisPoints: number;
  quoteFeeBasisPoints: number;
  // maximum fee of the quote mint, defaults to no cap
  quoteMaximumFee?: bigint;
};

type MigratedState = {
  svm: LiteSVM;
  program: VirtualCurveProgram;
  admin: Keypair;
  config: PublicKey;
  virtualPool: PublicKey;
  dammPool: PublicKey;
  firstPosition: PublicKey;
  secondPosition: PublicKey;
  quoteMint: PublicKey;
  baseMint: PublicKey;
  quoteVault: PublicKey;
  baseVault: PublicKey;
  // base vault balance right before migration
  preMigrationBaseVaultAmount: bigint;
  leftoverReceiver: PublicKey;
};

function transferFee(basisPoints: number): TransferFee {
  return {
    epoch: BigInt(0),
    maximumFee: NO_CAP,
    transferFeeBasisPoints: basisPoints,
  };
}

function excluded(basisPoints: number, amount: bigint): bigint {
  if (basisPoints === 0) {
    return amount;
  }
  return amount - calculateFee(transferFee(basisPoints), amount);
}

function included(basisPoints: number, amount: bigint): bigint {
  return getTransferFeeIncludedAmount(transferFee(basisPoints), amount);
}

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
    curves.push({
      sqrtPrice:
        i == 16 ? MAX_SQRT_PRICE : MAX_SQRT_PRICE.muln(i * 5).divn(100),
      liquidity: U64_MAX.shln(30 + i),
    });
  }

  const liquidityVestingInfo = {
    vestingPercentage: 0,
    cliffDurationFromMigrationTime: 0,
    bpsPerPeriod: 0,
    numberOfPeriods: 0,
    frequency: 0,
  };

  return {
    poolFees: {
      baseFee,
      dynamicFee: null,
    },
    activationType: 0,
    collectFeeMode: 0,
    migrationOption: 1,
    tokenType: 1,
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
    // create_config2 requires a customizable migrated pool once a base fee is set, which uses a damm v2 dynamic config
    migrationFeeOption: 6,
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
      collectFeeMode: MigratedCollectFeeMode.Compounding,
      dynamicFee: 0,
      poolFeeBps: 100,
    },
    creatorLiquidityVestingInfo: liquidityVestingInfo,
    partnerLiquidityVestingInfo: liquidityVestingInfo,
    poolCreationFee: new BN(0),
    enableFirstSwapWithMinFee: false,
    compoundingFeeBps: 500,
    migratedPoolBaseFeeMode: 0,
    migratedPoolMarketCapFeeSchedulerParams: null,
    curve: curves,
  };
}

// Creates a pool with a transfer fee on the base mint, the quote mint, or both, completes the curve and migrates.
// With `migrate` false the pool stays complete but not migrated, so the caller can change the quote fee first.
async function setupPool(
  scenario: Scenario,
  migrate: boolean = true
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

  const quoteHasFee = scenario.quoteFeeBasisPoints > 0;
  const quoteMaximumFee = scenario.quoteMaximumFee ?? NO_CAP;
  const legacyConfig = quoteHasFee && !scenario.fixedSupply;
  const quoteMint = createToken2022Mint(
    svm,
    admin,
    quoteHasFee
      ? {
          transferFeeConfig: legacyConfig
            ? {
                feeBasisPoints: 0,
                maximumFee: BigInt(0),
                transferFeeConfigAuthority: null,
              }
            : {
                feeBasisPoints: scenario.quoteFeeBasisPoints,
                maximumFee: quoteMaximumFee,
                transferFeeConfigAuthority: admin.publicKey,
              },
        }
      : {}
  );
  mintToken2022To(
    svm,
    admin,
    quoteMint,
    admin,
    user.publicKey,
    USER_QUOTE_BALANCE
  );
  let tokenBadge: PublicKey | undefined;
  if (quoteHasFee && !legacyConfig) {
    await createTokenBadge(svm, program, {
      operator,
      payer: operator,
      tokenMint: quoteMint,
    });
    tokenBadge = deriveTokenBadgeAddress(quoteMint);
  }

  const configParams = {
    payer: partner,
    leftoverReceiver: partner.publicKey,
    feeClaimer: partner.publicKey,
    quoteMint,
    instructionParams: buildConfigParams(scenario),
    tokenBadge,
  };
  let config: PublicKey;
  if (scenario.baseFeeBasisPoints > 0) {
    config = await createConfig2(svm, program, {
      ...configParams,
      transferFee: {
        transferFeeBasisPoints: scenario.baseFeeBasisPoints,
        withheldAuthority: 0,
      },
    });
  } else if (quoteHasFee && !legacyConfig) {
    config = await createConfig2(svm, program, {
      ...configParams,
      transferFee: {
        transferFeeBasisPoints: 0,
        withheldAuthority: 0,
      },
    });
  } else {
    config = await createConfig(svm, program, configParams);
  }

  if (legacyConfig) {
    setTransferFeeConfigAuthority(svm, quoteMint, admin.publicKey);
    await createTokenBadge(svm, program, {
      operator,
      payer: operator,
      tokenMint: quoteMint,
    });
    tokenBadge = deriveTokenBadgeAddress(quoteMint);
    setTransferFee(
      svm,
      admin,
      quoteMint,
      admin,
      scenario.quoteFeeBasisPoints,
      quoteMaximumFee
    );
    // the new fee becomes active two epochs later
    warpEpochBy(svm, 2);
  }

  const virtualPool = await createPoolWithToken2022(svm, program, {
    payer: poolCreator,
    poolCreator,
    quoteMint,
    config,
    instructionParams: {
      name: "fee",
      symbol: "FEE",
      uri: "fee.com",
    },
    tokenQuoteProgram: TOKEN_2022_PROGRAM_ID,
    tokenBadge,
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

  const preMigrationBaseVaultAmount = balanceOf(svm, poolState.baseVault);

  let dammPool = PublicKey.default;
  let firstPosition = PublicKey.default;
  let secondPosition = PublicKey.default;
  if (migrate) {
    ({ dammPool, firstPosition, secondPosition } = await migrate_(
      svm,
      program,
      admin,
      virtualPool
    ));
  }

  return {
    svm,
    program,
    admin,
    config,
    virtualPool,
    dammPool,
    firstPosition,
    secondPosition,
    quoteMint,
    baseMint: poolState.baseMint,
    quoteVault: poolState.quoteVault,
    baseVault: poolState.baseVault,
    preMigrationBaseVaultAmount,
    leftoverReceiver: partner.publicKey,
  };
}

async function migrate_(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  admin: Keypair,
  virtualPool: PublicKey
): Promise<{
  dammPool: PublicKey;
  firstPosition: PublicKey;
  secondPosition: PublicKey;
}> {
  const permission = encodeConfigPermissions([
    DammV2ConfigPermission.CreatePoolWithoutMintValidation,
  ]);
  const dammConfig = await createDammV2DynamicConfig(
    svm,
    admin,
    derivePoolAuthority(),
    permission
  );
  return migrateToDammV2(svm, program, {
    payer: admin,
    virtualPool,
    dammConfig,
  });
}

function positionLiquidity(svm: LiteSVM, position: PublicKey): bigint {
  const state = createDammV2Program().coder.accounts.decode(
    "position",
    Buffer.from(svm.getAccount(position).data)
  );
  return (
    BigInt(state.unlockedLiquidity.toString()) +
    BigInt(state.permanentLockedLiquidity.toString()) +
    BigInt(state.vestedLiquidity.toString())
  );
}

// share of the pool liquidity held by the second position, in parts per million
function secondPositionSharePpm(state: MigratedState): bigint {
  const first = positionLiquidity(state.svm, state.firstPosition);
  const second = positionLiquidity(state.svm, state.secondPosition);
  return (second * BigInt(1_000_000)) / (first + second);
}

function owedQuote(state: MigratedState): bigint {
  const pool = getVirtualPool(state.svm, state.program, state.virtualPool);
  // the migration fee percentage is 0 in every scenario, so this is all the quote still owed
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

// Base in the vault that is not owed as fees. The burn and withdraw_leftover act on this amount.
function baseLeftover(state: MigratedState): bigint {
  return balanceOf(state.svm, state.baseVault) - owedBase(state);
}

// Quote in the vault that is not owed as fees or as surplus above the threshold.
function quoteLeftover(state: MigratedState): bigint {
  const pool = getVirtualPool(state.svm, state.program, state.virtualPool);
  const config = getConfig(state.svm, state.program, state.config);
  const surplus =
    BigInt(pool.quoteReserve.toString()) -
    BigInt(config.migrationQuoteThreshold.toString());
  return balanceOf(state.svm, state.quoteVault) - owedQuote(state) - surplus;
}

function protocolMigrationBaseFee(state: MigratedState): bigint {
  const pool = getVirtualPool(state.svm, state.program, state.virtualPool);
  return BigInt(pool.protocolMigrationBaseFeeAmount.toString());
}

function protocolMigrationQuoteFee(state: MigratedState): bigint {
  const pool = getVirtualPool(state.svm, state.program, state.virtualPool);
  return BigInt(pool.protocolMigrationQuoteFeeAmount.toString());
}

// Base deposited into damm v2 on a fixed-supply pool. The burn comes after the deposit, so it is added back.
function depositedBase(state: MigratedState): bigint {
  const pre = BigInt(PRE_MIGRATION_TOKEN_SUPPLY.toString());
  const post = BigInt(POST_MIGRATION_TOKEN_SUPPLY.toString());
  return (
    state.preMigrationBaseVaultAmount -
    balanceOf(state.svm, state.baseVault) -
    (pre - post)
  );
}

function saturatingSub(a: bigint, b: bigint): bigint {
  return a > b ? a - b : BigInt(0);
}

function expectWithinAbsolute(
  actual: bigint,
  expected: bigint,
  tolerance: bigint
) {
  const diff = actual > expected ? actual - expected : expected - actual;
  expect(
    diff <= tolerance,
    `${actual} not within ${tolerance} of ${expected}`
  ).eq(true);
}

function expectWithinRelative(actual: bigint, expected: bigint, ppm: bigint) {
  const diff = actual > expected ? actual - expected : expected - actual;
  expect(
    diff * BigInt(1_000_000) <= expected * ppm,
    `${actual} not within ${ppm} ppm of ${expected}`
  ).eq(true);
}

describe("Migrate to damm v2 with a transfer fee on the base mint, the quote mint, or both", () => {
  describe("compounding handler", () => {
    // this pool has no transfer fees, so it gives the reference amounts and protocol migration fees
    let zeroFeeFixed: MigratedState;

    before(async () => {
      zeroFeeFixed = await setupPool({
        fixedSupply: true,
        baseFeeBasisPoints: 0,
        quoteFeeBasisPoints: 0,
      });
    });

    for (const feeCase of FEE_CASES) {
      const { baseFeeBasisPoints, quoteFeeBasisPoints } = feeCase;
      // on the compounding handler the side with the larger fee limits the deposit and the other side is
      // scaled down to match, so both sides shrink by the larger fee
      const compoundingFeeBasisPoints = Math.max(
        baseFeeBasisPoints,
        quoteFeeBasisPoints
      );

      const nonFixedSupplyAllowed = baseFeeBasisPoints === 0;

      describe(feeCase.name, () => {
        let feeFixed: MigratedState;
        let feeNonFixed: MigratedState | null = null;
        const states = () =>
          feeNonFixed ? [feeFixed, feeNonFixed] : [feeFixed];

        before(async () => {
          feeFixed = await setupPool({
            fixedSupply: true,
            baseFeeBasisPoints,
            quoteFeeBasisPoints,
          });
          if (nonFixedSupplyAllowed) {
            feeNonFixed = await setupPool({
              fixedSupply: false,
              baseFeeBasisPoints,
              quoteFeeBasisPoints,
            });
          }
        });

        it("migrates without overdrawing either vault below the outstanding claims", () => {
          for (const state of states()) {
            expect(
              getVirtualPool(state.svm, state.program, state.virtualPool)
                .isMigrated
            ).eq(1);
            expect(balanceOf(state.svm, state.baseVault) >= owedBase(state)).eq(
              true
            );
            expect(
              balanceOf(state.svm, state.quoteVault) >= owedQuote(state)
            ).eq(true);
          }
        });

        it("preserves the migration price", () => {
          const feePrice = BigInt(
            getDammV2Pool(feeFixed.svm, feeFixed.dammPool).sqrtPrice.toString()
          );
          const zeroFeePrice = BigInt(
            getDammV2Pool(
              zeroFeeFixed.svm,
              zeroFeeFixed.dammPool
            ).sqrtPrice.toString()
          );
          expectWithinRelative(feePrice, zeroFeePrice, BigInt(1));
        });

        it("deposits the fee-excluded amounts into damm v2", () => {
          const dammPool = getDammV2Pool(feeFixed.svm, feeFixed.dammPool);
          const zeroFeeDammPool = getDammV2Pool(
            zeroFeeFixed.svm,
            zeroFeeFixed.dammPool
          );
          const baseInPool = BigInt(dammPool.tokenAAmount.toString());
          const quoteInPool = BigInt(dammPool.tokenBAmount.toString());
          const zeroFeeBaseInPool = BigInt(
            zeroFeeDammPool.tokenAAmount.toString()
          );
          const zeroFeeQuoteInPool = BigInt(
            zeroFeeDammPool.tokenBAmount.toString()
          );

          // the base budget is the migration threshold, so both sides shrink by the larger fee.
          // damm v2 pulls the quote fee on top of the deposit, so the quote in the pool is not reduced a second time
          expectWithinRelative(
            baseInPool,
            excluded(compoundingFeeBasisPoints, zeroFeeBaseInPool),
            BigInt(10)
          );
          expectWithinRelative(
            quoteInPool,
            excluded(compoundingFeeBasisPoints, zeroFeeQuoteInPool),
            BigInt(10)
          );
        });

        it("books the base the quote fee kept out of damm v2 as protocol migration base fee on a fixed-supply config", () => {
          const surplus =
            protocolMigrationBaseFee(feeFixed) -
            protocolMigrationBaseFee(zeroFeeFixed);
          // the surplus is the base the zero-fee pool deposited and this pool did not. With a base fee the
          // deposit is grossed up, so this pool deposits at least as much and books no surplus.
          const expected = saturatingSub(
            depositedBase(zeroFeeFixed),
            depositedBase(feeFixed)
          );
          if (baseFeeBasisPoints === 0) {
            expect(surplus > BigInt(0)).eq(true);
          } else {
            expect(surplus.toString()).eq("0");
          }
          expectWithinAbsolute(surplus, expected, BigInt(2));

          // the surplus is kept in the vault for claim_protocol_fee2 and is not burned
          expect(
            balanceOf(feeFixed.svm, feeFixed.baseVault) >= owedBase(feeFixed)
          ).eq(true);
        });

        if (nonFixedSupplyAllowed) {
          it("does not change the protocol migration base fee for a non-fixed-supply config", () => {
            expect(protocolMigrationBaseFee(feeNonFixed!).toString()).eq(
              protocolMigrationBaseFee(zeroFeeFixed).toString()
            );
          });
        }

        it("books the quote the base fee scaled off as protocol migration quote fee on the compounding handler and strands none", () => {
          const plainProtocolBaseFee = protocolMigrationBaseFee(zeroFeeFixed);
          const plainProtocolQuoteFee = protocolMigrationQuoteFee(zeroFeeFixed);
          for (const state of states()) {
            // damm v2 pulls the quote deposit plus its fee, so only rounding dust stays in the vault
            expectWithinAbsolute(quoteLeftover(state), BigInt(0), BigInt(2));
            const routedQuote =
              protocolMigrationQuoteFee(state) - plainProtocolQuoteFee;
            if (baseFeeBasisPoints === 0) {
              // without a base fee nothing is scaled down
              expect(routedQuote.toString()).eq("0");
              continue;
            }
            const config = getConfig(state.svm, state.program, state.config);
            // quote_to_damm = quote_budget * excluded(base_budget) / base_budget, and damm v2 pulls included(quote_to_damm)
            const baseBudget =
              BigInt(config.migrationBaseThreshold.toString()) -
              plainProtocolBaseFee;
            const quoteBudget =
              BigInt(config.migrationQuoteThreshold.toString()) -
              plainProtocolQuoteFee;
            const quoteToDamm =
              (quoteBudget * excluded(baseFeeBasisPoints, baseBudget)) /
              baseBudget;
            const pulledQuote = included(quoteFeeBasisPoints, quoteToDamm);
            expectWithinRelative(
              routedQuote,
              quoteBudget - pulledQuote,
              BigInt(1_000)
            );
          }
        });

        it("pays the base fee from the deposit and leaves the leftover untouched", () => {
          const zeroFeeLeftover = baseLeftover(zeroFeeFixed);
          const feeLeftover = baseLeftover(feeFixed);
          if (baseFeeBasisPoints === 0) {
            // no base fee: the base kept out by the quote fee goes to the protocol, so the leftover does not change
            expectWithinAbsolute(feeLeftover, zeroFeeLeftover, BigInt(2));
            return;
          }
          expect(feeLeftover.toString()).eq(zeroFeeLeftover.toString());
        });

        if (nonFixedSupplyAllowed) {
          it("burns the base leftover for a non-fixed-supply config", () => {
            expect(baseLeftover(feeNonFixed!).toString()).eq("0");
          });
        }

        it("burns a fixed-supply config down to the target supply and pays the leftover to leftover_receiver", async () => {
          const supply = getMint(
            feeFixed.svm,
            feeFixed.baseMint,
            TOKEN_2022_PROGRAM_ID
          ).supply;
          expect(supply.toString()).eq(POST_MIGRATION_TOKEN_SUPPLY.toString());

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

          const received =
            balanceOf(feeFixed.svm, receiverAccount) - preReceiver;
          // the receiver pays the base transfer fee on the payout
          expect(received.toString()).eq(
            excluded(baseFeeBasisPoints, leftover).toString()
          );
          expect(baseLeftover(feeFixed).toString()).eq("0");
        });
      });
    }
  });

  describe("quote transfer fee capped by maximum fee across two deposits", () => {
    const CAPPED_FEE_BPS = 1000; // 10%
    const MAXIMUM_FEE = BigInt(1_000_000);

    it("compounding handler keeps the position split of a zero-fee pool", async () => {
      const zeroFee = await setupPool({
        fixedSupply: false,
        baseFeeBasisPoints: 0,
        quoteFeeBasisPoints: 0,
      });
      const cappedFee = await setupPool({
        fixedSupply: false,
        baseFeeBasisPoints: 0,
        quoteFeeBasisPoints: CAPPED_FEE_BPS,
        quoteMaximumFee: MAXIMUM_FEE,
      });

      expectWithinAbsolute(
        secondPositionSharePpm(cappedFee),
        secondPositionSharePpm(zeroFee),
        BigInt(20)
      );

      const config = getConfig(
        cappedFee.svm,
        cappedFee.program,
        cappedFee.config
      );
      const quoteBudget =
        BigInt(config.migrationQuoteThreshold.toString()) -
        protocolMigrationQuoteFee(cappedFee);
      const landedQuote = BigInt(
        getDammV2Pool(cappedFee.svm, cappedFee.dammPool).tokenBAmount.toString()
      );
      expectWithinAbsolute(
        landedQuote,
        quoteBudget - MAXIMUM_FEE * BigInt(2),
        BigInt(16)
      );
    });
  });

  describe("liquidity cliff", () => {
    it("fails when the quote fee leaves nothing for damm v2 to receive", async () => {
      const state = await setupPool(
        {
          fixedSupply: false,
          baseFeeBasisPoints: 0,
          quoteFeeBasisPoints: QUOTE_FEE_BPS,
        },
        false
      );

      // a 100% fee with no cap makes excluded(quote_budget) 0, so the liquidity is 0
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
            state.virtualPool
          ).then(() => {}),
        getDbcProgramErrorCodeHexString("AmountIsZero")
      );
      const after = getVirtualPool(state.svm, state.program, state.virtualPool);
      expect(after.migrationProgress).eq(before.migrationProgress);
      expect(after.isMigrated).eq(0);
    });
  });

  describe("dispatch between the zero-fee and the transfer fee migration", () => {
    it("runs the transfer fee logic for a quote mint whose fee can change, even while the active fee is zero", async () => {
      // a badged quote mint with a fee authority. Its fee is set to zero, so the current epoch charges nothing
      const state = await setupPool(
        {
          fixedSupply: false,
          baseFeeBasisPoints: 0,
          quoteFeeBasisPoints: QUOTE_FEE_BPS,
        },
        false
      );
      setTransferFee(
        state.svm,
        state.admin,
        state.quoteMint,
        state.admin,
        0,
        NO_CAP
      );
      warpEpochBy(state.svm, 2);

      // schedule a fee two epochs out. The zero-fee logic would reject the scheduled fee, the transfer fee logic
      // migrates with the active zero fee
      setTransferFee(
        state.svm,
        state.admin,
        state.quoteMint,
        state.admin,
        QUOTE_FEE_BPS,
        NO_CAP
      );
      await migrate_(state.svm, state.program, state.admin, state.virtualPool);
      expect(
        getVirtualPool(state.svm, state.program, state.virtualPool).isMigrated
      ).eq(1);
    });
  });
});
