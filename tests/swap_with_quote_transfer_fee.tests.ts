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
  getTokenAccount,
  mintToken2022To,
} from "./utils/token";
import { VirtualCurveProgram } from "./utils/types";

const MIGRATION_QUOTE_THRESHOLD = new BN(LAMPORTS_PER_SOL * 5);
const TRANSFER_FEE_BASIS_POINTS = 100; // 1%
const TRANSFER_FEE_MAXIMUM = BigInt(U64_MAX.toString());
const TRANSFER_FEE: TransferFee = {
  epoch: BigInt(0),
  maximumFee: TRANSFER_FEE_MAXIMUM,
  transferFeeBasisPoints: TRANSFER_FEE_BASIS_POINTS,
};
const USER_QUOTE_BALANCE = BigInt(LAMPORTS_PER_SOL) * BigInt(100);

function excludedAmount(includedAmount: bigint): bigint {
  return includedAmount - calculateFee(TRANSFER_FEE, includedAmount);
}

// Mirrors spl_token_2022 TransferFee::calculate_pre_fee_amount.
function includedAmount(excluded: bigint): bigint {
  const bps = BigInt(TRANSFER_FEE.transferFeeBasisPoints);
  const ONE = BigInt(10_000);
  if (bps === BigInt(0) || excluded === BigInt(0)) {
    return excluded;
  }
  if (bps === ONE) {
    return excluded + TRANSFER_FEE.maximumFee;
  }
  const numerator = excluded * ONE;
  const denominator = ONE - bps;
  const raw = (numerator + denominator - BigInt(1)) / denominator;
  if (raw - excluded >= TRANSFER_FEE.maximumFee) {
    return excluded + TRANSFER_FEE.maximumFee;
  }
  return raw;
}

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

function accruedQuoteFees(
  poolState: ReturnType<typeof getVirtualPool>
): bigint {
  return (
    BigInt(poolState.protocolQuoteFee.toString()) +
    BigInt(poolState.partnerQuoteFee.toString()) +
    BigInt(poolState.creatorQuoteFee.toString())
  );
}

// Runs a payout from the quote vault and checks the recipient nets the vault delta minus the transfer fee.
async function expectNetQuotePayout(
  svm: LiteSVM,
  quoteVault: PublicKey,
  recipientAccount: PublicKey,
  action: () => Promise<unknown>
): Promise<bigint> {
  const preVault = balanceOf(svm, quoteVault);
  const preRecipient = balanceOf(svm, recipientAccount);
  await action();
  const vaultPaid = preVault - balanceOf(svm, quoteVault);
  const recipientReceived = balanceOf(svm, recipientAccount) - preRecipient;
  expect(recipientReceived.toString()).eq(excludedAmount(vaultPaid).toString());
  return vaultPaid;
}

