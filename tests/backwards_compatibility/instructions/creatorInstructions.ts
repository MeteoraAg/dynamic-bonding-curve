import {
	Keypair,
	PublicKey,
	TransactionInstruction,
	Transaction
} from "@solana/web3.js";
import { VirtualCurveProgram } from "../../utils/types";
import { BanksClient } from "solana-bankrun";
import {
	derivePoolAuthority,
	processTransactionMaybeThrow,
	getOrCreateAssociatedTokenAccount,
	unwrapSOLInstruction,
	getTokenAccount,
	deriveMigrationMetadataAddress,
	getTokenProgram,
} from "../../utils";
import {
	deriveEventAuthority,
	readIxData
} from "../utils";
import { getConfig, getVirtualPool } from "../../utils/fetcher";
import {
	NATIVE_MINT,
	TOKEN_2022_PROGRAM_ID,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

export type ClaimCreatorTradeFeeParams = {
	creator: Keypair;
	pool: PublicKey;
};

export async function claimCreatorTradingFee(
	banksClient: BanksClient,
	program: VirtualCurveProgram,
	params: ClaimCreatorTradeFeeParams
): Promise<any> {
	const { creator, pool } = params;
	const poolState = await getVirtualPool(banksClient, program, pool);
	const configState = await getConfig(banksClient, program, poolState.config);
	const poolAuthority = derivePoolAuthority();

	const quoteMintInfo = await getTokenAccount(
		banksClient,
		poolState.quoteVault
	);

	const tokenBaseProgram =
		configState.tokenType === 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
	const tokenQuoteProgram =
		configState.quoteTokenFlag === 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

	const preInstructions: TransactionInstruction[] = [];
	const postInstructions: TransactionInstruction[] = [];

	const [
		{ ata: baseTokenAccount, ix: createBaseTokenAccountIx },
		{ ata: quoteTokenAccount, ix: createQuoteTokenAccountIx },
	] = await Promise.all([
		getOrCreateAssociatedTokenAccount(
			banksClient,
			creator,
			poolState.baseMint,
			creator.publicKey,
			tokenBaseProgram
		),
		getOrCreateAssociatedTokenAccount(
			banksClient,
			creator,
			quoteMintInfo.mint,
			creator.publicKey,
			tokenQuoteProgram
		),
	]);
	createBaseTokenAccountIx && preInstructions.push(createBaseTokenAccountIx);
	createQuoteTokenAccountIx && preInstructions.push(createQuoteTokenAccountIx);

	if (configState.quoteMint === NATIVE_MINT) {
		const unwrapSOLIx = unwrapSOLInstruction(creator.publicKey);
		unwrapSOLIx && postInstructions.push(unwrapSOLIx);
	}

	const eventAuthority = deriveEventAuthority(program);

	const ix = new TransactionInstruction({
		programId: program.programId,
		keys: [
			{ pubkey: poolAuthority, isSigner: false, isWritable: false },
			{ pubkey: pool, isSigner: false, isWritable: true },
			{ pubkey: baseTokenAccount, isSigner: false, isWritable: true },
			{ pubkey: quoteTokenAccount, isSigner: false, isWritable: true },
			{ pubkey: poolState.baseVault, isSigner: false, isWritable: true },
			{ pubkey: poolState.quoteVault, isSigner: false, isWritable: true },
			{ pubkey: poolState.baseMint, isSigner: false, isWritable: false },
			{ pubkey: quoteMintInfo.mint, isSigner: false, isWritable: false },
			{ pubkey: creator.publicKey, isSigner: true, isWritable: false },
			{ pubkey: tokenBaseProgram, isSigner: false, isWritable: false },
			{ pubkey: tokenQuoteProgram, isSigner: false, isWritable: false },
			{ pubkey: eventAuthority, isSigner: false, isWritable: false },
			{ pubkey: program.programId, isSigner: false, isWritable: false },
		],
		data: await readIxData("claimCreatorTradingFee"),
	});

	const tx = new Transaction().add(...preInstructions, ix, ...postInstructions);
	tx.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
	tx.sign(creator);
	await processTransactionMaybeThrow(banksClient, tx);
}

export type CreatorWithdrawSurplusParams = {
	creator: Keypair;
	virtualPool: PublicKey;
};

export async function creatorWithdrawSurplus(
	banksClient: BanksClient,
	program: VirtualCurveProgram,
	params: CreatorWithdrawSurplusParams
): Promise<any> {
	const { creator, virtualPool } = params;
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
			creator,
			quoteMintInfo.mint,
			creator.publicKey,
			TOKEN_PROGRAM_ID
		);
	createQuoteTokenAccountIx && preInstructions.push(createQuoteTokenAccountIx);

	if (quoteMintInfo.mint === NATIVE_MINT) {
		const unwrapSOLIx = unwrapSOLInstruction(creator.publicKey);
		unwrapSOLIx && postInstructions.push(unwrapSOLIx);
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
			{ pubkey: creator.publicKey, isSigner: true, isWritable: false },
			{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
			{ pubkey: eventAuthority, isSigner: false, isWritable: false },
			{ pubkey: program.programId, isSigner: false, isWritable: false },
		],
		data: await readIxData("creatorWithdrawSurplus"),
	});

	const tx = new Transaction().add(...preInstructions, ix, ...postInstructions);
	tx.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
	tx.sign(creator);
	await processTransactionMaybeThrow(banksClient, tx);
}

