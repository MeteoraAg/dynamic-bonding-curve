import {
  ACCOUNT_SIZE,
  ExtensionType,
  getAccountLen,
  getTransferFeeConfig,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  unpackMint,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  BaseFee,
  ConfigParameters,
  createConfig2,
  createOperatorAccount,
  createPoolWithToken2022,
  createTokenBadge,
  OperatorPermission,
  TransferFeeParameters,
} from "./instructions";
import {
  createVirtualCurveProgram,
  expectThrowsAsync,
  generateAndFund,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  startSvm,
  U64_MAX,
} from "./utils";
import { deriveTokenBadgeAddress } from "./utils/accounts";
import { getConfig, getVirtualPool } from "./utils/fetcher";
import { createToken2022Mint, getMintExtensionTypes } from "./utils/token";
import { VirtualCurveProgram } from "./utils/types";

const MAX_BASE_TRANSFER_FEE_BPS = 1000;
// in transfer fee mode create_config2 requires a fixed supply and a customizable migrated pool
const PRE_MIGRATION_TOKEN_SUPPLY = new BN(2_500_000_000);
const POST_MIGRATION_TOKEN_SUPPLY = new BN(2_200_000_000);
const CUSTOMIZABLE_MIGRATION_FEE_OPTION = 6;
const LOCKED_VESTING = {
  amountPerPeriod: new BN(1_000_000),
  cliffDurationFromMigrationTime: new BN(0),
  frequency: new BN(1),
  numberOfPeriod: new BN(10),
  cliffUnlockAmount: new BN(1_000_000_000),
};
const FIXED_MIGRATION_FEE_OPTIONS = [0, 1, 2, 3, 4, 5];

