import {
  AccountLayout,
  calculateFee,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TransferFee,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { BN } from "bn.js";
import { expect } from "chai";
import { LiteSVM, SimulatedTransactionInfo } from "litesvm";
import {
  BaseFee,
  buildSwapTransaction,
  claimCreatorTradingFee,
  claimTradingFee,
  ConfigParameters,
  createConfig,
  createConfig2,
  createOperatorAccount,
  createPoolWithToken2022,
  createTokenBadge,
  creatorWithdrawMigrationFee,
  creatorWithdrawSurplus,
  OperatorPermission,
  partnerWithdrawMigrationFee,
  partnerWithdrawSurplus,
  swap,
  SwapMode,
  SwapParams,
} from "./instructions";
import {
  createVirtualCurveProgram,
  expectThrowsAsync,
  generateAndFund,
  getDbcProgramErrorCodeHexString,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  sendTransactionMaybeThrow,
  startSvm,
  U64_MAX,
} from "./utils";
import { deriveTokenBadgeAddress } from "./utils/accounts";
import { getVirtualPool } from "./utils/fetcher";
import {
  createToken2022Mint,
  getOrCreateAssociatedTokenAccount,
  getTokenAccount,
  getTransferFeeIncludedAmount,
  mintToken2022To,
} from "./utils/token";
import { Pool, VirtualCurveProgram } from "./utils/types";

const MIGRATION_QUOTE_THRESHOLD = new BN(LAMPORTS_PER_SOL * 5);
const USER_QUOTE_BALANCE = BigInt(LAMPORTS_PER_SOL) * BigInt(100);
const NO_CAP = BigInt(U64_MAX.toString());
const WITHHELD_AUTHORITY_CREATOR = 1;

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

function balanceOf(svm: LiteSVM, tokenAccount: PublicKey): bigint {
  if (svm.getAccount(tokenAccount) === null) {
    return BigInt(0);
  }
  return getTokenAccount(svm, tokenAccount).amount;
}

// Absolute change of a vault balance if `transaction` were executed now.
function simulatedVaultDelta(
  svm: LiteSVM,
  transaction: Transaction,
  vault: PublicKey
): bigint {
  const pre = balanceOf(svm, vault);
  const simulation = svm.simulateTransaction(transaction);
  expect(simulation).instanceOf(SimulatedTransactionInfo);
  const post = (simulation as SimulatedTransactionInfo)
    .postAccounts()
    .find(([key]) => key.equals(vault));
  expect(post).not.eq(undefined);
  const postAmount = AccountLayout.decode(post![1].data()).amount;
  return postAmount > pre ? postAmount - pre : pre - postAmount;
}

function accruedBaseFees(poolState: Pool): bigint {
  return (
    BigInt(poolState.protocolBaseFee.toString()) +
    BigInt(poolState.partnerBaseFee.toString()) +
    BigInt(poolState.creatorBaseFee.toString())
  );
}

function accruedQuoteFees(poolState: Pool): bigint {
  return (
    BigInt(poolState.protocolQuoteFee.toString()) +
    BigInt(poolState.partnerQuoteFee.toString()) +
    BigInt(poolState.creatorQuoteFee.toString())
  );
}

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
    // fees on the output token, so quote-to-base swaps accrue base fees and base-to-quote swaps accrue quote fees
    collectFeeMode: 1,
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
    migrationFeeOption: 0,
    tokenSupply: null,
    // non-zero creator and migration fee shares so every payout below moves tokens
    creatorTradingFeePercentage: 50,
    tokenUpdateAuthority: 0,
    migrationFee: {
      feePercentage: 10,
      creatorFeePercentage: 50,
    },
    migratedPoolFee: {
      collectFeeMode: 0,
      dynamicFee: 0,
      poolFeeBps: 0,
    },
    creatorLiquidityVestingInfo: liquidityVestingInfo,
    partnerLiquidityVestingInfo: liquidityVestingInfo,
    poolCreationFee: new BN(0),
    enableFirstSwapWithMinFee: false,
    compoundingFeeBps: 0,
    migratedPoolBaseFeeMode: 0,
    migratedPoolMarketCapFeeSchedulerParams: null,
    curve: curves,
  };
}

