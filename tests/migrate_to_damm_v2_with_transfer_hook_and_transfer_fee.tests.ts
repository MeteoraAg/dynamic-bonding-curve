import {
  calculateFee,
  getAssociatedTokenAddressSync,
  getTransferFeeConfig,
  getTransferHook,
  TOKEN_2022_PROGRAM_ID,
  TransferFee,
  unpackMint,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  BaseFee,
  ConfigParameters,
  createConfigWithTransferHook2,
  createMeteoraDammV2Metadata,
  createOperatorAccount,
  createPoolWithToken2022TransferHook,
  createTokenBadge,
  migrateToDammV2,
  OperatorPermission,
  SwapMode,
  swapWithTransferHook,
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
  initializeExtraAccountMetaList,
  MAX_SQRT_PRICE,
  MigratedCollectFeeMode,
  MIN_SQRT_PRICE,
  startSvm,
  MigratedTransferFeeAuthorityOption,
  TransferFeeWithheldAuthority,
  U64_MAX,
  warpEpochBy,
} from "./utils";
import { deriveTokenBadgeAddress } from "./utils/accounts";
import { TRANSFER_HOOK_COUNTER_PROGRAM_ID } from "./utils/constants";
import { getConfig, getDammV2Pool, getVirtualPool } from "./utils/fetcher";
import {
  createToken2022Mint,
  getMint,
  getTokenAccount,
  getTransferFeeIncludedAmount,
  mintToken2022To,
  setTransferFee,
} from "./utils/token";
import { VirtualCurveProgram } from "./utils/types";

const MIGRATION_QUOTE_THRESHOLD = new BN(LAMPORTS_PER_SOL * 5);
const CONSTANT_TOKEN_SUPPLY = new BN(2_500_000_000);
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
  {
    name: "equal base and quote fees",
    baseFeeBasisPoints: BASE_FEE_BPS,
    quoteFeeBasisPoints: BASE_FEE_BPS,
  },
];

