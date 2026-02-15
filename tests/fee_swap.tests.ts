import { getAssociatedTokenAddressSync, NATIVE_MINT } from "@solana/spl-token";
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
import { Pool, VirtualCurveProgram } from "./utils/types";

describe("Fee Swap test", () => {
  describe("Fee charge on BothToken", () => {
    let svm: LiteSVM;
    let admin: Keypair;
    let partner: Keypair;
    let user: Keypair;
    let operator: Keypair;
    let poolCreator: Keypair;
    let program: VirtualCurveProgram;
    let config: PublicKey;
    let virtualPool: PublicKey;
    let virtualPoolState: Pool;

    before(async () => {
      svm = startSvm();
      admin = generateAndFund(svm);
      partner = generateAndFund(svm);
      user = generateAndFund(svm);
      poolCreator = generateAndFund(svm);
      operator = generateAndFund(svm);
      program = createVirtualCurveProgram();

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
        collectFeeMode: 1, // BothToken
        migrationOption: 0,
        tokenType: 0, // spl_token
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
        poolCreationFee: new BN(0),
        curve: curves,
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
        enableFirstSwapWithMinFee: false,
        compoundingFeeBps: 0,
        migratedPoolBaseFeeMode: 0,
        migratedPoolMarketCapFeeSchedulerParams: null,
      };
      const params: CreateConfigParams<ConfigParameters> = {
        payer: partner,
        leftoverReceiver: partner.publicKey,
        feeClaimer: partner.publicKey,
        quoteMint: NATIVE_MINT,
        instructionParams,
      };
      config = await createConfig(svm, program, params);

      virtualPool = await createPoolWithSplToken(svm, program, {
        poolCreator,
        payer: operator,
        quoteMint: NATIVE_MINT,
        config,
        instructionParams: {
          name: "test token spl",
          symbol: "TEST",
          uri: "abc.com",
        },
      });
    });

    it("Swap Quote to Base", async () => {
      virtualPoolState = getVirtualPool(svm, program, virtualPool);

      // use to validate virtual curve state
      const preBaseReserve = virtualPoolState.baseReserve;
      const preQuoteReserve = virtualPoolState.quoteReserve;
      const preQuoteTradingFee = virtualPoolState.partnerQuoteFee;
      const preBaseTradingFee = virtualPoolState.partnerBaseFee;
      const preQuoteProtocolFee = virtualPoolState.protocolQuoteFee;
      const preBaseProtocolFee = virtualPoolState.protocolBaseFee;

      // use to validate actual balance in vault
      const preBaseVaultBalance =
        getTokenAccount(svm, virtualPoolState.baseVault).amount ?? 0;
      const preQuoteVaultBalance =
        getTokenAccount(svm, virtualPoolState.quoteVault).amount ?? 0;

      const inAmount = LAMPORTS_PER_SOL;
      const params: SwapParams = {
        config,
        payer: user,
        pool: virtualPool,
        inputTokenMint: NATIVE_MINT,
        outputTokenMint: virtualPoolState.baseMint,
        amountIn: new BN(inAmount),
        minimumAmountOut: new BN(0),
        swapMode: SwapMode.ExactIn,
        referralTokenAccount: null,
      };
      await swap(svm, program, params);

      // reload new virtualPoolState
      virtualPoolState = getVirtualPool(svm, program, virtualPool);

      // use to validate virtual curve state
      const postBaseReserve = virtualPoolState.baseReserve;
      const postQuoteReserve = virtualPoolState.quoteReserve;
      const postQuoteTradingFee = virtualPoolState.partnerQuoteFee;
      const postBaseTradingFee = virtualPoolState.partnerBaseFee;
      const postQuoteProtocolFee = virtualPoolState.protocolQuoteFee;
      const postBaseProtocolFee = virtualPoolState.protocolBaseFee;

      // use to validate actual balance in vault
      const postBaseVaultBalance = getTokenAccount(
        svm,
        virtualPoolState.baseVault
      ).amount;
      const postQuoteVaultBalance = getTokenAccount(
        svm,
        virtualPoolState.quoteVault
      ).amount;

      const totalSwapBaseTradingFee = postBaseTradingFee.sub(preBaseTradingFee);
      const totalSwapQuoteTradingFee =
        postQuoteTradingFee.sub(preQuoteTradingFee);

      const totalSwapBaseProtolFee =
        postBaseProtocolFee.sub(preBaseProtocolFee);
      const totalSwapQuoteProtocolFee =
        postQuoteProtocolFee.sub(preQuoteProtocolFee);

      const userBaseTokenAccount = getAssociatedTokenAddressSync(
        virtualPoolState.baseMint,
        user.publicKey
      );
      const userBaseBaseBalance = getTokenAccount(
        svm,
        userBaseTokenAccount
      ).amount;

      // assert virtual state changed
      expect(totalSwapQuoteProtocolFee.toNumber()).eq(0);
      expect(totalSwapQuoteTradingFee.toNumber()).eq(0);
      expect(totalSwapBaseProtolFee.toString()).eq(
        virtualPoolState.protocolBaseFee.toString()
      );
      expect(totalSwapBaseTradingFee.toString()).eq(
        virtualPoolState.partnerBaseFee.toString()
      );
      expect(postQuoteReserve.sub(new BN(inAmount)).toString()).eq(
        preQuoteReserve.toString()
      );

      expect(preBaseReserve.sub(postBaseReserve).toString()).eq(
        new BN(userBaseBaseBalance.toString())
          .add(totalSwapBaseTradingFee)
          .add(totalSwapBaseProtolFee)
          .toString()
      );

      // assert balance vault changed
      expect(Number(postQuoteVaultBalance) - Number(preQuoteVaultBalance)).eq(
        inAmount
      );
      expect(Number(preBaseVaultBalance) - Number(postBaseVaultBalance)).eq(
        Number(userBaseBaseBalance)
      );
      expect(Number(preBaseVaultBalance) - Number(postBaseVaultBalance)).eq(
        preBaseReserve
          .sub(postBaseReserve)
          .sub(totalSwapBaseTradingFee)
          .sub(totalSwapBaseProtolFee)
          .toNumber()
      );
    });

    it("Swap Base to Quote", async () => {
      virtualPoolState = getVirtualPool(svm, program, virtualPool);

      // use to validate virtual curve state
      const preBaseReserve = virtualPoolState.baseReserve;
      const preQuoteReserve = virtualPoolState.quoteReserve;
      const preQuoteTradingFee = virtualPoolState.partnerQuoteFee;
      const preBaseTradingFee = virtualPoolState.partnerBaseFee;
      const preQuoteProtocolFee = virtualPoolState.protocolQuoteFee;
      const preBaseProtocolFee = virtualPoolState.protocolBaseFee;

      // use to validate actual balance in vault
      const preBaseVaultBalance =
        getTokenAccount(svm, virtualPoolState.baseVault).amount ?? 0;
      const preQuoteVaultBalance =
        getTokenAccount(svm, virtualPoolState.quoteVault).amount ?? 0;

      const userBaseTokenAccount = getAssociatedTokenAddressSync(
        virtualPoolState.baseMint,
        user.publicKey
      );
      const preUserBaseBaseBalance = getTokenAccount(svm, userBaseTokenAccount)
        ? getTokenAccount(svm, userBaseTokenAccount).amount
        : 0;

      const inAmount = preUserBaseBaseBalance;
      const params: SwapParams = {
        config,
        payer: user,
        pool: virtualPool,
        inputTokenMint: virtualPoolState.baseMint,
        outputTokenMint: NATIVE_MINT,
        amountIn: new BN(inAmount.toString()),
        minimumAmountOut: new BN(0),
        swapMode: SwapMode.ExactIn,
        referralTokenAccount: null,
      };
      await swap(svm, program, params);

      // reload new virtualPoolState
      virtualPoolState = getVirtualPool(svm, program, virtualPool);

      // use to validate virtual curve state
      const postBaseReserve = virtualPoolState.baseReserve;
      const postQuoteReserve = virtualPoolState.quoteReserve;
      const postQuoteTradingFee = virtualPoolState.partnerQuoteFee;
      const postBaseTradingFee = virtualPoolState.partnerBaseFee;
      const postQuoteProtocolFee = virtualPoolState.protocolQuoteFee;
      const postBaseProtocolFee = virtualPoolState.protocolBaseFee;

      // use to validate actual balance in vault
      const postBaseVaultBalance = getTokenAccount(
        svm,
        virtualPoolState.baseVault
      ).amount;
      const postQuoteVaultBalance = getTokenAccount(
        svm,
        virtualPoolState.quoteVault
      ).amount;

      const totalSwapBaseTradingFee = postBaseTradingFee.sub(preBaseTradingFee);
      const totalSwapQuoteTradingFee =
        postQuoteTradingFee.sub(preQuoteTradingFee);

      const totalSwapBaseProtolFee =
        postBaseProtocolFee.sub(preBaseProtocolFee);
      const totalSwapQuoteProtocolFee =
        postQuoteProtocolFee.sub(preQuoteProtocolFee);

      const postUserBaseBaseBalance = getTokenAccount(
        svm,
        userBaseTokenAccount
      ).amount;

      // assert virtual state changed
      expect(totalSwapQuoteProtocolFee.toString()).eq(
        virtualPoolState.protocolQuoteFee.toString()
      );
      expect(totalSwapQuoteTradingFee.toString()).eq(
        virtualPoolState.partnerQuoteFee.toString()
      );
      expect(totalSwapBaseProtolFee.toNumber()).eq(0);
      expect(totalSwapBaseTradingFee.toNumber()).eq(0);

      expect(postBaseReserve.sub(preBaseReserve).toString()).eq(
        inAmount.toString()
      );

      // assert balance vault changed
      expect(
        (
          Number(preUserBaseBaseBalance) - Number(postUserBaseBaseBalance)
        ).toString()
      ).eq(inAmount.toString());
      expect(
        (Number(postBaseVaultBalance) - Number(preBaseVaultBalance)).toString()
      ).eq(inAmount.toString());
      expect(
        (
          Number(preQuoteVaultBalance) - Number(postQuoteVaultBalance)
        ).toString()
      ).eq(
        preQuoteReserve
          .sub(postQuoteReserve)
          .sub(totalSwapQuoteTradingFee)
          .sub(totalSwapQuoteProtocolFee)
          .toString()
      );
      expect(
        (Number(postBaseVaultBalance) - Number(preBaseVaultBalance)).toString()
      ).eq(inAmount.toString());
    });
  });

  describe("Fee charge on OnlyB token (Quote token)", () => {
    let svm: LiteSVM;
    let admin: Keypair;
    let partner: Keypair;
    let user: Keypair;
    let operator: Keypair;
    let poolCreator: Keypair;
    let program: VirtualCurveProgram;
    let config: PublicKey;
    let virtualPool: PublicKey;
    let virtualPoolState: Pool;

    before(async () => {
      svm = startSvm();
      admin = generateAndFund(svm);
      partner = generateAndFund(svm);
      user = generateAndFund(svm);
      poolCreator = generateAndFund(svm);
      operator = generateAndFund(svm);
      program = createVirtualCurveProgram();

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
        collectFeeMode: 0, // OnlyB - only quote token
        migrationOption: 0,
        tokenType: 0, // spl_token
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
      const params: CreateConfigParams<ConfigParameters> = {
        payer: partner,
        leftoverReceiver: partner.publicKey,
        feeClaimer: partner.publicKey,
        quoteMint: NATIVE_MINT,
        instructionParams,
      };
      config = await createConfig(svm, program, params);

      virtualPool = await createPoolWithSplToken(svm, program, {
        poolCreator,
        payer: operator,
        quoteMint: NATIVE_MINT,
        config,
        instructionParams: {
          name: "test token spl",
          symbol: "TEST",
          uri: "abc.com",
        },
      });
    });

    it("Swap Quote to Base", async () => {
      virtualPoolState = getVirtualPool(svm, program, virtualPool);

      // use to validate virtual curve state
      const preBaseReserve = virtualPoolState.baseReserve;
      const preQuoteReserve = virtualPoolState.quoteReserve;
      const preQuoteTradingFee = virtualPoolState.partnerQuoteFee;
      const preBaseTradingFee = virtualPoolState.partnerBaseFee;
      const preQuoteProtocolFee = virtualPoolState.protocolQuoteFee;
      const preBaseProtocolFee = virtualPoolState.protocolBaseFee;

      // use to validate actual balance in vault
      const preBaseVaultBalance =
        getTokenAccount(svm, virtualPoolState.baseVault).amount ?? 0;
      const preQuoteVaultBalance =
        getTokenAccount(svm, virtualPoolState.quoteVault).amount ?? 0;

      const inAmount = LAMPORTS_PER_SOL;
      const params: SwapParams = {
        config,
        payer: user,
        pool: virtualPool,
        inputTokenMint: NATIVE_MINT,
        outputTokenMint: virtualPoolState.baseMint,
        amountIn: new BN(inAmount),
        minimumAmountOut: new BN(0),
        swapMode: SwapMode.ExactIn,
        referralTokenAccount: null,
      };
      await swap(svm, program, params);

      // reload new virtualPoolState
      virtualPoolState = getVirtualPool(svm, program, virtualPool);

      // use to validate virtual curve state
      const postBaseReserve = virtualPoolState.baseReserve;
      const postQuoteReserve = virtualPoolState.quoteReserve;
      const postQuoteTradingFee = virtualPoolState.partnerQuoteFee;
      const postBaseTradingFee = virtualPoolState.partnerBaseFee;
      const postQuoteProtocolFee = virtualPoolState.protocolQuoteFee;
      const postBaseProtocolFee = virtualPoolState.protocolBaseFee;

      // use to validate actual balance in vault
      const postBaseVaultBalance = getTokenAccount(
        svm,
        virtualPoolState.baseVault
      ).amount;
      const postQuoteVaultBalance = getTokenAccount(
        svm,
        virtualPoolState.quoteVault
      ).amount;

      const totalSwapBaseTradingFee = postBaseTradingFee.sub(preBaseTradingFee);
      const totalSwapQuoteTradingFee =
        postQuoteTradingFee.sub(preQuoteTradingFee);

      const totalSwapBaseProtolFee =
        postBaseProtocolFee.sub(preBaseProtocolFee);
      const totalSwapQuoteProtocolFee =
        postQuoteProtocolFee.sub(preQuoteProtocolFee);

      const userBaseTokenAccount = getAssociatedTokenAddressSync(
        virtualPoolState.baseMint,
        user.publicKey
      );
      const userBaseBaseBalance = getTokenAccount(
        svm,
        userBaseTokenAccount
      ).amount;
      const actualInAmount = new BN(inAmount)
        .sub(totalSwapQuoteProtocolFee)
        .sub(totalSwapQuoteTradingFee);
      // assert virtual state changed
      expect(totalSwapQuoteProtocolFee.toString()).eq(
        virtualPoolState.protocolQuoteFee.toString()
      );
      expect(totalSwapQuoteTradingFee.toString()).eq(
        virtualPoolState.partnerQuoteFee.toString()
      );
      expect(totalSwapBaseProtolFee.toNumber()).eq(0);
      expect(totalSwapBaseTradingFee.toNumber()).eq(0);
      expect(preQuoteReserve.add(actualInAmount).toString()).eq(
        postQuoteReserve.toString()
      );

      expect(preBaseReserve.sub(postBaseReserve).toString()).eq(
        userBaseBaseBalance.toString()
      );

      // assert balance vault changed
      expect(
        (
          Number(postQuoteVaultBalance) - Number(preQuoteVaultBalance)
        ).toString()
      ).eq(inAmount.toString());
      expect(
        (Number(preBaseVaultBalance) - Number(postBaseVaultBalance)).toString()
      ).eq(userBaseBaseBalance.toString());
    });

    it("Swap Base to Quote", async () => {
      virtualPoolState = getVirtualPool(svm, program, virtualPool);

      // use to validate virtual curve state
      const preBaseReserve = virtualPoolState.baseReserve;
      const preQuoteReserve = virtualPoolState.quoteReserve;
      const preQuoteTradingFee = virtualPoolState.partnerQuoteFee;
      const preBaseTradingFee = virtualPoolState.partnerBaseFee;
      const preQuoteProtocolFee = virtualPoolState.protocolQuoteFee;
      const preBaseProtocolFee = virtualPoolState.protocolBaseFee;

      // use to validate actual balance in vault
      const preBaseVaultBalance =
        getTokenAccount(svm, virtualPoolState.baseVault).amount ?? 0;
      const preQuoteVaultBalance =
        getTokenAccount(svm, virtualPoolState.quoteVault).amount ?? 0;

      const userBaseTokenAccount = getAssociatedTokenAddressSync(
        virtualPoolState.baseMint,
        user.publicKey
      );
      const preUserBaseBaseBalance = getTokenAccount(
        svm,
        userBaseTokenAccount
      ).amount;

      const inAmount = preUserBaseBaseBalance;
      const params: SwapParams = {
        config,
        payer: user,
        pool: virtualPool,
        inputTokenMint: virtualPoolState.baseMint,
        outputTokenMint: NATIVE_MINT,
        amountIn: new BN(inAmount.toString()),
        minimumAmountOut: new BN(0),
        swapMode: SwapMode.ExactIn,
        referralTokenAccount: null,
      };
      await swap(svm, program, params);

      // reload new virtualPoolState
      virtualPoolState = getVirtualPool(svm, program, virtualPool);

      // use to validate virtual curve state
      const postBaseReserve = virtualPoolState.baseReserve;
      const postQuoteReserve = virtualPoolState.quoteReserve;
      const postQuoteTradingFee = virtualPoolState.partnerQuoteFee;
      const postBaseTradingFee = virtualPoolState.partnerBaseFee;
      const postQuoteProtocolFee = virtualPoolState.protocolQuoteFee;
      const postBaseProtocolFee = virtualPoolState.protocolBaseFee;

      // use to validate actual balance in vault
      const postBaseVaultBalance = getTokenAccount(
        svm,
        virtualPoolState.baseVault
      ).amount;
      const postQuoteVaultBalance = getTokenAccount(
        svm,
        virtualPoolState.quoteVault
      ).amount;

      const totalSwapBaseTradingFee = postBaseTradingFee.sub(preBaseTradingFee);
      const totalSwapQuoteTradingFee =
        postQuoteTradingFee.sub(preQuoteTradingFee);

      const totalSwapBaseProtolFee =
        postBaseProtocolFee.sub(preBaseProtocolFee);
      const totalSwapQuoteProtocolFee =
        postQuoteProtocolFee.sub(preQuoteProtocolFee);

      const postUserBaseBaseBalance = getTokenAccount(
        svm,
        userBaseTokenAccount
      ).amount;
      expect(totalSwapBaseProtolFee.toNumber()).eq(0);
      expect(totalSwapBaseTradingFee.toNumber()).eq(0);

      expect(postBaseReserve.sub(preBaseReserve).toString()).eq(
        inAmount.toString()
      );

      //   // assert balance vault changed
      expect(
        (
          Number(preUserBaseBaseBalance) - Number(postUserBaseBaseBalance)
        ).toString()
      ).eq(inAmount.toString());
      expect(
        (Number(postBaseVaultBalance) - Number(preBaseVaultBalance)).toString()
      ).eq(inAmount.toString());
      expect(
        (
          Number(preQuoteVaultBalance) - Number(postQuoteVaultBalance)
        ).toString()
      ).eq(
        preQuoteReserve
          .sub(postQuoteReserve)
          .sub(totalSwapQuoteTradingFee)
          .sub(totalSwapQuoteProtocolFee)
          .toString()
      );
      expect(
        (Number(postBaseVaultBalance) - Number(preBaseVaultBalance)).toString()
      ).eq(inAmount.toString());
    });
  });
});
