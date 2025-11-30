import {
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  derivePartnerMetadata,
  derivePoolAuthority,
  getOrCreateAssociatedTokenAccount,
  getTokenAccount,
  getTokenProgram,
  sendTransactionMaybeThrow,
  unwrapSOLInstruction,
} from "../../utils";
import {
  getConfig,
  getPartnerMetadata,
  getVirtualPool,
} from "../../utils/fetcher";
import { VirtualCurveProgram } from "../../utils/types";
import { deriveEventAuthority, readIxData } from "../utils";

export type CreateConfigParams = {
  payer: Keypair;
  leftoverReceiver: PublicKey;
  feeClaimer: PublicKey;
  quoteMint: PublicKey;
  token2022: boolean;
};

export async function createPartnerMetadata(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: {
    feeClaimer: Keypair;
    payer: Keypair;
  }
) {
  const { payer, feeClaimer } = params;
  const partnerMetadata = derivePartnerMetadata(feeClaimer.publicKey);
  const eventAuthority = deriveEventAuthority(program);

  const ix = new TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: partnerMetadata, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: feeClaimer.publicKey, isSigner: true, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: program.programId, isSigner: false, isWritable: false },
    ],
    data: await readIxData("createPartnerMetadata"),
  });

  const tx = new Transaction().add(ix);
  sendTransactionMaybeThrow(svm, tx, [payer, feeClaimer]);

  const metadataState = getPartnerMetadata(svm, program, partnerMetadata);

  expect(metadataState.feeClaimer.toString()).equal(
    feeClaimer.publicKey.toString()
  );
  expect(metadataState.name.toString()).equal("name");
  expect(metadataState.website.toString()).equal("website");
  expect(metadataState.logo.toString()).equal("logo");
}

export type createConfigSplTokenWithBaseFeeParametersParams = {
  payer: Keypair;
  leftoverReceiver: PublicKey;
  feeClaimer: PublicKey;
  quoteMint: PublicKey;
};

export async function createConfigSplTokenWithBaseFeeParameters(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: createConfigSplTokenWithBaseFeeParametersParams
): Promise<PublicKey> {
  const { payer, leftoverReceiver, feeClaimer, quoteMint } = params;
  const config = Keypair.generate();
  const eventAuthority = deriveEventAuthority(program);

  const ix = new TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: config.publicKey, isSigner: true, isWritable: true },
      { pubkey: feeClaimer, isSigner: false, isWritable: false },
      { pubkey: leftoverReceiver, isSigner: false, isWritable: false },
      { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: program.programId, isSigner: false, isWritable: false },
    ],
    data: await readIxData("createConfigSplTokenWithBaseFeeParameters"),
  });

  const tx = new Transaction().add(ix);
  sendTransactionMaybeThrow(svm, tx, [payer, config]);

  const configState = getConfig(svm, program, config.publicKey);

  expect(configState.quoteMint.toString()).equal(quoteMint.toString());

  return config.publicKey;
}

export async function createConfig(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: CreateConfigParams
): Promise<PublicKey> {
  const { payer, leftoverReceiver, feeClaimer, quoteMint } = params;
  const config = Keypair.generate();
  const eventAuthority = deriveEventAuthority(program);

  const ix = new TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: config.publicKey, isSigner: true, isWritable: true },
      { pubkey: feeClaimer, isSigner: false, isWritable: false },
      { pubkey: leftoverReceiver, isSigner: false, isWritable: false },
      { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: program.programId, isSigner: false, isWritable: false },
    ],
    data: await readIxData(
      params.token2022 ? "createConfigToken2022" : "createConfigSplToken"
    ),
  });

  const tx = new Transaction().add(ix);
  sendTransactionMaybeThrow(svm, tx, [payer, config]);

  const configState = getConfig(svm, program, config.publicKey);

  expect(configState.quoteMint.toString()).equal(quoteMint.toString());

  return config.publicKey;
}

export type CreateConfigForSwapParams = {
  payer: Keypair;
  leftoverReceiver: PublicKey;
  feeClaimer: PublicKey;
  quoteMint: PublicKey;
};
export async function createConfigForSwapDamm(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: CreateConfigForSwapParams
): Promise<PublicKey> {
  const { payer, leftoverReceiver, feeClaimer, quoteMint } = params;
  const config = Keypair.generate();
  const eventAuthority = deriveEventAuthority(program);

  const ix = new TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: config.publicKey, isSigner: true, isWritable: true },
      { pubkey: feeClaimer, isSigner: false, isWritable: false },
      { pubkey: leftoverReceiver, isSigner: false, isWritable: false },
      { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: program.programId, isSigner: false, isWritable: false },
    ],
    data: await readIxData("createConfigSplTokenForSwapDamm"),
  });

  const tx = new Transaction().add(ix);
  sendTransactionMaybeThrow(svm, tx, [payer, config]);

  const configState = getConfig(svm, program, config.publicKey);

  expect(configState.quoteMint.toString()).equal(quoteMint.toString());

  return config.publicKey;
}

