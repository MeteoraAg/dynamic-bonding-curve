import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { LiteSVM } from "litesvm";
import { TRANSFER_HOOK_COUNTER_PROGRAM_ID } from "./constants";
import { createTransferHookCounterProgram } from "./common";
import { sendTransactionMaybeThrow } from "./common";

export function deriveExtraAccountMetaList(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.toBuffer()],
    TRANSFER_HOOK_COUNTER_PROGRAM_ID
  );
  return pda;
}

export function deriveCounterAccount(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("counter"), mint.toBuffer()],
    TRANSFER_HOOK_COUNTER_PROGRAM_ID
  );
  return pda;
}

export async function initializeExtraAccountMetaList(
  svm: LiteSVM,
  payer: Keypair,
  mint: PublicKey
) {
  const extraAccountMetaList = deriveExtraAccountMetaList(mint);
  const counterAccount = deriveCounterAccount(mint);

  const transaction = await createTransferHookCounterProgram()
    .methods.initializeExtraAccountMetaList()
    .accountsPartial({
      payer: payer.publicKey,
      extraAccountMetaList,
      mint,
      counterAccount,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  sendTransactionMaybeThrow(svm, transaction, [payer]);
}
