import {
  AnchorProvider,
  BN,
  IdlAccounts,
  Program,
  Wallet,
  web3,
} from "@coral-xyz/anchor";
import {
  AccountLayout,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
  MintLayout,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  FailedTransactionMetadata,
  LiteSVM,
  TransactionMetadata,
} from "litesvm";

import VirtualCurveIDL from "../../target/idl/dynamic_bonding_curve.json";
import { DynamicBondingCurve as VirtualCurve } from "../../target/types/dynamic_bonding_curve";

import VaultIDL from "../../idls/dynamic_vault.json";
import { DynamicVault as Vault } from "./idl/dynamic_vault";

import AmmIDL from "../../idls/dynamic_amm.json";

import DammV2IDL from "../../idls/damm_v2.json";

import { DynamicAmm as Damm } from "./idl/dynamic_amm";

import { CpAmm as DammV2 } from "./idl/damm_v2";

import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  Signer,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  DAMM_PROGRAM_ID,
  DAMM_V2_PROGRAM_ID,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
} from "./constants";
import { VirtualCurveProgram } from "./types";

export type DynamicVault = IdlAccounts<Vault>["vault"];
const BASE_ADDRESS = new PublicKey(
  "HWzXGcGHy4tcpYfaRDCyLNzXqBTv3E6BttpCH2vJxArv"
);

export function createVirtualCurveProgram(): VirtualCurveProgram {
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(
    new Connection(clusterApiUrl("devnet")),
    wallet,
    {}
  );

  const program = new Program<VirtualCurve>(
    VirtualCurveIDL as VirtualCurve,
    provider
  );
  return program;
}

export function createVaultProgram(): Program<Vault> {
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(
    new Connection(clusterApiUrl("devnet")),
    wallet,
    {}
  );

  const program = new Program<Vault>(VaultIDL, provider);
  return program;
}

export function createDammProgram() {
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(
    new Connection(clusterApiUrl("devnet")),
    wallet,
    {}
  );
  const program = new Program<Damm>(AmmIDL, provider);
  return program;
}

export function createDammV2Program() {
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(
    new Connection(clusterApiUrl("devnet")),
    wallet,
    {}
  );
  const program = new Program<DammV2>(DammV2IDL, provider);
  return program;
}

export function sendTransactionMaybeThrow(
  svm: LiteSVM,
  transaction: Transaction,
  signers: Signer[],
  logs = false
) {
  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.sign(...signers);
  const transactionMeta = svm.sendTransaction(transaction);
  svm.expireBlockhash();

  if (transactionMeta instanceof FailedTransactionMetadata) {
    throw Error(transactionMeta.meta().logs().toString());
  }

  if (logs) {
    console.log((transactionMeta as TransactionMetadata).logs());
  }
}

export async function expectThrowsAsync(
  fn: () => Promise<void>,
  errorMessage: String
) {
  try {
    await fn();
  } catch (err) {
    if (!(err instanceof Error)) {
      throw err;
    } else {
      if (!err.message.toLowerCase().includes(errorMessage.toLowerCase())) {
        throw new Error(
          `Unexpected error: ${err.message}. Expected error: ${errorMessage}`
        );
      }
      return;
    }
  }
  throw new Error("Expected an error but didn't get one");
}

export function getDbcProgramErrorCodeHexString(errorMessage: String) {
  const error = VirtualCurveIDL.errors.find(
    (e) =>
      e.name.toLowerCase() === errorMessage.toLowerCase() ||
      e.msg.toLowerCase() === errorMessage.toLowerCase()
  );

  if (!error) {
    throw new Error(
      `Unknown stake for fee error message / name: ${errorMessage}`
    );
  }

  return "0x" + error.code.toString(16);
}

export const wrapSOLInstruction = (
  from: PublicKey,
  to: PublicKey,
  amount: bigint
): TransactionInstruction[] => {
  return [
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: to,
      lamports: amount,
    }),
    new TransactionInstruction({
      keys: [
        {
          pubkey: to,
          isSigner: false,
          isWritable: true,
        },
      ],
      data: Buffer.from(new Uint8Array([17])),
      programId: TOKEN_PROGRAM_ID,
    }),
  ];
};

