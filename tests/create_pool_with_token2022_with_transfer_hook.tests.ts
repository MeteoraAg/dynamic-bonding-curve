import {
  ACCOUNT_SIZE,
  ACCOUNT_TYPE_SIZE,
  ExtensionType,
  getExtensionData,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { unpack } from "@solana/spl-token-metadata";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BN } from "@anchor-lang/core";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  BaseFee,
  ClaimCreatorTradeFeeParams,
  claimCreatorTradingFeeWithTransferHook,
  ClaimTradeFeeParams,
  claimTradingFeeWithTransferHook,
  ConfigParameters,
  createOperatorAccount,
  createConfigWithTransferHook,
  CreateConfigWithTransferHookParams,
  createPoolWithToken2022TransferHook,
  swapWithTransferHook,
  SwapMode,
  SwapParams,
  OperatorPermission,
} from "./instructions";
import {
  createVirtualCurveProgram,
  derivePoolAuthority,
  generateAndFund,
  getMint,
  getTokenAccount,
  initializeExtraAccountMetaList,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  startSvm,
  U64_MAX,
} from "./utils";
import { getOrCreateAssociatedTokenAccount } from "./utils/token";
import { getVirtualPool } from "./utils/fetcher";
import { Pool, VirtualCurveProgram } from "./utils/types";
import { TRANSFER_HOOK_COUNTER_PROGRAM_ID } from "./utils/constants";

describe("Create pool with token2022 transfer hook", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let user: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;
  let config: PublicKey;
  let virtualPool: PublicKey;
  let virtualPoolState: Pool;

  before(async () => {
    svm = startSvm();
    admin = generateAndFund(svm);
    operator = generateAndFund(svm);
    partner = generateAndFund(svm);
    user = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    program = createVirtualCurveProgram();

    await createOperatorAccount(svm, program, {
      admin,
      whitelistedAddress: operator.publicKey,
      permissions: [OperatorPermission.ClaimProtocolFee],
    });
  });

  it("Partner create config", async () => {
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
      collectFeeMode: 1, // OutputToken - so referral on QuoteToBase uses base token (with transfer hook)
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
    const params: CreateConfigWithTransferHookParams = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: NATIVE_MINT,
      instructionParams,
      transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
    };
    config = await createConfigWithTransferHook(svm, program, params);
  });

  it("Create token2022 pool with transfer hook", async () => {
    const name = "test token 2022 hook";
    const symbol = "HOOK2022";
    const uri = "hook2022.com";

    virtualPool = await createPoolWithToken2022TransferHook(svm, program, {
      payer: operator,
      poolCreator,
      quoteMint: NATIVE_MINT,
      config,
      transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
      instructionParams: {
        name,
        symbol,
        uri,
      },
    });
    virtualPoolState = getVirtualPool(svm, program, virtualPool);

    // validate metadata
    const tlvData = svm
      .getAccount(virtualPoolState.baseMint)
      .data.slice(ACCOUNT_SIZE + ACCOUNT_TYPE_SIZE);
    const metadata = unpack(
      getExtensionData(ExtensionType.TokenMetadata, Buffer.from(tlvData))
    );
    expect(metadata.name).eq(name);
    expect(metadata.symbol).eq(symbol);
    expect(metadata.uri).eq(uri);
    expect(metadata.updateAuthority.toString()).eq(
      poolCreator.publicKey.toString()
    );

    // validate transfer hook extension
    const transferHookData = getExtensionData(
      ExtensionType.TransferHook,
      Buffer.from(tlvData)
    );
    expect(transferHookData).to.not.be.null;
    const hookAuthority = new PublicKey(transferHookData.subarray(0, 32));
    const hookProgramId = new PublicKey(transferHookData.subarray(32, 64));
    expect(hookProgramId.toString()).eq(
      TRANSFER_HOOK_COUNTER_PROGRAM_ID.toString()
    );
    expect(hookAuthority.toString()).eq(derivePoolAuthority().toString());

    // validate freeze authority
    const baseMintData = getMint(svm, virtualPoolState.baseMint);
    expect(baseMintData.freezeAuthority.toString()).eq(
      PublicKey.default.toString()
    );
    expect(baseMintData.mintAuthorityOption).eq(0);
  });

  it("Initialize extra account meta list for transfer hook", async () => {
    await initializeExtraAccountMetaList(
      svm,
      operator,
      virtualPoolState.baseMint
    );
  });

  it("Swap with referral and transfer hook", async () => {
    const referral = Keypair.generate();
    const referralAta = getOrCreateAssociatedTokenAccount(
      svm,
      user,
      virtualPoolState.baseMint,
      referral.publicKey,
      TOKEN_2022_PROGRAM_ID
    );

    const params: SwapParams = {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: NATIVE_MINT,
      outputTokenMint: virtualPoolState.baseMint,
      amountIn: new BN(LAMPORTS_PER_SOL),
      minimumAmountOut: new BN(0),
      swapMode: SwapMode.ExactIn,
      referralTokenAccount: referralAta,
    };
    await swapWithTransferHook(svm, program, params);

    const referralTokenAccountState = getTokenAccount(svm, referralAta);
    expect(Number(referralTokenAccountState.amount)).to.be.greaterThan(0);
  });

  it("Swap", async () => {
    const params: SwapParams = {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: NATIVE_MINT,
      outputTokenMint: virtualPoolState.baseMint,
      amountIn: new BN(LAMPORTS_PER_SOL * 5.5),
      minimumAmountOut: new BN(0),
      swapMode: SwapMode.PartialFill,
      referralTokenAccount: null,
    };
    await swapWithTransferHook(svm, program, params);
  });

  it("Partner claim trading fee", async () => {
    const claimTradingFeeParams: ClaimTradeFeeParams = {
      feeClaimer: partner,
      pool: virtualPool,
      maxBaseAmount: new BN(U64_MAX),
      maxQuoteAmount: new BN(U64_MAX),
    };
    await claimTradingFeeWithTransferHook(svm, program, claimTradingFeeParams);
  });

  it("Creator claim trading fee", async () => {
    const claimCreatorTradingFeeParams: ClaimCreatorTradeFeeParams = {
      creator: poolCreator,
      pool: virtualPool,
      maxBaseAmount: new BN(U64_MAX),
      maxQuoteAmount: new BN(U64_MAX),
    };
    await claimCreatorTradingFeeWithTransferHook(
      svm,
      program,
      claimCreatorTradingFeeParams
    );
  });
});
