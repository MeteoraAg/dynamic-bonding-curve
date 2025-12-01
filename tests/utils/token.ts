import {
  AccountLayout,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
  MintLayout,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { LiteSVM, TransactionMetadata } from "litesvm";

export function getOrCreateAssociatedTokenAccount(
  svm: LiteSVM,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgram = TOKEN_PROGRAM_ID
) {
  const ataKey = getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);

  const account = svm.getAccount(ataKey);
  if (account === null) {
    const createAtaIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      ataKey,
      owner,
      mint,
      tokenProgram
    );
    let transaction = new Transaction();
    transaction.recentBlockhash = svm.latestBlockhash();
    transaction.add(createAtaIx);
    transaction.sign(payer);
    svm.sendTransaction(transaction);
  }

  return ataKey;
}

export function createToken(
  svm: LiteSVM,
  payer: Keypair,
  mintAuthority: PublicKey,
  decimal: number
): PublicKey {
  const mintKeypair = Keypair.generate();
  const rent = svm.getRent();
  const lamports = rent.minimumBalance(BigInt(MINT_SIZE));

  const createAccountIx = SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: mintKeypair.publicKey,
    space: MINT_SIZE,
    lamports: Number(lamports.toString()),
    programId: TOKEN_PROGRAM_ID,
  });

  const initializeMintIx = createInitializeMint2Instruction(
    mintKeypair.publicKey,
    decimal,
    mintAuthority,
    null
  );

  let transaction = new Transaction();
  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.add(createAccountIx, initializeMintIx);
  transaction.sign(payer, mintKeypair);

  const res = svm.sendTransaction(transaction);
  expect(res).instanceOf(TransactionMetadata);

  return mintKeypair.publicKey;
}

export function wrapSOL(svm: LiteSVM, payer: Keypair, amount: BN) {
  const solAta = getOrCreateAssociatedTokenAccount(
    svm,
    payer,
    NATIVE_MINT,
    payer.publicKey
  );

  const solTransferIx = SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: solAta,
    lamports: BigInt(amount.toString()),
  });

  const syncNativeIx = createSyncNativeInstruction(solAta);

  let transaction = new Transaction();
  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.add(solTransferIx, syncNativeIx);
  transaction.sign(payer);

  svm.sendTransaction(transaction);
}

export function mintSplTokenTo(
  svm: LiteSVM,
  payer: Keypair,
  mint: PublicKey,
  mintAuthority: Keypair,
  toWallet: PublicKey,
  rawAmount: bigint | number
) {
  const destination = getOrCreateAssociatedTokenAccount(
    svm,
    payer,
    mint,
    toWallet
  );

  const mintIx = createMintToInstruction(
    mint,
    destination,
    mintAuthority.publicKey,
    rawAmount
  );

  let transaction = new Transaction();
  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.add(mintIx);
  transaction.sign(payer, mintAuthority);
  svm.sendTransaction(transaction);
}

export function getMint(svm: LiteSVM, mint: PublicKey) {
  const account = svm.getAccount(mint);
  const mintState = MintLayout.decode(account.data);
  return mintState;
}

export function getTokenAccount(svm: LiteSVM, key: PublicKey) {
  const account = svm.getAccount(key);
  const tokenAccountState = AccountLayout.decode(account.data);
  return tokenAccountState;
}
