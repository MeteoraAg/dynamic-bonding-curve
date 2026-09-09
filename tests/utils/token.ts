import {
  AccountLayout,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createInitializePermanentDelegateInstruction,
  createInitializeTransferFeeConfigInstruction,
  createMintToInstruction,
  createSetTransferFeeInstruction,
  createSyncNativeInstruction,
  createTransferCheckedWithTransferHookInstruction,
  ExtensionType,
  getAssociatedTokenAddressSync,
  getMintLen,
  getTransferHook,
  MINT_SIZE,
  MintLayout,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackMint,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { LiteSVM, TransactionMetadata } from "litesvm";
import {
  AccountsType,
  TransferHookAccountsInfo,
  VirtualCurveProgram,
} from "./types";
import { getVirtualPool } from "./fetcher";

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
  decimal: number = 9
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

export function createToken2022Mint(
  svm: LiteSVM,
  payer: Keypair,
  options: {
    decimals?: number;
    permanentDelegate?: PublicKey;
    transferFeeConfig?: {
      feeBasisPoints: number;
      maximumFee: bigint;
      transferFeeConfigAuthority?: PublicKey;
    };
  } = {}
): PublicKey {
  const { decimals = 9, permanentDelegate, transferFeeConfig } = options;
  const mintKeypair = Keypair.generate();
  const extensions = [];
  if (permanentDelegate) {
    extensions.push(ExtensionType.PermanentDelegate);
  }
  if (transferFeeConfig) {
    extensions.push(ExtensionType.TransferFeeConfig);
  }
  const mintLen = getMintLen(extensions);
  const rent = svm.getRent();
  const lamports = rent.minimumBalance(BigInt(mintLen));

  const transaction = new Transaction();
  transaction.add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: mintLen,
      lamports: Number(lamports.toString()),
      programId: TOKEN_2022_PROGRAM_ID,
    })
  );
  if (permanentDelegate) {
    transaction.add(
      createInitializePermanentDelegateInstruction(
        mintKeypair.publicKey,
        permanentDelegate,
        TOKEN_2022_PROGRAM_ID
      )
    );
  }
  if (transferFeeConfig) {
    transaction.add(
      createInitializeTransferFeeConfigInstruction(
        mintKeypair.publicKey,
        transferFeeConfig.transferFeeConfigAuthority ?? payer.publicKey,
        transferFeeConfig.transferFeeConfigAuthority ?? payer.publicKey,
        transferFeeConfig.feeBasisPoints,
        transferFeeConfig.maximumFee,
        TOKEN_2022_PROGRAM_ID
      )
    );
  }
  transaction.add(
    createInitializeMint2Instruction(
      mintKeypair.publicKey,
      decimals,
      payer.publicKey,
      null,
      TOKEN_2022_PROGRAM_ID
    )
  );
  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.sign(payer, mintKeypair);

  const res = svm.sendTransaction(transaction);
  expect(res).instanceOf(TransactionMetadata);

  return mintKeypair.publicKey;
}

export function setTransferFee(
  svm: LiteSVM,
  payer: Keypair,
  mint: PublicKey,
  transferFeeConfigAuthority: Keypair,
  feeBasisPoints: number,
  maximumFee: bigint
) {
  const transaction = new Transaction();
  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.add(
    createSetTransferFeeInstruction(
      mint,
      transferFeeConfigAuthority.publicKey,
      [],
      feeBasisPoints,
      maximumFee,
      TOKEN_2022_PROGRAM_ID
    )
  );
  transaction.sign(payer, transferFeeConfigAuthority);

  const res = svm.sendTransaction(transaction);
  expect(res).instanceOf(TransactionMetadata);
}

export function mintToken2022To(
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
    toWallet,
    TOKEN_2022_PROGRAM_ID
  );

  const mintIx = createMintToInstruction(
    mint,
    destination,
    mintAuthority.publicKey,
    rawAmount,
    [],
    TOKEN_2022_PROGRAM_ID
  );

  const transaction = new Transaction();
  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.add(mintIx);
  transaction.sign(payer, mintAuthority);

  const res = svm.sendTransaction(transaction);
  expect(res).instanceOf(TransactionMetadata);
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

export function getMint(
  svm: LiteSVM,
  mint: PublicKey,
  programId: PublicKey = TOKEN_PROGRAM_ID
) {
  const mintInfo = svm.getAccount(mint);
  if (!mintInfo || !mintInfo.data.length) throw new Error("Invalid mint");

  const mintState = unpackMint(
    mint,
    {
      ...mintInfo,
      data: Buffer.from(mintInfo.data),
    },
    programId
  );

  return mintState;
}
export function getTokenAccount(svm: LiteSVM, key: PublicKey) {
  const account = svm.getAccount(key);
  const tokenAccountState = AccountLayout.decode(account.data);
  return tokenAccountState;
}

export async function getExtraAccountMetasForTransferHook(
  svm: LiteSVM,
  mint: PublicKey
) {
  const connection: {
    getAccountInfo: Connection["getAccountInfo"];
    commitment: Connection["commitment"];
  } = {
    getAccountInfo: async (publicKey) => {
      const info = svm.getAccount(publicKey);
      if (!info) return null;
      return { ...info, data: Buffer.from(info.data) };
    },
    commitment: "confirmed",
  };

  const mintInfo = svm.getAccount(mint);
  if (!mintInfo) throw new Error("Invalid mint");
  if (mintInfo.owner.equals(TOKEN_PROGRAM_ID)) {
    return [];
  }

  const mintState = getMint(svm, mint, TOKEN_2022_PROGRAM_ID);
  const transferHook = getTransferHook(mintState);

  if (!transferHook || transferHook.programId.equals(PublicKey.default)) {
    return [];
  } else {
    const transferWithHookIx =
      await createTransferCheckedWithTransferHookInstruction(
        connection as Connection,
        PublicKey.default,
        mint,
        PublicKey.default,
        PublicKey.default,
        BigInt(0),
        mintState.decimals,
        [],
        connection.commitment,
        TOKEN_2022_PROGRAM_ID
      );

    // Only 4 keys needed if it's single signer. https://github.com/solana-labs/solana-program-library/blob/d72289c79a04411c69a8bf1054f7156b6196f9b3/token/js/src/extensions/transferFee/instructions.ts#L251
    return transferWithHookIx.keys.slice(4);
  }
}

export async function getRemainingAccountsForTransferHook(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  pool: PublicKey,
  accountTypes: (typeof AccountsType)[keyof typeof AccountsType][] = [
    AccountsType.TransferHookBase,
  ]
): Promise<{
  info: TransferHookAccountsInfo;
  accounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[];
}> {
  const account = svm.getAccount(pool);
  if (!account) {
    return { info: { slices: [] }, accounts: [] };
  }
  const poolState = getVirtualPool(svm, program, pool);
  const transferHookAccounts = await getExtraAccountMetasForTransferHook(
    svm,
    poolState.baseMint
  );

  if (transferHookAccounts.length === 0) {
    return { info: { slices: [] }, accounts: [] };
  }

  const slices = accountTypes.map((accountsType) => ({
    accountsType,
    length: transferHookAccounts.length,
  }));

  const accounts = accountTypes.flatMap(() => transferHookAccounts);

  return { info: { slices }, accounts };
}
