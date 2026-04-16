import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import { BN } from "@anchor-lang/core";
import {
  BaseFee,
  ConfigParameters,
  createConfig,
  InitializePoolParameters,
} from "./instructions";
import {
  createTransferHookCounterProgram,
  createVirtualCurveProgram,
  deriveCounterAccount,
  deriveExtraAccountMetaList,
  derivePoolAddress,
  derivePoolAuthority,
  deriveTokenVaultAddress,
  FEE_DENOMINATOR,
  generateAndFund,
  getVirtualPool,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  sendTransactionMaybeThrow,
  startSvm,
  U64_MAX,
} from "./utils";
import {
  AccountsType,
  TransferHookAccountsInfo,
  VirtualCurveProgram,
} from "./utils/types";
import { TRANSFER_HOOK_COUNTER_PROGRAM_ID } from "./utils/constants";

import { expect } from "chai";
import { LiteSVM } from "litesvm";
import { wrapSOL } from "./utils/token";

describe("First swap with transfer hook", () => {
  let svm: LiteSVM;
  let partner: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;

  beforeEach(async () => {
    svm = startSvm();
    partner = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    program = createVirtualCurveProgram();

    await wrapSOL(svm, poolCreator, new BN(LAMPORTS_PER_SOL * 10));
    await wrapSOL(svm, partner, new BN(LAMPORTS_PER_SOL * 10));
  });

  it("Charge min fee for bundled swap ix", async () => {
    const {
      baseMintKP,
      initPoolIx,
      pool,
      config,
      cliffFeeNumerator,
      endFeeNumerator,
    } = await createInitializePoolWithTransferHookIx(
      partner,
      poolCreator,
      svm,
      program
    );

    const baseMint = baseMintKP.publicKey;

    const extraAccountMetaList = deriveExtraAccountMetaList(baseMint);
    const counterAccount = deriveCounterAccount(baseMint);
    const transferHookProgram = createTransferHookCounterProgram();

    const initExtraAccountMetaListIx = await transferHookProgram.methods
      .initializeExtraAccountMetaList()
      .accountsPartial({
        payer: poolCreator.publicKey,
        extraAccountMetaList,
        mint: baseMint,
        counterAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const transferHookRemainingAccounts = [
      { pubkey: extraAccountMetaList, isSigner: false, isWritable: false },
      { pubkey: counterAccount, isSigner: false, isWritable: true },
      {
        pubkey: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
    ];

    const transferHookAccountsInfo: TransferHookAccountsInfo = {
      slices: [
        {
          accountsType: AccountsType.TransferHookBase,
          length: transferHookRemainingAccounts.length,
        },
      ],
    };

    const amountIn = new BN(LAMPORTS_PER_SOL);
    const firstSwapIxs = await createSwapIx(
      pool,
      poolCreator.publicKey,
      program,
      amountIn,
      config,
      baseMint,
      NATIVE_MINT,
      transferHookAccountsInfo,
      transferHookRemainingAccounts
    );

    // bundle initPool + initExtraAccountsMetaList + firstSwap
    const initPoolAndFirstSwapTx = new Transaction().add(
      initPoolIx,
      initExtraAccountMetaListIx,
      ...firstSwapIxs
    );

    sendTransactionMaybeThrow(svm, initPoolAndFirstSwapTx, [
      poolCreator,
      baseMintKP,
    ]);

    // bundled swap should charge the end fee (min fee)
    const expectedFee = amountIn.mul(endFeeNumerator).div(FEE_DENOMINATOR);
    const poolState = getVirtualPool(svm, program, pool);

    const totalTradingFee0 = poolState.metrics.totalProtocolQuoteFee.add(
      poolState.metrics.totalTradingQuoteFee
    );

    expect(totalTradingFee0.eq(expectedFee)).to.be.true;

    // second swap (not bundled) should charge the cliff fee
    const secondSwapIxs = await createSwapIx(
      pool,
      poolCreator.publicKey,
      program,
      amountIn,
      config,
      baseMint,
      NATIVE_MINT,
      transferHookAccountsInfo,
      transferHookRemainingAccounts
    );
    const secondSwapTx = new Transaction().add(...secondSwapIxs);

    sendTransactionMaybeThrow(svm, secondSwapTx, [poolCreator]);

    const expectedFee2 = amountIn.mul(cliffFeeNumerator).div(FEE_DENOMINATOR);
    const poolState2 = getVirtualPool(svm, program, pool);
    const totalTradingFee2 = poolState2.metrics.totalProtocolQuoteFee.add(
      poolState2.metrics.totalTradingQuoteFee
    );

    const totalFeeCharged = totalTradingFee2.sub(totalTradingFee0);
    expect(totalFeeCharged.eq(expectedFee2)).to.be.true;
  });

  it("Charge cliff fee if no sysvar instruction passed in", async () => {
    const { baseMintKP, initPoolIx, pool, config, cliffFeeNumerator } =
      await createInitializePoolWithTransferHookIx(
        partner,
        poolCreator,
        svm,
        program
      );

    const baseMint = baseMintKP.publicKey;

    const extraAccountMetaList = deriveExtraAccountMetaList(baseMint);
    const counterAccount = deriveCounterAccount(baseMint);
    const transferHookProgram = createTransferHookCounterProgram();

    const initExtraAccountMetaListIx = await transferHookProgram.methods
      .initializeExtraAccountMetaList()
      .accountsPartial({
        payer: poolCreator.publicKey,
        extraAccountMetaList,
        mint: baseMint,
        counterAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const transferHookRemainingAccounts = [
      { pubkey: extraAccountMetaList, isSigner: false, isWritable: false },
      { pubkey: counterAccount, isSigner: false, isWritable: true },
      {
        pubkey: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
    ];

    const transferHookAccountsInfo: TransferHookAccountsInfo = {
      slices: [
        {
          accountsType: AccountsType.TransferHookBase,
          length: transferHookRemainingAccounts.length,
        },
      ],
    };

    const amountIn = new BN(LAMPORTS_PER_SOL);
    const swapIxs = await createSwapIx(
      pool,
      poolCreator.publicKey,
      program,
      amountIn,
      config,
      baseMint,
      NATIVE_MINT,
      transferHookAccountsInfo,
      transferHookRemainingAccounts,
      false
    );

    const tx = new Transaction().add(
      initPoolIx,
      initExtraAccountMetaListIx,
      ...swapIxs
    );

    sendTransactionMaybeThrow(svm, tx, [poolCreator, baseMintKP]);

    const expectedFee = amountIn.mul(cliffFeeNumerator).div(FEE_DENOMINATOR);
    const poolState = getVirtualPool(svm, program, pool);

    const totalTradingFee = poolState.metrics.totalProtocolQuoteFee.add(
      poolState.metrics.totalTradingQuoteFee
    );

    expect(totalTradingFee.eq(expectedFee)).to.be.true;
  });
});

async function createSwapIx(
  pool: PublicKey,
  user: PublicKey,
  program: VirtualCurveProgram,
  amountIn: BN,
  config: PublicKey,
  baseMint: PublicKey,
  quoteMint: PublicKey,
  transferHookAccountsInfo: TransferHookAccountsInfo,
  transferHookAccounts: {
    pubkey: PublicKey;
    isSigner: boolean;
    isWritable: boolean;
  }[],
  includeSysvar: boolean = true
) {
  const poolAuthority = derivePoolAuthority();
  const inputTokenAccount = getAssociatedTokenAddressSync(quoteMint, user);
  const outputTokenAccount = getAssociatedTokenAddressSync(
    baseMint,
    user,
    true,
    TOKEN_2022_PROGRAM_ID
  );
  const baseVault = deriveTokenVaultAddress(baseMint, pool);
  const quoteVault = deriveTokenVaultAddress(quoteMint, pool);

  const createInputAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    user,
    inputTokenAccount,
    user,
    quoteMint
  );

  const createOutputAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    user,
    outputTokenAccount,
    user,
    baseMint,
    TOKEN_2022_PROGRAM_ID
  );

  const tx = await program.methods
    .swap2WithTransferHook(
      {
        amount0: amountIn,
        amount1: new BN(0),
        swapMode: 0,
      },
      transferHookAccountsInfo
    )
    .accountsPartial({
      pool,
      poolAuthority,
      payer: user,
      inputTokenAccount,
      outputTokenAccount,
      baseVault,
      quoteVault,
      config,
      baseMint,
      quoteMint,
      tokenBaseProgram: TOKEN_2022_PROGRAM_ID,
      tokenQuoteProgram: TOKEN_PROGRAM_ID,
      referralTokenAccount: null,
    })
    .remainingAccounts([
      ...(includeSysvar
        ? [
            {
              pubkey: SYSVAR_INSTRUCTIONS_PUBKEY,
              isSigner: false,
              isWritable: false,
            },
          ]
        : []),
      ...transferHookAccounts,
    ])
    .preInstructions([createInputAtaIx, createOutputAtaIx])
    .transaction();

  return tx.instructions;
}

async function createInitializePoolWithTransferHookIx(
  partner: Keypair,
  poolCreator: Keypair,
  svm: LiteSVM,
  program: VirtualCurveProgram
) {
  // partner create config

  const cliffFeeNumerator = new BN(20_000_000);
  const endFeeNumerator = new BN(3_000_000);
  const numberOfPeriod = 60;
  const periodFrequency = new BN(1);

  const reductionFactor = cliffFeeNumerator
    .sub(endFeeNumerator)
    .div(new BN(numberOfPeriod));

  const refinedEndFeeNumerator = cliffFeeNumerator.sub(
    reductionFactor.mul(new BN(numberOfPeriod))
  );

  const baseFee: BaseFee = {
    cliffFeeNumerator,
    firstFactor: numberOfPeriod,
    secondFactor: periodFrequency,
    thirdFactor: reductionFactor,
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

  const migratedPoolFee = {
    poolFeeBps: 100,
    collectFeeMode: 0,
    dynamicFee: 0,
  };

  const instructionParams: ConfigParameters = {
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
    migrationFeeOption: 6, // customizable
    tokenSupply: null,
    creatorTradingFeePercentage: 0,
    tokenUpdateAuthority: 0,
    migrationFee: {
      feePercentage: 0,
      creatorFeePercentage: 0,
    },
    poolCreationFee: new BN(0),
    migratedPoolFee,
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
    enableFirstSwapWithMinFee: true,
    compoundingFeeBps: 0,
    migratedPoolBaseFeeMode: 0,
    migratedPoolMarketCapFeeSchedulerParams: null,
  };

  const quoteMint = NATIVE_MINT;
  const config = await createConfig(svm, program, {
    payer: partner,
    leftoverReceiver: partner.publicKey,
    feeClaimer: partner.publicKey,
    quoteMint,
    instructionParams,
  });

  const poolAuthority = derivePoolAuthority();
  const baseMintKP = Keypair.generate();
  const pool = derivePoolAddress(config, baseMintKP.publicKey, quoteMint);
  const baseVault = deriveTokenVaultAddress(baseMintKP.publicKey, pool);
  const quoteVault = deriveTokenVaultAddress(quoteMint, pool);

  const initPoolParams: InitializePoolParameters = {
    name: "test token 2022 with transfer hook",
    symbol: "TEST",
    uri: "abc.com",
  };

  const initPoolIx = await program.methods
    .initializeVirtualPoolWithToken2022TransferHook(initPoolParams)
    .accountsPartial({
      config,
      baseMint: baseMintKP.publicKey,
      quoteMint,
      pool,
      payer: poolCreator.publicKey,
      creator: poolCreator.publicKey,
      poolAuthority,
      baseVault,
      quoteVault,
      tokenQuoteProgram: TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
      transferHookAuthority: poolCreator.publicKey,
    })
    .instruction();

  return {
    baseMintKP,
    initPoolIx,
    pool,
    config,
    cliffFeeNumerator,
    endFeeNumerator: refinedEndFeeNumerator,
  };
}