describe("Swap with a transfer fee on the base mint, the quote mint, or both", () => {
  for (const feeCase of FEE_CASES) {
    const { baseFeeBasisPoints, quoteFeeBasisPoints } = feeCase;
    const excludedBase = (amount: bigint) =>
      excluded(baseFeeBasisPoints, amount);
    const includedBase = (amount: bigint) =>
      included(baseFeeBasisPoints, amount);
    const excludedQuote = (amount: bigint) =>
      excluded(quoteFeeBasisPoints, amount);
    const includedQuote = (amount: bigint) =>
      included(quoteFeeBasisPoints, amount);

    describe(feeCase.name, () => {
      let svm: LiteSVM;
      let admin: Keypair;
      let operator: Keypair;
      let partner: Keypair;
      let poolCreator: Keypair;
      let user: Keypair;
      let referrer: Keypair;
      let program: VirtualCurveProgram;

      let quoteMint: PublicKey;
      let tokenBadge: PublicKey | undefined;
      let config: PublicKey;
      let virtualPool: PublicKey;
      let baseMint: PublicKey;
      let baseVault: PublicKey;
      let quoteVault: PublicKey;

      const baseAccountOf = (owner: PublicKey) =>
        getAssociatedTokenAddressSync(
          baseMint,
          owner,
          true,
          TOKEN_2022_PROGRAM_ID
        );
      const quoteAccountOf = (owner: PublicKey) =>
        getAssociatedTokenAddressSync(
          quoteMint,
          owner,
          true,
          TOKEN_2022_PROGRAM_ID
        );

      // Runs a payout and checks each recipient account nets the vault delta minus that mint's transfer fee.
      // Returns the base and quote amounts that left the vaults.
      async function expectNetPayout(
        recipient: PublicKey,
        action: () => Promise<unknown>
      ): Promise<{ basePaid: bigint; quotePaid: bigint }> {
        const preBaseVault = balanceOf(svm, baseVault);
        const preQuoteVault = balanceOf(svm, quoteVault);
        const preBase = balanceOf(svm, baseAccountOf(recipient));
        const preQuote = balanceOf(svm, quoteAccountOf(recipient));
        await action();
        const basePaid = preBaseVault - balanceOf(svm, baseVault);
        const quotePaid = preQuoteVault - balanceOf(svm, quoteVault);
        expect(
          (balanceOf(svm, baseAccountOf(recipient)) - preBase).toString()
        ).eq(excludedBase(basePaid).toString());
        expect(
          (balanceOf(svm, quoteAccountOf(recipient)) - preQuote).toString()
        ).eq(excludedQuote(quotePaid).toString());
        return { basePaid, quotePaid };
      }

      before(async () => {
        svm = startSvm();
        admin = generateAndFund(svm);
        operator = generateAndFund(svm);
        partner = generateAndFund(svm);
        poolCreator = generateAndFund(svm);
        user = generateAndFund(svm);
        referrer = generateAndFund(svm);
        program = createVirtualCurveProgram();

        await createOperatorAccount(svm, program, {
          admin,
          whitelistedAddress: operator.publicKey,
          permissions: [OperatorPermission.CreateTokenBadge],
        });

        quoteMint = createToken2022Mint(
          svm,
          admin,
          quoteFeeBasisPoints > 0
            ? {
                transferFeeConfig: {
                  feeBasisPoints: quoteFeeBasisPoints,
                  maximumFee: NO_CAP,
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
      });

      if (quoteFeeBasisPoints > 0) {
        it("Rejects config creation for the fee-bearing quote mint without a badge", async () => {
          const errorCode =
            getDbcProgramErrorCodeHexString("InvalidTokenBadge");
          await expectThrowsAsync(async () => {
            await createConfig(svm, program, {
              payer: partner,
              leftoverReceiver: partner.publicKey,
              feeClaimer: partner.publicKey,
              quoteMint,
              instructionParams: buildConfigParams(),
            });
          }, errorCode);
        });

        it("Creates a token badge for the fee-bearing quote mint", async () => {
          await createTokenBadge(svm, program, {
            operator,
            payer: operator,
            tokenMint: quoteMint,
          });
          tokenBadge = deriveTokenBadgeAddress(quoteMint);
          expect(svm.getAccount(tokenBadge)).not.eq(null);
        });
      }

      it("Creates config and pool", async () => {
        const configParams = {
          payer: partner,
          leftoverReceiver: partner.publicKey,
          feeClaimer: partner.publicKey,
          quoteMint,
          instructionParams: buildConfigParams(),
          tokenBadge,
        };
        config =
          baseFeeBasisPoints > 0
            ? await createConfig2(svm, program, {
                ...configParams,
                instructionParams: {
                  ...configParams.instructionParams,
                  transferFee: {
                    transferFeeBasisPoints: baseFeeBasisPoints,
                    maximumFee: U64_MAX,
                    withheldAuthority: WITHHELD_AUTHORITY_CREATOR,
                  },
                },
              })
            : await createConfig(svm, program, configParams);

        virtualPool = await createPoolWithToken2022(svm, program, {
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
        baseMint = poolState.baseMint;
        baseVault = poolState.baseVault;
        quoteVault = poolState.quoteVault;
      });

      it("Exact-in quote to base charges the full quote input, credits the vault net of the quote fee, and pays the base output net of the base fee", async () => {
        const amountIn = BigInt(LAMPORTS_PER_SOL);
        const params: SwapParams = {
          config,
          payer: user,
          pool: virtualPool,
          inputTokenMint: quoteMint,
          outputTokenMint: baseMint,
          amountIn: new BN(amountIn.toString()),
          minimumAmountOut: new BN(0),
          swapMode: SwapMode.ExactIn,
          referralTokenAccount: null,
        };

        const grossBaseOut = simulatedVaultDelta(
          svm,
          await buildSwapTransaction(svm, program, params),
          baseVault
        );
        const netBaseOut = excludedBase(grossBaseOut);

        // slippage is checked on what the user actually receives
        const errorCode = getDbcProgramErrorCodeHexString("ExceededSlippage");
        await expectThrowsAsync(async () => {
          const transaction = await buildSwapTransaction(svm, program, {
            ...params,
            minimumAmountOut: new BN((netBaseOut + BigInt(1)).toString()),
          });
          sendTransactionMaybeThrow(svm, transaction, [user]);
        }, errorCode);

        const poolState = getVirtualPool(svm, program, virtualPool);
        const preUserQuote = balanceOf(svm, quoteAccountOf(user.publicKey));
        const preUserBase = balanceOf(svm, baseAccountOf(user.publicKey));
        const preVaultBase = balanceOf(svm, baseVault);
        const preVaultQuote = balanceOf(svm, quoteVault);
        const preQuoteReserve = BigInt(poolState.quoteReserve.toString());
        const preQuoteFees = accruedQuoteFees(poolState);

        const transaction = await buildSwapTransaction(svm, program, {
          ...params,
          minimumAmountOut: new BN(netBaseOut.toString()),
        });
        sendTransactionMaybeThrow(svm, transaction, [user]);

        const postPoolState = getVirtualPool(svm, program, virtualPool);
        const userQuotePaid =
          preUserQuote - balanceOf(svm, quoteAccountOf(user.publicKey));
        const userBaseReceived =
          balanceOf(svm, baseAccountOf(user.publicKey)) - preUserBase;
        const vaultBasePaid = preVaultBase - balanceOf(svm, baseVault);
        const vaultQuoteReceived = balanceOf(svm, quoteVault) - preVaultQuote;
        const curveAccountedQuote =
          BigInt(postPoolState.quoteReserve.toString()) -
          preQuoteReserve +
          (accruedQuoteFees(postPoolState) - preQuoteFees);

        expect(userQuotePaid.toString()).eq(amountIn.toString());
        expect(vaultQuoteReceived.toString()).eq(
          excludedQuote(amountIn).toString()
        );
        // the curve consumed exactly what landed in the vault
        expect(curveAccountedQuote.toString()).eq(
          vaultQuoteReceived.toString()
        );
        expect(vaultBasePaid.toString()).eq(grossBaseOut.toString());
        expect(userBaseReceived.toString()).eq(netBaseOut.toString());
      });

      it("Exact-in base to quote charges the full base input, credits the vault net of the base fee, and pays the quote output net of the quote fee", async () => {
        const userBaseAccount = baseAccountOf(user.publicKey);
        const amountIn = balanceOf(svm, userBaseAccount) / BigInt(2);
        const params: SwapParams = {
          config,
          payer: user,
          pool: virtualPool,
          inputTokenMint: baseMint,
          outputTokenMint: quoteMint,
          amountIn: new BN(amountIn.toString()),
          minimumAmountOut: new BN(0),
          swapMode: SwapMode.ExactIn,
          referralTokenAccount: null,
        };

        const grossQuoteOut = simulatedVaultDelta(
          svm,
          await buildSwapTransaction(svm, program, params),
          quoteVault
        );
        const netQuoteOut = excludedQuote(grossQuoteOut);

        const errorCode = getDbcProgramErrorCodeHexString("ExceededSlippage");
        await expectThrowsAsync(async () => {
          const transaction = await buildSwapTransaction(svm, program, {
            ...params,
            minimumAmountOut: new BN((netQuoteOut + BigInt(1)).toString()),
          });
          sendTransactionMaybeThrow(svm, transaction, [user]);
        }, errorCode);

        const poolState = getVirtualPool(svm, program, virtualPool);
        const preUserBase = balanceOf(svm, userBaseAccount);
        const preUserQuote = balanceOf(svm, quoteAccountOf(user.publicKey));
        const preVaultBase = balanceOf(svm, baseVault);
        const preVaultQuote = balanceOf(svm, quoteVault);
        const preBaseReserve = BigInt(poolState.baseReserve.toString());
        const preBaseFees = accruedBaseFees(poolState);

        const transaction = await buildSwapTransaction(svm, program, {
          ...params,
          minimumAmountOut: new BN(netQuoteOut.toString()),
        });
        sendTransactionMaybeThrow(svm, transaction, [user]);

        const postPoolState = getVirtualPool(svm, program, virtualPool);
        const userBasePaid = preUserBase - balanceOf(svm, userBaseAccount);
        const userQuoteReceived =
          balanceOf(svm, quoteAccountOf(user.publicKey)) - preUserQuote;
        const vaultBaseReceived = balanceOf(svm, baseVault) - preVaultBase;
        const vaultQuotePaid = preVaultQuote - balanceOf(svm, quoteVault);
        const curveAccountedBase =
          BigInt(postPoolState.baseReserve.toString()) -
          preBaseReserve +
          (accruedBaseFees(postPoolState) - preBaseFees);

        expect(userBasePaid.toString()).eq(amountIn.toString());
        expect(vaultBaseReceived.toString()).eq(
          excludedBase(amountIn).toString()
        );
        expect(curveAccountedBase.toString()).eq(vaultBaseReceived.toString());
        expect(vaultQuotePaid.toString()).eq(grossQuoteOut.toString());
        expect(userQuoteReceived.toString()).eq(netQuoteOut.toString());
      });

      it("Partial-fill base to quote charges the grossed-up consumed base input", async () => {
        const userBaseAccount = baseAccountOf(user.publicKey);
        const amountIn = balanceOf(svm, userBaseAccount) / BigInt(4);

        const preUserBase = balanceOf(svm, userBaseAccount);
        const preVaultBase = balanceOf(svm, baseVault);

        await swap(svm, program, {
          config,
          payer: user,
          pool: virtualPool,
          inputTokenMint: baseMint,
          outputTokenMint: quoteMint,
          amountIn: new BN(amountIn.toString()),
          minimumAmountOut: new BN(0),
          swapMode: SwapMode.PartialFill,
          referralTokenAccount: null,
        });

        const userBasePaid = preUserBase - balanceOf(svm, userBaseAccount);
        const vaultBaseReceived = balanceOf(svm, baseVault) - preVaultBase;

        // fully filled: the consumed amount is what landed in the vault, and the user is charged its gross-up
        expect(vaultBaseReceived.toString()).eq(
          excludedBase(amountIn).toString()
        );
        expect(userBasePaid.toString()).eq(
          includedBase(vaultBaseReceived).toString()
        );
      });

      it("Exact-out base to quote delivers the exact quote amount net of the quote fee and charges the grossed-up base input", async () => {
        const userBaseAccount = baseAccountOf(user.publicKey);
        const amountOut = BigInt(LAMPORTS_PER_SOL) / BigInt(10);
        const params: SwapParams = {
          config,
          payer: user,
          pool: virtualPool,
          inputTokenMint: baseMint,
          outputTokenMint: quoteMint,
          amountIn: new BN(amountOut.toString()),
          minimumAmountOut: new BN(U64_MAX.toString()),
          swapMode: SwapMode.ExactOut,
          referralTokenAccount: null,
        };

        const netBaseIn = simulatedVaultDelta(
          svm,
          await buildSwapTransaction(svm, program, params),
          baseVault
        );
        const grossBaseIn = includedBase(netBaseIn);

        // the maximum input is checked on what the user actually pays
        const errorCode = getDbcProgramErrorCodeHexString("ExceededSlippage");
        await expectThrowsAsync(async () => {
          const transaction = await buildSwapTransaction(svm, program, {
            ...params,
            minimumAmountOut: new BN((grossBaseIn - BigInt(1)).toString()),
          });
          sendTransactionMaybeThrow(svm, transaction, [user]);
        }, errorCode);

        const preUserBase = balanceOf(svm, userBaseAccount);
        const preUserQuote = balanceOf(svm, quoteAccountOf(user.publicKey));
        const preVaultBase = balanceOf(svm, baseVault);
        const preVaultQuote = balanceOf(svm, quoteVault);

        const transaction = await buildSwapTransaction(svm, program, {
          ...params,
          minimumAmountOut: new BN(grossBaseIn.toString()),
        });
        sendTransactionMaybeThrow(svm, transaction, [user]);

        const userBasePaid = preUserBase - balanceOf(svm, userBaseAccount);
        const userQuoteReceived =
          balanceOf(svm, quoteAccountOf(user.publicKey)) - preUserQuote;
        const vaultBaseReceived = balanceOf(svm, baseVault) - preVaultBase;
        const vaultQuotePaid = preVaultQuote - balanceOf(svm, quoteVault);

        expect(userQuoteReceived.toString()).eq(amountOut.toString());
        expect(vaultQuotePaid.toString()).eq(
          includedQuote(amountOut).toString()
        );
        expect(userBasePaid.toString()).eq(grossBaseIn.toString());
        expect(vaultBaseReceived.toString()).eq(netBaseIn.toString());
      });

      it("Exact-out quote to base delivers the exact base amount net of the base fee and charges the grossed-up quote input", async () => {
        const userBaseAccount = baseAccountOf(user.publicKey);
        const amountOut = balanceOf(svm, userBaseAccount) / BigInt(4);
        const params: SwapParams = {
          config,
          payer: user,
          pool: virtualPool,
          inputTokenMint: quoteMint,
          outputTokenMint: baseMint,
          amountIn: new BN(amountOut.toString()),
          minimumAmountOut: new BN(U64_MAX.toString()),
          swapMode: SwapMode.ExactOut,
          referralTokenAccount: null,
        };

        const netQuoteIn = simulatedVaultDelta(
          svm,
          await buildSwapTransaction(svm, program, params),
          quoteVault
        );
        const grossQuoteIn = includedQuote(netQuoteIn);

        const errorCode = getDbcProgramErrorCodeHexString("ExceededSlippage");
        await expectThrowsAsync(async () => {
          const transaction = await buildSwapTransaction(svm, program, {
            ...params,
            minimumAmountOut: new BN((grossQuoteIn - BigInt(1)).toString()),
          });
          sendTransactionMaybeThrow(svm, transaction, [user]);
        }, errorCode);

        const poolState = getVirtualPool(svm, program, virtualPool);
        const preUserBase = balanceOf(svm, userBaseAccount);
        const preUserQuote = balanceOf(svm, quoteAccountOf(user.publicKey));
        const preVaultBase = balanceOf(svm, baseVault);
        const preVaultQuote = balanceOf(svm, quoteVault);
        const preQuoteReserve = BigInt(poolState.quoteReserve.toString());
        const preQuoteFees = accruedQuoteFees(poolState);

        const transaction = await buildSwapTransaction(svm, program, {
          ...params,
          minimumAmountOut: new BN(grossQuoteIn.toString()),
        });
        sendTransactionMaybeThrow(svm, transaction, [user]);

        const postPoolState = getVirtualPool(svm, program, virtualPool);
        const userBaseReceived = balanceOf(svm, userBaseAccount) - preUserBase;
        const userQuotePaid =
          preUserQuote - balanceOf(svm, quoteAccountOf(user.publicKey));
        const vaultBasePaid = preVaultBase - balanceOf(svm, baseVault);
        const vaultQuoteReceived = balanceOf(svm, quoteVault) - preVaultQuote;
        const curveAccountedQuote =
          BigInt(postPoolState.quoteReserve.toString()) -
          preQuoteReserve +
          (accruedQuoteFees(postPoolState) - preQuoteFees);

        expect(userBaseReceived.toString()).eq(amountOut.toString());
        expect(vaultBasePaid.toString()).eq(includedBase(amountOut).toString());
        expect(userQuotePaid.toString()).eq(grossQuoteIn.toString());
        expect(vaultQuoteReceived.toString()).eq(netQuoteIn.toString());
        expect(curveAccountedQuote.toString()).eq(
          vaultQuoteReceived.toString()
        );
      });

      it("Referral paid in base receives the referral fee net of the base fee", async () => {
        const referralTokenAccount = getOrCreateAssociatedTokenAccount(
          svm,
          referrer,
          baseMint,
          referrer.publicKey,
          TOKEN_2022_PROGRAM_ID
        );
        const userBaseAccount = baseAccountOf(user.publicKey);
        const amountIn = BigInt(LAMPORTS_PER_SOL) / BigInt(2);
        const params: SwapParams = {
          config,
          payer: user,
          pool: virtualPool,
          inputTokenMint: quoteMint,
          outputTokenMint: baseMint,
          amountIn: new BN(amountIn.toString()),
          minimumAmountOut: new BN(0),
          swapMode: SwapMode.ExactIn,
          referralTokenAccount: null,
        };

        // the referral fee is carved out of the protocol fee, so the user's output is the same with or without it
        const grossBaseOut = simulatedVaultDelta(
          svm,
          await buildSwapTransaction(svm, program, params),
          baseVault
        );

        const preUserBase = balanceOf(svm, userBaseAccount);
        const preReferral = balanceOf(svm, referralTokenAccount);
        const preVaultBase = balanceOf(svm, baseVault);

        await swap(svm, program, { ...params, referralTokenAccount });

        const userBaseReceived = balanceOf(svm, userBaseAccount) - preUserBase;
        const referralReceived =
          balanceOf(svm, referralTokenAccount) - preReferral;
        const vaultBasePaid = preVaultBase - balanceOf(svm, baseVault);
        const grossReferralFee = vaultBasePaid - grossBaseOut;

        expect(grossReferralFee > BigInt(0)).eq(true);
        expect(userBaseReceived.toString()).eq(
          excludedBase(grossBaseOut).toString()
        );
        expect(referralReceived.toString()).eq(
          excludedBase(grossReferralFee).toString()
        );
      });

      it("Partial-fill quote to base completes the curve, charges the grossed-up consumed quote input, and pays the base net of the base fee", async () => {
        const userBaseAccount = baseAccountOf(user.publicKey);
        const userQuoteAccount = quoteAccountOf(user.publicKey);
        const amountIn = balanceOf(svm, userQuoteAccount);

        const poolState = getVirtualPool(svm, program, virtualPool);
        const preUserBase = balanceOf(svm, userBaseAccount);
        const preUserQuote = balanceOf(svm, userQuoteAccount);
        const preVaultBase = balanceOf(svm, baseVault);
        const preVaultQuote = balanceOf(svm, quoteVault);
        const preQuoteReserve = BigInt(poolState.quoteReserve.toString());
        const preQuoteFees = accruedQuoteFees(poolState);

        const { completed } = await swap(svm, program, {
          config,
          payer: user,
          pool: virtualPool,
          inputTokenMint: quoteMint,
          outputTokenMint: baseMint,
          amountIn: new BN(amountIn.toString()),
          minimumAmountOut: new BN(0),
          swapMode: SwapMode.PartialFill,
          referralTokenAccount: null,
        });

        const postPoolState = getVirtualPool(svm, program, virtualPool);
        const userBaseReceived = balanceOf(svm, userBaseAccount) - preUserBase;
        const userQuotePaid = preUserQuote - balanceOf(svm, userQuoteAccount);
        const vaultBasePaid = preVaultBase - balanceOf(svm, baseVault);
        const vaultQuoteReceived = balanceOf(svm, quoteVault) - preVaultQuote;
        const curveAccountedQuote =
          BigInt(postPoolState.quoteReserve.toString()) -
          preQuoteReserve +
          (accruedQuoteFees(postPoolState) - preQuoteFees);

        expect(completed).eq(true);
        expect(userQuotePaid < amountIn).eq(true);
        expect(userQuotePaid.toString()).eq(
          includedQuote(vaultQuoteReceived).toString()
        );
        expect(curveAccountedQuote.toString()).eq(
          vaultQuoteReceived.toString()
        );
        expect(userBaseReceived.toString()).eq(
          excludedBase(vaultBasePaid).toString()
        );
      });

      describe("Payouts after the curve completes", () => {
        it("Partner claims trading fees net of the transfer fees", async () => {
          const { basePaid, quotePaid } = await expectNetPayout(
            partner.publicKey,
            () =>
              claimTradingFee(svm, program, {
                feeClaimer: partner,
                pool: virtualPool,
                maxBaseAmount: U64_MAX,
                maxQuoteAmount: U64_MAX,
              })
          );
          expect(basePaid > BigInt(0)).eq(true);
          expect(quotePaid > BigInt(0)).eq(true);
        });

        it("Creator claims trading fees net of the transfer fees", async () => {
          const { basePaid, quotePaid } = await expectNetPayout(
            poolCreator.publicKey,
            () =>
              claimCreatorTradingFee(svm, program, {
                creator: poolCreator,
                pool: virtualPool,
                maxBaseAmount: U64_MAX,
                maxQuoteAmount: U64_MAX,
              })
          );
          expect(basePaid > BigInt(0)).eq(true);
          expect(quotePaid > BigInt(0)).eq(true);
        });

        // claim_protocol_fee2 is signed by a PDA of the protocol fee program, so it cannot be
        // exercised here; the suite only has rejection cases for it (see claim_protocol_fee2.tests.ts).

        it("Partner withdraws surplus net of the quote fee", async () => {
          await expectNetPayout(partner.publicKey, () =>
            partnerWithdrawSurplus(svm, program, {
              feeClaimer: partner,
              virtualPool,
            })
          );
        });

        it("Creator withdraws surplus net of the quote fee", async () => {
          await expectNetPayout(poolCreator.publicKey, () =>
            creatorWithdrawSurplus(svm, program, {
              creator: poolCreator,
              virtualPool,
            })
          );
        });

        it("Partner withdraws migration fee net of the quote fee", async () => {
          const { quotePaid } = await expectNetPayout(partner.publicKey, () =>
            partnerWithdrawMigrationFee(svm, program, {
              partner,
              virtualPool,
            })
          );
          expect(quotePaid > BigInt(0)).eq(true);
        });

        it("Creator withdraws migration fee net of the quote fee", async () => {
          const { quotePaid } = await expectNetPayout(
            poolCreator.publicKey,
            () =>
              creatorWithdrawMigrationFee(svm, program, {
                creator: poolCreator,
                virtualPool,
              })
          );
          expect(quotePaid > BigInt(0)).eq(true);
        });
      });
    });
  }
});
