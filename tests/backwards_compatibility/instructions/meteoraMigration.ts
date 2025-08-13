import {
	ComputeBudgetProgram,
	Keypair,
	PublicKey,
	SystemProgram,
	Transaction,
	SYSVAR_RENT_PUBKEY,
	TransactionInstruction,
} from "@solana/web3.js";
import {
	createVaultIfNotExists,
	DAMM_PROGRAM_ID,
	deriveDammPoolAddress,
	deriveLpMintAddress,
	deriveMetadataAccount,
	deriveMigrationMetadataAddress,
	derivePoolAuthority,
	deriveProtocolFeeAddress,
	deriveVaultLPAddress,
	getVirtualPool,
	getTokenAccount,
	METAPLEX_PROGRAM_ID,
	processTransactionMaybeThrow,
	VAULT_PROGRAM_ID,
	VirtualCurveProgram,
	createLockEscrowIx,
	getOrCreateAssociatedTokenAccount,
	getMeteoraDammMigrationMetadata,
	getConfig,
} from "../../utils";
import {
	deriveEventAuthority,
	readIxData
} from "../utils";
import { BanksClient } from "solana-bankrun";
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

export type CreateMeteoraMetadata = {
	payer: Keypair;
	virtualPool: PublicKey;
	config: PublicKey;
};

export async function createMeteoraMetadata(
	banksClient: BanksClient,
	program: VirtualCurveProgram,
	params: CreateMeteoraMetadata
): Promise<PublicKey> {
	const { payer, virtualPool, config } = params;
	const migrationMetadata = deriveMigrationMetadataAddress(virtualPool);
	const eventAuthority = deriveEventAuthority(program);

	const ix = new TransactionInstruction({
		programId: program.programId,
		keys: [
			{ pubkey: virtualPool, isSigner: false, isWritable: false },
			{ pubkey: config, isSigner: false, isWritable: false },
			{ pubkey: migrationMetadata, isSigner: false, isWritable: true },
			{ pubkey: payer.publicKey, isSigner: true, isWritable: true },
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
			{ pubkey: eventAuthority, isSigner: false, isWritable: false },
			{ pubkey: program.programId, isSigner: false, isWritable: false },
		],
		data: await readIxData("migrationMeteoraDammCreateMetadata"),
	});

	const tx = new Transaction().add(ix);
	tx.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
	tx.sign(payer);
	await processTransactionMaybeThrow(banksClient, tx);

	return migrationMetadata;
}

export type MigrateMeteoraParams = {
	payer: Keypair;
	virtualPool: PublicKey;
	dammConfig: PublicKey;
};

