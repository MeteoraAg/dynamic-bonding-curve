import { NATIVE_MINT } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import { SwapMode } from "../instructions";
import {
  createDammConfig,
  createVirtualCurveProgram,
  derivePoolAuthority,
  expectThrowsAsync,
  generateAndFund,
  getDbcProgramErrorCodeHexString,
  getMint,
  startSvm,
} from "../utils";
import { getVirtualPool } from "../utils/fetcher";
import { Pool, VirtualCurveProgram } from "../utils/types";
import {
  creatorWithdrawSurplus,
  transferCreator,
} from "./instructions/creatorInstructions";
import {
  createMeteoraMetadata,
  creatorClaimLpDamm,
  lockLpForCreatorDamm,
  lockLpForPartnerDamm,
  MigrateMeteoraParams,
  migrateToMeteoraDamm,
  partnerClaimLpDamm,
} from "./instructions/meteoraMigration";
import {
  ClaimTradeFeeParams,
  claimTradingFee,
  createConfigForSwapDamm,
  CreateConfigForSwapParams,
  partnerWithdrawSurplus,
} from "./instructions/partnerInstructions";
import {
  createPoolWithSplToken,
  swap2,
  Swap2Params,
} from "./instructions/userInstructions";

describe("Backwards compatibility - DAMM full flow", () => {
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

  it("createConfigSplTokenForSwapDamm", async () => {
    const params: CreateConfigForSwapParams = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: NATIVE_MINT,
    };
    config = await createConfigForSwapDamm(svm, program, params);
  });

  it("initializeVirtualPoolWithSplToken", async () => {
    virtualPool = await createPoolWithSplToken(svm, program, {
      poolCreator,
      payer: operator,
      quoteMint: NATIVE_MINT,
      config,
    });
    virtualPoolState = getVirtualPool(svm, program, virtualPool);

    // validate freeze authority
    const baseMintData = getMint(svm, virtualPoolState.baseMint);
    expect(baseMintData.freezeAuthority.toString()).eq(
      PublicKey.default.toString()
    );
    expect(baseMintData.mintAuthorityOption).eq(0);
  });

  it("swap2", async () => {
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

  it("migrationMeteoraDammCreateMetadata", async () => {
    await createMeteoraMetadata(svm, program, {
      payer: admin,
      virtualPool,
      config,
    });
  });

  it("migrateMeteoraDamm", async () => {
    const poolAuthority = derivePoolAuthority();

    dammConfig = await createDammConfig(svm, admin, poolAuthority);
    const migrationParams: MigrateMeteoraParams = {
      payer: admin,
      virtualPool,
      dammConfig,
    };

    await migrateToMeteoraDamm(svm, program, migrationParams);

    // validate mint authority
    const baseMintData = getMint(svm, virtualPoolState.baseMint);
    expect(baseMintData.mintAuthorityOption).eq(0);
  });

  it("migrateMeteoraDammLockLpToken - partner", async () => {
    await lockLpForPartnerDamm(svm, program, {
      payer: partner,
      dammConfig,
      virtualPool,
    });
  });

  it("migrateMeteoraDammLockLpToken - creator", async () => {
    await lockLpForCreatorDamm(svm, program, {
      payer: poolCreator,
      dammConfig,
      virtualPool,
    });
  });

  it("partnerWithdrawSurplus", async () => {
    await partnerWithdrawSurplus(svm, program, {
      feeClaimer: partner,
      virtualPool,
    });
  });

  it("creatorWithdrawSurplus", async () => {
    await creatorWithdrawSurplus(svm, program, {
      creator: poolCreator,
      virtualPool,
    });
  });

  it("claimTradingFee", async () => {
    const claimTradingFeeParams: ClaimTradeFeeParams = {
      feeClaimer: partner,
      pool: virtualPool,
    };
    await claimTradingFee(svm, program, claimTradingFeeParams);
  });

  it("migrateMeteoraDammClaimLpToken - partner", async () => {
    await partnerClaimLpDamm(svm, program, {
      payer: partner,
      dammConfig,
      virtualPool,
    });
  });

  it("migrateMeteoraDammClaimLpToken - creator", async () => {
    await creatorClaimLpDamm(svm, program, {
      payer: poolCreator,
      dammConfig,
      virtualPool,
    });
  });

  it("unauthorize transfer pool creator", async () => {
    const errorCodeUnauthorized =
      getDbcProgramErrorCodeHexString("Unauthorized");
    const newCreator = Keypair.generate().publicKey;

    // unauthorized pool creator claim trading fee
    expectThrowsAsync(async () => {
      await transferCreator(svm, program, virtualPool, partner, newCreator);
    }, errorCodeUnauthorized);
  });

  it("transferPoolCreator", async () => {
    const newCreator = Keypair.generate().publicKey;
    await transferCreator(svm, program, virtualPool, poolCreator, newCreator);
  });
});
