import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  BaseFee,
  ConfigParameters,
  createConfig,
  CreateConfigParams,
  createPoolWithSplToken,
  swap,
  SwapMode,
  SwapParams,
} from "./instructions";
import {
  createVirtualCurveProgram,
  generateAndFund,
  getTokenAccount,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  startSvm,
  U64_MAX,
} from "./utils";
import { getVirtualPool } from "./utils/fetcher";
import {
  createToken,
  getOrCreateAssociatedTokenAccount,
  mintSplTokenTo,
} from "./utils/token";
import { Pool, VirtualCurveProgram } from "./utils/types";

describe("Swap with referral (Anchor dup constraint)", () => {
  const SWAP_AMOUNT_QUOTE_TO_BASE = new BN(LAMPORTS_PER_SOL);
  const SWAP_AMOUNT_BASE_TO_QUOTE = new BN(10_000_000);
  const USER_QUOTE_AIRDROP = BigInt(LAMPORTS_PER_SOL * 100);

  let svm: LiteSVM;
  let admin: Keypair;
  let partner: Keypair;
  let user: Keypair;
  let operator: Keypair;
  let poolCreator: Keypair;
  let referralOwner: Keypair;
  let program: VirtualCurveProgram;
  let quoteMint: PublicKey;
  let config: PublicKey;
  let virtualPool: PublicKey;
  let virtualPoolState: Pool;
  let referralTokenAccount: PublicKey;
  let userQuoteAta: PublicKey;
  let userBaseAta: PublicKey;

  let nonSelfQuoteToBaseUserQuote: bigint;
  let nonSelfBaseToQuoteUserQuote: bigint;

  beforeEach(async () => {
    svm = startSvm();
    admin = generateAndFund(svm);
    partner = generateAndFund(svm);
    user = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    operator = generateAndFund(svm);
    referralOwner = generateAndFund(svm);
    program = createVirtualCurveProgram();

    quoteMint = createToken(svm, admin, admin.publicKey, 9);

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
      collectFeeMode: 0, // QuoteToken
      migrationOption: 0,
      tokenType: 0,
      tokenDecimal: 6,
      migrationQuoteThreshold: new BN(LAMPORTS_PER_SOL * 500),
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
      enableFirstSwapWithMinFee: false,
      compoundingFeeBps: 0,
      migratedPoolBaseFeeMode: 0,
      migratedPoolMarketCapFeeSchedulerParams: null,
      curve: curves,
    };
    const params: CreateConfigParams<ConfigParameters> = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint,
      instructionParams,
    };
    config = await createConfig(svm, program, params);

    virtualPool = await createPoolWithSplToken(svm, program, {
      poolCreator,
      payer: operator,
      quoteMint,
      config,
      instructionParams: {
        name: "test token spl",
        symbol: "TEST",
        uri: "abc.com",
      },
    });

    virtualPoolState = getVirtualPool(svm, program, virtualPool);

    mintSplTokenTo(
      svm,
      admin,
      quoteMint,
      admin,
      user.publicKey,
      USER_QUOTE_AIRDROP
    );
    userQuoteAta = getAssociatedTokenAddressSync(quoteMint, user.publicKey);
    userBaseAta = getAssociatedTokenAddressSync(
      virtualPoolState.baseMint,
      user.publicKey
    );

    referralTokenAccount = getOrCreateAssociatedTokenAccount(
      svm,
      operator,
      quoteMint,
      referralOwner.publicKey,
      TOKEN_PROGRAM_ID
    );
  });

  it("QuoteToBase with referral", async () => {
    const preReferralBalance =
      getTokenAccount(svm, referralTokenAccount)?.amount ?? BigInt(0);
    const preUserQuote = getTokenAccount(svm, userQuoteAta)!.amount;
    const preUserBase = getTokenAccount(svm, userBaseAta)?.amount ?? BigInt(0);

    const swapParams: SwapParams = {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: quoteMint,
      outputTokenMint: virtualPoolState.baseMint,
      amountIn: SWAP_AMOUNT_QUOTE_TO_BASE,
      minimumAmountOut: new BN(0),
      swapMode: SwapMode.ExactIn,
      referralTokenAccount,
    };
    await swap(svm, program, swapParams);

    const postReferralBalance =
      getTokenAccount(svm, referralTokenAccount)?.amount ?? BigInt(0);
    const userQuote = getTokenAccount(svm, userQuoteAta)!.amount;
    const userBase = getTokenAccount(svm, userBaseAta)!.amount;

    expect(Number(postReferralBalance)).to.be.greaterThan(
      Number(preReferralBalance)
    );
    expect(Number(userQuote)).to.be.lessThan(Number(preUserQuote));
    expect(Number(userBase)).to.be.greaterThan(Number(preUserBase));

    nonSelfQuoteToBaseUserQuote = userQuote;
  });

  it("BaseToQuote with referral", async () => {
    await swap(svm, program, {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: quoteMint,
      outputTokenMint: virtualPoolState.baseMint,
      amountIn: SWAP_AMOUNT_QUOTE_TO_BASE,
      minimumAmountOut: new BN(0),
      swapMode: SwapMode.ExactIn,
      referralTokenAccount: null,
    });

    const preReferralBalance =
      getTokenAccount(svm, referralTokenAccount)?.amount ?? BigInt(0);
    const preUserQuote = getTokenAccount(svm, userQuoteAta)!.amount;
    const preUserBase = getTokenAccount(svm, userBaseAta)!.amount;

    const swapParams: SwapParams = {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: virtualPoolState.baseMint,
      outputTokenMint: quoteMint,
      amountIn: SWAP_AMOUNT_BASE_TO_QUOTE,
      minimumAmountOut: new BN(0),
      swapMode: SwapMode.ExactIn,
      referralTokenAccount,
    };
    await swap(svm, program, swapParams);

    const postReferralBalance =
      getTokenAccount(svm, referralTokenAccount)?.amount ?? BigInt(0);
    const userQuote = getTokenAccount(svm, userQuoteAta)!.amount;
    const userBase = getTokenAccount(svm, userBaseAta)!.amount;

    expect(Number(postReferralBalance)).to.be.greaterThan(
      Number(preReferralBalance)
    );
    expect(Number(userBase)).to.be.lessThan(Number(preUserBase));
    expect(Number(userQuote)).to.be.greaterThan(Number(preUserQuote));

    nonSelfBaseToQuoteUserQuote = userQuote;
  });

  it("Self-referral on QuoteToBase, input_token_account = referralTokenAccount", async () => {
    const preUserQuote = getTokenAccount(svm, userQuoteAta)!.amount;
    const preUserBase = getTokenAccount(svm, userBaseAta)?.amount ?? BigInt(0);

    const swapParams: SwapParams = {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: quoteMint,
      outputTokenMint: virtualPoolState.baseMint,
      amountIn: SWAP_AMOUNT_QUOTE_TO_BASE,
      minimumAmountOut: new BN(0),
      swapMode: SwapMode.ExactIn,
      referralTokenAccount: userQuoteAta,
    };
    await swap(svm, program, swapParams);

    const userQuote = getTokenAccount(svm, userQuoteAta)!.amount;
    const userBase = getTokenAccount(svm, userBaseAta)!.amount;

    expect(Number(userQuote)).to.be.lessThan(Number(preUserQuote));
    expect(Number(userBase)).to.be.greaterThan(Number(preUserBase));
    expect(Number(userQuote)).to.be.greaterThan(
      Number(nonSelfQuoteToBaseUserQuote)
    );
  });

  it("Self-referral on BaseToQuote, output_token_account = referralTokenAccount", async () => {
    await swap(svm, program, {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: quoteMint,
      outputTokenMint: virtualPoolState.baseMint,
      amountIn: SWAP_AMOUNT_QUOTE_TO_BASE,
      minimumAmountOut: new BN(0),
      swapMode: SwapMode.ExactIn,
      referralTokenAccount: null,
    });

    const preUserQuote = getTokenAccount(svm, userQuoteAta)!.amount;
    const preUserBase = getTokenAccount(svm, userBaseAta)!.amount;

    const swapParams: SwapParams = {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: virtualPoolState.baseMint,
      outputTokenMint: quoteMint,
      amountIn: SWAP_AMOUNT_BASE_TO_QUOTE,
      minimumAmountOut: new BN(0),
      swapMode: SwapMode.ExactIn,
      referralTokenAccount: userQuoteAta,
    };
    await swap(svm, program, swapParams);

    const userQuote = getTokenAccount(svm, userQuoteAta)!.amount;
    const userBase = getTokenAccount(svm, userBaseAta)!.amount;

    expect(Number(userBase)).to.be.lessThan(Number(preUserBase));
    expect(Number(userQuote)).to.be.greaterThan(Number(preUserQuote));
    expect(Number(userQuote)).to.be.greaterThan(
      Number(nonSelfBaseToQuoteUserQuote)
    );
  });
});
