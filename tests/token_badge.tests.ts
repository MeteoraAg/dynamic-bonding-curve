import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  BaseFee,
  closeTokenBadge,
  ConfigParameters,
  createConfig,
  createConfigWithTransferHook,
  CreateConfigParams,
  createOperatorAccount,
  createPoolWithSplToken,
  createPoolWithToken2022,
  createPoolWithToken2022TransferHook,
  createTokenBadge,
  OperatorPermission,
  swap,
  SwapMode,
  SwapParams,
  swapWithTransferHook,
} from "./instructions";
import {
  createVirtualCurveProgram,
  expectThrowsAsync,
  generateAndFund,
  initializeExtraAccountMetaList,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  startSvm,
  U64_MAX,
} from "./utils";
import { TRANSFER_HOOK_COUNTER_PROGRAM_ID } from "./utils/constants";
import { deriveTokenBadgeAddress } from "./utils/accounts";
import { getConfig, getVirtualPool } from "./utils/fetcher";
import {
  createToken,
  createToken2022Mint,
  mintToken2022To,
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

describe("Token badge", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let operator: Keypair;
  let operatorWithoutBadgePermission: Keypair;
  let partner: Keypair;
  let poolCreator: Keypair;
  let user: Keypair;
  let program: VirtualCurveProgram;

  // token2022 quote mint with a permanent delegate extension, unsupported without a badge
  let badgedQuoteMint: PublicKey;
  let config: PublicKey;
  let virtualPool: PublicKey;

  before(async () => {
    svm = startSvm();
    admin = generateAndFund(svm);
    operator = generateAndFund(svm);
    operatorWithoutBadgePermission = generateAndFund(svm);
    partner = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    user = generateAndFund(svm);
    program = createVirtualCurveProgram();

    await createOperatorAccount(svm, program, {
      admin,
      whitelistedAddress: operator.publicKey,
      permissions: [
        OperatorPermission.CreateTokenBadge,
        OperatorPermission.CloseTokenBadge,
      ],
    });
    await createOperatorAccount(svm, program, {
      admin,
      whitelistedAddress: operatorWithoutBadgePermission.publicKey,
      permissions: [OperatorPermission.ClaimProtocolFee],
    });

    badgedQuoteMint = createToken2022Mint(svm, admin, {
      permanentDelegate: admin.publicKey,
    });
  });

  describe("Failure cases", () => {
    it("Fails to create token badge without the CreateTokenBadge permission", async () => {
      await expectThrowsAsync(
        () =>
          createTokenBadge(svm, program, {
            operator: operatorWithoutBadgePermission,
            payer: operatorWithoutBadgePermission,
            tokenMint: badgedQuoteMint,
          }),
        "InvalidPermission"
      );
    });

    it("Fails to create token badge on a supported spl token mint", async () => {
      const splMint = createToken(svm, admin, admin.publicKey, 9);
      await expectThrowsAsync(
        () =>
          createTokenBadge(svm, program, {
            operator,
            payer: operator,
            tokenMint: splMint,
          }),
        "CannotCreateTokenBadgeOnSupportedMint"
      );
    });

    it("Fails to create token badge on a supported token2022 mint", async () => {
      const plain2022Mint = createToken2022Mint(svm, admin);
      await expectThrowsAsync(
        () =>
          createTokenBadge(svm, program, {
            operator,
            payer: operator,
            tokenMint: plain2022Mint,
          }),
        "CannotCreateTokenBadgeOnSupportedMint"
      );
    });

    it("Fails to create config with an unsupported quote mint and no badge", async () => {
      const params: CreateConfigParams<ConfigParameters> = {
        payer: partner,
        leftoverReceiver: partner.publicKey,
        feeClaimer: partner.publicKey,
        quoteMint: badgedQuoteMint,
        instructionParams: buildConfigParams(),
      };
      // without the badge in remaining accounts the mint is rejected
      await expectThrowsAsync(
        () => createConfig(svm, program, params).then(() => {}),
        "InvalidTokenBadge"
      );
      await expectThrowsAsync(
        () =>
          createConfigWithTransferHook(svm, program, {
            ...params,
            transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
          }).then(() => {}),
        "InvalidTokenBadge"
      );
    });

    it("Badge does not override the MeteoraDamm spl-only quote rule", async () => {
      const dammV1QuoteMint = createToken2022Mint(svm, admin, {
        permanentDelegate: admin.publicKey,
      });
      await createTokenBadge(svm, program, {
        operator,
        payer: operator,
        tokenMint: dammV1QuoteMint,
      });

      const instructionParams = buildConfigParams();
      instructionParams.migrationOption = 0; // meteora damm v1
      instructionParams.tokenType = 0; // spl token
      await expectThrowsAsync(
        () =>
          createConfig(svm, program, {
            payer: partner,
            leftoverReceiver: partner.publicKey,
            feeClaimer: partner.publicKey,
            quoteMint: dammV1QuoteMint,
            instructionParams,
            tokenBadge: deriveTokenBadgeAddress(dammV1QuoteMint),
          }).then(() => {}),
        "InvalidQuoteMint"
      );
    });
  });

  describe("Lifecycle", () => {
    describe("Token2022", () => {
      before(async () => {
        await createTokenBadge(svm, program, {
          operator,
          payer: operator,
          tokenMint: badgedQuoteMint,
        });
      });

      it("Creates config with a badged quote mint", async () => {
        const params: CreateConfigParams<ConfigParameters> = {
          payer: partner,
          leftoverReceiver: partner.publicKey,
          feeClaimer: partner.publicKey,
          quoteMint: badgedQuoteMint,
          instructionParams: buildConfigParams(),
          tokenBadge: deriveTokenBadgeAddress(badgedQuoteMint),
        };
        config = await createConfig(svm, program, params);
      });

      it("Creates pool on the badged-quote config", async () => {
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

        const configState = getConfig(svm, program, config);
        expect(configState.quoteMint.toString()).eq(badgedQuoteMint.toString());
        expect(svm.getAccount(virtualPool)).not.eq(null);
      });

      it("Fails to create pool without the token badge account", async () => {
        await expectThrowsAsync(
          () =>
            createPoolWithToken2022(svm, program, {
              payer: poolCreator,
              poolCreator,
              quoteMint: badgedQuoteMint,
              config,
              instructionParams: {
                name: "no badge",
                symbol: "NOBADGE",
                uri: "nobadge.com",
              },
              tokenQuoteProgram: TOKEN_2022_PROGRAM_ID,
            }).then(() => {}),
          "InvalidTokenBadge"
        );
      });

      it("Swaps on the badged-quote pool", async () => {
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
          amountIn: new BN(LAMPORTS_PER_SOL),
          minimumAmountOut: new BN(0),
          swapMode: SwapMode.PartialFill,
          referralTokenAccount: null,
        };
        await swap(svm, program, params);
      });

      it("Close badge blocks new configs and new pools while existing pools keep working", async () => {
        await closeTokenBadge(svm, program, {
          operator,
          tokenMint: badgedQuoteMint,
          rentReceiver: admin.publicKey,
        });
        const closedBadge = svm.getAccount(
          deriveTokenBadgeAddress(badgedQuoteMint)
        );
        expect(closedBadge === null || Number(closedBadge.lamports) === 0).eq(
          true
        );

        await expectThrowsAsync(
          () =>
            createConfig(svm, program, {
              payer: partner,
              leftoverReceiver: partner.publicKey,
              feeClaimer: partner.publicKey,
              quoteMint: badgedQuoteMint,
              instructionParams: buildConfigParams(),
            }).then(() => {}),
          "InvalidTokenBadge"
        );

        await expectThrowsAsync(
          () =>
            createPoolWithToken2022(svm, program, {
              payer: poolCreator,
              poolCreator,
              quoteMint: badgedQuoteMint,
              config,
              instructionParams: {
                name: "badged2",
                symbol: "BADGE2",
                uri: "badge2.com",
              },
              tokenQuoteProgram: TOKEN_2022_PROGRAM_ID,
            }).then(() => {}),
          "InvalidTokenBadge"
        );

        const poolState = getVirtualPool(svm, program, virtualPool);
        const params: SwapParams = {
          config,
          payer: user,
          pool: virtualPool,
          inputTokenMint: badgedQuoteMint,
          outputTokenMint: poolState.baseMint,
          amountIn: new BN(LAMPORTS_PER_SOL),
          minimumAmountOut: new BN(0),
          swapMode: SwapMode.PartialFill,
          referralTokenAccount: null,
        };
        await swap(svm, program, params);
      });
    });

    describe("Token2022 with transfer hook", () => {
      let hookConfig: PublicKey;
      let hookPool: PublicKey;

      before(async () => {
        await createTokenBadge(svm, program, {
          operator,
          payer: operator,
          tokenMint: badgedQuoteMint,
        });
      });

      it("Creates transfer hook config with a badged quote mint", async () => {
        hookConfig = await createConfigWithTransferHook(svm, program, {
          payer: partner,
          leftoverReceiver: partner.publicKey,
          feeClaimer: partner.publicKey,
          quoteMint: badgedQuoteMint,
          instructionParams: buildConfigParams(),
          transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
          tokenBadge: deriveTokenBadgeAddress(badgedQuoteMint),
        });
      });

      it("Creates pool on the badged-quote hook config", async () => {
        hookPool = await createPoolWithToken2022TransferHook(svm, program, {
          payer: poolCreator,
          poolCreator,
          quoteMint: badgedQuoteMint,
          config: hookConfig,
          transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
          instructionParams: {
            name: "badged hook",
            symbol: "BHOOK",
            uri: "badgedhook.com",
          },
          tokenQuoteProgram: TOKEN_2022_PROGRAM_ID,
          tokenBadge: deriveTokenBadgeAddress(badgedQuoteMint),
        });
        expect(svm.getAccount(hookPool)).not.eq(null);

        const hookPoolState = getVirtualPool(svm, program, hookPool);
        await initializeExtraAccountMetaList(
          svm,
          poolCreator,
          hookPoolState.baseMint
        );
      });

      it("Fails to create hook pool without the token badge account", async () => {
        await expectThrowsAsync(
          () =>
            createPoolWithToken2022TransferHook(svm, program, {
              payer: poolCreator,
              poolCreator,
              quoteMint: badgedQuoteMint,
              config: hookConfig,
              transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
              instructionParams: {
                name: "no badge hook",
                symbol: "NBHOOK",
                uri: "nobadgehook.com",
              },
              tokenQuoteProgram: TOKEN_2022_PROGRAM_ID,
            }).then(() => {}),
          "InvalidTokenBadge"
        );
      });

      it("Swaps on the badged-quote hook pool", async () => {
        const hookPoolState = getVirtualPool(svm, program, hookPool);
        const params: SwapParams = {
          config: hookConfig,
          payer: user,
          pool: hookPool,
          inputTokenMint: badgedQuoteMint,
          outputTokenMint: hookPoolState.baseMint,
          amountIn: new BN(LAMPORTS_PER_SOL),
          minimumAmountOut: new BN(0),
          swapMode: SwapMode.PartialFill,
          referralTokenAccount: null,
        };
        await swapWithTransferHook(svm, program, params);
      });

      it("Close badge blocks new configs and new pools while existing pools keep working", async () => {
        await closeTokenBadge(svm, program, {
          operator,
          tokenMint: badgedQuoteMint,
          rentReceiver: admin.publicKey,
        });
        const closedBadge = svm.getAccount(
          deriveTokenBadgeAddress(badgedQuoteMint)
        );
        expect(closedBadge === null || Number(closedBadge.lamports) === 0).eq(
          true
        );

        await expectThrowsAsync(
          () =>
            createConfigWithTransferHook(svm, program, {
              payer: partner,
              leftoverReceiver: partner.publicKey,
              feeClaimer: partner.publicKey,
              quoteMint: badgedQuoteMint,
              instructionParams: buildConfigParams(),
              transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
            }).then(() => {}),
          "InvalidTokenBadge"
        );

        await expectThrowsAsync(
          () =>
            createPoolWithToken2022TransferHook(svm, program, {
              payer: poolCreator,
              poolCreator,
              quoteMint: badgedQuoteMint,
              config: hookConfig,
              transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
              instructionParams: {
                name: "badged hook 2",
                symbol: "BHOOK2",
                uri: "badgedhook2.com",
              },
              tokenQuoteProgram: TOKEN_2022_PROGRAM_ID,
            }).then(() => {}),
          "InvalidTokenBadge"
        );

        const hookPoolState = getVirtualPool(svm, program, hookPool);
        const params: SwapParams = {
          config: hookConfig,
          payer: user,
          pool: hookPool,
          inputTokenMint: badgedQuoteMint,
          outputTokenMint: hookPoolState.baseMint,
          amountIn: new BN(LAMPORTS_PER_SOL),
          minimumAmountOut: new BN(0),
          swapMode: SwapMode.PartialFill,
          referralTokenAccount: null,
        };
        await swapWithTransferHook(svm, program, params);
      });
    });

    describe("SplToken base", () => {
      let splBadgedQuoteMint: PublicKey;
      let otherBadgedMint: PublicKey;
      let splConfig: PublicKey;

      before(async () => {
        splBadgedQuoteMint = createToken2022Mint(svm, admin, {
          permanentDelegate: admin.publicKey,
        });
        await createTokenBadge(svm, program, {
          operator,
          payer: operator,
          tokenMint: splBadgedQuoteMint,
        });
        otherBadgedMint = createToken2022Mint(svm, admin, {
          permanentDelegate: admin.publicKey,
        });
        await createTokenBadge(svm, program, {
          operator,
          payer: operator,
          tokenMint: otherBadgedMint,
        });

        const instructionParams = buildConfigParams();
        instructionParams.tokenType = 0; // spl token base
        splConfig = await createConfig(svm, program, {
          payer: partner,
          leftoverReceiver: partner.publicKey,
          feeClaimer: partner.publicKey,
          quoteMint: splBadgedQuoteMint,
          instructionParams,
          tokenBadge: deriveTokenBadgeAddress(splBadgedQuoteMint),
        });
      });

      it("Fails to create spl pool without the token badge account", async () => {
        await expectThrowsAsync(
          () =>
            createPoolWithSplToken(svm, program, {
              payer: poolCreator,
              poolCreator,
              quoteMint: splBadgedQuoteMint,
              config: splConfig,
              instructionParams: {
                name: "no badge spl",
                symbol: "NBSPL",
                uri: "nobadgespl.com",
              },
              tokenQuoteProgram: TOKEN_2022_PROGRAM_ID,
            }).then(() => {}),
          "InvalidTokenBadge"
        );
      });

      it("Fails to create spl pool with a badge for a different mint", async () => {
        await expectThrowsAsync(
          () =>
            createPoolWithSplToken(svm, program, {
              payer: poolCreator,
              poolCreator,
              quoteMint: splBadgedQuoteMint,
              config: splConfig,
              instructionParams: {
                name: "wrong badge spl",
                symbol: "WBSPL",
                uri: "wrongbadgespl.com",
              },
              tokenQuoteProgram: TOKEN_2022_PROGRAM_ID,
              tokenBadge: deriveTokenBadgeAddress(otherBadgedMint),
            }).then(() => {}),
          "InvalidTokenBadge"
        );
      });

      it("Creates spl pool with the token badge", async () => {
        const splPool = await createPoolWithSplToken(svm, program, {
          payer: poolCreator,
          poolCreator,
          quoteMint: splBadgedQuoteMint,
          config: splConfig,
          instructionParams: {
            name: "badged spl",
            symbol: "BSPL",
            uri: "badgedspl.com",
          },
          tokenQuoteProgram: TOKEN_2022_PROGRAM_ID,
          tokenBadge: deriveTokenBadgeAddress(splBadgedQuoteMint),
        });
        expect(svm.getAccount(splPool)).not.eq(null);
      });
    });
  });
});
