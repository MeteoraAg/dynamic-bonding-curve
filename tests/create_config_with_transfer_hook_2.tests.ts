import {
  ExtensionType,
  getAccountLen,
  getTransferFeeConfig,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackMint,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  BaseFee,
  ConfigParameters,
  createConfigWithTransferHook,
  createConfigWithTransferHook2,
  createOperatorAccount,
  createPoolWithToken2022TransferHook,
  createTokenBadge,
  OperatorPermission,
  TransferFeeParameters,
} from "./instructions";
import {
  createVirtualCurveProgram,
  derivePoolAuthority,
  expectThrowsAsync,
  generateAndFund,
  MAX_SQRT_PRICE,
  MigratedCollectFeeMode,
  MIN_SQRT_PRICE,
  startSvm,
  MigratedTransferFeeAuthorityOption,
  TransferFeeWithheldAuthority,
  U64_MAX,
} from "./utils";
import { deriveTokenBadgeAddress } from "./utils/accounts";
import { TRANSFER_HOOK_COUNTER_PROGRAM_ID } from "./utils/constants";
import { getConfig, getVirtualPool } from "./utils/fetcher";
import { createToken2022Mint, getMintExtensionTypes } from "./utils/token";
import { VirtualCurveProgram } from "./utils/types";

const MAX_BASE_TRANSFER_FEE_BPS = 1000;
const PRE_MIGRATION_TOKEN_SUPPLY = new BN(2_500_000_000);
const UNEQUAL_POST_MIGRATION_TOKEN_SUPPLY = new BN(2_200_000_000);
const CUSTOMIZABLE_MIGRATION_FEE_OPTION = 6;
const LOCKED_VESTING = {
  amountPerPeriod: new BN(1_000_000),
  cliffDurationFromMigrationTime: new BN(0),
  frequency: new BN(1),
  numberOfPeriod: new BN(10),
  cliffUnlockAmount: new BN(1_000_000_000),
};
const LOCKED_VESTING_TOKEN_SUPPLY = PRE_MIGRATION_TOKEN_SUPPLY.add(
  LOCKED_VESTING.cliffUnlockAmount.add(
    LOCKED_VESTING.amountPerPeriod.mul(LOCKED_VESTING.numberOfPeriod)
  )
);
const FIXED_MIGRATION_FEE_OPTIONS = [0, 1, 2, 3, 4, 5];
const SPL_TOKEN_TYPE = 0;
const TOKEN_2022_TYPE = 1;

function buildConfigParameters(tokenType: number): ConfigParameters {
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
    tokenType,
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
    migrationFeeOption: CUSTOMIZABLE_MIGRATION_FEE_OPTION,
    tokenSupply: {
      preMigrationTokenSupply: PRE_MIGRATION_TOKEN_SUPPLY,
      postMigrationTokenSupply: PRE_MIGRATION_TOKEN_SUPPLY,
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
    compoundingFeeBps: 0,
    migratedPoolBaseFeeMode: 0,
    migratedPoolMarketCapFeeSchedulerParams: null,
    curve: curves,
  };
}