export async function createConfigForSwapDammv2(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: CreateConfigForSwapParams
): Promise<PublicKey> {
  const { payer, leftoverReceiver, feeClaimer, quoteMint } = params;
  const config = Keypair.generate();
  const eventAuthority = deriveEventAuthority(program);

  const ix = new TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: config.publicKey, isSigner: true, isWritable: true },
      { pubkey: feeClaimer, isSigner: false, isWritable: false },
      { pubkey: leftoverReceiver, isSigner: false, isWritable: false },
      { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: program.programId, isSigner: false, isWritable: false },
    ],
    data: await readIxData("createConfigSplTokenForSwapDammv2"),
  });

  const tx = new Transaction().add(ix);
  sendTransactionMaybeThrow(svm, tx, [payer, config]);

  const configState = getConfig(svm, program, config.publicKey);

  expect(configState.quoteMint.toString()).equal(quoteMint.toString());

  return config.publicKey;
}

export type ClaimTradeFeeParams = {
  feeClaimer: Keypair;
  pool: PublicKey;
};
export async function claimTradingFee(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: ClaimTradeFeeParams
): Promise<any> {
  const { feeClaimer, pool } = params;
  const poolState = getVirtualPool(svm, program, pool);
  const configState = getConfig(svm, program, poolState.config);
  const poolAuthority = derivePoolAuthority();

  const quoteMintInfo = getTokenAccount(svm, poolState.quoteVault);

  const tokenBaseProgram =
    configState.tokenType == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  const tokenQuoteProgram =
    configState.quoteTokenFlag == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  const preInstructions: TransactionInstruction[] = [];
  const postInstructions: TransactionInstruction[] = [];
  const [
    { ata: baseTokenAccount, ix: createBaseTokenAccountIx },
    { ata: quoteTokenAccount, ix: createQuoteTokenAccountIx },
  ] = [
    getOrCreateAssociatedTokenAccount(
      svm,
      feeClaimer,
      poolState.baseMint,
      feeClaimer.publicKey,
      tokenBaseProgram
    ),
    getOrCreateAssociatedTokenAccount(
      svm,
      feeClaimer,
      quoteMintInfo.mint,
      feeClaimer.publicKey,
      tokenQuoteProgram
    ),
  ];
  createBaseTokenAccountIx && preInstructions.push(createBaseTokenAccountIx);
  createQuoteTokenAccountIx && preInstructions.push(createQuoteTokenAccountIx);

  if (configState.quoteMint == NATIVE_MINT) {
    const unrapSOLIx = unwrapSOLInstruction(feeClaimer.publicKey);
    unrapSOLIx && postInstructions.push(unrapSOLIx);
  }

  const eventAuthority = deriveEventAuthority(program);

  const ix = new TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: poolAuthority, isSigner: false, isWritable: false },
      { pubkey: poolState.config, isSigner: false, isWritable: false },
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: baseTokenAccount, isSigner: false, isWritable: true },
      { pubkey: quoteTokenAccount, isSigner: false, isWritable: true },
      { pubkey: poolState.baseVault, isSigner: false, isWritable: true },
      { pubkey: poolState.quoteVault, isSigner: false, isWritable: true },
      { pubkey: poolState.baseMint, isSigner: false, isWritable: false },
      { pubkey: quoteMintInfo.mint, isSigner: false, isWritable: false },
      { pubkey: feeClaimer.publicKey, isSigner: true, isWritable: false },
      { pubkey: tokenBaseProgram, isSigner: false, isWritable: false },
      { pubkey: tokenQuoteProgram, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: program.programId, isSigner: false, isWritable: false },
    ],
    data: await readIxData("claimTradingFee"),
  });

  const tx = new Transaction().add(...preInstructions, ix, ...postInstructions);
  sendTransactionMaybeThrow(svm, tx, [feeClaimer]);
}

export type PartnerWithdrawSurplusParams = {
  feeClaimer: Keypair;
  virtualPool: PublicKey;
};
export async function partnerWithdrawSurplus(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: PartnerWithdrawSurplusParams
): Promise<any> {
  const { feeClaimer, virtualPool } = params;
  const poolState = getVirtualPool(svm, program, virtualPool);
  const poolAuthority = derivePoolAuthority();

  const quoteMintInfo = getTokenAccount(svm, poolState.quoteVault);

  const preInstructions: TransactionInstruction[] = [];
  const postInstructions: TransactionInstruction[] = [];
  const { ata: tokenQuoteAccount, ix: createQuoteTokenAccountIx } =
    getOrCreateAssociatedTokenAccount(
      svm,
      feeClaimer,
      quoteMintInfo.mint,
      feeClaimer.publicKey,
      TOKEN_PROGRAM_ID
    );

  createQuoteTokenAccountIx && preInstructions.push(createQuoteTokenAccountIx);

  if (quoteMintInfo.mint == NATIVE_MINT) {
    const unrapSOLIx = unwrapSOLInstruction(feeClaimer.publicKey);
    unrapSOLIx && postInstructions.push(unrapSOLIx);
  }

  const eventAuthority = deriveEventAuthority(program);

  const ix = new TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: poolAuthority, isSigner: false, isWritable: false },
      { pubkey: poolState.config, isSigner: false, isWritable: false },
      { pubkey: virtualPool, isSigner: false, isWritable: true },
      { pubkey: tokenQuoteAccount, isSigner: false, isWritable: true },
      { pubkey: poolState.quoteVault, isSigner: false, isWritable: true },
      { pubkey: quoteMintInfo.mint, isSigner: false, isWritable: false },
      { pubkey: feeClaimer.publicKey, isSigner: true, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: program.programId, isSigner: false, isWritable: false },
    ],
    data: await readIxData("partnerWithdrawSurplus"),
  });

  const tx = new Transaction().add(...preInstructions, ix, ...postInstructions);
  sendTransactionMaybeThrow(svm, tx, [feeClaimer]);
}