// 0 partner (fee claimer), 1 creator
const WITHHELD_AUTHORITY_PARTNER = 0;
const WITHHELD_AUTHORITY_CREATOR = 1;

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
      postMigrationTokenSupply: POST_MIGRATION_TOKEN_SUPPLY,
    },
    creatorTradingFeePercentage: 0,
    tokenUpdateAuthority: 0,
    migrationFee: {
      feePercentage: 0,
      creatorFeePercentage: 0,
    },
    migratedPoolFee: {
      collectFeeMode: 0,
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

describe("Create config2", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let partner: Keypair;
  let operator: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;

  const feeParameters: TransferFeeParameters = {
    transferFeeBasisPoints: 100,
    withheldAuthority: WITHHELD_AUTHORITY_CREATOR,
  };
  const zeroFeeParameters: TransferFeeParameters = {
    transferFeeBasisPoints: 0,
    withheldAuthority: WITHHELD_AUTHORITY_PARTNER,
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

  function createFeeConfig(
    tokenType: number,
    transferFeeParameters: TransferFeeParameters,
    overrides: Partial<ConfigParameters> = {},
    quote: { quoteMint: PublicKey; tokenBadge?: PublicKey } = {
      quoteMint: NATIVE_MINT,
    }
  ) {
    return createConfig2(svm, program, {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: quote.quoteMint,
      tokenBadge: quote.tokenBadge,
      instructionParams: { ...buildConfigParameters(tokenType), ...overrides },
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
        () => create()({ lockedVesting: LOCKED_VESTING }),
        "InvalidVestingParameters"
      );
    });

    it("Accepts a fixed supply with a customizable migrated pool", async () => {
      const config = await create()({});
      const configState = getConfig(svm, program, config);
      expect(configState.fixedTokenSupplyFlag).eq(1);
      expect(configState.migrationFeeOption).eq(
        CUSTOMIZABLE_MIGRATION_FEE_OPTION
      );
    });
  }

  function itIsNotRestricted(create: () => CreateWithOverrides) {
    it("Accepts a non-fixed token supply", async () => {
      const config = await create()({ tokenSupply: null });
      expect(getConfig(svm, program, config).fixedTokenSupplyFlag).eq(0);
    });

    it("Accepts a fixed migration fee option", async () => {
      const config = await create()({
        migrationFeeOption: 0,
        migratedPoolFee: noMigratedPoolFee,
      });
      expect(getConfig(svm, program, config).migrationFeeOption).eq(0);
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

  describe("Validation", () => {
    it("Rejects a transfer fee on an SPL token config", async () => {
      await expectThrowsAsync(
        () => createFeeConfig(0, feeParameters),
        "InvalidTokenType"
      );
    });

    it("Rejects basis points above the maximum", async () => {
      await expectThrowsAsync(
        () =>
          createFeeConfig(1, {
            ...feeParameters,
            transferFeeBasisPoints: MAX_BASE_TRANSFER_FEE_BPS + 1,
          }),
        "InvalidTransferFeeParameters"
      );
    });

    it("Rejects an unknown withheld authority", async () => {
      await expectThrowsAsync(
        () => createFeeConfig(1, { ...feeParameters, withheldAuthority: 2 }),
        "InvalidTransferFeeParameters"
      );
    });

    it("Rejects zero basis points with a non-zero withheld authority", async () => {
      await expectThrowsAsync(
        () =>
          createFeeConfig(1, {
            transferFeeBasisPoints: 0,
            withheldAuthority: WITHHELD_AUTHORITY_CREATOR,
          }),
        "InvalidTransferFeeParameters"
      );
    });

    it("Accepts the maximum basis points", async () => {
      const config = await createFeeConfig(1, {
        ...feeParameters,
        transferFeeBasisPoints: MAX_BASE_TRANSFER_FEE_BPS,
      });
      const configState = getConfig(svm, program, config);
      expect(configState.transferFeeBasisPoints).eq(MAX_BASE_TRANSFER_FEE_BPS);
    });
  });

  describe("Zero fee", () => {
    it("Accepts zero fee on an SPL token config", async () => {
      const config = await createFeeConfig(0, {
        transferFeeBasisPoints: 0,
        withheldAuthority: WITHHELD_AUTHORITY_PARTNER,
      });
      const configState = getConfig(svm, program, config);
      expect(configState.transferFeeBasisPoints).eq(0);
      expect(configState.transferFeeWithheldAuthority).eq(0);
    });

    it("Zero fee Token2022 config creates a mint without TransferFeeConfig", async () => {
      const config = await createFeeConfig(1, {
        transferFeeBasisPoints: 0,
        withheldAuthority: WITHHELD_AUTHORITY_PARTNER,
      });
      const pool = await createPoolWithToken2022(svm, program, {
        payer: operator,
        poolCreator,
        quoteMint: NATIVE_MINT,
        config,
        instructionParams: { name: "zero", symbol: "ZERO", uri: "zero.com" },
      });
      const poolState = getVirtualPool(svm, program, pool);

      expect(
        getMintExtensionTypes(svm.getAccount(poolState.baseMint).data)
      ).deep.eq([ExtensionType.MetadataPointer, ExtensionType.TokenMetadata]);
      expect(svm.getAccount(poolState.baseVault).data.length).eq(ACCOUNT_SIZE);
    });
  });

  describe("Transfer fee mode", () => {
    describe("Base fee set", () => {
      itIsRestricted(
        () => (overrides) => createFeeConfig(1, feeParameters, overrides)
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
          createFeeConfig(1, zeroFeeParameters, overrides, quote)
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
          createFeeConfig(1, zeroFeeParameters, overrides, quote)
      );
    });

    describe("SPL quote mint and no base fee", () => {
      itIsNotRestricted(
        () => (overrides) => createFeeConfig(0, zeroFeeParameters, overrides)
      );
    });

    describe("Permissionless Token2022 quote mint with a zero immutable fee and no base fee", () => {
      let quoteMint: PublicKey;
      before(() => {
        quoteMint = createToken2022Mint(svm, admin, {
          transferFeeConfig: {
            feeBasisPoints: 0,
            maximumFee: BigInt(0),
            transferFeeConfigAuthority: null,
          },
        });
      });
      itIsNotRestricted(
        () => (overrides) =>
          createFeeConfig(1, zeroFeeParameters, overrides, { quoteMint })
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
          createFeeConfig(1, zeroFeeParameters, overrides, quote)
      );
    });
  });

  describe("Fee-bearing base mint", () => {
    function expectFeeMint(
      baseMint: PublicKey,
      baseVault: PublicKey,
      transferFeeParameters: TransferFeeParameters,
      withheldAuthority: PublicKey,
      extensionTypes: ExtensionType[]
    ) {
      const mintAccount = svm.getAccount(baseMint);
      expect(getMintExtensionTypes(mintAccount.data)).deep.eq(extensionTypes);

      const mint = unpackMint(
        baseMint,
        { ...mintAccount, data: Buffer.from(mintAccount.data) },
        TOKEN_2022_PROGRAM_ID
      );
      const transferFeeConfig = getTransferFeeConfig(mint);
      expect(transferFeeConfig.transferFeeConfigAuthority.toString()).eq(
        PublicKey.default.toString()
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
        getAccountLen([ExtensionType.TransferFeeAmount])
      );
    }

    it("Stores the fee parameters on the config", async () => {
      const config = await createFeeConfig(1, feeParameters);
      const configState = getConfig(svm, program, config);
      expect(configState.transferFeeBasisPoints).eq(
        feeParameters.transferFeeBasisPoints
      );
      expect(configState.transferFeeWithheldAuthority).eq(
        feeParameters.withheldAuthority
      );
    });

    it("Creates a pool whose mint pays withheld fees to the creator", async () => {
      const config = await createFeeConfig(1, feeParameters);
      const pool = await createPoolWithToken2022(svm, program, {
        payer: operator,
        poolCreator,
        quoteMint: NATIVE_MINT,
        config,
        instructionParams: { name: "fee", symbol: "FEE", uri: "fee.com" },
      });
      const poolState = getVirtualPool(svm, program, pool);
      expectFeeMint(
        poolState.baseMint,
        poolState.baseVault,
        feeParameters,
        poolCreator.publicKey,
        [
          ExtensionType.MetadataPointer,
          ExtensionType.TransferFeeConfig,
          ExtensionType.TokenMetadata,
        ]
      );
    });

    it("Creates a pool whose mint pays withheld fees to the partner", async () => {
      const partnerFeeParameters = {
        ...feeParameters,
        withheldAuthority: WITHHELD_AUTHORITY_PARTNER,
      };
      const config = await createFeeConfig(1, partnerFeeParameters);
      const pool = await createPoolWithToken2022(svm, program, {
        payer: operator,
        poolCreator,
        quoteMint: NATIVE_MINT,
        config,
        instructionParams: { name: "fee", symbol: "FEE", uri: "fee.com" },
      });
      const poolState = getVirtualPool(svm, program, pool);
      expectFeeMint(
        poolState.baseMint,
        poolState.baseVault,
        partnerFeeParameters,
        partner.publicKey,
        [
          ExtensionType.MetadataPointer,
          ExtensionType.TransferFeeConfig,
          ExtensionType.TokenMetadata,
        ]
      );
    });
  });
});
