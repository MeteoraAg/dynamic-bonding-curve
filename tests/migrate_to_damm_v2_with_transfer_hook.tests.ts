import {
  getTransferHook,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
import {
  BaseFee,
  claimProtocolFee,
  ConfigParameters,
  createConfigWithTransferHook,
  CreateConfigWithTransferHookParams,
  createOperatorAccount,
  createPoolWithToken2022TransferHook,
  OperatorPermission,
  swapWithTransferHook,
  SwapMode,
  SwapParams,
} from "./instructions";
import {
  createDammV2Config,
  createDammV2Operator,
  createVirtualCurveProgram,
  DammV2OperatorPermission,
  derivePoolAuthority,
  encodePermissions,
  expectThrowsAsync,
  generateAndFund,
  initializeExtraAccountMetaList,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  startSvm,
  U64_MAX,
} from "./utils";
import { getVirtualPool } from "./utils/fetcher";
import { Pool, VirtualCurveProgram } from "./utils/types";
import { TRANSFER_HOOK_COUNTER_PROGRAM_ID } from "./utils/constants";

import { expect } from "chai";
import { LiteSVM } from "litesvm";
import { getMint } from "./utils/token";
import {
  createMeteoraDammV2Metadata,
  MigrateMeteoraDammV2Params,
  migrateToDammV2,
} from "./instructions/dammV2Migration";

describe("Migrate to damm v2 with transfer hook", () => {
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
  let dammConfig: PublicKey;

  before(async () => {
    svm = startSvm();
    admin = generateAndFund(svm);
    operator = generateAndFund(svm);
    partner = generateAndFund(svm);
    user = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    program = createVirtualCurveProgram();

    await createDammV2Operator(svm, {
      whitelistAddress: admin.publicKey,
      admin,
      permission: encodePermissions([DammV2OperatorPermission.CreateConfigKey]),
    });
  });

  it("Admin create operator account", async () => {
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
      collectFeeMode: 0,
      migrationOption: 1,
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
      curve: curves,
      enableFirstSwapWithMinFee: false,
      compoundingFeeBps: 0,
      migratedPoolBaseFeeMode: 0,
      migratedPoolMarketCapFeeSchedulerParams: null,
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
    virtualPool = await createPoolWithToken2022TransferHook(svm, program, {
      poolCreator,
      payer: operator,
      quoteMint: NATIVE_MINT,
      config,
      transferHookProgram: TRANSFER_HOOK_COUNTER_PROGRAM_ID,
      instructionParams: {
        name: "test token 2022 with transfer hook",
        symbol: "TEST",
        uri: "abc.com",
      },
    });
    virtualPoolState = getVirtualPool(svm, program, virtualPool);
  });

  it("Initialize extra account meta list for transfer hook", async () => {
    await initializeExtraAccountMetaList(
      svm,
      operator,
      virtualPoolState.baseMint
    );
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

  it("Create meteora damm v2 metadata", async () => {
    await createMeteoraDammV2Metadata(svm, program, {
      payer: admin,
      virtualPool,
      config,
    });
  });

  it("Migrate to Meteora Damm V2 Pool (revokes transfer hook)", async () => {
    const poolAuthority = derivePoolAuthority();
    dammConfig = await createDammV2Config(
      svm,
      admin,
      poolAuthority,
      1 // Timestamp
    );

    const migrationParams: MigrateMeteoraDammV2Params = {
      payer: admin,
      virtualPool,
      dammConfig,
    };

    await migrateToDammV2(svm, program, migrationParams);

    const baseMint = virtualPoolState.baseMint;
    const mintState = getMint(svm, baseMint, TOKEN_2022_PROGRAM_ID);
    const transferHook = getTransferHook(mintState);
    // Verify transfer hook was revoked during migration
    expect(transferHook.authority.equals(PublicKey.default)).to.be.true;
    expect(transferHook.programId.equals(PublicKey.default)).to.be.true;
  });

  it("Deprecated claim_protocol_fee rejects transfer hook pool", async () => {
    await expectThrowsAsync(async () => {
      await claimProtocolFee(svm, program, {
        pool: virtualPool,
        operator: operator,
      });
    }, "Account discriminator did not match what was expected"); // claimProtocolFee does not support transfer hook pool. need to use claimProtocolFee2
  });
});
