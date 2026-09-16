import {
  calculateFee,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TransferFee,
  unpackMint,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  BaseFee,
  ConfigParameters,
  createConfig,
  createConfig2,
  createLocker,
  createPoolWithToken2022,
  swap,
  SwapMode,
  TransferFeeParameters,
} from "./instructions";
import { deriveLockerEscrow } from "./instructions/lockerInstructions";
import {
  createVirtualCurveProgram,
  deriveBaseKeyForLocker,
  expectThrowsAsync,
  generateAndFund,
  getTotalSupplyFromCurve,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  startSvm,
  U64_MAX,
} from "./utils";
import { getConfig, getVirtualPool } from "./utils/fetcher";
import { getTokenAccount, getTransferFeeIncludedAmount } from "./utils/token";
import { Pool, VirtualCurveProgram } from "./utils/types";

const MIGRATION_QUOTE_THRESHOLD = new BN(LAMPORTS_PER_SOL * 5);
const TRANSFER_FEE_BASIS_POINTS = 250; // 2.5%
const TRANSFER_FEE: TransferFee = {
  epoch: BigInt(0),
  maximumFee: BigInt(U64_MAX.toString()),
  transferFeeBasisPoints: TRANSFER_FEE_BASIS_POINTS,
};
const TRANSFER_FEE_PARAMETERS: TransferFeeParameters = {
  transferFeeBasisPoints: TRANSFER_FEE_BASIS_POINTS,
  maximumFee: U64_MAX,
  withheldAuthority: 1,
};
const LOCKED_VESTING = {
  amountPerPeriod: new BN(1_000_000),
  cliffDurationFromMigrationTime: new BN(0),
  frequency: new BN(1),
  numberOfPeriod: new BN(10),
  cliffUnlockAmount: new BN(1_000_000_000),
};
const VESTING_TOTAL = BigInt(
  LOCKED_VESTING.cliffUnlockAmount
    .add(LOCKED_VESTING.amountPerPeriod.mul(LOCKED_VESTING.numberOfPeriod))
    .toString()
);
const VESTING_TOTAL_INCLUDED = getTransferFeeIncludedAmount(
  TRANSFER_FEE,
  VESTING_TOTAL
);

function buildCurve() {
  const curves = [];
  for (let i = 1; i <= 16; i++) {
    curves.push({
      sqrtPrice:
        i == 16 ? MAX_SQRT_PRICE : MAX_SQRT_PRICE.muln(i * 5).divn(100),
      liquidity: U64_MAX.shln(30 + i),
    });
  }
  return curves;
}

function buildConfigParams(
  tokenSupply: { pre: bigint; post: bigint } | null
): ConfigParameters {
  const baseFee: BaseFee = {
    cliffFeeNumerator: new BN(2_500_000),
    firstFactor: 0,
    secondFactor: new BN(0),
    thirdFactor: new BN(0),
    baseFeeMode: 0,
  };
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
    lockedVesting: LOCKED_VESTING,
    migrationFeeOption: 0,
    tokenSupply: tokenSupply
      ? {
          preMigrationTokenSupply: new BN(tokenSupply.pre.toString()),
          postMigrationTokenSupply: new BN(tokenSupply.post.toString()),
        }
      : null,
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
    creatorLiquidityVestingInfo: liquidityVestingInfo,
    partnerLiquidityVestingInfo: liquidityVestingInfo,
    poolCreationFee: new BN(0),
    migratedPoolBaseFeeMode: 0,
    migratedPoolMarketCapFeeSchedulerParams: null,
    enableFirstSwapWithMinFee: false,
    compoundingFeeBps: 0,
    curve: buildCurve(),
  };
}

function mintSupply(svm: LiteSVM, mint: PublicKey): bigint {
  const account = svm.getAccount(mint);
  return unpackMint(
    mint,
    { ...account, data: Buffer.from(account.data) },
    TOKEN_2022_PROGRAM_ID
  ).supply;
}

function balanceOf(svm: LiteSVM, tokenAccount: PublicKey): bigint {
  if (svm.getAccount(tokenAccount) === null) {
    return BigInt(0);
  }
  return getTokenAccount(svm, tokenAccount).amount;
}

function escrowTokenAccountOf(virtualPool: PublicKey, baseMint: PublicKey) {
  const escrow = deriveLockerEscrow(deriveBaseKeyForLocker(virtualPool));
  return getAssociatedTokenAddressSync(
    baseMint,
    escrow,
    true,
    TOKEN_2022_PROGRAM_ID
  );
}

function requiredBaseReserve(poolState: Pool, migrationBaseThreshold: BN) {
  return (
    BigInt(migrationBaseThreshold.toString()) +
    BigInt(poolState.protocolBaseFee.toString()) +
    BigInt(poolState.partnerBaseFee.toString()) +
    BigInt(poolState.creatorBaseFee.toString())
  );
}

