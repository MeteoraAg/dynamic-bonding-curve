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
  createConfigWithTransferHook2,
  createPoolWithToken2022,
  createPoolWithToken2022TransferHook,
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
import { TRANSFER_HOOK_COUNTER_PROGRAM_ID } from "./utils/constants";
import { getConfig, getVirtualPool } from "./utils/fetcher";
import { getMintExtensionTypes } from "./utils/token";
import { VirtualCurveProgram } from "./utils/types";

const MAX_FEE_BPS = 9900;

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
  let partner: Keypair;
  let operator: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;

  const feeParameters: TransferFeeParameters = {
    transferFeeBasisPoints: 100,
    maximumFee: new BN(1_000_000),
    withheldAuthority: WITHHELD_AUTHORITY_CREATOR,
  };

  before(async () => {
    svm = startSvm();
    partner = generateAndFund(svm);
    operator = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    program = createVirtualCurveProgram();
  });

  function createFeeConfig(
    tokenType: number,
    transferFeeParameters: TransferFeeParameters
  ) {
    return createConfig2(svm, program, {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: NATIVE_MINT,
      instructionParams: {
        ...buildConfigParameters(tokenType),
        transferFee: transferFeeParameters,
      },
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
            transferFeeBasisPoints: MAX_FEE_BPS + 1,
          }),
        "InvalidTransferFeeParameters"
      );
    });

    it("Rejects a transfer fee with a zero maximum fee", async () => {
      await expectThrowsAsync(
        () => createFeeConfig(1, { ...feeParameters, maximumFee: new BN(0) }),
        "InvalidTransferFeeParameters"
      );
    });

    it("Rejects an unknown withheld authority", async () => {
      await expectThrowsAsync(
        () => createFeeConfig(1, { ...feeParameters, withheldAuthority: 2 }),
        "InvalidTransferFeeParameters"
      );
    });

    it("Rejects zero basis points with a non-zero maximum fee", async () => {
      await expectThrowsAsync(
        () =>
          createFeeConfig(1, {
            transferFeeBasisPoints: 0,
            maximumFee: new BN(1),
            withheldAuthority: WITHHELD_AUTHORITY_PARTNER,
          }),
        "InvalidTransferFeeParameters"
      );
    });

    it("Accepts the maximum basis points", async () => {
      const config = await createFeeConfig(1, {
        ...feeParameters,
        transferFeeBasisPoints: MAX_FEE_BPS,
      });
      const configState = getConfig(svm, program, config);
      expect(configState.transferFeeBasisPoints).eq(MAX_FEE_BPS);
    });
  });

  describe("Zero fee", () => {
    it("Accepts zero fee on an SPL token config and stores flag 0", async () => {
      const config = await createFeeConfig(0, {
        transferFeeBasisPoints: 0,
        maximumFee: new BN(0),
        withheldAuthority: 5,
      });
      const configState = getConfig(svm, program, config);
      expect(configState.transferFeeBasisPoints).eq(0);
      expect(configState.transferFeeMaximumFee).deep.eq(new Array(8).fill(0));
      expect(configState.transferFeeWithheldAuthority).eq(0);
    });

    it("Zero fee Token2022 config creates a mint without TransferFeeConfig", async () => {
      const config = await createFeeConfig(1, {
        transferFeeBasisPoints: 0,
        maximumFee: new BN(0),
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
        expect(fee.maximumFee.toString()).eq(
          transferFeeParameters.maximumFee.toString()
        );
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
      expect(configState.transferFeeMaximumFee).deep.eq(
        Array.from(feeParameters.maximumFee.toArrayLike(Buffer, "le", 8))
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

    it("Creates a transfer hook pool with a fee-bearing mint", async () => {
      const config = await createConfigWithTransferHook2(svm, program, {
        payer: partner,
        leftoverReceiver: partner.publicKey,
        feeClaimer: partner.publicKey,
        quoteMint: NATIVE_MINT,
        instructionParams: {
          ...buildConfigParameters(1),
          transferFee: feeParameters,
        },
        transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
      });
      const pool = await createPoolWithToken2022TransferHook(svm, program, {
        payer: operator,
        poolCreator,
        quoteMint: NATIVE_MINT,
        config,
        transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
        instructionParams: { name: "hook", symbol: "HOOK", uri: "hook.com" },
      });
      const poolState = getVirtualPool(svm, program, pool);

      const mintAccount = svm.getAccount(poolState.baseMint);
      expect(getMintExtensionTypes(mintAccount.data)).deep.eq([
        ExtensionType.MetadataPointer,
        ExtensionType.TransferFeeConfig,
        ExtensionType.TransferHook,
        ExtensionType.TokenMetadata,
      ]);
      const mint = unpackMint(
        poolState.baseMint,
        { ...mintAccount, data: Buffer.from(mintAccount.data) },
        TOKEN_2022_PROGRAM_ID
      );
      const transferFeeConfig = getTransferFeeConfig(mint);
      expect(transferFeeConfig.transferFeeConfigAuthority.toString()).eq(
        PublicKey.default.toString()
      );
      expect(transferFeeConfig.withdrawWithheldAuthority.toString()).eq(
        poolCreator.publicKey.toString()
      );
      expect(svm.getAccount(poolState.baseVault).data.length).eq(
        getAccountLen([
          ExtensionType.TransferFeeAmount,
          ExtensionType.TransferHookAccount,
        ])
      );
    });
  });
});