export const unwrapSOLInstruction = (
  owner: PublicKey,
  allowOwnerOffCurve = true
) => {
  const wSolATAAccount = getAssociatedTokenAddressSync(
    NATIVE_MINT,
    owner,
    allowOwnerOffCurve
  );
  if (wSolATAAccount) {
    const closedWrappedSolInstruction = createCloseAccountInstruction(
      wSolATAAccount,
      owner,
      owner,
      [],
      TOKEN_PROGRAM_ID
    );
    return closedWrappedSolInstruction;
  }
  return null;
};

export function getOrCreateAssociatedTokenAccount(
  svm: LiteSVM,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  program: PublicKey
): { ata: PublicKey; ix?: TransactionInstruction } {
  const ataKey = getAssociatedTokenAddressSync(mint, owner, true, program);

  const account = svm.getAccount(ataKey);
  if (account === null) {
    const createAtaIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      ataKey,
      owner,
      mint,
      program
    );
    return { ata: ataKey, ix: createAtaIx };
  }

  return { ata: ataKey, ix: undefined };
}

export function getTokenAccount(svm: LiteSVM, key: PublicKey) {
  const account = svm.getAccount(key);
  if (!account) {
    return null;
  }
  const tokenAccountState = AccountLayout.decode(account.data);
  return tokenAccountState;
}

export function getBalance(svm: LiteSVM, wallet: PublicKey) {
  const account = svm.getAccount(wallet);
  return account.lamports;
}

export function getMint(svm: LiteSVM, mint: PublicKey) {
  const account = svm.getAccount(mint);
  const mintState = MintLayout.decode(account.data);
  return mintState;
}

export async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

export function getCurrentSlot(svm: LiteSVM): BN {
  const slot = svm.getClock().slot;
  return new BN(slot.toString());
}

export function warpSlotBy(svm: LiteSVM, slots: BN) {
  svm.warpToSlot(BigInt(slots.toString()));
}

export const SET_COMPUTE_UNIT_LIMIT_IX =
  web3.ComputeBudgetProgram.setComputeUnitLimit({
    units: 1_400_000,
  });

