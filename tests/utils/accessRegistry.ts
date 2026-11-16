/**
 * Helpers for the external access-registry program, which owns the TokenBadge accounts
 * that DBC accepts for a quote mint.
 *
 * The fixture is built with the `local` feature, which drops the hardcoded admin check so tests can create operators.
 */
import { AnchorProvider, BN, Program, Wallet } from "@anchor-lang/core";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import AccessRegistryIDL from "../../idls/access_registry.json";
import VirtualCurveIDL from "../../target/idl/dynamic_bonding_curve.json";
import { sendTransactionMaybeThrow } from "./common";
import {
  ACCESS_REGISTRY_PROGRAM_ID,
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
} from "./constants";
import { AccessRegistry } from "./idl/access_registry";
import { LiteSVM } from "./litesvmCompat";

// access-registry keeps its own permission set, unrelated to the DBC operator permissions
export enum AccessRegistryOperatorPermission {
  CreateTokenBadge = 0,
  CloseTokenBadge = 1,
}

export function createAccessRegistryProgram(): Program<AccessRegistry> {
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(
    new Connection(clusterApiUrl("devnet")),
    wallet,
    {}
  );
  return new Program<AccessRegistry>(
    AccessRegistryIDL as AccessRegistry,
    provider
  );
}

export function deriveAccessRegistryOperator(
  whitelistedAddress: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("operator"), whitelistedAddress.toBuffer()],
    ACCESS_REGISTRY_PROGRAM_ID
  )[0];
}

export function deriveAccessRegistryTokenBadge(
  tokenMint: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token_badge"), tokenMint.toBuffer()],
    ACCESS_REGISTRY_PROGRAM_ID
  )[0];
}

export async function createAccessRegistryOperator(
  svm: LiteSVM,
  admin: Keypair,
  whitelistedAddress: PublicKey,
  permissions: AccessRegistryOperatorPermission[]
): Promise<PublicKey> {
  const program = createAccessRegistryProgram();
  const operator = deriveAccessRegistryOperator(whitelistedAddress);
  const permission = new BN(permissions.reduce((acc, p) => acc | (1 << p), 0));

  const transaction = await program.methods
    .createOperatorAccount(permission)
    .accountsPartial({
      operator,
      whitelistedAddress,
      signer: admin.publicKey,
      payer: admin.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  sendTransactionMaybeThrow(svm, transaction, [admin]);
  return operator;
}

export async function createAccessRegistryTokenBadge(
  svm: LiteSVM,
  operator: Keypair,
  tokenMint: PublicKey,
  mintScore = 0
): Promise<PublicKey> {
  const program = createAccessRegistryProgram();
  const tokenBadge = deriveAccessRegistryTokenBadge(tokenMint);

  const transaction = await program.methods
    .createTokenBadge(mintScore)
    .accountsPartial({
      tokenBadge,
      tokenMint,
      operator: deriveAccessRegistryOperator(operator.publicKey),
      signer: operator.publicKey,
      payer: operator.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  sendTransactionMaybeThrow(svm, transaction, [operator]);
  return tokenBadge;
}

export async function closeAccessRegistryTokenBadge(
  svm: LiteSVM,
  operator: Keypair,
  tokenMint: PublicKey,
  rentReceiver: PublicKey
) {
  const program = createAccessRegistryProgram();

  const transaction = await program.methods
    .closeTokenBadge()
    .accountsPartial({
      tokenBadge: deriveAccessRegistryTokenBadge(tokenMint),
      operator: deriveAccessRegistryOperator(operator.publicKey),
      signer: operator.publicKey,
      rentReceiver,
    })
    .transaction();

  sendTransactionMaybeThrow(svm, transaction, [operator]);
}

/**
 * Writes a legacy DBC TokenBadge straight into the SVM, since `create_token_badge`
 * is deprecated. Layout: discriminator, token_mint, 128 bytes of padding.
 */
export function setLegacyTokenBadge(
  svm: LiteSVM,
  tokenBadge: PublicKey,
  tokenMint: PublicKey,
  owner: PublicKey = DYNAMIC_BONDING_CURVE_PROGRAM_ID
) {
  const discriminator = VirtualCurveIDL.accounts.find(
    (a) => a.name === "TokenBadge"
  )!.discriminator;
  const data = Buffer.alloc(8 + 32 + 128);
  Buffer.from(discriminator).copy(data, 0);
  tokenMint.toBuffer().copy(data, 8);

  svm.setAccount(tokenBadge, {
    data,
    executable: false,
    lamports: Number(svm.getRent().minimumBalance(BigInt(data.length))),
    owner,
  });
}
