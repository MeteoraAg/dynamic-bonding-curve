import { NATIVE_MINT } from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { BN } from "@anchor-lang/core";
import {
  createConfig,
  createConfigWithTransferHook,
  createPoolWithSplToken,
  createPoolWithToken2022TransferHook,
  swap2,
  SwapMode,
  swapWithTransferHook,
} from "./instructions";
import {
  createVirtualCurveProgram,
  designCurve,
  expectThrowsAsync,
  generateAndFund,
  getDbcProgramErrorCodeHexString,
  getVirtualPool,
  initializeExtraAccountMetaList,
  startSvm,
} from "./utils";
import { VirtualCurveProgram } from "./utils/types";
import { TRANSFER_HOOK_COUNTER_PROGRAM_ID } from "./utils/constants";
import { wrapSOL } from "./utils/token";
import { LiteSVM } from "litesvm";

describe("Swap pool-type mismatch", () => {
  let svm: LiteSVM;
  let partner: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;

  beforeEach(() => {
    svm = startSvm();
    partner = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    program = createVirtualCurveProgram();

    wrapSOL(svm, poolCreator, new BN(LAMPORTS_PER_SOL * 10));
    wrapSOL(svm, partner, new BN(LAMPORTS_PER_SOL * 10));
  });

  it("swap2 on TransferHookPool fails with PoolTypeMismatch", async () => {
    const { pool, config, baseMint } = await setupTransferHookPool(
      partner,
      poolCreator,
      svm,
      program
    );

    const errorCode = getDbcProgramErrorCodeHexString("PoolTypeMismatch");
    await expectThrowsAsync(async () => {
      await swap2(svm, program, {
        config,
        payer: poolCreator,
        pool,
        inputTokenMint: NATIVE_MINT,
        outputTokenMint: baseMint,
        amount0: new BN(LAMPORTS_PER_SOL),
        amount1: new BN(0),
        swapMode: 0,
        referralTokenAccount: null,
      });
    }, errorCode);
  });

  it("swap2WithTransferHook on VirtualPool fails with PoolTypeMismatch", async () => {
    const { pool, config, baseMint } = await setupVirtualPool(
      partner,
      poolCreator,
      svm,
      program
    );

    const errorCode = getDbcProgramErrorCodeHexString("PoolTypeMismatch");
    await expectThrowsAsync(async () => {
      await swapWithTransferHook(svm, program, {
        config,
        payer: poolCreator,
        pool,
        inputTokenMint: NATIVE_MINT,
        outputTokenMint: baseMint,
        amountIn: new BN(LAMPORTS_PER_SOL),
        minimumAmountOut: new BN(0),
        swapMode: SwapMode.ExactIn,
        referralTokenAccount: null,
      });
    }, errorCode);
  });

  describe("with transfer hook program closed", () => {
    let pool: PublicKey;
    let config: PublicKey;
    let baseMint: PublicKey;

    beforeEach(async () => {
      const setup = await setupTransferHookPool(
        partner,
        poolCreator,
        svm,
        program
      );
      pool = setup.pool;
      config = setup.config;
      baseMint = setup.baseMint;

      // Disable the transfer hook program (make it non-executable, empty).
      svm.setAccount(TRANSFER_HOOK_COUNTER_PROGRAM_ID, {
        data: new Uint8Array(0),
        executable: false,
        lamports: 0,
        owner: SystemProgram.programId,
      });
    });

    it("swap2WithTransferHook fails because hook program CPI fails", async () => {
      // Guard passes (kinds match); failure must come from token program CPI
      // into the now-non-executable hook program. Match the specific log.
      await expectThrowsAsync(async () => {
        await swapWithTransferHook(svm, program, {
          config,
          payer: poolCreator,
          pool,
          inputTokenMint: NATIVE_MINT,
          outputTokenMint: baseMint,
          amountIn: new BN(LAMPORTS_PER_SOL),
          minimumAmountOut: new BN(0),
          swapMode: SwapMode.ExactIn,
          referralTokenAccount: null,
        });
      }, `${TRANSFER_HOOK_COUNTER_PROGRAM_ID.toBase58()} is not executable`);
    });

    it("swap2 still fails with PoolTypeMismatch, before any hook CPI", async () => {
      const errorCode = getDbcProgramErrorCodeHexString("PoolTypeMismatch");
      await expectThrowsAsync(async () => {
        await swap2(svm, program, {
          config,
          payer: poolCreator,
          pool,
          inputTokenMint: NATIVE_MINT,
          outputTokenMint: baseMint,
          amount0: new BN(LAMPORTS_PER_SOL),
          amount1: new BN(0),
          swapMode: 0,
          referralTokenAccount: null,
        });
      }, errorCode);
    });
  });
});

async function setupVirtualPool(
  partner: Keypair,
  poolCreator: Keypair,
  svm: LiteSVM,
  program: VirtualCurveProgram
): Promise<{ pool: PublicKey; config: PublicKey; baseMint: PublicKey }> {
  const quoteMint = NATIVE_MINT;
  const instructionParams = designCurve(
    1_000_000_000,
    10,
    5,
    1, // damm v2
    6,
    9,
    0,
    0,
    {
      amountPerPeriod: new BN(0),
      cliffDurationFromMigrationTime: new BN(0),
      frequency: new BN(0),
      numberOfPeriod: new BN(0),
      cliffUnlockAmount: new BN(0),
    },
    { feePercentage: 0, creatorFeePercentage: 0 }
  );

  const config = await createConfig(svm, program, {
    payer: partner,
    leftoverReceiver: partner.publicKey,
    feeClaimer: partner.publicKey,
    quoteMint,
    instructionParams,
  });

  const pool = await createPoolWithSplToken(svm, program, {
    poolCreator,
    payer: poolCreator,
    quoteMint,
    config,
    instructionParams: { name: "spl", symbol: "SPL", uri: "abc.com" },
  });

  const baseMint = getVirtualPool(svm, program, pool).baseMint;
  return { pool, config, baseMint };
}

async function setupTransferHookPool(
  partner: Keypair,
  poolCreator: Keypair,
  svm: LiteSVM,
  program: VirtualCurveProgram
): Promise<{ pool: PublicKey; config: PublicKey; baseMint: PublicKey }> {
  const quoteMint = NATIVE_MINT;
  const instructionParams = designCurve(
    1_000_000_000,
    10,
    5,
    1, // damm v2
    6,
    9,
    0,
    0,
    {
      amountPerPeriod: new BN(0),
      cliffDurationFromMigrationTime: new BN(0),
      frequency: new BN(0),
      numberOfPeriod: new BN(0),
      cliffUnlockAmount: new BN(0),
    },
    { feePercentage: 0, creatorFeePercentage: 0 }
  );
  instructionParams.tokenType = 1; // token-2022

  const config = await createConfigWithTransferHook(svm, program, {
    payer: partner,
    leftoverReceiver: partner.publicKey,
    feeClaimer: partner.publicKey,
    quoteMint,
    instructionParams,
    transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
  });

  const pool = await createPoolWithToken2022TransferHook(svm, program, {
    poolCreator,
    payer: poolCreator,
    quoteMint,
    config,
    instructionParams: { name: "thp", symbol: "THP", uri: "abc.com" },
    transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
  });

  const baseMint = getVirtualPool(svm, program, pool).baseMint;
  await initializeExtraAccountMetaList(svm, poolCreator, baseMint);

  return { pool, config, baseMint };
}
