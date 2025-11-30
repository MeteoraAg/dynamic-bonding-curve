import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  createVirtualCurveProgram,
  derivePoolAuthority,
  FLASH_RENT_FUND,
  generateAndFund,
  sendTransactionMaybeThrow,
  startSvm,
} from "./utils";
import { VirtualCurveProgram } from "./utils/types";

describe("Withdraw lamports from authority", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let program: VirtualCurveProgram;
  let treasury = new PublicKey("4EWqcx3aNZmMetCnxwLYwyNjan6XLGp3Ca2W316vrSjv");

  before(async () => {
    svm = startSvm();
    program = createVirtualCurveProgram();
    admin = generateAndFund(svm);
    svm.setAccount(treasury, {
      data: new Uint8Array(),
      executable: false,
      lamports: 1200626308,
      owner: SystemProgram.programId,
    });
  });

  it("test withdraw", async () => {
    let poolAuthority = derivePoolAuthority();

    svm.airdrop(poolAuthority, BigInt(LAMPORTS_PER_SOL));

    let prePoolAuthorityBalance = svm.getBalance(poolAuthority);

    let preTreasuryBalance = svm.getBalance(treasury);

    const withdrawTx = await program.methods
      .withdrawLamportsFromPoolAuthority()
      .accountsPartial({
        poolAuthority,
        receiver: treasury,
      })
      .transaction();
    sendTransactionMaybeThrow(svm, withdrawTx, [admin]);

    let postTreasuryBalance = svm.getBalance(treasury);

    expect(Number(postTreasuryBalance) - Number(preTreasuryBalance)).eq(
      Number(prePoolAuthorityBalance) - Number(FLASH_RENT_FUND)
    );
  });
});
