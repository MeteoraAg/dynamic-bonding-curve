import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  BaseFee,
  ConfigParameters,
  createConfig,
  createConfigWithTransferHook,
  createOperatorAccount,
  claimCreatorTradingFee,
  claimTradingFee,
  createMeteoraDammV2Metadata,
  createPoolWithToken2022,
  createTokenBadge,
  creatorWithdrawSurplus,
  migrateToDammV2,
  OperatorPermission,
  partnerWithdrawMigrationFee,
  partnerWithdrawSurplus,
  swap,
  SwapMode,
  SwapParams,
} from "./instructions";
import {
  createDammV2Config,
  createDammV2Operator,
  createVirtualCurveProgram,
  DammV2OperatorPermission,
  derivePoolAuthority,
  encodePermissions,
  expectThrowsAsync,
  generateAndFund,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  startSvm,
  U64_MAX,
  warpEpochBy,
} from "./utils";
import { TRANSFER_HOOK_COUNTER_PROGRAM_ID } from "./utils/constants";
import { deriveTokenBadgeAddress } from "./utils/accounts";
import { getVirtualPool } from "./utils/fetcher";
import {
  createToken2022Mint,
  mintToken2022To,
  setTransferFee,
} from "./utils/token";
import { VirtualCurveProgram } from "./utils/types";

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
    creatorTradingFeePercentage: 50,
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