type Scenario = {
  baseFeeBasisPoints: number;
  quoteFeeBasisPoints: number;
  quoteMaximumFee?: bigint;
  migratedTransferFeeAuthorityOption?: number;
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
  leftoverReceiver: Keypair;
  poolCreator: Keypair;
  feeClaimer: PublicKey;
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
    migrationFeeOption: 6,
    tokenSupply: {
      preMigrationTokenSupply: CONSTANT_TOKEN_SUPPLY,
      postMigrationTokenSupply: CONSTANT_TOKEN_SUPPLY,
    },
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

function expectTransferHookConfigured(svm: LiteSVM, baseMint: PublicKey) {
  const hook = getTransferHook(getMint(svm, baseMint, TOKEN_2022_PROGRAM_ID));
  expect(hook!.programId.toString()).eq(
    TRANSFER_HOOK_COUNTER_PROGRAM_ID.toString()
  );
  expect(hook!.authority.toString()).eq(derivePoolAuthority().toString());
}

function expectTransferHookRevoked(svm: LiteSVM, baseMint: PublicKey) {
  const hook = getTransferHook(getMint(svm, baseMint, TOKEN_2022_PROGRAM_ID));
  expect(hook!.programId.toString()).eq(PublicKey.default.toString());
  expect(hook!.authority.toString()).eq(PublicKey.default.toString());
}

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
  const quoteMint = createToken2022Mint(
    svm,
    admin,
    quoteHasFee
      ? {
          transferFeeConfig: {
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
  if (quoteHasFee) {
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
  const config = await createConfigWithTransferHook2(svm, program, {
    ...configParams,
    transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
    transferFee:
      scenario.baseFeeBasisPoints > 0
        ? {
            transferFeeBasisPoints: scenario.baseFeeBasisPoints,
            withheldAuthority: TransferFeeWithheldAuthority.Partner,
            migratedTransferFeeAuthorityOption:
              scenario.migratedTransferFeeAuthorityOption ??
              MigratedTransferFeeAuthorityOption.Immutable,
          }
        : null,
  });

  const virtualPool = await createPoolWithToken2022TransferHook(svm, program, {
    payer: poolCreator,
    poolCreator,
    quoteMint,
    config,
    transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
    instructionParams: {
      name: "fee",
      symbol: "FEE",
      uri: "fee.com",
    },
    tokenQuoteProgram: TOKEN_2022_PROGRAM_ID,
    tokenBadge,
  });
  const poolState = getVirtualPool(svm, program, virtualPool);
  await initializeExtraAccountMetaList(svm, operator, poolState.baseMint);
  expectTransferHookConfigured(svm, poolState.baseMint);

  const { completed } = await swapWithTransferHook(svm, program, {
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
  expectTransferHookRevoked(svm, poolState.baseMint);

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
    ({ dammPool, firstPosition, secondPosition } = await migratePool(
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
    leftoverReceiver: partner,
    poolCreator,
    feeClaimer: partner.publicKey,
  };
}

async function migratePool(
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

function secondPositionSharePpm(state: MigratedState): bigint {
  const first = positionLiquidity(state.svm, state.firstPosition);
  const second = positionLiquidity(state.svm, state.secondPosition);
  return (second * BigInt(1_000_000)) / (first + second);
}

function owedQuote(state: MigratedState): bigint {
  const pool = getVirtualPool(state.svm, state.program, state.virtualPool);
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

function baseLeftover(state: MigratedState): bigint {
  return balanceOf(state.svm, state.baseVault) - owedBase(state);
}

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

function depositedBase(state: MigratedState): bigint {
  return (
    state.preMigrationBaseVaultAmount - balanceOf(state.svm, state.baseVault)
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

describe("Migrate to damm v2 with transfer hook and a transfer fee on the base mint, the quote mint, or both", () => {
  let zeroFeeFixed: MigratedState;

  before(async () => {
    zeroFeeFixed = await setupPool({
      baseFeeBasisPoints: 0,
      quoteFeeBasisPoints: 0,
    });
  });

  for (const feeCase of FEE_CASES) {
    const { baseFeeBasisPoints, quoteFeeBasisPoints } = feeCase;
    const compoundingFeeBasisPoints = Math.max(
      baseFeeBasisPoints,
      quoteFeeBasisPoints
    );

    describe(feeCase.name, () => {
      let feeFixed: MigratedState;
      const states = () => [feeFixed];

      before(async () => {
        feeFixed = await setupPool({
          baseFeeBasisPoints,
          quoteFeeBasisPoints,
        });
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
          expect(balanceOf(state.svm, state.quoteVault) >= owedQuote(state)).eq(
            true
          );
        }
      });

      it("transfer hook stays revoked across migration", () => {
        for (const state of states()) {
          expectTransferHookRevoked(state.svm, state.baseMint);
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

      it("books the base that the quote fee kept out of damm v2 as protocol migration base fee", () => {
        const surplus =
          protocolMigrationBaseFee(feeFixed) -
          protocolMigrationBaseFee(zeroFeeFixed);
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

        expect(
          balanceOf(feeFixed.svm, feeFixed.baseVault) >= owedBase(feeFixed)
        ).eq(true);
      });

      it("books the quote that the base fee scaled off as protocol migration quote fee and strands none", () => {
        const plainProtocolBaseFee = protocolMigrationBaseFee(zeroFeeFixed);
        const plainProtocolQuoteFee = protocolMigrationQuoteFee(zeroFeeFixed);
        for (const state of states()) {
          expectWithinAbsolute(quoteLeftover(state), BigInt(0), BigInt(2));
          const routedQuote =
            protocolMigrationQuoteFee(state) - plainProtocolQuoteFee;
          if (baseFeeBasisPoints === 0) {
            expect(routedQuote.toString()).eq("0");
            continue;
          }
          const config = getConfig(state.svm, state.program, state.config);
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
          expectWithinAbsolute(feeLeftover, zeroFeeLeftover, BigInt(2));
          return;
        }
        expect(feeLeftover.toString()).eq(zeroFeeLeftover.toString());
      });

      it("leaves the token supply unchanged and pays the leftover to leftover_receiver", async () => {
        const supply = getMint(
          feeFixed.svm,
          feeFixed.baseMint,
          TOKEN_2022_PROGRAM_ID
        ).supply;
        expect(supply.toString()).eq(CONSTANT_TOKEN_SUPPLY.toString());

        const leftover = baseLeftover(feeFixed);
        const receiverAccount = getAssociatedTokenAddressSync(
          feeFixed.baseMint,
          feeFixed.leftoverReceiver.publicKey,
          true,
          TOKEN_2022_PROGRAM_ID
        );
        const preReceiver = balanceOf(feeFixed.svm, receiverAccount);

        await withdrawLeftover(feeFixed.svm, feeFixed.program, {
          payer: feeFixed.admin,
          virtualPool: feeFixed.virtualPool,
          leftoverReceiver: feeFixed.leftoverReceiver,
        });

        const received = balanceOf(feeFixed.svm, receiverAccount) - preReceiver;
        expect(received.toString()).eq(
          excluded(baseFeeBasisPoints, leftover).toString()
        );
        expect(baseLeftover(feeFixed).toString()).eq("0");
      });
    });
  }

  describe("quote transfer fee capped by maximum fee", () => {
    const CAPPED_FEE_BPS = 1000; // 10%
    const MAXIMUM_FEE = BigInt(1_000_000);

    it("compounding handler keeps the position split of a zero-fee pool", async () => {
      const zeroFee = await setupPool({
        baseFeeBasisPoints: 0,
        quoteFeeBasisPoints: 0,
      });
      const cappedFee = await setupPool({
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
      expectWithinAbsolute(landedQuote, quoteBudget - MAXIMUM_FEE, BigInt(16));
    });
  });

  describe("liquidity cliff", () => {
    it("fails when the quote fee leaves nothing for damm v2 to receive", async () => {
      const state = await setupPool(
        {
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
          migratePool(
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

  describe("migrated transfer fee authority option", () => {
    function baseFeeConfig(state: MigratedState) {
      const account = state.svm.getAccount(state.baseMint);
      const mint = unpackMint(
        state.baseMint,
        { ...account, data: Buffer.from(account.data) },
        TOKEN_2022_PROGRAM_ID
      );
      return getTransferFeeConfig(mint);
    }

    function feeForEpoch(
      config: ReturnType<typeof baseFeeConfig>,
      epoch: bigint
    ): TransferFee {
      return epoch >= config.newerTransferFee.epoch
        ? config.newerTransferFee
        : config.olderTransferFee;
    }

    function migrateWithOption(migratedTransferFeeAuthorityOption: number) {
      return setupPool({
        baseFeeBasisPoints: BASE_FEE_BPS,
        quoteFeeBasisPoints: 0,
        migratedTransferFeeAuthorityOption,
      });
    }

    it("option 0 keeps the fee with no authority on the mint", async () => {
      const state = await migrateWithOption(
        MigratedTransferFeeAuthorityOption.Immutable
      );
      const config = baseFeeConfig(state);

      expect(config.transferFeeConfigAuthority.toString()).eq(
        PublicKey.default.toString()
      );
      expect(config.newerTransferFee.transferFeeBasisPoints).eq(BASE_FEE_BPS);
      expect(
        feeForEpoch(config, state.svm.getClock().epoch).transferFeeBasisPoints
      ).eq(BASE_FEE_BPS);
    });

    it("option 1 schedules a zero fee two epochs out and revokes the authority", async () => {
      const state = await migrateWithOption(
        MigratedTransferFeeAuthorityOption.RevokeZeroFee
      );
      const config = baseFeeConfig(state);
      const migrationEpoch = state.svm.getClock().epoch;

      expect(config.transferFeeConfigAuthority.toString()).eq(
        PublicKey.default.toString()
      );
      expect(config.newerTransferFee.epoch).eq(migrationEpoch + BigInt(2));
      expect(config.newerTransferFee.transferFeeBasisPoints).eq(0);
      expect(config.olderTransferFee.transferFeeBasisPoints).eq(BASE_FEE_BPS);
      expect(
        calculateFee(feeForEpoch(config, migrationEpoch), BigInt(1_000_000))
      ).eq(BigInt(25_000));

      warpEpochBy(state.svm, 2);
      const afterWarp = state.svm.getClock().epoch;
      expect(
        calculateFee(feeForEpoch(config, afterWarp), BigInt(1_000_000))
      ).eq(BigInt(0));
    });

    it("option 2 hands the authority to the creator", async () => {
      const state = await migrateWithOption(
        MigratedTransferFeeAuthorityOption.Creator
      );
      const config = baseFeeConfig(state);

      expect(config.transferFeeConfigAuthority.toString()).eq(
        state.poolCreator.publicKey.toString()
      );
      expect(config.newerTransferFee.transferFeeBasisPoints).eq(BASE_FEE_BPS);
    });

    it("option 3 hands the authority to the partner", async () => {
      const state = await migrateWithOption(
        MigratedTransferFeeAuthorityOption.Partner
      );
      const config = baseFeeConfig(state);

      expect(config.transferFeeConfigAuthority.toString()).eq(
        state.feeClaimer.toString()
      );
      expect(config.newerTransferFee.transferFeeBasisPoints).eq(BASE_FEE_BPS);
    });

    it("holds the authority with the pool authority until migration", async () => {
      const state = await setupPool(
        {
          baseFeeBasisPoints: BASE_FEE_BPS,
          quoteFeeBasisPoints: 0,
          migratedTransferFeeAuthorityOption:
            MigratedTransferFeeAuthorityOption.Creator,
        },
        false
      );

      expect(baseFeeConfig(state).transferFeeConfigAuthority.toString()).eq(
        derivePoolAuthority().toString()
      );
      expect(() =>
        setTransferFee(
          state.svm,
          state.poolCreator,
          state.baseMint,
          state.poolCreator,
          0,
          NO_CAP
        )
      ).to.throw();
    });

    it("leaves a mint without a base fee untouched", async () => {
      const state = await setupPool({
        baseFeeBasisPoints: 0,
        quoteFeeBasisPoints: QUOTE_FEE_BPS,
      });

      expect(
        getVirtualPool(state.svm, state.program, state.virtualPool).isMigrated
      ).eq(1);
      const account = state.svm.getAccount(state.baseMint);
      const mint = unpackMint(
        state.baseMint,
        { ...account, data: Buffer.from(account.data) },
        TOKEN_2022_PROGRAM_ID
      );
      expect(getTransferFeeConfig(mint)).eq(null);
    });
  });

  describe("withdraw leftover authorization", () => {
    function receiverAccount(state: MigratedState): PublicKey {
      return getAssociatedTokenAddressSync(
        state.baseMint,
        state.leftoverReceiver.publicKey,
        true,
        TOKEN_2022_PROGRAM_ID
      );
    }

    it("rejects a permissionless withdrawal that charges a base transfer fee", async () => {
      const state = await setupPool({
        baseFeeBasisPoints: BASE_FEE_BPS,
        quoteFeeBasisPoints: 0,
      });
      const leftover = baseLeftover(state);

      await expectThrowsAsync(
        () =>
          withdrawLeftover(state.svm, state.program, {
            payer: state.admin,
            virtualPool: state.virtualPool,
          }),
        "AccountNotSigner"
      );
      expect(baseLeftover(state).toString()).eq(leftover.toString());
      expect(
        getVirtualPool(state.svm, state.program, state.virtualPool)
          .isWithdrawLeftover
      ).eq(0);
    });

    it("allows a permissionless withdrawal when the base mint has no transfer fee", async () => {
      const state = await setupPool({
        baseFeeBasisPoints: 0,
        quoteFeeBasisPoints: QUOTE_FEE_BPS,
      });
      const leftover = baseLeftover(state);
      const preReceiver = balanceOf(state.svm, receiverAccount(state));

      await withdrawLeftover(state.svm, state.program, {
        payer: state.admin,
        virtualPool: state.virtualPool,
      });

      const received =
        balanceOf(state.svm, receiverAccount(state)) - preReceiver;
      expect(received.toString()).eq(leftover.toString());
    });

    it("waits for the zero fee of RevokeZeroFee before a permissionless withdrawal", async () => {
      const state = await setupPool({
        baseFeeBasisPoints: BASE_FEE_BPS,
        quoteFeeBasisPoints: 0,
        migratedTransferFeeAuthorityOption:
          MigratedTransferFeeAuthorityOption.RevokeZeroFee,
      });
      const leftover = baseLeftover(state);

      await expectThrowsAsync(
        () =>
          withdrawLeftover(state.svm, state.program, {
            payer: state.admin,
            virtualPool: state.virtualPool,
          }),
        "AccountNotSigner"
      );

      warpEpochBy(state.svm, 2);
      const preReceiver = balanceOf(state.svm, receiverAccount(state));
      await withdrawLeftover(state.svm, state.program, {
        payer: state.admin,
        virtualPool: state.virtualPool,
      });

      const received =
        balanceOf(state.svm, receiverAccount(state)) - preReceiver;
      expect(received.toString()).eq(leftover.toString());
    });

    it("rejects a permissionless withdrawal after the fee authority raises the fee", async () => {
      const state = await setupPool({
        baseFeeBasisPoints: BASE_FEE_BPS,
        quoteFeeBasisPoints: 0,
        migratedTransferFeeAuthorityOption:
          MigratedTransferFeeAuthorityOption.Creator,
      });
      setTransferFee(
        state.svm,
        state.poolCreator,
        state.baseMint,
        state.poolCreator,
        10_000,
        NO_CAP
      );
      warpEpochBy(state.svm, 2);

      await expectThrowsAsync(
        () =>
          withdrawLeftover(state.svm, state.program, {
            payer: state.poolCreator,
            virtualPool: state.virtualPool,
          }),
        "AccountNotSigner"
      );
      expect(
        getVirtualPool(state.svm, state.program, state.virtualPool)
          .isWithdrawLeftover
      ).eq(0);
    });
  });

  describe("choice between the original migration path and the transfer fee migration path", () => {
    it("takes the transfer fee path when the quote mint has a live fee authority, even while the active fee is zero", async () => {
      // a badged quote mint with a fee authority. Its fee is set to zero, so the current epoch charges nothing
      const state = await setupPool(
        {
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
      await migratePool(
        state.svm,
        state.program,
        state.admin,
        state.virtualPool
      );
      expect(
        getVirtualPool(state.svm, state.program, state.virtualPool).isMigrated
      ).eq(1);
    });
  });
});
