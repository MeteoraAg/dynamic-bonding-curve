import {
  getAssociatedTokenAddressSync,
  unpackAccount,
} from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  claimProtocolFee,
  createOperatorAccount,
  OperatorPermission,
} from "./instructions";
import {
  createDammV2Operator,
  createDbcConfig,
  createPoolAndSwapForMigration,
  createVirtualCurveProgram,
  dammMigration,
  dammV2Migration,
  DammV2OperatorPermission,
  encodePermissions,
  generateAndFund,
  startSvm,
  TREASURY,
} from "./utils";
import { getConfig, getVirtualPool } from "./utils/fetcher";
import { VirtualCurveProgram } from "./utils/types";

import { expect } from "chai";
import { LiteSVM } from "litesvm";

describe("Claim protocol liquidity migration fee", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;

  before(async () => {
    svm = startSvm();
    admin = generateAndFund(svm);
    operator = generateAndFund(svm);
    partner = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    program = createVirtualCurveProgram();

    await createOperatorAccount(svm, program, {
      admin,
      whitelistedAddress: operator.publicKey,
      permissions: [OperatorPermission.ClaimProtocolFee],
    });

    await createDammV2Operator(svm, {
      whitelistAddress: admin.publicKey,
      admin,
      permission: encodePermissions([DammV2OperatorPermission.CreateConfigKey]),
    });
  });

  it("Claim protocol liquidity migration fee after migrate to damm v2", async () => {
    const migrationOptionDammV2 = 1;
    const customizableMigrationFeeOption = 6;

    const config = await createDbcConfig(
      svm,
      program,
      migrationOptionDammV2,
      customizableMigrationFeeOption,
      {
        poolFeeBps: 100,
        collectFeeMode: 0,
        dynamicFee: 0,
      },
      partner,
    );

    const virtualPoolAddress = await createPoolAndSwapForMigration(
      svm,
      program,
      config,
      poolCreator,
    );

    await dammV2Migration(
      svm,
      program,
      poolCreator,
      admin,
      virtualPoolAddress,
      config,
    );

    await claimProtocolLiquidityMigrationFeeAndAssert(
      svm,
      program,
      operator,
      config,
      virtualPoolAddress,
    );
  });

  it("Claim protocol liquidity migration fee after migrate to damm", async () => {
    const migrationOptionDamm = 0;
    const fixedFeeBps0MigrationFeeOption = 0;

    const config = await createDbcConfig(
      svm,
      program,
      migrationOptionDamm,
      fixedFeeBps0MigrationFeeOption,
      {
        poolFeeBps: 0,
        collectFeeMode: 0,
        dynamicFee: 0,
      },
      partner,
    );

    const virtualPoolAddress = await createPoolAndSwapForMigration(
      svm,
      program,
      config,
      poolCreator,
    );

    await dammMigration(
      svm,
      admin,
      poolCreator,
      program,
      virtualPoolAddress,
      config,
    );

    await claimProtocolLiquidityMigrationFeeAndAssert(
      svm,
      program,
      operator,
      config,
      virtualPoolAddress,
    );
  });
});

async function claimProtocolLiquidityMigrationFeeAndAssert(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  operator: Keypair,
  config: PublicKey,
  virtualPoolAddress: PublicKey,
) {
  let virtualPoolState = getVirtualPool(svm, program, virtualPoolAddress);

  const configState = getConfig(svm, program, config);

  const treasuryBaseTokenAddress = getAssociatedTokenAddressSync(
    virtualPoolState.baseMint,
    TREASURY,
    true,
  );

  const treasuryQuoteTokenAddress = getAssociatedTokenAddressSync(
    configState.quoteMint,
    TREASURY,
    true,
  );

  const beforeBaseTokenAccount = svm.getAccount(treasuryBaseTokenAddress);
  const beforeQuoteTokenAccount = svm.getAccount(treasuryQuoteTokenAddress);

  await claimProtocolFee(svm, program, {
    operator,
    pool: virtualPoolAddress,
  });

  const afterBaseTokenAccount = svm.getAccount(treasuryBaseTokenAddress);
  const afterQuoteTokenAccount = svm.getAccount(treasuryQuoteTokenAddress);

  const beforeBaseBalance = beforeBaseTokenAccount
    ? unpackAccount(treasuryBaseTokenAddress, {
        ...beforeBaseTokenAccount,
        data: Buffer.from(beforeBaseTokenAccount.data),
      }).amount
    : BigInt(0);

  const beforeQuoteBalance = beforeQuoteTokenAccount
    ? unpackAccount(treasuryQuoteTokenAddress, {
        ...beforeQuoteTokenAccount,
        data: Buffer.from(beforeQuoteTokenAccount.data),
      }).amount
    : BigInt(0);

  const afterBaseBalance = unpackAccount(treasuryBaseTokenAddress, {
    ...afterBaseTokenAccount,
    data: Buffer.from(afterBaseTokenAccount.data),
  }).amount;

  const afterQuoteBalance = unpackAccount(treasuryQuoteTokenAddress, {
    ...afterQuoteTokenAccount,
    data: Buffer.from(afterQuoteTokenAccount.data),
  }).amount;

  expect(afterBaseBalance >= beforeBaseBalance).to.be.true;
  expect(afterQuoteBalance >= beforeQuoteBalance).to.be.true;
}