describe("Quote mint with transfer fee extension", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let poolCreator: Keypair;
  let user: Keypair;
  let program: VirtualCurveProgram;

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

    await createDammV2Operator(svm, {
      whitelistAddress: admin.publicKey,
      admin,
      permission: encodePermissions([DammV2OperatorPermission.CreateConfigKey]),
    });
  });

  it("Fails to create a token badge and config when the quote mint has a non-zero transfer fee", async () => {
    const feeMint = createToken2022Mint(svm, admin, {
      transferFeeConfig: {
        feeBasisPoints: 100,
        maximumFee: BigInt(LAMPORTS_PER_SOL),
        transferFeeConfigAuthority: admin.publicKey,
      },
    });
    await expectThrowsAsync(
      () =>
        createTokenBadge(svm, program, {
          operator,
          payer: operator,
          tokenMint: feeMint,
        }).then(() => {}),
      "QuoteMintHasNonZeroTransferFee"
    );

    await expectThrowsAsync(
      () =>
        createConfig(svm, program, {
          payer: partner,
          leftoverReceiver: partner.publicKey,
          feeClaimer: partner.publicKey,
          quoteMint: feeMint,
          instructionParams: buildConfigParams(),
          tokenBadge: deriveTokenBadgeAddress(feeMint),
        }).then(() => {}),
      "QuoteMintHasNonZeroTransferFee"
    );

    await expectThrowsAsync(
      () =>
        createConfigWithTransferHook(svm, program, {
          payer: partner,
          leftoverReceiver: partner.publicKey,
          feeClaimer: partner.publicKey,
          quoteMint: feeMint,
          instructionParams: buildConfigParams(),
          transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
          tokenBadge: deriveTokenBadgeAddress(feeMint),
        }).then(() => {}),
      "QuoteMintHasNonZeroTransferFee"
    );
  });

  it("Fails to create config when a non-zero transfer fee is scheduled", async () => {
    const scheduledFeeMint = createToken2022Mint(svm, admin, {
      transferFeeConfig: {
        feeBasisPoints: 0,
        maximumFee: BigInt(0),
        transferFeeConfigAuthority: admin.publicKey,
      },
    });
    await createTokenBadge(svm, program, {
      operator,
      payer: operator,
      tokenMint: scheduledFeeMint,
    });
    // set newer_transfer_fee > 0 while the active fee is still 0
    setTransferFee(
      svm,
      admin,
      scheduledFeeMint,
      admin,
      100,
      BigInt(LAMPORTS_PER_SOL)
    );

    await expectThrowsAsync(
      () =>
        createConfig(svm, program, {
          payer: partner,
          leftoverReceiver: partner.publicKey,
          feeClaimer: partner.publicKey,
          quoteMint: scheduledFeeMint,
          instructionParams: buildConfigParams(),
          tokenBadge: deriveTokenBadgeAddress(scheduledFeeMint),
        }).then(() => {}),
      "QuoteMintHasNonZeroTransferFee"
    );
  });

  it("Fails to create config with a zero-fee mint without a badge", async () => {
    const zeroFeeMintWithoutBadge = createToken2022Mint(svm, admin, {
      transferFeeConfig: {
        feeBasisPoints: 0,
        maximumFee: BigInt(0),
        transferFeeConfigAuthority: admin.publicKey,
      },
    });

    await expectThrowsAsync(
      () =>
        createConfig(svm, program, {
          payer: partner,
          leftoverReceiver: partner.publicKey,
          feeClaimer: partner.publicKey,
          quoteMint: zeroFeeMintWithoutBadge,
          instructionParams: buildConfigParams(),
        }).then(() => {}),
      "InvalidTokenBadge"
    );
  });

  describe("Zero-fee badged mint lifecycle", () => {
    let zeroFeeMint: PublicKey;
    let config: PublicKey;
    let virtualPool: PublicKey;

    before(async () => {
      zeroFeeMint = createToken2022Mint(svm, admin, {
        transferFeeConfig: {
          feeBasisPoints: 0,
          maximumFee: BigInt(0),
          transferFeeConfigAuthority: admin.publicKey,
        },
      });
      await createTokenBadge(svm, program, {
        operator,
        payer: operator,
        tokenMint: zeroFeeMint,
      });
    });

    it("Creates config and pool with a badged zero-fee quote mint", async () => {
      config = await createConfig(svm, program, {
        payer: partner,
        leftoverReceiver: partner.publicKey,
        feeClaimer: partner.publicKey,
        quoteMint: zeroFeeMint,
        instructionParams: buildConfigParams(),
        tokenBadge: deriveTokenBadgeAddress(zeroFeeMint),
      });

      virtualPool = await createPoolWithToken2022(svm, program, {
        payer: poolCreator,
        poolCreator,
        quoteMint: zeroFeeMint,
        config,
        instructionParams: {
          name: "zero fee",
          symbol: "ZEROFEE",
          uri: "zerofee.com",
        },
        tokenQuoteProgram: TOKEN_2022_PROGRAM_ID,
        tokenBadge: deriveTokenBadgeAddress(zeroFeeMint),
      });
      expect(svm.getAccount(virtualPool)).not.eq(null);
    });

    it("Fails to create a new pool after a non-zero fee is set", async () => {
      setTransferFee(svm, admin, zeroFeeMint, admin, 50, BigInt(1_000_000));

      await expectThrowsAsync(
        () =>
          createPoolWithToken2022(svm, program, {
            payer: poolCreator,
            poolCreator,
            quoteMint: zeroFeeMint,
            config,
            instructionParams: {
              name: "fee set",
              symbol: "FEESET",
              uri: "feeset.com",
            },
            tokenQuoteProgram: TOKEN_2022_PROGRAM_ID,
            tokenBadge: deriveTokenBadgeAddress(zeroFeeMint),
          }).then(() => {}),
        "QuoteMintHasNonZeroTransferFee"
      );
    });

    it("Blocks swap while the transfer fee is non-zero", async () => {
      mintToken2022To(
        svm,
        user,
        zeroFeeMint,
        admin,
        user.publicKey,
        BigInt(LAMPORTS_PER_SOL * 10)
      );

      const poolState = getVirtualPool(svm, program, virtualPool);
      const params: SwapParams = {
        config,
        payer: user,
        pool: virtualPool,
        inputTokenMint: zeroFeeMint,
        outputTokenMint: poolState.baseMint,
        amountIn: new BN(LAMPORTS_PER_SOL),
        minimumAmountOut: new BN(0),
        swapMode: SwapMode.PartialFill,
        referralTokenAccount: null,
      };
      await expectThrowsAsync(
        () => swap(svm, program, params).then(() => {}),
        "QuoteMintHasNonZeroTransferFee"
      );
    });

    it("Allows swap again after the transfer fee returns to zero", async () => {
      setTransferFee(svm, admin, zeroFeeMint, admin, 0, BigInt(0));

      const poolState = getVirtualPool(svm, program, virtualPool);
      const params: SwapParams = {
        config,
        payer: user,
        pool: virtualPool,
        inputTokenMint: zeroFeeMint,
        outputTokenMint: poolState.baseMint,
        amountIn: new BN(LAMPORTS_PER_SOL),
        minimumAmountOut: new BN(0),
        swapMode: SwapMode.PartialFill,
        referralTokenAccount: null,
      };
      await swap(svm, program, params);
    });

    describe("Claims and withdrawals", () => {
      before(async () => {
        mintToken2022To(
          svm,
          user,
          zeroFeeMint,
          admin,
          user.publicKey,
          BigInt(LAMPORTS_PER_SOL * 20)
        );
        const poolState = getVirtualPool(svm, program, virtualPool);
        await swap(svm, program, {
          config,
          payer: user,
          pool: virtualPool,
          inputTokenMint: zeroFeeMint,
          outputTokenMint: poolState.baseMint,
          amountIn: new BN(LAMPORTS_PER_SOL * 10),
          minimumAmountOut: new BN(0),
          swapMode: SwapMode.PartialFill,
          referralTokenAccount: null,
        });
      });

      it("Partner claims trading fee while the fee is zero", async () => {
        // claim only a little so the claims below still have a non-zero quote amount to transfer
        await claimTradingFee(svm, program, {
          feeClaimer: partner,
          pool: virtualPool,
          maxBaseAmount: U64_MAX,
          maxQuoteAmount: new BN(1),
        });
      });

      it("Blocks claims and withdrawals while the fee is non-zero", async () => {
        setTransferFee(svm, admin, zeroFeeMint, admin, 50, BigInt(1_000_000));

        await expectThrowsAsync(
          () =>
            claimTradingFee(svm, program, {
              feeClaimer: partner,
              pool: virtualPool,
              maxBaseAmount: U64_MAX,
              maxQuoteAmount: U64_MAX,
            }).then(() => {}),
          "QuoteMintHasNonZeroTransferFee"
        );

        await expectThrowsAsync(
          () =>
            claimCreatorTradingFee(svm, program, {
              creator: poolCreator,
              pool: virtualPool,
              maxBaseAmount: U64_MAX,
              maxQuoteAmount: U64_MAX,
            }).then(() => {}),
          "QuoteMintHasNonZeroTransferFee"
        );

        await expectThrowsAsync(
          () =>
            partnerWithdrawSurplus(svm, program, {
              feeClaimer: partner,
              virtualPool,
            }).then(() => {}),
          "QuoteMintHasNonZeroTransferFee"
        );

        await expectThrowsAsync(
          () =>
            creatorWithdrawSurplus(svm, program, {
              creator: poolCreator,
              virtualPool,
            }).then(() => {}),
          "QuoteMintHasNonZeroTransferFee"
        );

        await expectThrowsAsync(
          () =>
            partnerWithdrawMigrationFee(svm, program, {
              partner,
              virtualPool,
            }).then(() => {}),
          "QuoteMintHasNonZeroTransferFee"
        );
      });

      it("Allows base-only trading fee claims while the fee is non-zero", async () => {
        await claimTradingFee(svm, program, {
          feeClaimer: partner,
          pool: virtualPool,
          maxBaseAmount: U64_MAX,
          maxQuoteAmount: new BN(0),
        });

        await claimCreatorTradingFee(svm, program, {
          creator: poolCreator,
          pool: virtualPool,
          maxBaseAmount: U64_MAX,
          maxQuoteAmount: new BN(0),
        });
      });

      it("Partner withdraws surplus after the fee returns to zero", async () => {
        setTransferFee(svm, admin, zeroFeeMint, admin, 0, BigInt(0));

        await partnerWithdrawSurplus(svm, program, {
          feeClaimer: partner,
          virtualPool,
        });
      });
    });

    describe("Migration to damm v2", () => {
      before(async () => {
        await createMeteoraDammV2Metadata(svm, program, {
          payer: admin,
          virtualPool,
          config,
        });
      });

      it("Blocks migration while the fee is non-zero", async () => {
        setTransferFee(svm, admin, zeroFeeMint, admin, 50, BigInt(1_000_000));

        const dammConfig = await createDammV2Config(
          svm,
          admin,
          derivePoolAuthority(),
          1
        );
        await expectThrowsAsync(
          () =>
            migrateToDammV2(svm, program, {
              payer: admin,
              virtualPool,
              dammConfig,
            }).then(() => {}),
          "QuoteMintHasNonZeroTransferFee"
        );
      });

      it("Migrates after the fee returns to zero", async () => {
        setTransferFee(svm, admin, zeroFeeMint, admin, 0, BigInt(0));

        const dammConfig = await createDammV2Config(
          svm,
          admin,
          derivePoolAuthority(),
          1
        );
        await migrateToDammV2(svm, program, {
          payer: admin,
          virtualPool,
          dammConfig,
        });
      });
    });
  });

  describe("Transfer fee schedule across epochs", () => {
    function buildSwapParams(
      quoteMint: PublicKey,
      config: PublicKey,
      pool: PublicKey
    ): SwapParams {
      const poolState = getVirtualPool(svm, program, pool);
      return {
        config,
        payer: user,
        pool,
        inputTokenMint: quoteMint,
        outputTokenMint: poolState.baseMint,
        amountIn: new BN(LAMPORTS_PER_SOL),
        minimumAmountOut: new BN(0),
        swapMode: SwapMode.PartialFill,
        referralTokenAccount: null,
      };
    }

    it("Accepts a mint whose historical fee is non-zero once the zero fee is active", async () => {
      const mint = createToken2022Mint(svm, admin, {
        transferFeeConfig: {
          feeBasisPoints: 100,
          maximumFee: BigInt(LAMPORTS_PER_SOL),
          transferFeeConfigAuthority: admin.publicKey,
        },
      });
      // older_transfer_fee stays 100 bps, newer_transfer_fee becomes 0 bps two epochs ahead
      setTransferFee(svm, admin, mint, admin, 0, BigInt(0));

      // the zero fee is only scheduled, the active fee is still 100 bps
      await expectThrowsAsync(
        () =>
          createTokenBadge(svm, program, {
            operator,
            payer: operator,
            tokenMint: mint,
          }).then(() => {}),
        "QuoteMintHasNonZeroTransferFee"
      );

      warpEpochBy(svm, 2);

      await createTokenBadge(svm, program, {
        operator,
        payer: operator,
        tokenMint: mint,
      });
      const config = await createConfig(svm, program, {
        payer: partner,
        leftoverReceiver: partner.publicKey,
        feeClaimer: partner.publicKey,
        quoteMint: mint,
        instructionParams: buildConfigParams(),
        tokenBadge: deriveTokenBadgeAddress(mint),
      });
      const pool = await createPoolWithToken2022(svm, program, {
        payer: poolCreator,
        poolCreator,
        quoteMint: mint,
        config,
        instructionParams: {
          name: "historical fee",
          symbol: "HISTFEE",
          uri: "histfee.com",
        },
        tokenQuoteProgram: TOKEN_2022_PROGRAM_ID,
        tokenBadge: deriveTokenBadgeAddress(mint),
      });

      mintToken2022To(
        svm,
        user,
        mint,
        admin,
        user.publicKey,
        BigInt(LAMPORTS_PER_SOL * 10)
      );
      await swap(svm, program, buildSwapParams(mint, config, pool));
    });

    it("Enforces a scheduled non-zero fee once it becomes active", async () => {
      const mint = createToken2022Mint(svm, admin, {
        transferFeeConfig: {
          feeBasisPoints: 0,
          maximumFee: BigInt(0),
          transferFeeConfigAuthority: admin.publicKey,
        },
      });
      await createTokenBadge(svm, program, {
        operator,
        payer: operator,
        tokenMint: mint,
      });
      const config = await createConfig(svm, program, {
        payer: partner,
        leftoverReceiver: partner.publicKey,
        feeClaimer: partner.publicKey,
        quoteMint: mint,
        instructionParams: buildConfigParams(),
        tokenBadge: deriveTokenBadgeAddress(mint),
      });
      const pool = await createPoolWithToken2022(svm, program, {
        payer: poolCreator,
        poolCreator,
        quoteMint: mint,
        config,
        instructionParams: {
          name: "scheduled fee",
          symbol: "SCHEDFEE",
          uri: "schedfee.com",
        },
        tokenQuoteProgram: TOKEN_2022_PROGRAM_ID,
        tokenBadge: deriveTokenBadgeAddress(mint),
      });
      mintToken2022To(
        svm,
        user,
        mint,
        admin,
        user.publicKey,
        BigInt(LAMPORTS_PER_SOL * 10)
      );

      // older_transfer_fee stays 0 bps, newer_transfer_fee becomes 50 bps two epochs ahead
      setTransferFee(svm, admin, mint, admin, 50, BigInt(1_000_000));
      warpEpochBy(svm, 2);

      // the historical zero fee must not mask the active 50 bps fee
      await expectThrowsAsync(
        () =>
          swap(svm, program, buildSwapParams(mint, config, pool)).then(
            () => {}
          ),
        "QuoteMintHasNonZeroTransferFee"
      );

      // older_transfer_fee becomes 50 bps, newer_transfer_fee becomes 0 bps two epochs ahead
      setTransferFee(svm, admin, mint, admin, 0, BigInt(0));

      // the zero fee is only scheduled, the active fee is still 50 bps
      await expectThrowsAsync(
        () =>
          swap(svm, program, buildSwapParams(mint, config, pool)).then(
            () => {}
          ),
        "QuoteMintHasNonZeroTransferFee"
      );

      warpEpochBy(svm, 2);
      await swap(svm, program, buildSwapParams(mint, config, pool));
    });
  });
});
