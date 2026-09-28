import {
  getAssociatedTokenAddressSync,
  getTransferHook,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { BN } from "@anchor-lang/core";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  BaseFee,
  claimCreatorTradingFee2,
  claimTradingFee2,
  ConfigParameters,
  createConfig,
  createMeteoraDammV2Metadata,
  createConfigWithTransferHook,
  createOperatorAccount,
  createPoolWithToken2022,
  createPoolWithToken2022TransferHook,
  OperatorPermission,
  migrateToDammV2,
  revokeTransferHook,
  swapWithTransferHook,
  SwapMode,
} from "./instructions";
import {
  createVirtualCurveProgram,
  expectThrowsAsync,
  generateAndFund,
  getDbcProgramErrorCodeHexString,
  createDammV2Config,
  createDammV2Operator,
  DammV2OperatorPermission,
  derivePoolAuthority,
  encodePermissions,
  getTokenAccount,
  initializeExtraAccountMetaList,
  MAX_SQRT_PRICE,
  sendTransactionMaybeThrow,
  MIN_SQRT_PRICE,
  startSvm,
  U64_MAX,
} from "./utils";
import { TRANSFER_HOOK_COUNTER_PROGRAM_ID } from "./utils/constants";
import { getVirtualPool } from "./utils/fetcher";
import { getMint } from "./utils/token";
import { AccountsType, VirtualCurveProgram } from "./utils/types";

function getConfigParameters(
  tokenType: number,
  collectFeeMode = 0
): ConfigParameters {
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
    collectFeeMode,
    migrationOption: 1,
    tokenType,
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
    curve: curves,
    enableFirstSwapWithMinFee: false,
    compoundingFeeBps: 0,
    migratedPoolBaseFeeMode: 0,
    migratedPoolMarketCapFeeSchedulerParams: null,
  };
}

async function setupTransferHookPool(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  partner: Keypair,
  poolCreator: Keypair,
  collectFeeMode = 0
): Promise<{ config: PublicKey; pool: PublicKey; baseMint: PublicKey }> {
  const config = await createConfigWithTransferHook(svm, program, {
    payer: partner,
    leftoverReceiver: partner.publicKey,
    feeClaimer: partner.publicKey,
    quoteMint: NATIVE_MINT,
    instructionParams: getConfigParameters(1, collectFeeMode),
    transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
  });

  const pool = await createPoolWithToken2022TransferHook(svm, program, {
    poolCreator,
    payer: poolCreator,
    quoteMint: NATIVE_MINT,
    config,
    transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
    instructionParams: {
      name: "test token 2022 with transfer hook",
      symbol: "TEST",
      uri: "abc.com",
    },
  });

  const baseMint = getVirtualPool(svm, program, pool).baseMint;
  await initializeExtraAccountMetaList(svm, poolCreator, baseMint);

  return { config, pool, baseMint };
}

function getBaseMintTransferHook(svm: LiteSVM, baseMint: PublicKey) {
  return getTransferHook(getMint(svm, baseMint, TOKEN_2022_PROGRAM_ID))!;
}