export async function transferCreator(
	banksClient: BanksClient,
	program: VirtualCurveProgram,
	virtualPool: PublicKey,
	creator: Keypair,
	newCreator: PublicKey
): Promise<void> {
	const poolState = await getVirtualPool(banksClient, program, virtualPool);
	const migrationMetadata = deriveMigrationMetadataAddress(virtualPool);
	const eventAuthority = deriveEventAuthority(program);

	const ix = new TransactionInstruction({
		programId: program.programId,
		keys: [
			{ pubkey: virtualPool, isSigner: false, isWritable: true },
			{ pubkey: poolState.config, isSigner: false, isWritable: false },
			{ pubkey: creator.publicKey, isSigner: true, isWritable: false },
			{ pubkey: newCreator, isSigner: false, isWritable: false },
			{ pubkey: eventAuthority, isSigner: false, isWritable: false },
			{ pubkey: program.programId, isSigner: false, isWritable: false },
			// remaining_accounts: migration_metadata_account
			{ pubkey: migrationMetadata, isSigner: false, isWritable: false },
		],
		data: await readIxData("transferPoolCreator"),
	});

	const tx = new Transaction().add(ix);
	tx.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
	tx.sign(creator);
	await processTransactionMaybeThrow(banksClient, tx);
}

export type CreatorWithdrawMigrationFeeParams = {
	creator: Keypair;
	virtualPool: PublicKey;
};

export async function creatorWithdrawMigrationFee(
	banksClient: BanksClient,
	program: VirtualCurveProgram,
	params: CreatorWithdrawMigrationFeeParams
): Promise<void> {
	const { creator, virtualPool } = params;
	const poolAuthority = derivePoolAuthority();
	const poolState = await getVirtualPool(banksClient, program, virtualPool);
	const configState = await getConfig(banksClient, program, poolState.config);

	const preInstructions: TransactionInstruction[] = [];
	const postInstructions: TransactionInstruction[] = [];
	const { ata: tokenQuoteAccount, ix: createQuoteTokenAccountIx } =
		await getOrCreateAssociatedTokenAccount(
			banksClient,
			creator,
			configState.quoteMint,
			creator.publicKey,
			getTokenProgram(configState.quoteTokenFlag)
		);
	createQuoteTokenAccountIx && preInstructions.push(createQuoteTokenAccountIx);

	if (configState.quoteMint.equals(NATIVE_MINT)) {
		const unwrapSOLIx = unwrapSOLInstruction(creator.publicKey);
		unwrapSOLIx && postInstructions.push(unwrapSOLIx);
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
			{ pubkey: creator.publicKey, isSigner: true, isWritable: false },
			{ pubkey: getTokenProgram(configState.quoteTokenFlag), isSigner: false, isWritable: false },
			{ pubkey: eventAuthority, isSigner: false, isWritable: false },
			{ pubkey: program.programId, isSigner: false, isWritable: false },
		],
		data: await readIxData("creatorWithdrawMigrationFee"),
	});

	const tx = new Transaction().add(...preInstructions, ix, ...postInstructions);
	tx.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
	tx.sign(creator);
	await processTransactionMaybeThrow(banksClient, tx);
}