function balanceOf(svm: LiteSVM, tokenAccount: PublicKey): bigint {
  if (svm.getAccount(tokenAccount) === null) {
    return BigInt(0);
  }
  return getTokenAccount(svm, tokenAccount).amount;
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
    migrationFeeOption: 0,
    tokenSupply: null,
    // non-zero creator and migration fee shares so every fee-bearing payout below moves quote
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

describe("Swap with a quote mint that has a non-zero transfer fee", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let poolCreator: Keypair;
  let user: Keypair;
  let program: VirtualCurveProgram;

  let feeQuoteMint: PublicKey;
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

    await createOperatorAccount(svm, program, {
      admin,
      whitelistedAddress: operator.publicKey,
      permissions: [OperatorPermission.CreateTokenBadge],
    });

    feeQuoteMint = createToken2022Mint(svm, admin, {
      transferFeeConfig: {
        feeBasisPoints: TRANSFER_FEE_BASIS_POINTS,
        maximumFee: TRANSFER_FEE_MAXIMUM,
      },
    });
    mintToken2022To(
      svm,
      admin,
      feeQuoteMint,
      admin,
      user.publicKey,
      USER_QUOTE_BALANCE
    );
  });

  it("Rejects config creation for the fee-bearing quote mint without a badge", async () => {
    const errorCode = getDbcProgramErrorCodeHexString("InvalidTokenBadge");
    await expectThrowsAsync(async () => {
      await createConfig(svm, program, {
        payer: partner,
        leftoverReceiver: partner.publicKey,
        feeClaimer: partner.publicKey,
        quoteMint: feeQuoteMint,
        instructionParams: buildConfigParams(),
      });
    }, errorCode);
  });

  it("Creates a token badge for the fee-bearing quote mint", async () => {
    await createTokenBadge(svm, program, {
      operator,
      payer: operator,
      tokenMint: feeQuoteMint,
    });
    expect(svm.getAccount(deriveTokenBadgeAddress(feeQuoteMint))).not.eq(null);
  });

  it("Creates config and pool with the badged fee-bearing quote mint", async () => {
    config = await createConfig(svm, program, {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: feeQuoteMint,
      instructionParams: buildConfigParams(),
      tokenBadge: deriveTokenBadgeAddress(feeQuoteMint),
    });

    virtualPool = await createPoolWithToken2022(svm, program, {
      payer: poolCreator,
      poolCreator,
      quoteMint: feeQuoteMint,
      config,
      instructionParams: {
        name: "fee quote",
        symbol: "FEEQ",
        uri: "feequote.com",
      },
      tokenQuoteProgram: TOKEN_2022_PROGRAM_ID,
      tokenBadge: deriveTokenBadgeAddress(feeQuoteMint),
    });
    expect(svm.getAccount(virtualPool)).not.eq(null);
  });

  it("Exact-in quote to base charges the full input and credits the vault net of the transfer fee", async () => {
    const poolState = getVirtualPool(svm, program, virtualPool);
    const userQuoteAccount = getAssociatedTokenAddressSync(
      feeQuoteMint,
      user.publicKey,
      true,
      TOKEN_2022_PROGRAM_ID
    );
    const userBaseAccount = getAssociatedTokenAddressSync(
      poolState.baseMint,
      user.publicKey,
      true,
      TOKEN_2022_PROGRAM_ID
    );
    const amountIn = BigInt(LAMPORTS_PER_SOL);

    const preUserQuote = balanceOf(svm, userQuoteAccount);
    const preUserBase = balanceOf(svm, userBaseAccount);
    const preVaultQuote = balanceOf(svm, poolState.quoteVault);
    const preVaultBase = balanceOf(svm, poolState.baseVault);
    const preQuoteReserve = BigInt(poolState.quoteReserve.toString());
    const preQuoteFees = accruedQuoteFees(poolState);

    await swap(svm, program, {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: feeQuoteMint,
      outputTokenMint: poolState.baseMint,
      amountIn: new BN(amountIn.toString()),
      minimumAmountOut: new BN(0),
      swapMode: SwapMode.ExactIn,
      referralTokenAccount: null,
    });

    const postPoolState = getVirtualPool(svm, program, virtualPool);
    const userQuotePaid = preUserQuote - balanceOf(svm, userQuoteAccount);
    const vaultQuoteReceived =
      balanceOf(svm, poolState.quoteVault) - preVaultQuote;
    const userBaseReceived = balanceOf(svm, userBaseAccount) - preUserBase;
    const vaultBasePaid = preVaultBase - balanceOf(svm, poolState.baseVault);
    const quoteReserveDelta =
      BigInt(postPoolState.quoteReserve.toString()) - preQuoteReserve;
    const quoteFeesDelta = accruedQuoteFees(postPoolState) - preQuoteFees;

    expect(userQuotePaid.toString()).eq(amountIn.toString());
    expect(vaultQuoteReceived.toString()).eq(
      excludedAmount(amountIn).toString()
    );
    // the curve consumed the net amount: reserve plus accrued trading fees equals what landed in the vault
    expect((quoteReserveDelta + quoteFeesDelta).toString()).eq(
      vaultQuoteReceived.toString()
    );
    expect(userBaseReceived > BigInt(0)).eq(true);
    expect(userBaseReceived.toString()).eq(vaultBasePaid.toString());
  });

  it("Exact-in base to quote pays the user the output net of the transfer fee", async () => {
    const poolState = getVirtualPool(svm, program, virtualPool);
    const userQuoteAccount = getAssociatedTokenAddressSync(
      feeQuoteMint,
      user.publicKey,
      true,
      TOKEN_2022_PROGRAM_ID
    );
    const userBaseAccount = getAssociatedTokenAddressSync(
      poolState.baseMint,
      user.publicKey,
      true,
      TOKEN_2022_PROGRAM_ID
    );
    const amountIn = balanceOf(svm, userBaseAccount) / BigInt(2);

    const preUserQuote = balanceOf(svm, userQuoteAccount);
    const preUserBase = balanceOf(svm, userBaseAccount);
    const preVaultQuote = balanceOf(svm, poolState.quoteVault);
    const preVaultBase = balanceOf(svm, poolState.baseVault);

    await swap(svm, program, {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: poolState.baseMint,
      outputTokenMint: feeQuoteMint,
      amountIn: new BN(amountIn.toString()),
      minimumAmountOut: new BN(0),
      swapMode: SwapMode.ExactIn,
      referralTokenAccount: null,
    });

    const userBasePaid = preUserBase - balanceOf(svm, userBaseAccount);
    const vaultBaseReceived =
      balanceOf(svm, poolState.baseVault) - preVaultBase;
    const vaultQuotePaid = preVaultQuote - balanceOf(svm, poolState.quoteVault);
    const userQuoteReceived = balanceOf(svm, userQuoteAccount) - preUserQuote;

    expect(userBasePaid.toString()).eq(amountIn.toString());
    expect(vaultBaseReceived.toString()).eq(amountIn.toString());
    expect(vaultQuotePaid > BigInt(0)).eq(true);
    expect(userQuoteReceived.toString()).eq(
      excludedAmount(vaultQuotePaid).toString()
    );
  });

  it("Exact-in base to quote checks slippage against the output net of the transfer fee", async () => {
    const poolState = getVirtualPool(svm, program, virtualPool);
    const userBaseAccount = getAssociatedTokenAddressSync(
      poolState.baseMint,
      user.publicKey,
      true,
      TOKEN_2022_PROGRAM_ID
    );
    const amountIn = balanceOf(svm, userBaseAccount) / BigInt(2);
    const params = {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: poolState.baseMint,
      outputTokenMint: feeQuoteMint,
      amountIn: new BN(amountIn.toString()),
      minimumAmountOut: new BN(0),
      swapMode: SwapMode.ExactIn,
      referralTokenAccount: null,
    };

    const preVaultQuote = balanceOf(svm, poolState.quoteVault);
    const simulation = svm.simulateTransaction(
      await buildSwapTransaction(svm, program, params)
    );
    expect(simulation).instanceOf(SimulatedTransactionInfo);
    const postVaultQuoteAccount = (simulation as SimulatedTransactionInfo)
      .postAccounts()
      .find(([key]) => key.equals(poolState.quoteVault));
    expect(postVaultQuoteAccount).not.eq(undefined);
    const quoteOut =
      preVaultQuote -
      AccountLayout.decode(postVaultQuoteAccount![1].data()).amount;
    const netQuoteOut = excludedAmount(quoteOut);
    expect(netQuoteOut < quoteOut).eq(true);

    const errorCode = getDbcProgramErrorCodeHexString("ExceededSlippage");
    await expectThrowsAsync(async () => {
      const transaction = await buildSwapTransaction(svm, program, {
        ...params,
        minimumAmountOut: new BN((netQuoteOut + BigInt(1)).toString()),
      });
      sendTransactionMaybeThrow(svm, transaction, [user]);
    }, errorCode);

    const transaction = await buildSwapTransaction(svm, program, {
      ...params,
      minimumAmountOut: new BN(netQuoteOut.toString()),
    });
    sendTransactionMaybeThrow(svm, transaction, [user]);
    expect(
      (preVaultQuote - balanceOf(svm, poolState.quoteVault)).toString()
    ).eq(quoteOut.toString());
  });

  it("Exact-out quote to base delivers the exact base amount and charges the grossed-up quote input", async () => {
    const poolState = getVirtualPool(svm, program, virtualPool);
    const userQuoteAccount = getAssociatedTokenAddressSync(
      feeQuoteMint,
      user.publicKey,
      true,
      TOKEN_2022_PROGRAM_ID
    );
    const userBaseAccount = getAssociatedTokenAddressSync(
      poolState.baseMint,
      user.publicKey,
      true,
      TOKEN_2022_PROGRAM_ID
    );
    const amountOut = balanceOf(svm, userBaseAccount) / BigInt(4);
    const params = {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: feeQuoteMint,
      outputTokenMint: poolState.baseMint,
      amountIn: new BN(amountOut.toString()),
      minimumAmountOut: new BN(U64_MAX.toString()),
      swapMode: SwapMode.ExactOut,
      referralTokenAccount: null,
    };

    const netQuoteIn = simulatedVaultDelta(
      svm,
      await buildSwapTransaction(svm, program, params),
      poolState.quoteVault
    );
    const grossQuoteIn = includedAmount(netQuoteIn);
    expect(grossQuoteIn > netQuoteIn).eq(true);

    const errorCode = getDbcProgramErrorCodeHexString("ExceededSlippage");
    await expectThrowsAsync(async () => {
      const transaction = await buildSwapTransaction(svm, program, {
        ...params,
        minimumAmountOut: new BN((grossQuoteIn - BigInt(1)).toString()),
      });
      sendTransactionMaybeThrow(svm, transaction, [user]);
    }, errorCode);

    const preUserQuote = balanceOf(svm, userQuoteAccount);
    const preUserBase = balanceOf(svm, userBaseAccount);
    const preVaultQuote = balanceOf(svm, poolState.quoteVault);
    const preQuoteReserve = BigInt(poolState.quoteReserve.toString());
    const preQuoteFees = accruedQuoteFees(poolState);

    const transaction = await buildSwapTransaction(svm, program, {
      ...params,
      minimumAmountOut: new BN(grossQuoteIn.toString()),
    });
    sendTransactionMaybeThrow(svm, transaction, [user]);

    const postPoolState = getVirtualPool(svm, program, virtualPool);
    const userQuotePaid = preUserQuote - balanceOf(svm, userQuoteAccount);
    const userBaseReceived = balanceOf(svm, userBaseAccount) - preUserBase;
    const vaultQuoteReceived =
      balanceOf(svm, poolState.quoteVault) - preVaultQuote;
    const curveAccountedQuote =
      BigInt(postPoolState.quoteReserve.toString()) -
      preQuoteReserve +
      (accruedQuoteFees(postPoolState) - preQuoteFees);

    expect(userBaseReceived.toString()).eq(amountOut.toString());
    expect(userQuotePaid.toString()).eq(grossQuoteIn.toString());
    expect(vaultQuoteReceived.toString()).eq(netQuoteIn.toString());
    expect(curveAccountedQuote.toString()).eq(vaultQuoteReceived.toString());
  });

  it("Exact-out base to quote delivers the exact quote amount net of the transfer fee", async () => {
    const poolState = getVirtualPool(svm, program, virtualPool);
    const userQuoteAccount = getAssociatedTokenAddressSync(
      feeQuoteMint,
      user.publicKey,
      true,
      TOKEN_2022_PROGRAM_ID
    );
    const userBaseAccount = getAssociatedTokenAddressSync(
      poolState.baseMint,
      user.publicKey,
      true,
      TOKEN_2022_PROGRAM_ID
    );
    const amountOut = BigInt(LAMPORTS_PER_SOL) / BigInt(10);

    const preUserQuote = balanceOf(svm, userQuoteAccount);
    const preUserBase = balanceOf(svm, userBaseAccount);
    const preVaultQuote = balanceOf(svm, poolState.quoteVault);
    const preVaultBase = balanceOf(svm, poolState.baseVault);

    await swap(svm, program, {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: poolState.baseMint,
      outputTokenMint: feeQuoteMint,
      amountIn: new BN(amountOut.toString()),
      minimumAmountOut: new BN(U64_MAX.toString()),
      swapMode: SwapMode.ExactOut,
      referralTokenAccount: null,
    });

    const userQuoteReceived = balanceOf(svm, userQuoteAccount) - preUserQuote;
    const vaultQuotePaid = preVaultQuote - balanceOf(svm, poolState.quoteVault);
    const userBasePaid = preUserBase - balanceOf(svm, userBaseAccount);
    const vaultBaseReceived =
      balanceOf(svm, poolState.baseVault) - preVaultBase;

    expect(userQuoteReceived.toString()).eq(amountOut.toString());
    expect(vaultQuotePaid.toString()).eq(includedAmount(amountOut).toString());
    expect(userBasePaid.toString()).eq(vaultBaseReceived.toString());
  });

  it("Partial-fill quote to base charges the grossed-up consumed input and completes the curve", async () => {
    const poolState = getVirtualPool(svm, program, virtualPool);
    const userQuoteAccount = getAssociatedTokenAddressSync(
      feeQuoteMint,
      user.publicKey,
      true,
      TOKEN_2022_PROGRAM_ID
    );
    const amountIn = balanceOf(svm, userQuoteAccount);

    const preUserQuote = balanceOf(svm, userQuoteAccount);
    const preVaultQuote = balanceOf(svm, poolState.quoteVault);
    const preQuoteReserve = BigInt(poolState.quoteReserve.toString());
    const preQuoteFees = accruedQuoteFees(poolState);

    const { completed } = await swap(svm, program, {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: feeQuoteMint,
      outputTokenMint: poolState.baseMint,
      amountIn: new BN(amountIn.toString()),
      minimumAmountOut: new BN(0),
      swapMode: SwapMode.PartialFill,
      referralTokenAccount: null,
    });

    const postPoolState = getVirtualPool(svm, program, virtualPool);
    const userQuotePaid = preUserQuote - balanceOf(svm, userQuoteAccount);
    const vaultQuoteReceived =
      balanceOf(svm, poolState.quoteVault) - preVaultQuote;
    const curveAccountedQuote =
      BigInt(postPoolState.quoteReserve.toString()) -
      preQuoteReserve +
      (accruedQuoteFees(postPoolState) - preQuoteFees);

    expect(completed).eq(true);
    expect(userQuotePaid < amountIn).eq(true);
    expect(userQuotePaid.toString()).eq(
      includedAmount(vaultQuoteReceived).toString()
    );
    expect(curveAccountedQuote.toString()).eq(vaultQuoteReceived.toString());
  });

  describe("Payouts from the quote vault after the curve completes", () => {
    let quoteVault: PublicKey;
    const quoteAccountOf = (owner: PublicKey) =>
      getAssociatedTokenAddressSync(
        feeQuoteMint,
        owner,
        true,
        TOKEN_2022_PROGRAM_ID
      );

    before(() => {
      quoteVault = getVirtualPool(svm, program, virtualPool).quoteVault;
    });

    it("Partner claims trading fee net of the transfer fee", async () => {
      const paid = await expectNetQuotePayout(
        svm,
        quoteVault,
        quoteAccountOf(partner.publicKey),
        () =>
          claimTradingFee(svm, program, {
            feeClaimer: partner,
            pool: virtualPool,
            maxBaseAmount: U64_MAX,
            maxQuoteAmount: U64_MAX,
          })
      );
      expect(paid > BigInt(0)).eq(true);
    });

    it("Creator claims trading fee net of the transfer fee", async () => {
      const paid = await expectNetQuotePayout(
        svm,
        quoteVault,
        quoteAccountOf(poolCreator.publicKey),
        () =>
          claimCreatorTradingFee(svm, program, {
            creator: poolCreator,
            pool: virtualPool,
            maxBaseAmount: U64_MAX,
            maxQuoteAmount: U64_MAX,
          })
      );
      expect(paid > BigInt(0)).eq(true);
    });

    // claim_protocol_fee2 is signed by a PDA of the protocol fee program, so it cannot be
    // exercised here; the suite only has rejection cases for it (see claim_protocol_fee2.tests.ts).

    it("Partner withdraws surplus net of the transfer fee", async () => {
      await expectNetQuotePayout(
        svm,
        quoteVault,
        quoteAccountOf(partner.publicKey),
        () =>
          partnerWithdrawSurplus(svm, program, {
            feeClaimer: partner,
            virtualPool,
          })
      );
    });

    it("Creator withdraws surplus net of the transfer fee", async () => {
      await expectNetQuotePayout(
        svm,
        quoteVault,
        quoteAccountOf(poolCreator.publicKey),
        () =>
          creatorWithdrawSurplus(svm, program, {
            creator: poolCreator,
            virtualPool,
          })
      );
    });

    it("Partner withdraws migration fee net of the transfer fee", async () => {
      const paid = await expectNetQuotePayout(
        svm,
        quoteVault,
        quoteAccountOf(partner.publicKey),
        () =>
          partnerWithdrawMigrationFee(svm, program, {
            partner,
            virtualPool,
          })
      );
      expect(paid > BigInt(0)).eq(true);
    });

    it("Creator withdraws migration fee net of the transfer fee", async () => {
      const paid = await expectNetQuotePayout(
        svm,
        quoteVault,
        quoteAccountOf(poolCreator.publicKey),
        () =>
          creatorWithdrawMigrationFee(svm, program, {
            creator: poolCreator,
            virtualPool,
          })
      );
      expect(paid > BigInt(0)).eq(true);
    });
  });
});
