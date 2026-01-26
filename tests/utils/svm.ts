import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { LiteSVM } from "litesvm";
import path from "path";
import { derivePoolAuthority } from "./accounts";
import {
  DAMM_PROGRAM_ID,
  DAMM_V2_PROGRAM_ID,
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  FLASH_RENT_FUND,
  JUPITER_V6_PROGRAM_ID,
  LOCKER_PROGRAM_ID,
  METAPLEX_PROGRAM_ID,
  VAULT_PROGRAM_ID,
  ZAP_PROGRAM_ID,
} from "./constants";

export function startSvm() {
  const svm = new LiteSVM();

  const sourceFileDbcPath = path.resolve(
    "./target/deploy/dynamic_bonding_curve.so"
  );
  const sourceFileDammV2Path = path.resolve("./tests/fixtures/damm_v2.so");
  const sourceFileDammV1Path = path.resolve("./tests/fixtures/amm.so");
  const sourceFileAlphaVaultPath = path.resolve("./tests/fixtures/vault.so");
  const sourceFileLockerPath = path.resolve("./tests/fixtures/locker.so");
  const sourceFileMetaplexPath = path.resolve("./tests/fixtures/metaplex.so");
  const sourceFileZapProgramPath = path.resolve("./tests/fixtures/zap.so");
  const sourceFileJupiterPath = path.resolve("./tests/fixtures/jupiter.so");
  svm.addProgramFromFile(DYNAMIC_BONDING_CURVE_PROGRAM_ID, sourceFileDbcPath);
  svm.addProgramFromFile(DAMM_V2_PROGRAM_ID, sourceFileDammV2Path);
  svm.addProgramFromFile(DAMM_PROGRAM_ID, sourceFileDammV1Path);
  svm.addProgramFromFile(VAULT_PROGRAM_ID, sourceFileAlphaVaultPath);
  svm.addProgramFromFile(LOCKER_PROGRAM_ID, sourceFileLockerPath);
  svm.addProgramFromFile(METAPLEX_PROGRAM_ID, sourceFileMetaplexPath);
  svm.addProgramFromFile(ZAP_PROGRAM_ID, sourceFileZapProgramPath);
  svm.addProgramFromFile(JUPITER_V6_PROGRAM_ID, sourceFileJupiterPath);

  // set wrap sol mint account
  svm.setAccount(NATIVE_MINT, {
    data: new Uint8Array([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9, 1, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0,
    ]),
    executable: false,
    lamports: 1390379946687,
    owner: TOKEN_PROGRAM_ID,
  });
  svm.setAccount(derivePoolAuthority(), {
    lamports: FLASH_RENT_FUND,
    data: new Uint8Array(),
    owner: SystemProgram.programId,
    executable: false,
  });
  return svm;
}

export function generateAndFund(svm: LiteSVM): Keypair {
  const kp = Keypair.generate();
  svm.airdrop(kp.publicKey, BigInt(10000 * LAMPORTS_PER_SOL));
  return kp;
}

export function setNativeMint(svm: LiteSVM) {
  svm.setAccount(NATIVE_MINT, {
    data: new Uint8Array([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9, 1, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0,
    ]),
    executable: false,
    lamports: 1390379946687,
    owner: TOKEN_PROGRAM_ID,
  });
}