export async function migrateToMeteoraDamm(
	banksClient: BanksClient,
	program: VirtualCurveProgram,
	params: MigrateMeteoraParams
): Promise<any> {
	const { payer, virtualPool, dammConfig } = params;
	const virtualPoolState = await getVirtualPool(banksClient, program, virtualPool);
	const quoteMintInfo = await getTokenAccount(banksClient, virtualPoolState.quoteVault);
	const poolAuthority = derivePoolAuthority();
	const migrationMetadata = deriveMigrationMetadataAddress(virtualPool);

	const dammPool = deriveDammPoolAddress(dammConfig, virtualPoolState.baseMint, quoteMintInfo.mint);
	const lpMint = deriveLpMintAddress(dammPool);
	const mintMetadata = deriveMetadataAccount(lpMint);
	const protocolTokenAFee = deriveProtocolFeeAddress(virtualPoolState.baseMint, dammPool);
	const protocolTokenBFee = deriveProtocolFeeAddress(quoteMintInfo.mint, dammPool);

	const { vaultPda: aVault, tokenVaultPda: aTokenVault, lpMintPda: aVaultLpMint }
		= await createVaultIfNotExists(virtualPoolState.baseMint, banksClient, payer);
	const { vaultPda: bVault, tokenVaultPda: bTokenVault, lpMintPda: bVaultLpMint }
		= await createVaultIfNotExists(quoteMintInfo.mint, banksClient, payer);

	const aVaultLp = deriveVaultLPAddress(aVault, dammPool);
	const bVaultLp = deriveVaultLPAddress(bVault, dammPool);
	const virtualPoolLp = getAssociatedTokenAddressSync(
		lpMint, poolAuthority, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
	);

	const eventAuthority = deriveEventAuthority(program);

	const ix = new TransactionInstruction({
		programId: program.programId,
		keys: [
			{ pubkey: virtualPool, isSigner: false, isWritable: true },
			{ pubkey: migrationMetadata, isSigner: false, isWritable: true },
			{ pubkey: virtualPoolState.config, isSigner: false, isWritable: false },
			{ pubkey: poolAuthority, isSigner: false, isWritable: true },
			{ pubkey: dammPool, isSigner: false, isWritable: true },
			{ pubkey: dammConfig, isSigner: false, isWritable: false },
			{ pubkey: lpMint, isSigner: false, isWritable: true },
			{ pubkey: virtualPoolState.baseMint, isSigner: false, isWritable: true },
			{ pubkey: quoteMintInfo.mint, isSigner: false, isWritable: false },
			{ pubkey: aVault, isSigner: false, isWritable: true },
			{ pubkey: bVault, isSigner: false, isWritable: true },
			{ pubkey: aTokenVault, isSigner: false, isWritable: true },
			{ pubkey: bTokenVault, isSigner: false, isWritable: true },
			{ pubkey: aVaultLpMint, isSigner: false, isWritable: true },
			{ pubkey: bVaultLpMint, isSigner: false, isWritable: true },
			{ pubkey: aVaultLp, isSigner: false, isWritable: true },
			{ pubkey: bVaultLp, isSigner: false, isWritable: true },
			{ pubkey: virtualPoolState.baseVault, isSigner: false, isWritable: true },
			{ pubkey: virtualPoolState.quoteVault, isSigner: false, isWritable: true },
			{ pubkey: virtualPoolLp, isSigner: false, isWritable: true },
			{ pubkey: protocolTokenAFee, isSigner: false, isWritable: true },
			{ pubkey: protocolTokenBFee, isSigner: false, isWritable: true },
			{ pubkey: payer.publicKey, isSigner: true, isWritable: true },
			{ pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
			{ pubkey: mintMetadata, isSigner: false, isWritable: true },
			{ pubkey: METAPLEX_PROGRAM_ID, isSigner: false, isWritable: false },
			{ pubkey: DAMM_PROGRAM_ID, isSigner: false, isWritable: false },
			{ pubkey: VAULT_PROGRAM_ID, isSigner: false, isWritable: false },
			{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
			{ pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
		],
		data: await readIxData("migrateMeteoraDamm"),
	});

	const tx = new Transaction()
		.add(
			ComputeBudgetProgram.setComputeUnitLimit({
				units: 400_000,
			}))
		.add(ix);

	tx.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
	tx.sign(payer);
	await processTransactionMaybeThrow(banksClient, tx);
}

export type LockLPDammForCreatorParams = {
	payer: Keypair;
	virtualPool: PublicKey;
	dammConfig: PublicKey;
};

export async function lockLpForCreatorDamm(
	banksClient: BanksClient,
	program: VirtualCurveProgram,
	params: LockLPDammForCreatorParams
): Promise<PublicKey> {
	const { payer, virtualPool, dammConfig } = params;
	const virtualPoolState = await getVirtualPool(banksClient, program, virtualPool);
	const quoteMintInfo = await getTokenAccount(banksClient, virtualPoolState.quoteVault);
	const dammPool = deriveDammPoolAddress(dammConfig, virtualPoolState.baseMint, quoteMintInfo.mint);
	const poolAuthority = derivePoolAuthority();
	const migrationMetadata = deriveMigrationMetadataAddress(virtualPool);

	const [
		{ vaultPda: aVault, tokenVaultPda: aTokenVault, lpMintPda: aVaultLpMint },
		{ vaultPda: bVault, tokenVaultPda: bTokenVault, lpMintPda: bVaultLpMint },
	] = await Promise.all([
		createVaultIfNotExists(virtualPoolState.baseMint, banksClient, payer),
		createVaultIfNotExists(quoteMintInfo.mint, banksClient, payer),
	]);

	const [aVaultLp, bVaultLp] = [
		deriveVaultLPAddress(aVault, dammPool),
		deriveVaultLPAddress(bVault, dammPool),
	];

	const lpMint = deriveLpMintAddress(dammPool);
	const lockEscrowKey = PublicKey.findProgramAddressSync(
		[Buffer.from("lock_escrow"), dammPool.toBuffer(), virtualPoolState.creator.toBuffer()],
		DAMM_PROGRAM_ID
	)[0];

	const lockEscrowData = await banksClient.getAccount(lockEscrowKey);
	if (!lockEscrowData) {
		await createLockEscrowIx(
			banksClient,
			payer,
			dammPool,
			lpMint,
			virtualPoolState.creator,
			lockEscrowKey
		);
	}

	const preInstructions: TransactionInstruction[] = [];
	const { ata: escrowVault, ix: createEscrowVaultIx } =
		await getOrCreateAssociatedTokenAccount(
			banksClient,
			payer,
			lpMint,
			lockEscrowKey,
			TOKEN_PROGRAM_ID
		);
	createEscrowVaultIx && preInstructions.push(createEscrowVaultIx);

	const sourceTokens = getAssociatedTokenAddressSync(
		lpMint,
		poolAuthority,
		true,
		TOKEN_PROGRAM_ID,
		ASSOCIATED_TOKEN_PROGRAM_ID
	);

	const eventAuthority = deriveEventAuthority(program);

	const ix = new TransactionInstruction({
		programId: program.programId,
		keys: [
			{ pubkey: virtualPool, isSigner: false, isWritable: true },
			{ pubkey: migrationMetadata, isSigner: false, isWritable: true },
			{ pubkey: poolAuthority, isSigner: false, isWritable: true },
			{ pubkey: dammPool, isSigner: false, isWritable: true },
			{ pubkey: lpMint, isSigner: false, isWritable: true },
			{ pubkey: lockEscrowKey, isSigner: false, isWritable: true },
			{ pubkey: virtualPoolState.creator, isSigner: false, isWritable: false },
			{ pubkey: sourceTokens, isSigner: false, isWritable: true },
			{ pubkey: escrowVault, isSigner: false, isWritable: true },
			{ pubkey: DAMM_PROGRAM_ID, isSigner: false, isWritable: false },
			{ pubkey: aVault, isSigner: false, isWritable: false },
			{ pubkey: bVault, isSigner: false, isWritable: false },
			{ pubkey: aVaultLp, isSigner: false, isWritable: false },
			{ pubkey: bVaultLp, isSigner: false, isWritable: false },
			{ pubkey: aVaultLpMint, isSigner: false, isWritable: false },
			{ pubkey: bVaultLpMint, isSigner: false, isWritable: false },
			{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
			{ pubkey: eventAuthority, isSigner: false, isWritable: false },
			{ pubkey: program.programId, isSigner: false, isWritable: false },
		],
		data: await readIxData("migrateMeteoraDammLockLpToken"),
	});

	const tx = new Transaction().add(...preInstructions, ix);
	tx.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
	tx.sign(payer);
	await processTransactionMaybeThrow(banksClient, tx);

	return lockEscrowKey;
}

export type LockLPDammForPartnerParams = LockLPDammForCreatorParams;

export async function lockLpForPartnerDamm(
	banksClient: BanksClient,
	program: VirtualCurveProgram,
	params: LockLPDammForPartnerParams
): Promise<PublicKey> {
	const { payer, virtualPool, dammConfig } = params;
	const virtualPoolState = await getVirtualPool(banksClient, program, virtualPool);
	const quoteMintInfo = await getTokenAccount(banksClient, virtualPoolState.quoteVault);
	const dammPool = deriveDammPoolAddress(dammConfig, virtualPoolState.baseMint, quoteMintInfo.mint);
	const poolAuthority = derivePoolAuthority();
	const migrationMetadata = deriveMigrationMetadataAddress(virtualPool);
	const metaState = await getMeteoraDammMigrationMetadata(banksClient, program, migrationMetadata);
	const partner = metaState.partner;

	const [
		{ vaultPda: aVault, tokenVaultPda: aTokenVault, lpMintPda: aVaultLpMint },
		{ vaultPda: bVault, tokenVaultPda: bTokenVault, lpMintPda: bVaultLpMint },
	] = await Promise.all([
		createVaultIfNotExists(virtualPoolState.baseMint, banksClient, payer),
		createVaultIfNotExists(quoteMintInfo.mint, banksClient, payer),
	]);

	const [aVaultLp, bVaultLp] = [
		deriveVaultLPAddress(aVault, dammPool),
		deriveVaultLPAddress(bVault, dammPool),
	];

	const lpMint = deriveLpMintAddress(dammPool);

	const lockEscrowKey = PublicKey.findProgramAddressSync(
		[Buffer.from("lock_escrow"), dammPool.toBuffer(), partner.toBuffer()],
		DAMM_PROGRAM_ID
	)[0];

	if (!(await banksClient.getAccount(lockEscrowKey))) {
		await createLockEscrowIx(
			banksClient,
			payer,
			dammPool,
			lpMint,
			partner,
			lockEscrowKey
		);
	}

	const preInstructions: TransactionInstruction[] = [];
	const { ata: escrowVault, ix: createEscrowVaultIx } =
		await getOrCreateAssociatedTokenAccount(
			banksClient,
			payer,
			lpMint,
			lockEscrowKey,
			TOKEN_PROGRAM_ID
		);
	if (createEscrowVaultIx) preInstructions.push(createEscrowVaultIx);

	const sourceTokens = getAssociatedTokenAddressSync(
		lpMint,
		poolAuthority,
		true,
		TOKEN_PROGRAM_ID,
		ASSOCIATED_TOKEN_PROGRAM_ID
	);

	const eventAuthority = deriveEventAuthority(program);

	const ix = new TransactionInstruction({
		programId: program.programId,
		keys: [
			{ pubkey: virtualPool, isSigner: false, isWritable: true },
			{ pubkey: migrationMetadata, isSigner: false, isWritable: true },
			{ pubkey: poolAuthority, isSigner: false, isWritable: true },
			{ pubkey: dammPool, isSigner: false, isWritable: true },
			{ pubkey: lpMint, isSigner: false, isWritable: false },
			{ pubkey: lockEscrowKey, isSigner: false, isWritable: true },
			{ pubkey: partner, isSigner: false, isWritable: false },
			{ pubkey: sourceTokens, isSigner: false, isWritable: true },
			{ pubkey: escrowVault, isSigner: false, isWritable: true },
			{ pubkey: DAMM_PROGRAM_ID, isSigner: false, isWritable: false },
			{ pubkey: aVault, isSigner: false, isWritable: false },
			{ pubkey: bVault, isSigner: false, isWritable: false },
			{ pubkey: aVaultLp, isSigner: false, isWritable: false },
			{ pubkey: bVaultLp, isSigner: false, isWritable: false },
			{ pubkey: aVaultLpMint, isSigner: false, isWritable: false },
			{ pubkey: bVaultLpMint, isSigner: false, isWritable: false },
			{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
			{ pubkey: eventAuthority, isSigner: false, isWritable: false },
			{ pubkey: program.programId, isSigner: false, isWritable: false },
		],
		data: await readIxData("migrateMeteoraDammLockLpToken"),
	});

	const tx = new Transaction().add(...preInstructions, ix);
	tx.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
	tx.sign(payer);
	await processTransactionMaybeThrow(banksClient, tx);

	return lockEscrowKey;
}

export async function partnerClaimLpDamm(
	banksClient: BanksClient,
	program: VirtualCurveProgram,
	params: LockLPDammForPartnerParams
): Promise<void> {
	const { payer, virtualPool, dammConfig } = params;
	const virtualPoolState = await getVirtualPool(banksClient, program, virtualPool);
	const configState = await getConfig(banksClient, program, virtualPoolState.config);
	const dammPool = deriveDammPoolAddress(dammConfig, virtualPoolState.baseMint, configState.quoteMint);
	const poolAuthority = derivePoolAuthority();
	const migrationMetadata = deriveMigrationMetadataAddress(virtualPool);
	const lpMint = deriveLpMintAddress(dammPool);

	const preInstructions: TransactionInstruction[] = [];
	const { ata: destinationToken, ix: createDestinationTokenIx } =
		await getOrCreateAssociatedTokenAccount(
			banksClient,
			payer,
			lpMint,
			payer.publicKey,
			TOKEN_PROGRAM_ID
		);
	if (createDestinationTokenIx) preInstructions.push(createDestinationTokenIx);

	const sourceToken = getAssociatedTokenAddressSync(
		lpMint,
		poolAuthority,
		true,
		TOKEN_PROGRAM_ID,
		ASSOCIATED_TOKEN_PROGRAM_ID
	);

	const eventAuthority = deriveEventAuthority(program);

	const ix = new TransactionInstruction({
		programId: program.programId,
		keys: [
			{ pubkey: virtualPool, isSigner: false, isWritable: false },
			{ pubkey: migrationMetadata, isSigner: false, isWritable: true },
			{ pubkey: poolAuthority, isSigner: false, isWritable: true },
			{ pubkey: lpMint, isSigner: false, isWritable: false },
			{ pubkey: sourceToken, isSigner: false, isWritable: true },
			{ pubkey: destinationToken, isSigner: false, isWritable: true },
			{ pubkey: configState.feeClaimer, isSigner: false, isWritable: false },
			{ pubkey: payer.publicKey, isSigner: true, isWritable: false },
			{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
			{ pubkey: eventAuthority, isSigner: false, isWritable: false },
			{ pubkey: program.programId, isSigner: false, isWritable: false },
		],
		data: await readIxData("migrateMeteoraDammClaimLpToken"),
	});

	const tx = new Transaction().add(...preInstructions, ix);
	tx.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
	tx.sign(payer);
	await processTransactionMaybeThrow(banksClient, tx);
}

export async function creatorClaimLpDamm(
	banksClient: BanksClient,
	program: VirtualCurveProgram,
	params: LockLPDammForPartnerParams
): Promise<void> {
	const { payer, virtualPool, dammConfig } = params;
	const virtualPoolState = await getVirtualPool(banksClient, program, virtualPool);
	const configState = await getConfig(banksClient, program, virtualPoolState.config);
	const dammPool = deriveDammPoolAddress(dammConfig, virtualPoolState.baseMint, configState.quoteMint);
	const poolAuthority = derivePoolAuthority();
	const migrationMetadata = deriveMigrationMetadataAddress(virtualPool);
	const lpMint = deriveLpMintAddress(dammPool);

	const preInstructions: TransactionInstruction[] = [];
	const { ata: destinationToken, ix: createDestinationTokenIx } =
		await getOrCreateAssociatedTokenAccount(
			banksClient,
			payer,
			lpMint,
			payer.publicKey,
			TOKEN_PROGRAM_ID
		);
	if (createDestinationTokenIx) preInstructions.push(createDestinationTokenIx);

	const sourceToken = getAssociatedTokenAddressSync(
		lpMint,
		poolAuthority,
		true,
		TOKEN_PROGRAM_ID,
		ASSOCIATED_TOKEN_PROGRAM_ID
	);

	const eventAuthority = deriveEventAuthority(program);

	const ix = new TransactionInstruction({
		programId: program.programId,
		keys: [
			{ pubkey: virtualPool, isSigner: false, isWritable: false },
			{ pubkey: migrationMetadata, isSigner: false, isWritable: true },
			{ pubkey: poolAuthority, isSigner: false, isWritable: true },
			{ pubkey: lpMint, isSigner: false, isWritable: false },
			{ pubkey: sourceToken, isSigner: false, isWritable: true },
			{ pubkey: destinationToken, isSigner: false, isWritable: true },
			{ pubkey: virtualPoolState.creator, isSigner: false, isWritable: false },
			{ pubkey: payer.publicKey, isSigner: true, isWritable: false },
			{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
			{ pubkey: eventAuthority, isSigner: false, isWritable: false },
			{ pubkey: program.programId, isSigner: false, isWritable: false },
		],
		data: await readIxData("migrateMeteoraDammClaimLpToken"),
	});

	const tx = new Transaction().add(...preInstructions, ix);
	tx.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
	tx.sign(payer);
	await processTransactionMaybeThrow(banksClient, tx);
}