describe("Create locker with a base mint that has a transfer fee", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let partner: Keypair;
  let user: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;

  // supply minted by the fee config, read on chain in the first test
  let feeMintSupply: bigint;

  before(async () => {
    svm = startSvm();
    admin = generateAndFund(svm);
    partner = generateAndFund(svm);
    user = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    program = createVirtualCurveProgram();
  });

  async function createFeeConfig(
    tokenSupply: { pre: bigint; post: bigint } | null
  ) {
    return createConfig2(svm, program, {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: NATIVE_MINT,
      instructionParams: {
        ...buildConfigParams(tokenSupply),
        transferFee: TRANSFER_FEE_PARAMETERS,
      },
    });
  }

  async function createPool(config: PublicKey) {
    const pool = await createPoolWithToken2022(svm, program, {
      payer: admin,
      poolCreator,
      quoteMint: NATIVE_MINT,
      config,
      instructionParams: { name: "fee", symbol: "FEE", uri: "fee.com" },
    });
    return { pool, poolState: getVirtualPool(svm, program, pool) };
  }

  async function completeCurve(config: PublicKey, pool: PublicKey) {
    const { completed } = await swap(svm, program, {
      config,
      payer: user,
      pool,
      inputTokenMint: NATIVE_MINT,
      outputTokenMint: getVirtualPool(svm, program, pool).baseMint,
      amountIn: new BN(LAMPORTS_PER_SOL * 5.5),
      minimumAmountOut: new BN(0),
      swapMode: SwapMode.PartialFill,
      referralTokenAccount: null,
    });
    expect(completed).eq(true);
  }

  async function expectLockerPullsGrossedUpVesting(
    config: PublicKey,
    pool: PublicKey
  ) {
    const poolState = getVirtualPool(svm, program, pool);
    const escrowToken = escrowTokenAccountOf(pool, poolState.baseMint);
    const preVault = balanceOf(svm, poolState.baseVault);

    await createLocker(svm, program, { payer: admin, virtualPool: pool });

    const vaultPaid = preVault - balanceOf(svm, poolState.baseVault);
    expect(vaultPaid.toString()).eq(VESTING_TOTAL_INCLUDED.toString());
    expect(balanceOf(svm, escrowToken).toString()).eq(VESTING_TOTAL.toString());
    expect(calculateFee(TRANSFER_FEE, vaultPaid).toString()).eq(
      (VESTING_TOTAL_INCLUDED - VESTING_TOTAL).toString()
    );

    const configState = getConfig(svm, program, config);
    const postPoolState = getVirtualPool(svm, program, pool);
    expect(
      balanceOf(svm, poolState.baseVault) >=
        requiredBaseReserve(postPoolState, configState.migrationBaseThreshold)
    ).eq(true);
  }

  describe("Non-fixed supply", () => {
    let config: PublicKey;
    let pool: PublicKey;

    it("Mints the vesting reserve grossed up by the transfer fee", async () => {
      const zeroFeeConfig = await createConfig(svm, program, {
        payer: partner,
        leftoverReceiver: partner.publicKey,
        feeClaimer: partner.publicKey,
        quoteMint: NATIVE_MINT,
        instructionParams: buildConfigParams(null),
      });
      const zeroFeePool = await createPool(zeroFeeConfig);
      const zeroFeeSupply = mintSupply(svm, zeroFeePool.poolState.baseMint);

      config = await createFeeConfig(null);
      const feePool = await createPool(config);
      pool = feePool.pool;
      feeMintSupply = mintSupply(svm, feePool.poolState.baseMint);

      expect((feeMintSupply - zeroFeeSupply).toString()).eq(
        (VESTING_TOTAL_INCLUDED - VESTING_TOTAL).toString()
      );
    });

    it("TS supply helper grosses up the vesting part by the same amount", () => {
      const params = buildConfigParams(null);
      const withoutFee = getTotalSupplyFromCurve(
        params.migrationQuoteThreshold,
        params.sqrtStartPrice,
        params.curve,
        params.lockedVesting,
        params.migrationOption,
        new BN(0),
        params.migrationFee.feePercentage
      );
      const withFee = getTotalSupplyFromCurve(
        params.migrationQuoteThreshold,
        params.sqrtStartPrice,
        params.curve,
        params.lockedVesting,
        params.migrationOption,
        new BN(0),
        params.migrationFee.feePercentage,
        TRANSFER_FEE
      );
      expect(withFee.sub(withoutFee).toString()).eq(
        (VESTING_TOTAL_INCLUDED - VESTING_TOTAL).toString()
      );
    });

    it("Completing swap passes the grossed-up reserve check", async () => {
      await completeCurve(config, pool);
    });

    it("Locker pulls the grossed-up amount and the escrow holds the exact vesting total", async () => {
      await expectLockerPullsGrossedUpVesting(config, pool);
    });
  });

  describe("Fixed supply", () => {
    let config: PublicKey;
    let pool: PublicKey;

    it("Rejects a pre-migration supply one unit below the grossed-up minimum", async () => {
      await expectThrowsAsync(
        () =>
          createFeeConfig({
            pre: feeMintSupply - BigInt(1),
            post: feeMintSupply - BigInt(1),
          }),
        "InvalidTokenSupply"
      );
    });

    it("Accepts the grossed-up minimum and mints exactly that supply", async () => {
      config = await createFeeConfig({
        pre: feeMintSupply,
        post: feeMintSupply,
      });
      const feePool = await createPool(config);
      pool = feePool.pool;
      expect(mintSupply(svm, feePool.poolState.baseMint).toString()).eq(
        feeMintSupply.toString()
      );
    });

    it("Completing swap passes the grossed-up reserve check", async () => {
      await completeCurve(config, pool);
    });

    it("Locker pulls the grossed-up amount and the escrow holds the exact vesting total", async () => {
      await expectLockerPullsGrossedUpVesting(config, pool);
    });
  });
});
