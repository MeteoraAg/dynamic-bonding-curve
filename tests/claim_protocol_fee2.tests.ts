import { Keypair, PublicKey } from "@solana/web3.js";
import {
  claimProtocolFee2,
  createOperatorAccount,
  OperatorPermission,
} from "./instructions";
import {
  createDammV2Operator,
  createDbcConfig,
  createPoolAndSwapForMigration,
  createVirtualCurveProgram,
  dammV2Migration,
  DammV2OperatorPermission,
  encodePermissions,
  expectThrowsAsync,
  generateAndFund,
  getOrCreateAta,
  startSvm,
} from "./utils";
import { getConfig } from "./utils/fetcher";
import { VirtualCurveProgram } from "./utils/types";

import { LiteSVM } from "litesvm";

const ANCHOR_CONSTRAINT_ADDRESS_ERROR = "ConstraintAddress";

describe("Claim protocol fee 2", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;
  let config: PublicKey;
  let virtualPoolAddress: PublicKey;

  before(async () => {
    svm = startSvm();
    admin = generateAndFund(svm);
    operator = generateAndFund(svm);
    partner = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    program = createVirtualCurveProgram();

    const fullPermissions = Object.values(OperatorPermission).filter(
      (v): v is OperatorPermission => typeof v === "number"
    );

    await createOperatorAccount(svm, program, {
      admin,
      whitelistedAddress: operator.publicKey,
      permissions: fullPermissions,
    });

    await createDammV2Operator(svm, {
      whitelistAddress: admin.publicKey,
      admin,
      permission: encodePermissions([DammV2OperatorPermission.CreateConfigKey]),
    });

    const migrationOptionDammV2 = 1;
    const customizableMigrationFeeOption = 6;

    config = await createDbcConfig(
      svm,
      program,
      migrationOptionDammV2,
      customizableMigrationFeeOption,
      {
        poolFeeBps: 100,
        collectFeeMode: 0,
        dynamicFee: 0,
      },
      partner
    );

    virtualPoolAddress = await createPoolAndSwapForMigration(
      svm,
      program,
      config,
      poolCreator
    );

    await dammV2Migration(
      svm,
      program,
      poolCreator,
      admin,
      virtualPoolAddress,
      config
    );
  });

  it("rejects when signed by operator (not protocol_fee_authority)", async () => {
    const configState = getConfig(svm, program, config);

    const receiverTokenAccount = getOrCreateAta(
      svm,
      operator,
      configState.quoteMint,
      admin.publicKey
    );

    await expectThrowsAsync(
      () =>
        claimProtocolFee2(svm, program, {
          signerKP: operator,
          pool: virtualPoolAddress,
          isTokenBase: false,
          receiverTokenAccount,
        }),
      ANCHOR_CONSTRAINT_ADDRESS_ERROR
    );
  });

  it("rejects when signed by admin", async () => {
    const configState = getConfig(svm, program, config);

    const receiverTokenAccount = getOrCreateAta(
      svm,
      admin,
      configState.quoteMint,
      admin.publicKey
    );

    await expectThrowsAsync(
      () =>
        claimProtocolFee2(svm, program, {
          signerKP: admin,
          pool: virtualPoolAddress,
          isTokenBase: false,
          receiverTokenAccount,
        }),
      ANCHOR_CONSTRAINT_ADDRESS_ERROR
    );
  });
});
