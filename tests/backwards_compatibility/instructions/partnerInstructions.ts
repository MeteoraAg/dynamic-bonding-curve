import {
	Keypair,
	PublicKey,
	SystemProgram,
	TransactionInstruction,
	Transaction
} from "@solana/web3.js";
import { VirtualCurveProgram } from "../../utils/types";
import { BanksClient } from "solana-bankrun";
import {
	deriveEventAuthority,
	readIxData
} from "../utils";
import {
	derivePoolAuthority,
	processTransactionMaybeThrow,
	getOrCreateAssociatedTokenAccount,
	unwrapSOLInstruction,
	getTokenAccount,
	derivePartnerMetadata,
	getTokenProgram,
} from "../../utils";
import {
	getConfig,
	getPartnerMetadata,
	getVirtualPool,
} from "../../utils/fetcher";
import { expect } from "chai";
import {
	NATIVE_MINT,
	TOKEN_2022_PROGRAM_ID,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

export type CreateConfigParams = {
	payer: Keypair;
	leftoverReceiver: PublicKey;
	feeClaimer: PublicKey;
	quoteMint: PublicKey;
	token2022: boolean;
};

export async function createPartnerMetadata(
	banksClient: BanksClient,
	program: VirtualCurveProgram,
	params: {
		feeClaimer: Keypair;
		payer: Keypair;
	}
) {
	const { payer, feeClaimer, } = params;
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
		data: await readIxData("createPartnerMetadata")
	});

	const tx = new Transaction().add(ix);

	tx.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
	tx.sign(payer, feeClaimer);

	await processTransactionMaybeThrow(banksClient, tx);

	const metadataState = await getPartnerMetadata(
		banksClient,
		program,
		partnerMetadata
	);

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
	banksClient: BanksClient,
	program: VirtualCurveProgram,
	params: createConfigSplTokenWithBaseFeeParametersParams
): Promise<PublicKey> {
	const { payer, leftoverReceiver, feeClaimer, quoteMint } =
		params;
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
		data: await readIxData("createConfigSplTokenWithBaseFeeParameters")
	});

	const tx = new Transaction().add(ix);
	tx.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
	tx.sign(payer, config);

	await processTransactionMaybeThrow(banksClient, tx);

	const configState = await getConfig(banksClient, program, config.publicKey);

	expect(configState.quoteMint.toString()).equal(quoteMint.toString());

	return config.publicKey;
}

export async function createConfig(
	banksClient: BanksClient,
	program: VirtualCurveProgram,
	params: CreateConfigParams
): Promise<PublicKey> {
	const { payer, leftoverReceiver, feeClaimer, quoteMint } =
		params;
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
		data: await readIxData((params.token2022) ? "createConfigToken2022" : "createConfigSplToken")
	});

	const tx = new Transaction().add(ix);
	tx.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
	tx.sign(payer, config);

	await processTransactionMaybeThrow(banksClient, tx);

	const configState = await getConfig(banksClient, program, config.publicKey);

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
	banksClient: BanksClient,
	program: VirtualCurveProgram,
	params: CreateConfigForSwapParams
): Promise<PublicKey> {
	const { payer, leftoverReceiver, feeClaimer, quoteMint } =
		params;
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
		data: await readIxData("createConfigSplTokenForSwapDamm")
	});

	const tx = new Transaction().add(ix);
	tx.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
	tx.sign(payer, config);

	await processTransactionMaybeThrow(banksClient, tx);

	const configState = await getConfig(banksClient, program, config.publicKey);

	expect(configState.quoteMint.toString()).equal(quoteMint.toString());

	return config.publicKey;
}

export async function createConfigForSwapDammv2(
	banksClient: BanksClient,
	program: VirtualCurveProgram,
	params: CreateConfigForSwapParams
): Promise<PublicKey> {
	const { payer, leftoverReceiver, feeClaimer, quoteMint } =
		params;
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
		data: await readIxData("createConfigSplTokenForSwapDammv2")
	});

	const tx = new Transaction().add(ix);
	tx.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
	tx.sign(payer, config);

	await processTransactionMaybeThrow(banksClient, tx);

	const configState = await getConfig(banksClient, program, config.publicKey);

	expect(configState.quoteMint.toString()).equal(quoteMint.toString());

	return config.publicKey;
}