describe("Create config with transfer hook 2", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let partner: Keypair;
  let operator: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;

  const feeParameters: TransferFeeParameters = {
    transferFeeBasisPoints: 100,
    withheldAuthority: TransferFeeWithheldAuthority.Creator,
    migratedTransferFeeAuthorityOption:
      MigratedTransferFeeAuthorityOption.Immutable,
  };

  before(async () => {
    svm = startSvm();
    admin = generateAndFund(svm);
    partner = generateAndFund(svm);
    operator = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    program = createVirtualCurveProgram();

    await createOperatorAccount(svm, program, {
      admin,
      whitelistedAddress: operator.publicKey,
      permissions: [OperatorPermission.CreateTokenBadge],
    });
  });

  function createHookFeeConfig(
    tokenType: number,
    transferFeeParameters: TransferFeeParameters | null,
    overrides: Partial<ConfigParameters> = {},
    quote: { quoteMint: PublicKey; tokenBadge?: PublicKey } = {
      quoteMint: NATIVE_MINT,
    },
    transferHookProgram: PublicKey = TRANSFER_HOOK_COUNTER_PROGRAM_ID,
    feeClaimer: PublicKey = partner.publicKey
  ) {
    return createConfigWithTransferHook2(svm, program, {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer,
      quoteMint: quote.quoteMint,
      tokenBadge: quote.tokenBadge,
      instructionParams: { ...buildConfigParameters(tokenType), ...overrides },
      transferHookProgram,
      transferFee: transferFeeParameters,
    });
  }

  async function createBadgedQuoteMint(
    options: Parameters<typeof createToken2022Mint>[2]
  ): Promise<{ quoteMint: PublicKey; tokenBadge: PublicKey }> {
    const quoteMint = createToken2022Mint(svm, admin, options);
    await createTokenBadge(svm, program, {
      operator,
      payer: operator,
      tokenMint: quoteMint,
    });
    return { quoteMint, tokenBadge: deriveTokenBadgeAddress(quoteMint) };
  }

  // the migrated pool fee must be empty for a fixed migration fee option
  const noMigratedPoolFee = { collectFeeMode: 0, dynamicFee: 0, poolFeeBps: 0 };
  const quoteTokenMigratedPoolFee = {
    collectFeeMode: MigratedCollectFeeMode.QuoteToken,
    dynamicFee: 0,
    poolFeeBps: 100,
  };

  type CreateWithOverrides = (
    overrides: Partial<ConfigParameters>
  ) => Promise<PublicKey>;

  function itIsRestricted(create: () => CreateWithOverrides) {
    it("Rejects a non-fixed token supply", async () => {
      await expectThrowsAsync(
        () => create()({ tokenSupply: null }),
        "InvalidTokenSupply"
      );
    });

    it("Rejects a non-constant token supply", async () => {
      await expectThrowsAsync(
        () =>
          create()({
            tokenSupply: {
              preMigrationTokenSupply: PRE_MIGRATION_TOKEN_SUPPLY,
              postMigrationTokenSupply: UNEQUAL_POST_MIGRATION_TOKEN_SUPPLY,
            },
          }),
        "InvalidTokenSupply"
      );
    });

    it("Rejects every fixed migration fee option", async () => {
      for (const migrationFeeOption of FIXED_MIGRATION_FEE_OPTIONS) {
        await expectThrowsAsync(
          () =>
            create()({
              migrationFeeOption,
              migratedPoolFee: noMigratedPoolFee,
            }),
          "InvalidMigrationFeeOption"
        );
      }
    });

    it("Rejects locked vesting", async () => {
      await expectThrowsAsync(
        () =>
          create()({
            lockedVesting: LOCKED_VESTING,
            tokenSupply: {
              preMigrationTokenSupply: LOCKED_VESTING_TOKEN_SUPPLY,
              postMigrationTokenSupply: LOCKED_VESTING_TOKEN_SUPPLY,
            },
          }),
        "InvalidVestingParameters"
      );
    });

    it("Rejects a quote token migrated collect fee mode", async () => {
      await expectThrowsAsync(
        () => create()({ migratedPoolFee: quoteTokenMigratedPoolFee }),
        "InvalidMigratedPoolFee"
      );
    });

    it("Accepts a fixed supply with a customizable migrated pool", async () => {
      const config = await create()({});
      const configState = getConfig(svm, program, config);
      expect(configState.fixedTokenSupplyFlag).eq(1);
      expect(configState.migrationFeeOption).eq(
        CUSTOMIZABLE_MIGRATION_FEE_OPTION
      );
      expect(configState.version).eq(1);
    });
  }

  function itIsNotRestricted(create: () => CreateWithOverrides) {
    it("Sets the config version", async () => {
      const config = await create()({});
      expect(getConfig(svm, program, config).version).eq(1);
    });

    it("Accepts a non-fixed token supply", async () => {
      const config = await create()({ tokenSupply: null });
      expect(getConfig(svm, program, config).fixedTokenSupplyFlag).eq(0);
    });

    it("Accepts a non-constant token supply", async () => {
      const config = await create()({
        tokenSupply: {
          preMigrationTokenSupply: PRE_MIGRATION_TOKEN_SUPPLY,
          postMigrationTokenSupply: UNEQUAL_POST_MIGRATION_TOKEN_SUPPLY,
        },
      });
      expect(
        getConfig(svm, program, config).postMigrationTokenSupply.toString()
      ).eq(UNEQUAL_POST_MIGRATION_TOKEN_SUPPLY.toString());
    });

    it("Accepts a fixed migration fee option", async () => {
      const config = await create()({
        migrationFeeOption: 0,
        migratedPoolFee: noMigratedPoolFee,
      });
      expect(getConfig(svm, program, config).migrationFeeOption).eq(0);
    });

    it("Accepts a quote token migrated collect fee mode", async () => {
      const config = await create()({
        migratedPoolFee: quoteTokenMigratedPoolFee,
      });
      expect(getConfig(svm, program, config).migratedCollectFeeMode).eq(
        MigratedCollectFeeMode.QuoteToken
      );
    });

    it("Accepts locked vesting", async () => {
      const config = await create()({
        lockedVesting: LOCKED_VESTING,
        tokenSupply: null,
      });
      expect(
        getConfig(svm, program, config).lockedVestingConfig.frequency.toString()
      ).eq(LOCKED_VESTING.frequency.toString());
    });
  }

  describe("Stored config", () => {
    it("Stores the transfer hook program and the fee parameters", async () => {
      const config = await createHookFeeConfig(TOKEN_2022_TYPE, feeParameters);
      const configState = getConfig(svm, program, config);
      expect(configState.transferFeeFlag).eq(1);
      expect(configState.transferFeeBasisPoints).eq(
        feeParameters.transferFeeBasisPoints
      );
      expect(configState.transferFeeWithheldAuthority).eq(
        feeParameters.withheldAuthority
      );
      expect(configState.migratedTransferFeeAuthorityOption).eq(
        feeParameters.migratedTransferFeeAuthorityOption
      );
      expect(configState.version).eq(1);
      // the helper asserts the stored transfer hook program
    });

    it("Stores no fee for a null transfer fee", async () => {
      const config = await createHookFeeConfig(TOKEN_2022_TYPE, null);
      const configState = getConfig(svm, program, config);
      expect(configState.transferFeeFlag).eq(0);
      expect(configState.transferFeeBasisPoints).eq(0);
      expect(configState.transferFeeWithheldAuthority).eq(0);
      expect(configState.migratedTransferFeeAuthorityOption).eq(0);
    });

    it("Allows the mint authority token update options", async () => {
      // PartnerUpdateAndMintAuthority is only valid for transfer hook configs
      const config = await createHookFeeConfig(TOKEN_2022_TYPE, feeParameters, {
        tokenUpdateAuthority: 4,
      });
      expect(getConfig(svm, program, config).tokenUpdateAuthority).eq(4);
    });
  });

  describe("Validation", () => {
    it("Rejects an SPL token config without a transfer fee", async () => {
      await expectThrowsAsync(
        () => createHookFeeConfig(SPL_TOKEN_TYPE, null),
        "InvalidTokenType"
      );
    });

    it("Rejects an SPL token config with a transfer fee", async () => {
      await expectThrowsAsync(
        () => createHookFeeConfig(SPL_TOKEN_TYPE, feeParameters),
        "InvalidTokenType"
      );
    });

    it("Rejects basis points above the maximum", async () => {
      await expectThrowsAsync(
        () =>
          createHookFeeConfig(TOKEN_2022_TYPE, {
            ...feeParameters,
            transferFeeBasisPoints: MAX_BASE_TRANSFER_FEE_BPS + 1,
          }),
        "InvalidTransferFeeParameters"
      );
    });

    it("Rejects an unknown withheld authority", async () => {
      await expectThrowsAsync(
        () =>
          createHookFeeConfig(TOKEN_2022_TYPE, {
            ...feeParameters,
            withheldAuthority: 2,
          }),
        "InvalidTransferFeeParameters"
      );
    });

    it("Rejects zero basis points with an immutable migrated authority", async () => {
      await expectThrowsAsync(
        () =>
          createHookFeeConfig(TOKEN_2022_TYPE, {
            transferFeeBasisPoints: 0,
            withheldAuthority: TransferFeeWithheldAuthority.Creator,
            migratedTransferFeeAuthorityOption:
              MigratedTransferFeeAuthorityOption.Immutable,
          }),
        "InvalidTransferFeeParameters"
      );
    });

    it("Rejects zero basis points when the fee is zeroed and revoked on migration", async () => {
      await expectThrowsAsync(
        () =>
          createHookFeeConfig(TOKEN_2022_TYPE, {
            transferFeeBasisPoints: 0,
            withheldAuthority: TransferFeeWithheldAuthority.Partner,
            migratedTransferFeeAuthorityOption:
              MigratedTransferFeeAuthorityOption.RevokeZeroFee,
          }),
        "InvalidTransferFeeParameters"
      );
    });

    it("Rejects an unknown migrated transfer fee authority option", async () => {
      await expectThrowsAsync(
        () =>
          createHookFeeConfig(TOKEN_2022_TYPE, {
            ...feeParameters,
            migratedTransferFeeAuthorityOption: 4,
          }),
        "InvalidTransferFeeParameters"
      );
    });

    it("Accepts zero basis points when there is a post migration authority", async () => {
      for (const [withheldAuthority, migratedTransferFeeAuthorityOption] of [
        [
          TransferFeeWithheldAuthority.Partner,
          MigratedTransferFeeAuthorityOption.Creator,
        ],
        [
          TransferFeeWithheldAuthority.Creator,
          MigratedTransferFeeAuthorityOption.Partner,
        ],
      ]) {
        const config = await createHookFeeConfig(TOKEN_2022_TYPE, {
          transferFeeBasisPoints: 0,
          withheldAuthority,
          migratedTransferFeeAuthorityOption,
        });
        const configState = getConfig(svm, program, config);
        expect(configState.transferFeeBasisPoints).eq(0);
        expect(configState.transferFeeWithheldAuthority).eq(withheldAuthority);
        expect(configState.migratedTransferFeeAuthorityOption).eq(
          migratedTransferFeeAuthorityOption
        );
      }
    });

    it("Rejects a fee claimer with pubkey default as the withheld authority", async () => {
      await expectThrowsAsync(
        () =>
          createHookFeeConfig(
            TOKEN_2022_TYPE,
            {
              ...feeParameters,
              withheldAuthority: TransferFeeWithheldAuthority.Partner,
            },
            {},
            { quoteMint: NATIVE_MINT },
            TRANSFER_HOOK_COUNTER_PROGRAM_ID,
            PublicKey.default
          ),
        "InvalidFeeClaimer"
      );
    });

    it("Rejects a fee claimer with pubkey default as the migrated transfer fee authority", async () => {
      await expectThrowsAsync(
        () =>
          createHookFeeConfig(
            TOKEN_2022_TYPE,
            {
              ...feeParameters,
              migratedTransferFeeAuthorityOption:
                MigratedTransferFeeAuthorityOption.Partner,
            },
            {},
            { quoteMint: NATIVE_MINT },
            TRANSFER_HOOK_COUNTER_PROGRAM_ID,
            PublicKey.default
          ),
        "InvalidFeeClaimer"
      );
    });

    it("Accepts a fee claimer with pubkey default when the partner holds no transfer fee authority", async () => {
      const config = await createHookFeeConfig(
        TOKEN_2022_TYPE,
        feeParameters,
        {},
        { quoteMint: NATIVE_MINT },
        TRANSFER_HOOK_COUNTER_PROGRAM_ID,
        PublicKey.default
      );
      expect(getConfig(svm, program, config).feeClaimer.toString()).eq(
        PublicKey.default.toString()
      );
    });

    it("Accepts and stores every migrated transfer fee authority option", async () => {
      for (const migratedTransferFeeAuthorityOption of [
        MigratedTransferFeeAuthorityOption.Immutable,
        MigratedTransferFeeAuthorityOption.RevokeZeroFee,
        MigratedTransferFeeAuthorityOption.Creator,
        MigratedTransferFeeAuthorityOption.Partner,
      ]) {
        const config = await createHookFeeConfig(TOKEN_2022_TYPE, {
          ...feeParameters,
          migratedTransferFeeAuthorityOption,
        });
        expect(
          getConfig(svm, program, config).migratedTransferFeeAuthorityOption
        ).eq(migratedTransferFeeAuthorityOption);
      }
    });

    it("Accepts the maximum basis points", async () => {
      const config = await createHookFeeConfig(TOKEN_2022_TYPE, {
        ...feeParameters,
        transferFeeBasisPoints: MAX_BASE_TRANSFER_FEE_BPS,
      });
      expect(getConfig(svm, program, config).transferFeeBasisPoints).eq(
        MAX_BASE_TRANSFER_FEE_BPS
      );
    });

    it("Rejects this program, SPL Token, and Token-2022 as the hook program", async () => {
      for (const transferHookProgram of [
        program.programId,
        TOKEN_PROGRAM_ID,
        TOKEN_2022_PROGRAM_ID,
      ]) {
        await expectThrowsAsync(
          () =>
            createHookFeeConfig(
              TOKEN_2022_TYPE,
              feeParameters,
              {},
              { quoteMint: NATIVE_MINT },
              transferHookProgram
            ),
          "InvalidTransferHookProgram"
        );
      }
    });
  });

  describe("Quote mint with a transfer fee", () => {
    let feeQuoteMint: PublicKey;

    before(() => {
      feeQuoteMint = createToken2022Mint(svm, admin, {
        transferFeeConfig: {
          feeBasisPoints: 100,
          maximumFee: BigInt(1_000_000),
          transferFeeConfigAuthority: null,
        },
      });
    });

    it("Rejects the fee-bearing quote mint without a badge", async () => {
      await expectThrowsAsync(
        () =>
          createHookFeeConfig(
            TOKEN_2022_TYPE,
            feeParameters,
            {},
            {
              quoteMint: feeQuoteMint,
            }
          ),
        "InvalidQuoteMint"
      );
    });

    it("Accepts the fee-bearing quote mint with a badge", async () => {
      await createTokenBadge(svm, program, {
        operator,
        payer: operator,
        tokenMint: feeQuoteMint,
      });
      const config = await createHookFeeConfig(
        TOKEN_2022_TYPE,
        feeParameters,
        {},
        {
          quoteMint: feeQuoteMint,
          tokenBadge: deriveTokenBadgeAddress(feeQuoteMint),
        }
      );
      expect(getConfig(svm, program, config).quoteMint.toString()).eq(
        feeQuoteMint.toString()
      );
    });

    it("The old endpoint still rejects the badged fee-bearing quote mint", async () => {
      await expectThrowsAsync(
        () =>
          createConfigWithTransferHook(svm, program, {
            payer: partner,
            leftoverReceiver: partner.publicKey,
            feeClaimer: partner.publicKey,
            quoteMint: feeQuoteMint,
            tokenBadge: deriveTokenBadgeAddress(feeQuoteMint),
            instructionParams: buildConfigParameters(TOKEN_2022_TYPE),
            transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
          }),
        "InvalidQuoteMint"
      );
    });

    it("The old endpoint still creates a config without a fee", async () => {
      const config = await createConfigWithTransferHook(svm, program, {
        payer: partner,
        leftoverReceiver: partner.publicKey,
        feeClaimer: partner.publicKey,
        quoteMint: NATIVE_MINT,
        instructionParams: buildConfigParameters(TOKEN_2022_TYPE),
        transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
      });
      expect(getConfig(svm, program, config).transferFeeFlag).eq(0);
    });
  });

  describe("Transfer fee mode", () => {
    describe("Base fee set", () => {
      itIsRestricted(
        () => (overrides) =>
          createHookFeeConfig(TOKEN_2022_TYPE, feeParameters, overrides)
      );
    });

    describe("Badged quote mint with a zero fee and a fee authority", () => {
      let quote: { quoteMint: PublicKey; tokenBadge: PublicKey };
      before(async () => {
        quote = await createBadgedQuoteMint({
          transferFeeConfig: { feeBasisPoints: 0, maximumFee: BigInt(0) },
        });
      });
      itIsRestricted(
        () => (overrides) =>
          createHookFeeConfig(TOKEN_2022_TYPE, null, overrides, quote)
      );
    });

    describe("Badged quote mint with a non-zero immutable fee", () => {
      let quote: { quoteMint: PublicKey; tokenBadge: PublicKey };
      before(async () => {
        quote = await createBadgedQuoteMint({
          transferFeeConfig: {
            feeBasisPoints: 100,
            maximumFee: BigInt(1_000_000),
            transferFeeConfigAuthority: null,
          },
        });
      });
      itIsRestricted(
        () => (overrides) =>
          createHookFeeConfig(TOKEN_2022_TYPE, null, overrides, quote)
      );
    });

    describe("Permissionless quote mint and no base fee", () => {
      itIsNotRestricted(
        () => (overrides) =>
          createHookFeeConfig(TOKEN_2022_TYPE, null, overrides)
      );
    });

    describe("Badged quote mint without TransferFeeConfig and no base fee", () => {
      let quote: { quoteMint: PublicKey; tokenBadge: PublicKey };
      before(async () => {
        quote = await createBadgedQuoteMint({
          permanentDelegate: admin.publicKey,
        });
      });
      itIsNotRestricted(
        () => (overrides) =>
          createHookFeeConfig(TOKEN_2022_TYPE, null, overrides, quote)
      );
    });
  });

  describe("Fee-bearing base mint", () => {
    const HOOK_FEE_MINT_EXTENSIONS = [
      ExtensionType.MetadataPointer,
      ExtensionType.TransferFeeConfig,
      ExtensionType.TransferHook,
      ExtensionType.TokenMetadata,
    ];

    function expectFeeMint(
      baseMint: PublicKey,
      baseVault: PublicKey,
      transferFeeParameters: TransferFeeParameters,
      withheldAuthority: PublicKey
    ) {
      const mintAccount = svm.getAccount(baseMint);
      expect(getMintExtensionTypes(mintAccount.data)).deep.eq(
        HOOK_FEE_MINT_EXTENSIONS
      );

      const mint = unpackMint(
        baseMint,
        { ...mintAccount, data: Buffer.from(mintAccount.data) },
        TOKEN_2022_PROGRAM_ID
      );
      const transferFeeConfig = getTransferFeeConfig(mint);
      const expectedConfigAuthority =
        transferFeeParameters.migratedTransferFeeAuthorityOption ===
        MigratedTransferFeeAuthorityOption.Immutable
          ? PublicKey.default
          : derivePoolAuthority();
      expect(transferFeeConfig.transferFeeConfigAuthority.toString()).eq(
        expectedConfigAuthority.toString()
      );
      expect(transferFeeConfig.withdrawWithheldAuthority.toString()).eq(
        withheldAuthority.toString()
      );
      for (const fee of [
        transferFeeConfig.olderTransferFee,
        transferFeeConfig.newerTransferFee,
      ]) {
        expect(fee.transferFeeBasisPoints).eq(
          transferFeeParameters.transferFeeBasisPoints
        );
        expect(fee.maximumFee.toString()).eq(U64_MAX.toString());
      }
      expect(mint.freezeAuthority).to.be.null;
      expect(mint.mintAuthority).to.be.null;
      expect(mint.decimals).eq(6);

      expect(svm.getAccount(baseVault).data.length).eq(
        getAccountLen([
          ExtensionType.TransferFeeAmount,
          ExtensionType.TransferHookAccount,
        ])
      );
    }

    async function createHookPool(config: PublicKey): Promise<PublicKey> {
      return createPoolWithToken2022TransferHook(svm, program, {
        payer: operator,
        poolCreator,
        quoteMint: NATIVE_MINT,
        config,
        transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
        instructionParams: { name: "fee", symbol: "FEE", uri: "fee.com" },
      });
    }

    it("Creates a pool whose mint pays withheld fees to the creator", async () => {
      const config = await createHookFeeConfig(TOKEN_2022_TYPE, feeParameters);
      const pool = await createHookPool(config);
      const poolState = getVirtualPool(svm, program, pool);
      expectFeeMint(
        poolState.baseMint,
        poolState.baseVault,
        feeParameters,
        poolCreator.publicKey
      );
    });

    it("Creates a mint that keeps the config authority when the fee is zeroed on migration", async () => {
      const zeroFeeOnMigrationParameters = {
        ...feeParameters,
        migratedTransferFeeAuthorityOption:
          MigratedTransferFeeAuthorityOption.RevokeZeroFee,
      };
      const config = await createHookFeeConfig(
        TOKEN_2022_TYPE,
        zeroFeeOnMigrationParameters
      );
      const pool = await createHookPool(config);
      const poolState = getVirtualPool(svm, program, pool);
      expectFeeMint(
        poolState.baseMint,
        poolState.baseVault,
        zeroFeeOnMigrationParameters,
        poolCreator.publicKey
      );
    });

    it("Creates a pool whose mint pays withheld fees to the partner", async () => {
      const partnerFeeParameters = {
        ...feeParameters,
        withheldAuthority: TransferFeeWithheldAuthority.Partner,
      };
      const config = await createHookFeeConfig(
        TOKEN_2022_TYPE,
        partnerFeeParameters
      );
      const pool = await createHookPool(config);
      const poolState = getVirtualPool(svm, program, pool);
      expectFeeMint(
        poolState.baseMint,
        poolState.baseVault,
        partnerFeeParameters,
        partner.publicKey
      );
    });

    it("Creates the extension at zero basis points when an authority survives migration", async () => {
      // Some(0 bps) is not None: the extension exists so the surviving authority
      // can raise the fee later
      const zeroBpsRaisableParameters = {
        transferFeeBasisPoints: 0,
        withheldAuthority: TransferFeeWithheldAuthority.Creator,
        migratedTransferFeeAuthorityOption:
          MigratedTransferFeeAuthorityOption.Creator,
      };
      const config = await createHookFeeConfig(
        TOKEN_2022_TYPE,
        zeroBpsRaisableParameters
      );
      const pool = await createHookPool(config);
      const poolState = getVirtualPool(svm, program, pool);
      expectFeeMint(
        poolState.baseMint,
        poolState.baseVault,
        zeroBpsRaisableParameters,
        poolCreator.publicKey
      );
    });
  });
});
