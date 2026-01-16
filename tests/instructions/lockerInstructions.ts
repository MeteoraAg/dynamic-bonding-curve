import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { LiteSVM } from "litesvm";
import {
  deriveBaseKeyForLocker,
  derivePoolAuthority,
  getConfig,
  getOrCreateAssociatedTokenAccount,
  getVirtualPool,
  LOCKER_PROGRAM_ID,
  sendTransactionMaybeThrow,
  VirtualCurveProgram,
} from "../utils";

export type CreateLockerParameters = {
  payer: Keypair;
  virtualPool: PublicKey;
};

export async function createLocker(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: CreateLockerParameters
): Promise<any> {
  const { payer, virtualPool } = params;
  const virtualPoolState = getVirtualPool(svm, program, virtualPool);
  const configState = getConfig(svm, program, virtualPoolState.config);
  const base = deriveBaseKeyForLocker(virtualPool);
  const escrow = deriveLockerEscrow(base);
  const tokenProgram =
    configState.tokenType == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
  const preInstructions: TransactionInstruction[] = [];
  const { ata: escrowToken, ix: createOwnerEscrowVaultTokenXIx } =
    getOrCreateAssociatedTokenAccount(
      svm,
      payer,
      virtualPoolState.baseMint,
      escrow,
      tokenProgram
    );

  createOwnerEscrowVaultTokenXIx &&
    preInstructions.push(createOwnerEscrowVaultTokenXIx);

  const transaction = await program.methods
    .createLocker()
    .accountsPartial({
      virtualPool,
      config: virtualPoolState.config,
      poolAuthority: derivePoolAuthority(),
      baseVault: virtualPoolState.baseVault,
      baseMint: virtualPoolState.baseMint,
      base,
      creator: virtualPoolState.creator,
      escrow,
      escrowToken,
      payer: payer.publicKey,
      tokenProgram,
      lockerProgram: LOCKER_PROGRAM_ID,
      lockerEventAuthority: deriveLockerEventAuthority(),
      systemProgram: SystemProgram.programId,
    })
    .preInstructions(preInstructions)
    .transaction();

  sendTransactionMaybeThrow(svm, transaction, [payer]);
}

export const deriveLockerEscrow = (base: PublicKey) => {
  const [escrow] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), base.toBuffer()],
    LOCKER_PROGRAM_ID
  );
  return escrow;
};

export function deriveLockerEventAuthority() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    LOCKER_PROGRAM_ID
  )[0];
}