export type ClaimTradeFeeParams = {
	feeClaimer: Keypair;
	pool: PublicKey;
};
export async function claimTradingFee(
	banksClient: BanksClient,
	program: VirtualCurveProgram,
	params: ClaimTradeFeeParams
): Promise<any> {
	const { feeClaimer, pool } = params;
	const poolState = await getVirtualPool(banksClient, program, pool);
	const configState = await getConfig(banksClient, program, poolState.config);
	const poolAuthority = derivePoolAuthority();

	const quoteMintInfo = await getTokenAccount(
		banksClient,
		poolState.quoteVault
	);

	const tokenBaseProgram =
		configState.tokenType == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

	const tokenQuoteProgram =
		configState.quoteTokenFlag == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

	const preInstructions: TransactionInstruction[] = [];
	const postInstructions: TransactionInstruction[] = [];
	const [
		{ ata: baseTokenAccount, ix: createBaseTokenAccountIx },
		{ ata: quoteTokenAccount, ix: createQuoteTokenAccountIx },
	] = await Promise.all([
		getOrCreateAssociatedTokenAccount(
			banksClient,
			feeClaimer,
			poolState.baseMint,
			feeClaimer.publicKey,
			tokenBaseProgram
		),
		getOrCreateAssociatedTokenAccount(
			banksClient,
			feeClaimer,
			quoteMintInfo.mint,
			feeClaimer.publicKey,
			tokenQuoteProgram
		),
	]);
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

	tx.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
	tx.sign(feeClaimer);
	await processTransactionMaybeThrow(banksClient, tx);
}

export type PartnerWithdrawSurplusParams = {
	feeClaimer: Keypair;
	virtualPool: PublicKey;
};
export async function partnerWithdrawSurplus(
	banksClient: BanksClient,
	program: VirtualCurveProgram,
	params: PartnerWithdrawSurplusParams
): Promise<any> {
	const { feeClaimer, virtualPool } = params;
	const poolState = await getVirtualPool(banksClient, program, virtualPool);
	const poolAuthority = derivePoolAuthority();

	const quoteMintInfo = await getTokenAccount(
		banksClient,
		poolState.quoteVault
	);

	const preInstructions: TransactionInstruction[] = [];
	const postInstructions: TransactionInstruction[] = [];
	const { ata: tokenQuoteAccount, ix: createQuoteTokenAccountIx } =
		await getOrCreateAssociatedTokenAccount(
			banksClient,
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
		data: await readIxData("partnerWithdrawSurplus")
	});

	const tx = new Transaction().add(...preInstructions, ix, ...postInstructions);

	tx.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
	tx.sign(feeClaimer);
	await processTransactionMaybeThrow(banksClient, tx);
}

export async function withdrawLeftover(
	banksClient: BanksClient,
	program: VirtualCurveProgram,
	params: {
		payer: Keypair;
		virtualPool: PublicKey;
	}
): Promise<any> {
	const { payer, virtualPool } = params;
	const poolState = await getVirtualPool(banksClient, program, virtualPool);
	const configState = await getConfig(banksClient, program, poolState.config);
	const poolAuthority = derivePoolAuthority();

	const tokenBaseProgram =
		configState.tokenType == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

	const preInstructions: TransactionInstruction[] = [];
	const postInstructions: TransactionInstruction[] = [];
	const [{ ata: tokenBaseAccount, ix: createBaseTokenAccountIx }] =
		await Promise.all([
			getOrCreateAssociatedTokenAccount(
				banksClient,
				payer,
				poolState.baseMint,
				configState.leftoverReceiver,
				tokenBaseProgram
			),
		]);
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
			{ pubkey: configState.leftoverReceiver, isSigner: false, isWritable: false },
			{ pubkey: tokenBaseProgram, isSigner: false, isWritable: false },
			{ pubkey: eventAuthority, isSigner: false, isWritable: false },
			{ pubkey: program.programId, isSigner: false, isWritable: false },
		],
		data: await readIxData("withdrawLeftover")
	});

	const tx = new Transaction().add(...preInstructions, ix, ...postInstructions);

	tx.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
	tx.sign(payer);
	await processTransactionMaybeThrow(banksClient, tx);
}

export type PartnerWithdrawMigrationFeeParams = {
	partner: Keypair;
	virtualPool: PublicKey;
};
export async function partnerWithdrawMigrationFee(
	banksClient: BanksClient,
	program: VirtualCurveProgram,
	params: PartnerWithdrawMigrationFeeParams
): Promise<void> {
	const { partner, virtualPool } = params;
	const poolAuthority = derivePoolAuthority();
	const poolState = await getVirtualPool(banksClient, program, virtualPool);
	const configState = await getConfig(banksClient, program, poolState.config);

	const preInstructions: TransactionInstruction[] = [];
	const postInstructions: TransactionInstruction[] = [];
	const { ata: tokenQuoteAccount, ix: createQuoteTokenAccountIx } =
		await getOrCreateAssociatedTokenAccount(
			banksClient,
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
			{ pubkey: getTokenProgram(configState.quoteTokenFlag), isSigner: true, isWritable: false },
			{ pubkey: eventAuthority, isSigner: false, isWritable: false },
			{ pubkey: program.programId, isSigner: false, isWritable: false },
		],
		data: await readIxData("withdrawMigrationFee")
	});

	const tx = new Transaction().add(...preInstructions, ix, ...postInstructions);

	tx.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
	tx.sign(partner);
	await processTransactionMaybeThrow(banksClient, tx);
}
