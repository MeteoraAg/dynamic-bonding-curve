import { ProgramTestContext } from "solana-bankrun";
import { VirtualCurveProgram } from "./utils/types";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  FLASH_RENT_FUND,
  fundSol,
  processTransactionMaybeThrow,
  startTest,
} from "./utils";
import { createVirtualCurveProgram, derivePoolAuthority } from "./utils";
import { expect } from "chai";

describe("Withdraw lamports from authority", () => {
  let context: ProgramTestContext;
  let program: VirtualCurveProgram;
  let treasury = new PublicKey("4EWqcx3aNZmMetCnxwLYwyNjan6XLGp3Ca2W316vrSjv");

  before(async () => {
    context = await startTest();
    program = createVirtualCurveProgram();
    context.setAccount(treasury, {
      data: new Uint8Array(),
      executable: false,
      lamports: 1200626308,
      owner: SystemProgram.programId,
    });
  });

  it("test withdraw", async () => {
    let poolAuthority = derivePoolAuthority();

    await fundSol(context.banksClient, context.payer, [poolAuthority]);

    let prePoolAuthorityBalance = (
      await context.banksClient.getAccount(poolAuthority)
    ).lamports;

    let preTreasuryBalance = (await context.banksClient.getAccount(treasury))
      .lamports;

    const withdrawTx = await program.methods
      .withdrawLamportsFromPoolAuthority()
      .accountsPartial({
        poolAuthority,
        receiver: treasury,
      })
      .transaction();

    withdrawTx.recentBlockhash = (
      await context.banksClient.getLatestBlockhash()
    )[0];
    withdrawTx.sign(context.payer);

    await processTransactionMaybeThrow(context.banksClient, withdrawTx);

    let postTreasuryBalance = (await context.banksClient.getAccount(treasury))
      .lamports;

    expect(postTreasuryBalance - preTreasuryBalance).eq(
      prePoolAuthorityBalance - FLASH_RENT_FUND
    );
  });
});
