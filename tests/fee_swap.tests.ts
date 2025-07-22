import { BN } from "bn.js";
import { ProgramTestContext } from "solana-bankrun";
import {
  BaseFee,
  ConfigParameters,
  createConfig,
  CreateConfigParams,
  createPoolWithSplToken,
  swap,
  SwapParams,
} from "./instructions";
import { Pool, VirtualCurveProgram } from "./utils/types";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { fundSol, getTokenAccount, startTest } from "./utils";
import {
  createVirtualCurveProgram,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  U64_MAX,
} from "./utils";
import { getVirtualPool } from "./utils/fetcher";
import { getAssociatedTokenAddressSync, NATIVE_MINT } from "@solana/spl-token";
import { expect } from "chai";

describe("Fee Swap test", () => {
  describe("Fee charge on BothToken", () => {
    let context: ProgramTestContext;
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
      context = await startTest();
      admin = context.payer;
      partner = Keypair.generate();
      user = Keypair.generate();
      poolCreator = Keypair.generate();
      operator = Keypair.generate();
      const receivers = [
        partner.publicKey,
        user.publicKey,
        poolCreator.publicKey,
        operator.publicKey,
      ];
      await fundSol(context.banksClient, admin, receivers);
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
        partnerLpPercentage: 0,
        creatorLpPercentage: 0,
        partnerLockedLpPercentage: 95,
        creatorLockedLpPercentage: 5,
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
        padding: [],
        curve: curves,
      };
      const params: CreateConfigParams = {
        payer: partner,
        leftoverReceiver: partner.publicKey,
        feeClaimer: partner.publicKey,
        quoteMint: NATIVE_MINT,
        instructionParams,
      };
      config = await createConfig(context.banksClient, program, params);

      virtualPool = await createPoolWithSplToken(context.banksClient, program, {
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
      virtualPoolState = await getVirtualPool(
        context.banksClient,
        program,
        virtualPool
      );

      // use to validate virtual curve state
      const preBaseReserve = virtualPoolState.baseReserve;
      const preQuoteReserve = virtualPoolState.quoteReserve;
      const preQuoteTradingFee = virtualPoolState.partnerQuoteFee;
      const preBaseTradingFee = virtualPoolState.partnerBaseFee;
      const preQuoteProtocolFee = virtualPoolState.protocolQuoteFee;
      const preBaseProtocolFee = virtualPoolState.protocolBaseFee;

      // use to validate actual balance in vault
      const preBaseVaultBalance =
        (await getTokenAccount(context.banksClient, virtualPoolState.baseVault))
          .amount ?? 0;
      const preQuoteVaultBalance =
        (
          await getTokenAccount(
            context.banksClient,
            virtualPoolState.quoteVault
          )
        ).amount ?? 0;

      const inAmount = LAMPORTS_PER_SOL;
      const params: SwapParams = {
        config,
        payer: user,
        pool: virtualPool,
        inputTokenMint: NATIVE_MINT,
        outputTokenMint: virtualPoolState.baseMint,
        amountIn: new BN(inAmount),
        minimumAmountOut: new BN(0),
        referralTokenAccount: null,
      };
      await swap(context.banksClient, program, params);

      // reload new virtualPoolState
      virtualPoolState = await getVirtualPool(
        context.banksClient,
        program,
        virtualPool
      );

      // use to validate virtual curve state
      const postBaseReserve = virtualPoolState.baseReserve;
      const postQuoteReserve = virtualPoolState.quoteReserve;
      const postQuoteTradingFee = virtualPoolState.partnerQuoteFee;
      const postBaseTradingFee = virtualPoolState.partnerBaseFee;
      const postQuoteProtocolFee = virtualPoolState.protocolQuoteFee;
      const postBaseProtocolFee = virtualPoolState.protocolBaseFee;

      // use to validate actual balance in vault
      const postBaseVaultBalance = (
        await getTokenAccount(context.banksClient, virtualPoolState.baseVault)
      ).amount;
      const postQuoteVaultBalance = (
        await getTokenAccount(context.banksClient, virtualPoolState.quoteVault)
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
      const userBaseBaseBalance = (
        await getTokenAccount(context.banksClient, userBaseTokenAccount)
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
      virtualPoolState = await getVirtualPool(
        context.banksClient,
        program,
        virtualPool
      );

      // use to validate virtual curve state
      const preBaseReserve = virtualPoolState.baseReserve;
      const preQuoteReserve = virtualPoolState.quoteReserve;
      const preQuoteTradingFee = virtualPoolState.partnerQuoteFee;
      const preBaseTradingFee = virtualPoolState.partnerBaseFee;
      const preQuoteProtocolFee = virtualPoolState.protocolQuoteFee;
      const preBaseProtocolFee = virtualPoolState.protocolBaseFee;

      // use to validate actual balance in vault
      const preBaseVaultBalance =
        (await getTokenAccount(context.banksClient, virtualPoolState.baseVault))
          .amount ?? 0;
      const preQuoteVaultBalance =
        (
          await getTokenAccount(
            context.banksClient,
            virtualPoolState.quoteVault
          )
        ).amount ?? 0;

      const userBaseTokenAccount = getAssociatedTokenAddressSync(
        virtualPoolState.baseMint,
        user.publicKey
      );
      const preUserBaseBaseBalance = (
        await getTokenAccount(context.banksClient, userBaseTokenAccount)
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
        referralTokenAccount: null,
      };
      await swap(context.banksClient, program, params);

      // reload new virtualPoolState
      virtualPoolState = await getVirtualPool(
        context.banksClient,
        program,
        virtualPool
      );

      // use to validate virtual curve state
      const postBaseReserve = virtualPoolState.baseReserve;
      const postQuoteReserve = virtualPoolState.quoteReserve;
      const postQuoteTradingFee = virtualPoolState.partnerQuoteFee;
      const postBaseTradingFee = virtualPoolState.partnerBaseFee;
      const postQuoteProtocolFee = virtualPoolState.protocolQuoteFee;
      const postBaseProtocolFee = virtualPoolState.protocolBaseFee;

      // use to validate actual balance in vault
      const postBaseVaultBalance = (
        await getTokenAccount(context.banksClient, virtualPoolState.baseVault)
      ).amount;
      const postQuoteVaultBalance = (
        await getTokenAccount(context.banksClient, virtualPoolState.quoteVault)
      ).amount;

      const totalSwapBaseTradingFee = postBaseTradingFee.sub(preBaseTradingFee);
      const totalSwapQuoteTradingFee =
        postQuoteTradingFee.sub(preQuoteTradingFee);

      const totalSwapBaseProtolFee =
        postBaseProtocolFee.sub(preBaseProtocolFee);
      const totalSwapQuoteProtocolFee =
        postQuoteProtocolFee.sub(preQuoteProtocolFee);

      const postUserBaseBaseBalance = (
        await getTokenAccount(context.banksClient, userBaseTokenAccount)
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
    let context: ProgramTestContext;
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
      context = await startTest();
      admin = context.payer;
      partner = Keypair.generate();
      user = Keypair.generate();
      poolCreator = Keypair.generate();
      operator = Keypair.generate();

      const receivers = [
        partner.publicKey,
        user.publicKey,
        poolCreator.publicKey,
        operator.publicKey,
      ];
      await fundSol(context.banksClient, admin, receivers);
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
        partnerLpPercentage: 0,
        creatorLpPercentage: 0,
        partnerLockedLpPercentage: 95,
        creatorLockedLpPercentage: 5,
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
        padding: [],
        curve: curves,
      };
      const params: CreateConfigParams = {
        payer: partner,
        leftoverReceiver: partner.publicKey,
        feeClaimer: partner.publicKey,
        quoteMint: NATIVE_MINT,
        instructionParams,
      };
      config = await createConfig(context.banksClient, program, params);

      virtualPool = await createPoolWithSplToken(context.banksClient, program, {
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
      virtualPoolState = await getVirtualPool(
        context.banksClient,
        program,
        virtualPool
      );

      // use to validate virtual curve state
      const preBaseReserve = virtualPoolState.baseReserve;
      const preQuoteReserve = virtualPoolState.quoteReserve;
      const preQuoteTradingFee = virtualPoolState.partnerQuoteFee;
      const preBaseTradingFee = virtualPoolState.partnerBaseFee;
      const preQuoteProtocolFee = virtualPoolState.protocolQuoteFee;
      const preBaseProtocolFee = virtualPoolState.protocolBaseFee;

      // use to validate actual balance in vault
      const preBaseVaultBalance =
        (await getTokenAccount(context.banksClient, virtualPoolState.baseVault))
          .amount ?? 0;
      const preQuoteVaultBalance =
        (
          await getTokenAccount(
            context.banksClient,
            virtualPoolState.quoteVault
          )
        ).amount ?? 0;

      const inAmount = LAMPORTS_PER_SOL;
      const params: SwapParams = {
        config,
        payer: user,
        pool: virtualPool,
        inputTokenMint: NATIVE_MINT,
        outputTokenMint: virtualPoolState.baseMint,
        amountIn: new BN(inAmount),
        minimumAmountOut: new BN(0),
        referralTokenAccount: null,
      };
      await swap(context.banksClient, program, params);

      // reload new virtualPoolState
      virtualPoolState = await getVirtualPool(
        context.banksClient,
        program,
        virtualPool
      );

      // use to validate virtual curve state
      const postBaseReserve = virtualPoolState.baseReserve;
      const postQuoteReserve = virtualPoolState.quoteReserve;
      const postQuoteTradingFee = virtualPoolState.partnerQuoteFee;
      const postBaseTradingFee = virtualPoolState.partnerBaseFee;
      const postQuoteProtocolFee = virtualPoolState.protocolQuoteFee;
      const postBaseProtocolFee = virtualPoolState.protocolBaseFee;

      // use to validate actual balance in vault
      const postBaseVaultBalance = (
        await getTokenAccount(context.banksClient, virtualPoolState.baseVault)
      ).amount;
      const postQuoteVaultBalance = (
        await getTokenAccount(context.banksClient, virtualPoolState.quoteVault)
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
      const userBaseBaseBalance = (
        await getTokenAccount(context.banksClient, userBaseTokenAccount)
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
      virtualPoolState = await getVirtualPool(
        context.banksClient,
        program,
        virtualPool
      );

      // use to validate virtual curve state
      const preBaseReserve = virtualPoolState.baseReserve;
      const preQuoteReserve = virtualPoolState.quoteReserve;
      const preQuoteTradingFee = virtualPoolState.partnerQuoteFee;
      const preBaseTradingFee = virtualPoolState.partnerBaseFee;
      const preQuoteProtocolFee = virtualPoolState.protocolQuoteFee;
      const preBaseProtocolFee = virtualPoolState.protocolBaseFee;

      // use to validate actual balance in vault
      const preBaseVaultBalance =
        (await getTokenAccount(context.banksClient, virtualPoolState.baseVault))
          .amount ?? 0;
      const preQuoteVaultBalance =
        (
          await getTokenAccount(
            context.banksClient,
            virtualPoolState.quoteVault
          )
        ).amount ?? 0;

      const userBaseTokenAccount = getAssociatedTokenAddressSync(
        virtualPoolState.baseMint,
        user.publicKey
      );
      const preUserBaseBaseBalance = (
        await getTokenAccount(context.banksClient, userBaseTokenAccount)
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
        referralTokenAccount: null,
      };
      await swap(context.banksClient, program, params);

      // reload new virtualPoolState
      virtualPoolState = await getVirtualPool(
        context.banksClient,
        program,
        virtualPool
      );

      // use to validate virtual curve state
      const postBaseReserve = virtualPoolState.baseReserve;
      const postQuoteReserve = virtualPoolState.quoteReserve;
      const postQuoteTradingFee = virtualPoolState.partnerQuoteFee;
      const postBaseTradingFee = virtualPoolState.partnerBaseFee;
      const postQuoteProtocolFee = virtualPoolState.protocolQuoteFee;
      const postBaseProtocolFee = virtualPoolState.protocolBaseFee;

      // use to validate actual balance in vault
      const postBaseVaultBalance = (
        await getTokenAccount(context.banksClient, virtualPoolState.baseVault)
      ).amount;
      const postQuoteVaultBalance = (
        await getTokenAccount(context.banksClient, virtualPoolState.quoteVault)
      ).amount;

      const totalSwapBaseTradingFee = postBaseTradingFee.sub(preBaseTradingFee);
      const totalSwapQuoteTradingFee =
        postQuoteTradingFee.sub(preQuoteTradingFee);

      const totalSwapBaseProtolFee =
        postBaseProtocolFee.sub(preBaseProtocolFee);
      const totalSwapQuoteProtocolFee =
        postQuoteProtocolFee.sub(preQuoteProtocolFee);

      const postUserBaseBaseBalance = (
        await getTokenAccount(context.banksClient, userBaseTokenAccount)
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