export async function withdrawLeftover(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: {
    payer: Keypair;
    virtualPool: PublicKey;
  }
): Promise<any> {
  const { payer, virtualPool } = params;
  const poolState = getVirtualPool(svm, program, virtualPool);
  const configState = getConfig(svm, program, poolState.config);
  const poolAuthority = derivePoolAuthority();

  const tokenBaseProgram =
    configState.tokenType == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  const preInstructions: TransactionInstruction[] = [];
  const postInstructions: TransactionInstruction[] = [];
  const [{ ata: tokenBaseAccount, ix: createBaseTokenAccountIx }] = [
    getOrCreateAssociatedTokenAccount(
      svm,
      payer,
      poolState.baseMint,
      configState.leftoverReceiver,
      tokenBaseProgram
    ),
  ];
  createBaseTokenAccountIx && preInstructions.push(createBaseTokenAccountIx);

  const eventAuthority = deriveEventAuthority(program);

  const ix = new TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: poolAuthority, isSigner: false, isWritable: false },
      { pubkey: poolState.config, isSigner: false, isWritable: false },
      { pubkey: virtualPool, isSigner: false, isWritable: true },
      { pubkey: tokenBaseAccount, isSigner: false, isWritable: true },
      { pubkey: poolState.baseVault, isSigner: false, isWritable: true },
      { pubkey: poolState.baseMint, isSigner: false, isWritable: false },
      {
        pubkey: configState.leftoverReceiver,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: tokenBaseProgram, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: program.programId, isSigner: false, isWritable: false },
    ],
    data: await readIxData("withdrawLeftover"),
  });

  const tx = new Transaction().add(...preInstructions, ix, ...postInstructions);
  sendTransactionMaybeThrow(svm, tx, [payer]);
}

export type PartnerWithdrawMigrationFeeParams = {
  partner: Keypair;
  virtualPool: PublicKey;
};
export async function partnerWithdrawMigrationFee(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: PartnerWithdrawMigrationFeeParams
): Promise<void> {
  const { partner, virtualPool } = params;
  const poolAuthority = derivePoolAuthority();
  const poolState = getVirtualPool(svm, program, virtualPool);
  const configState = getConfig(svm, program, poolState.config);

  const preInstructions: TransactionInstruction[] = [];
  const postInstructions: TransactionInstruction[] = [];
  const { ata: tokenQuoteAccount, ix: createQuoteTokenAccountIx } =
    getOrCreateAssociatedTokenAccount(
      svm,
      partner,
      configState.quoteMint,
      partner.publicKey,
      getTokenProgram(configState.quoteTokenFlag)
    );

  createQuoteTokenAccountIx && preInstructions.push(createQuoteTokenAccountIx);

  if (configState.quoteMint.equals(NATIVE_MINT)) {
    const unrapSOLIx = unwrapSOLInstruction(partner.publicKey);
    unrapSOLIx && postInstructions.push(unrapSOLIx);
  }

  const eventAuthority = deriveEventAuthority(program);

  const ix = new TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: poolAuthority, isSigner: false, isWritable: false },
      { pubkey: poolState.config, isSigner: false, isWritable: false },
      { pubkey: virtualPool, isSigner: false, isWritable: true },
      { pubkey: tokenQuoteAccount, isSigner: false, isWritable: true },
      { pubkey: poolState.quoteVault, isSigner: false, isWritable: true },
      { pubkey: configState.quoteMint, isSigner: false, isWritable: false },
      { pubkey: partner.publicKey, isSigner: true, isWritable: false },
      {
        pubkey: getTokenProgram(configState.quoteTokenFlag),
        isSigner: true,
        isWritable: false,
      },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: program.programId, isSigner: false, isWritable: false },
    ],
    data: await readIxData("withdrawMigrationFee"),
  });

  const tx = new Transaction().add(...preInstructions, ix, ...postInstructions);
  sendTransactionMaybeThrow(svm, tx, [partner]);
}