describe("Revoke transfer hook", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let poolCreator: Keypair;
  let user: Keypair;
  let program: VirtualCurveProgram;

  beforeEach(async () => {
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
      permissions: [OperatorPermission.RevokeTransferHook],
    });
  });

  it("Operator revokes the transfer hook program and authority", async () => {
    const { config, pool, baseMint } = await setupTransferHookPool(
      svm,
      program,
      partner,
      poolCreator
    );

    await swapWithTransferHook(svm, program, {
      config,
      payer: user,
      pool,
      inputTokenMint: NATIVE_MINT,
      outputTokenMint: baseMint,
      amountIn: new BN(LAMPORTS_PER_SOL),
      minimumAmountOut: new BN(0),
      swapMode: SwapMode.ExactIn,
      referralTokenAccount: null,
    });

    const hookBefore = getBaseMintTransferHook(svm, baseMint);
    expect(hookBefore.programId.equals(TRANSFER_HOOK_COUNTER_PROGRAM_ID)).to.be
      .true;
    expect(hookBefore.authority.equals(PublicKey.default)).to.be.false;

    await revokeTransferHook(svm, program, { operator, pool });

    const hookAfter = getBaseMintTransferHook(svm, baseMint);
    expect(hookAfter.programId.equals(PublicKey.default)).to.be.true;
    expect(hookAfter.authority.equals(PublicKey.default)).to.be.true;
  });

  it("Operator without the permission cannot revoke", async () => {
    const { pool } = await setupTransferHookPool(
      svm,
      program,
      partner,
      poolCreator
    );

    const otherOperator = generateAndFund(svm);
    await createOperatorAccount(svm, program, {
      admin,
      whitelistedAddress: otherOperator.publicKey,
      permissions: [
        OperatorPermission.ClaimProtocolFee,
        OperatorPermission.CreateTokenBadge,
        OperatorPermission.CloseTokenBadge,
      ],
    });

    await expectThrowsAsync(async () => {
      await revokeTransferHook(svm, program, {
        operator: otherOperator,
        pool,
      });
    }, getDbcProgramErrorCodeHexString("InvalidPermission"));
  });

  it("Revoke on a VirtualPool fails with PoolTypeMismatch", async () => {
    const config = await createConfig(svm, program, {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: NATIVE_MINT,
      instructionParams: getConfigParameters(1),
    });

    const pool = await createPoolWithToken2022(svm, program, {
      poolCreator,
      payer: poolCreator,
      quoteMint: NATIVE_MINT,
      config,
      instructionParams: { name: "spl", symbol: "SPL", uri: "abc.com" },
    });

    await expectThrowsAsync(async () => {
      await revokeTransferHook(svm, program, {
        operator,
        pool,
      });
    }, getDbcProgramErrorCodeHexString("PoolTypeMismatch"));
  });

  it("Revoke with another pool's base mint fails with ConstraintHasOne", async () => {
    const { pool } = await setupTransferHookPool(
      svm,
      program,
      partner,
      poolCreator
    );
    const { baseMint: otherBaseMint } = await setupTransferHookPool(
      svm,
      program,
      partner,
      poolCreator
    );

    await expectThrowsAsync(async () => {
      await revokeTransferHook(svm, program, {
        operator,
        pool,
        baseMint: otherBaseMint,
      });
    }, "ConstraintHasOne");

    const otherHook = getBaseMintTransferHook(svm, otherBaseMint);
    expect(otherHook.programId.equals(TRANSFER_HOOK_COUNTER_PROGRAM_ID)).to.be
      .true;
  });

  it("Second revoke is a no-op", async () => {
    const { pool, baseMint } = await setupTransferHookPool(
      svm,
      program,
      partner,
      poolCreator
    );

    await revokeTransferHook(svm, program, { operator, pool });
    const mintDataBefore = svm.getAccount(baseMint).data;

    await revokeTransferHook(svm, program, { operator, pool });

    expect(
      Buffer.from(svm.getAccount(baseMint).data).equals(
        Buffer.from(mintDataBefore)
      )
    ).to.be.true;
  });

  it("Revoke after the curve completes is a no-op", async () => {
    const { config, pool, baseMint } = await setupTransferHookPool(
      svm,
      program,
      partner,
      poolCreator
    );

    const { completed } = await swapWithTransferHook(svm, program, {
      config,
      payer: user,
      pool,
      inputTokenMint: NATIVE_MINT,
      outputTokenMint: baseMint,
      amountIn: new BN(LAMPORTS_PER_SOL * 5.5),
      minimumAmountOut: new BN(0),
      swapMode: SwapMode.PartialFill,
      referralTokenAccount: null,
    });
    expect(completed).to.be.true;

    const mintDataBefore = svm.getAccount(baseMint).data;

    await revokeTransferHook(svm, program, { operator, pool });

    expect(
      Buffer.from(svm.getAccount(baseMint).data).equals(
        Buffer.from(mintDataBefore)
      )
    ).to.be.true;
  });

  it("Revoke unblocks swaps on a pool whose transfer hook rejects transfers", async () => {
    const { config, pool, baseMint } = await setupTransferHookPool(
      svm,
      program,
      partner,
      poolCreator
    );

    // Disable the transfer hook program so every base transfer fails.
    svm.setAccount(TRANSFER_HOOK_COUNTER_PROGRAM_ID, {
      data: new Uint8Array(0),
      executable: false,
      lamports: 0,
      owner: SystemProgram.programId,
    });

    const swapParams = {
      config,
      payer: user,
      pool,
      inputTokenMint: NATIVE_MINT,
      outputTokenMint: baseMint,
      amountIn: new BN(LAMPORTS_PER_SOL),
      minimumAmountOut: new BN(0),
      swapMode: SwapMode.ExactIn,
      referralTokenAccount: null,
    };

    await expectThrowsAsync(async () => {
      await swapWithTransferHook(svm, program, swapParams);
    }, `${TRANSFER_HOOK_COUNTER_PROGRAM_ID.toBase58()} is not executable`);

    await revokeTransferHook(svm, program, { operator, pool });

    await swapWithTransferHook(svm, program, swapParams);
    expect(getVirtualPool(svm, program, pool).quoteReserve.gtn(0)).to.be.true;
  });

  describe("After the operator revokes the transfer hook", () => {
    let config: PublicKey;
    let pool: PublicKey;
    let baseMint: PublicKey;

    function buyBase(amountIn: BN, swapMode = SwapMode.ExactIn) {
      return swapWithTransferHook(svm, program, {
        config,
        payer: user,
        pool,
        inputTokenMint: NATIVE_MINT,
        outputTokenMint: baseMint,
        amountIn,
        minimumAmountOut: new BN(0),
        swapMode,
        referralTokenAccount: null,
      });
    }

    beforeEach(async () => {
      ({ config, pool, baseMint } = await setupTransferHookPool(
        svm,
        program,
        partner,
        poolCreator,
        1 // fees on the output token, so a buy collects base fees
      ));

      await buyBase(new BN(LAMPORTS_PER_SOL));
      await revokeTransferHook(svm, program, { operator, pool });
    });

    it("Swaps in both directions without transfer hook accounts", async () => {
      await buyBase(new BN(LAMPORTS_PER_SOL));

      const userBaseTokenAccount = getAssociatedTokenAddressSync(
        baseMint,
        user.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );
      const baseBalance = new BN(
        getTokenAccount(svm, userBaseTokenAccount).amount.toString()
      );

      await swapWithTransferHook(svm, program, {
        config,
        payer: user,
        pool,
        inputTokenMint: baseMint,
        outputTokenMint: NATIVE_MINT,
        amountIn: baseBalance.divn(2),
        minimumAmountOut: new BN(0),
        swapMode: SwapMode.ExactIn,
        referralTokenAccount: null,
      });

      const baseBalanceAfter = new BN(
        getTokenAccount(svm, userBaseTokenAccount).amount.toString()
      );
      expect(baseBalanceAfter.lt(baseBalance)).to.be.true;
    });

    it("Swap with transfer hook accounts fails with NoTransferHookProgram", async () => {
      const poolState = getVirtualPool(svm, program, pool);
      // one stale hook account, as a client that still reads the old hook would send
      const staleHookAccount = {
        pubkey: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      };

      const transaction = await program.methods
        .swap2WithTransferHook(
          {
            amount0: new BN(1_000_000),
            amount1: new BN(0),
            swapMode: SwapMode.ExactIn,
          },
          {
            slices: [
              { accountsType: AccountsType.TransferHookBase, length: 1 },
            ],
          }
        )
        .accountsPartial({
          poolAuthority: derivePoolAuthority(),
          config,
          pool,
          inputTokenAccount: getAssociatedTokenAddressSync(
            baseMint,
            user.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID
          ),
          outputTokenAccount: getAssociatedTokenAddressSync(
            NATIVE_MINT,
            user.publicKey
          ),
          baseVault: poolState.baseVault,
          quoteVault: poolState.quoteVault,
          baseMint,
          quoteMint: NATIVE_MINT,
          payer: user.publicKey,
          tokenBaseProgram: TOKEN_2022_PROGRAM_ID,
          tokenQuoteProgram: TOKEN_PROGRAM_ID,
          referralTokenAccount: null,
        })
        .remainingAccounts([
          {
            pubkey: SYSVAR_INSTRUCTIONS_PUBKEY,
            isSigner: false,
            isWritable: false,
          },
          staleHookAccount,
        ])
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        ])
        .transaction();

      await expectThrowsAsync(async () => {
        sendTransactionMaybeThrow(svm, transaction, [user]);
      }, getDbcProgramErrorCodeHexString("NoTransferHookProgram"));
    });

    it("Partner and creator claim base trading fees", async () => {
      const partnerBaseTokenAccount = getAssociatedTokenAddressSync(
        baseMint,
        partner.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );
      const creatorBaseTokenAccount = getAssociatedTokenAddressSync(
        baseMint,
        poolCreator.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const poolState = getVirtualPool(svm, program, pool);
      expect(poolState.partnerBaseFee.gtn(0)).to.be.true;
      expect(poolState.creatorBaseFee.gtn(0)).to.be.true;

      await claimTradingFee2(svm, program, {
        feeClaimer: partner,
        pool,
        maxBaseAmount: U64_MAX,
        maxQuoteAmount: U64_MAX,
      });
      await claimCreatorTradingFee2(svm, program, {
        creator: poolCreator,
        pool,
        maxBaseAmount: U64_MAX,
        maxQuoteAmount: U64_MAX,
      });

      expect(
        getTokenAccount(svm, partnerBaseTokenAccount).amount.toString()
      ).eq(poolState.partnerBaseFee.toString());
      expect(
        getTokenAccount(svm, creatorBaseTokenAccount).amount.toString()
      ).eq(poolState.creatorBaseFee.toString());
    });

    it("Curve completes and the pool migrates to DAMM v2", async () => {
      const { completed } = await buyBase(
        new BN(LAMPORTS_PER_SOL * 5.5),
        SwapMode.PartialFill
      );
      expect(completed).to.be.true;

      const hook = getBaseMintTransferHook(svm, baseMint);
      expect(hook.programId.equals(PublicKey.default)).to.be.true;
      expect(hook.authority.equals(PublicKey.default)).to.be.true;

      await createDammV2Operator(svm, {
        whitelistAddress: admin.publicKey,
        admin,
        permission: encodePermissions([
          DammV2OperatorPermission.CreateConfigKey,
        ]),
      });
      await createMeteoraDammV2Metadata(svm, program, {
        payer: admin,
        virtualPool: pool,
        config,
      });
      const dammConfig = await createDammV2Config(
        svm,
        admin,
        derivePoolAuthority(),
        1 // Timestamp
      );

      await migrateToDammV2(svm, program, {
        payer: admin,
        virtualPool: pool,
        dammConfig,
      });

      const poolState = getVirtualPool(svm, program, pool);
      expect(poolState.isMigrated).eq(1);
    });
  });
});
