import {
  ACCOUNT_SIZE,
  ACCOUNT_TYPE_SIZE,
  calculateFee,
  ExtensionType,
  getAccountLen,
  getExtensionData,
  getTransferFeeConfig,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  unpackMint,
} from "@solana/spl-token";
import { unpack } from "@solana/spl-token-metadata";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BN } from "@anchor-lang/core";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  BaseFee,
  ClaimCreatorTradeFeeParams,
  claimCreatorTradingFee,
  claimCreatorTradingFee2,
  ClaimTradeFeeParams,
  claimTradingFee,
  claimTradingFee2,
  ConfigParameters,
  createOperatorAccount,
  createConfigWithTransferHook2,
  CreateConfigWithTransferHook2Params,
  createPoolWithToken2022TransferHook,
  swapWithTransferHook,
  SwapMode,
  SwapParams,
  OperatorPermission,
  TransferFeeParameters,
} from "./instructions";
import {
  createVirtualCurveProgram,
  derivePoolAuthority,
  expectThrowsAsync,
  generateAndFund,
  getDbcProgramErrorCodeHexString,
  getMint,
  getTokenAccount,
  getTransferHookCounter,
  initializeExtraAccountMetaList,
  MAX_SQRT_PRICE,
  MigratedCollectFeeMode,
  MIN_SQRT_PRICE,
  startSvm,
  MigratedTransferFeeAuthorityOption,
  TransferFeeWithheldAuthority,
  U64_MAX,
} from "./utils";
import {
  getMintExtensionTypes,
  getOrCreateAssociatedTokenAccount,
} from "./utils/token";
import { getVirtualPool } from "./utils/fetcher";
import { Pool, VirtualCurveProgram } from "./utils/types";
import { TRANSFER_HOOK_COUNTER_PROGRAM_ID } from "./utils/constants";

const CONSTANT_TOKEN_SUPPLY = new BN(2_500_000_000);
const BASE_FEE_BPS = 250; // 2.5%

const feeParameters: TransferFeeParameters = {
  transferFeeBasisPoints: BASE_FEE_BPS,
  withheldAuthority: TransferFeeWithheldAuthority.Creator,
  migratedTransferFeeAuthorityOption:
    MigratedTransferFeeAuthorityOption.Immutable,
};

function excludedBase(amount: bigint): bigint {
  return (
    amount -
    calculateFee(
      {
        epoch: BigInt(0),
        maximumFee: BigInt(U64_MAX.toString()),
        transferFeeBasisPoints: BASE_FEE_BPS,
      },
      amount
    )
  );
}

function balanceOf(svm: LiteSVM, tokenAccount: PublicKey): bigint {
  if (svm.getAccount(tokenAccount) === null) {
    return BigInt(0);
  }
  return getTokenAccount(svm, tokenAccount).amount;
}

describe("Create pool with token2022 transfer hook and transfer fee", () => {
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

  const baseAccountOf = (owner: PublicKey) =>
    getOrCreateAssociatedTokenAccount(
      svm,
      user,
      virtualPoolState.baseMint,
      owner,
      TOKEN_2022_PROGRAM_ID
    );

  async function expectBaseNetPayout(
    recipient: PublicKey,
    action: () => Promise<unknown>
  ) {
    const recipientAccount = baseAccountOf(recipient);
    const preVault = balanceOf(svm, virtualPoolState.baseVault);
    const preRecipient = balanceOf(svm, recipientAccount);
    await action();
    const paid = preVault - balanceOf(svm, virtualPoolState.baseVault);
    expect(paid > BigInt(0)).eq(true);
    expect((balanceOf(svm, recipientAccount) - preRecipient).toString()).eq(
      excludedBase(paid).toString()
    );
  }

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
      migrationFeeOption: 6,
      tokenSupply: {
        preMigrationTokenSupply: CONSTANT_TOKEN_SUPPLY,
        postMigrationTokenSupply: CONSTANT_TOKEN_SUPPLY,
      },
      creatorTradingFeePercentage: 50,
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
    const params: CreateConfigWithTransferHook2Params = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: NATIVE_MINT,
      instructionParams,
      transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
      transferFee: feeParameters,
    };
    config = await createConfigWithTransferHook2(svm, program, params);
  });

  it("Create token2022 pool with transfer hook and transfer fee", async () => {
    const name = "test token 2022 hook fee";
    const symbol = "HOOKFEE";
    const uri = "hookfee.com";

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

    // validate transfer fee extension
    const mintAccount = svm.getAccount(virtualPoolState.baseMint);
    const mint = unpackMint(
      virtualPoolState.baseMint,
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
    expect(transferFeeConfig.newerTransferFee.transferFeeBasisPoints).eq(
      BASE_FEE_BPS
    );

    // validate freeze authority
    const baseMintData = getMint(svm, virtualPoolState.baseMint);
    expect(baseMintData.freezeAuthority.toString()).eq(
      PublicKey.default.toString()
    );
    expect(baseMintData.mintAuthorityOption).eq(0);

    expect(
      getMintExtensionTypes(svm.getAccount(virtualPoolState.baseMint).data)
    ).deep.eq([
      ExtensionType.MetadataPointer,
      ExtensionType.TransferFeeConfig,
      ExtensionType.TransferHook,
      ExtensionType.TokenMetadata,
    ]);
    expect(svm.getAccount(virtualPoolState.baseVault).data.length).eq(
      getAccountLen([
        ExtensionType.TransferFeeAmount,
        ExtensionType.TransferHookAccount,
      ])
    );
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
    const counterBefore = getTransferHookCounter(
      svm,
      virtualPoolState.baseMint
    );
    await swapWithTransferHook(svm, program, params);
    expect(getTransferHookCounter(svm, virtualPoolState.baseMint)).eq(
      counterBefore + 1
    );
  });

  it("Partner claim trading fee", async () => {
    const claimTradingFeeParams: ClaimTradeFeeParams = {
      feeClaimer: partner,
      pool: virtualPool,
      maxBaseAmount: new BN(U64_MAX),
      maxQuoteAmount: new BN(U64_MAX),
    };
    await expectBaseNetPayout(partner.publicKey, () =>
      claimTradingFee2(svm, program, claimTradingFeeParams)
    );
  });

  it("Creator claim trading fee", async () => {
    const claimCreatorTradingFeeParams: ClaimCreatorTradeFeeParams = {
      creator: poolCreator,
      pool: virtualPool,
      maxBaseAmount: new BN(U64_MAX),
      maxQuoteAmount: new BN(U64_MAX),
    };
    await expectBaseNetPayout(poolCreator.publicKey, () =>
      claimCreatorTradingFee2(svm, program, claimCreatorTradingFeeParams)
    );
  });

  it("Partner claim trading fee rejects transfer hook pool", async () => {
    const errorCode = getDbcProgramErrorCodeHexString("PoolTypeMismatch");
    await expectThrowsAsync(async () => {
      await claimTradingFee(svm, program, {
        feeClaimer: partner,
        pool: virtualPool,
        maxBaseAmount: new BN(0),
        maxQuoteAmount: new BN(0),
      });
    }, errorCode);
  });

  it("Creator claim trading fee rejects transfer hook pool", async () => {
    const errorCode = getDbcProgramErrorCodeHexString("PoolTypeMismatch");
    await expectThrowsAsync(async () => {
      await claimCreatorTradingFee(svm, program, {
        creator: poolCreator,
        pool: virtualPool,
        maxBaseAmount: new BN(0),
        maxQuoteAmount: new BN(0),
      });
    }, errorCode);
  });
});