export async function createInitializePermissionlessDynamicVaultIx(
  mint: PublicKey,
  payer: PublicKey
): Promise<{
  vaultKey: PublicKey;
  tokenVaultKey: PublicKey;
  lpMintKey: PublicKey;
  instruction: TransactionInstruction;
}> {
  const program = createVaultProgram();
  const vaultKey = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), mint.toBuffer(), BASE_ADDRESS.toBuffer()],
    program.programId
  )[0];

  const tokenVaultKey = PublicKey.findProgramAddressSync(
    [Buffer.from("token_vault"), vaultKey.toBuffer()],
    program.programId
  )[0];

  const lpMintKey = PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint"), vaultKey.toBuffer()],
    program.programId
  )[0];

  const ix = await program.methods
    .initialize()
    .accountsPartial({
      vault: vaultKey,
      tokenVault: tokenVaultKey,
      tokenMint: mint,
      lpMint: lpMintKey,
      payer,
      rent: SYSVAR_RENT_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  return {
    instruction: ix,
    vaultKey,
    tokenVaultKey,
    lpMintKey,
  };
}

export async function createVaultIfNotExists(
  svm: LiteSVM,
  mint: PublicKey,
  payer: Keypair
): Promise<{
  vaultPda: PublicKey;
  tokenVaultPda: PublicKey;
  lpMintPda: PublicKey;
}> {
  const vaultIx = await createInitializePermissionlessDynamicVaultIx(
    mint,
    payer.publicKey
  );

  const vaultAccount = svm.getAccount(vaultIx.vaultKey);
  if (!vaultAccount) {
    let tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.add(vaultIx.instruction);
    tx.sign(payer);
    svm.sendTransaction(tx);
  }

  return {
    vaultPda: vaultIx.vaultKey,
    tokenVaultPda: vaultIx.tokenVaultKey,
    lpMintPda: vaultIx.lpMintKey,
  };
}

export function getDynamicVault(svm: LiteSVM, vault: PublicKey): DynamicVault {
  const program = createVaultProgram();
  const account = svm.getAccount(vault);
  return program.coder.accounts.decode("Vault", Buffer.from(account.data));
}

export async function createDammConfig(
  svm: LiteSVM,
  payer: Keypair,
  poolCreatorAuthority: PublicKey
): Promise<PublicKey> {
  const program = createDammProgram();
  const params = {
    tradeFeeNumerator: new BN(250),
    protocolTradeFeeNumerator: new BN(10),
    activationDuration: new BN(0),
    vaultConfigKey: PublicKey.default,
    poolCreatorAuthority: poolCreatorAuthority,
    partnerFeeNumerator: new BN(0),
    activationType: 0, //slot
    index: new BN(1),
  };
  const [config] = PublicKey.findProgramAddressSync(
    [Buffer.from("config"), params.index.toBuffer("le", 8)],
    DAMM_PROGRAM_ID
  );

  const account = svm.getAccount(config);
  if (account) {
    return config;
  }

  const transaction = await program.methods
    .createConfig(params)
    .accounts({
      config,
      admin: payer.publicKey,
    })
    .transaction();

  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.sign(payer);
  svm.sendTransaction(transaction);

  return config;
}

export async function createDammV2Config(
  svm: LiteSVM,
  payer: Keypair,
  poolCreatorAuthority: PublicKey
): Promise<PublicKey> {
  const program = createDammV2Program();
  const params = {
    index: new BN(0),
    poolFees: {
      baseFee: {
        cliffFeeNumerator: new BN(2_500_000),
        numberOfPeriod: 0,
        reductionFactor: new BN(0),
        periodFrequency: new BN(0),
        feeSchedulerMode: 0,
      },
      protocolFeePercent: 10,
      partnerFeePercent: 0,
      referralFeePercent: 0,
      dynamicFee: null,
    },
    sqrtMinPrice: new BN(MIN_SQRT_PRICE),
    sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
    vaultConfigKey: PublicKey.default,
    poolCreatorAuthority,
    activationType: 0,
    collectFeeMode: 0,
  };
  const [config] = PublicKey.findProgramAddressSync(
    [Buffer.from("config"), params.index.toBuffer("le", 8)],
    DAMM_V2_PROGRAM_ID
  );
  const transaction = await program.methods
    .createConfig(new BN(0), params)
    .accountsPartial({
      config,
      admin: payer.publicKey,
    })
    .transaction();

  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.sign(payer);
  svm.sendTransaction(transaction);

  return config;
}

export async function createDammV2DynamicConfig(
  svm: LiteSVM,
  payer: Keypair,
  poolCreatorAuthority: PublicKey
): Promise<PublicKey> {
  const program = createDammV2Program();

  const [config] = PublicKey.findProgramAddressSync(
    [Buffer.from("config"), new BN(0).toBuffer("le", 8)],
    DAMM_V2_PROGRAM_ID
  );
  const transaction = await program.methods
    .createDynamicConfig(new BN(0), { poolCreatorAuthority })
    .accountsPartial({
      config,
      admin: payer.publicKey,
    })
    .transaction();

  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.sign(payer);
  svm.sendTransaction(transaction);

  return config;
}

export async function createLockEscrowIx(
  svm: LiteSVM,
  payer: Keypair,
  pool: PublicKey,
  lpMint: PublicKey,
  escrowOwner: PublicKey,
  lockEscrowKey: PublicKey
): Promise<PublicKey> {
  const program = createDammProgram();

  const transaction = await program.methods
    .createLockEscrow()
    .accountsPartial({
      pool,
      lpMint,
      owner: escrowOwner,
      lockEscrow: lockEscrowKey,
      systemProgram: SystemProgram.programId,
      payer: payer.publicKey,
    })
    .transaction();

  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.sign(payer);
  svm.sendTransaction(transaction);

  return lockEscrowKey;
}

export function getOrCreateAta(
  svm: LiteSVM,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey
) {
  const ataKey = getAssociatedTokenAddressSync(mint, owner, true);

  const account = svm.getAccount(ataKey);
  if (account === null) {
    const createAtaIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      ataKey,
      owner,
      mint
    );
    let transaction = new Transaction();
    transaction.recentBlockhash = svm.latestBlockhash();
    transaction.add(createAtaIx);
    transaction.sign(payer);
    svm.sendTransaction(transaction);
  }

  return ataKey;
}

export function getTokenProgram(flag: number): PublicKey {
  return flag == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
}
