import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { startAnchor } from "solana-bankrun";
import {
  DAMM_PROGRAM_ID,
  DAMM_V2_PROGRAM_ID,
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  FLASH_RENT_FUND,
  LOCKER_PROGRAM_ID,
  VAULT_PROGRAM_ID,
} from "./constants";
import { derivePoolAuthority, METAPLEX_PROGRAM_ID } from ".";
import {
  ACCOUNT_SIZE,
  AccountLayout,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

export const LOCAL_ADMIN_KEYPAIR = Keypair.fromSecretKey(
  Uint8Array.from([
    230, 207, 238, 109, 95, 154, 47, 93, 183, 250, 147, 189, 87, 15, 117, 184,
    44, 91, 94, 231, 126, 140, 238, 134, 29, 58, 8, 182, 88, 22, 113, 234, 8,
    234, 192, 109, 87, 125, 190, 55, 129, 173, 227, 8, 104, 201, 104, 13, 31,
    178, 74, 80, 54, 14, 77, 78, 226, 57, 47, 122, 166, 165, 57, 144,
  ])
);

export const VAULT_BASE_KEY = LOCAL_ADMIN_KEYPAIR.publicKey;

export const USDC = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);
export const ADMIN_USDC_ATA = getAssociatedTokenAddressSync(
  USDC,
  LOCAL_ADMIN_KEYPAIR.publicKey,
  true
);
const usdcToOwn = 1_000_000_000_000;
const tokenAccData = Buffer.alloc(ACCOUNT_SIZE);
AccountLayout.encode(
  {
    mint: USDC,
    owner: LOCAL_ADMIN_KEYPAIR.publicKey,
    amount: BigInt(usdcToOwn),
    delegateOption: 0,
    delegate: PublicKey.default,
    delegatedAmount: BigInt(0),
    state: 1,
    isNativeOption: 0,
    isNative: BigInt(0),
    closeAuthorityOption: 0,
    closeAuthority: PublicKey.default,
  },
  tokenAccData
);

export async function startTest() {
  // Program name need to match fixtures program name
  return startAnchor(
    "./",
    [
      {
        name: "dynamic_bonding_curve",
        programId: new PublicKey(DYNAMIC_BONDING_CURVE_PROGRAM_ID),
      },
      {
        name: "metaplex",
        programId: new PublicKey(METAPLEX_PROGRAM_ID),
      },
      {
        name: "amm",
        programId: new PublicKey(DAMM_PROGRAM_ID),
      },
      {
        name: "vault",
        programId: new PublicKey(VAULT_PROGRAM_ID),
      },
      {
        name: "damm_v2",
        programId: new PublicKey(DAMM_V2_PROGRAM_ID),
      },
      {
        name: "locker",
        programId: new PublicKey(LOCKER_PROGRAM_ID),
      },
    ],
    [
      {
        address: LOCAL_ADMIN_KEYPAIR.publicKey,
        info: {
          executable: false,
          owner: SystemProgram.programId,
          lamports: LAMPORTS_PER_SOL * 100,
          data: new Uint8Array(),
        },
      },
      {
        address: ADMIN_USDC_ATA,
        info: {
          lamports: 1_000_000_000,
          data: tokenAccData,
          owner: TOKEN_PROGRAM_ID,
          executable: false,
        },
      },
      {
        address: derivePoolAuthority(),
        info: {
          lamports: FLASH_RENT_FUND,
          data: new Uint8Array(),
          owner: SystemProgram.programId,
          executable: false,
        },
      },
    ]
  );
}
