import { NATIVE_MINT } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createDammV2Config,
  createVirtualCurveProgram,
  derivePoolAuthority,
  generateAndFund,
  startSvm,
} from "../utils";
import { getVirtualPool } from "../utils/fetcher";
import { Pool, VirtualCurveProgram } from "../utils/types";
import {
  createConfigForSwapDammv2,
  CreateConfigForSwapParams,
  createPoolWithSplToken,
  creatorWithdrawMigrationFee,
  CreatorWithdrawMigrationFeeParams,
  swap2,
  Swap2Params,
  withdrawLeftover,
} from "./instructions";

import { LiteSVM } from "litesvm";
import { SwapMode } from "../instructions";
import {
  createMeteoraDammV2Metadata,
  MigrateMeteoraDammV2Params,
  migrateToDammV2,
} from "./instructions/dammV2Migration";

describe("Backwards compatibility - DAMMv2 migration", () => {
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
  });

  it("createConfigSplTokenForSwapDammv2", async () => {
    const params: CreateConfigForSwapParams = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: NATIVE_MINT,
    };
    config = await createConfigForSwapDammv2(svm, program, params);
  });

  it("initializeVirtualPoolWithSplToken", async () => {
    virtualPool = await createPoolWithSplToken(svm, program, {
      poolCreator,
      payer: operator,
      quoteMint: NATIVE_MINT,
      config,
    });
    virtualPoolState = getVirtualPool(svm, program, virtualPool);
  });

  it("swap", async () => {
    const params: Swap2Params = {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: NATIVE_MINT,
      outputTokenMint: virtualPoolState.baseMint,
      swapMode: SwapMode.PartialFill,
      referralTokenAccount: null,
    };
    await swap2(svm, program, params);
  });

  it("createConfigSplTokenForSwapDammv2", async () => {
    await createMeteoraDammV2Metadata(svm, program, {
      payer: admin,
      virtualPool,
      config,
    });
  });

  it("migrationDammV2", async () => {
    const poolAuthority = derivePoolAuthority();
    dammConfig = await createDammV2Config(svm, admin, poolAuthority);
    const migrationParams: MigrateMeteoraDammV2Params = {
      payer: admin,
      virtualPool,
      dammConfig,
    };

    await migrateToDammV2(svm, program, migrationParams);
  });

  it("withdrawMigrationFee", async () => {
    const migrationParams: CreatorWithdrawMigrationFeeParams = {
      creator: poolCreator,
      virtualPool,
    };

    await creatorWithdrawMigrationFee(svm, program, migrationParams);
  });

  it("withdrawLeftover", async () => {
    const withdrawLeftoverParams = {
      payer: poolCreator,
      virtualPool,
    };

    await withdrawLeftover(svm, program, withdrawLeftoverParams);
  });
});
