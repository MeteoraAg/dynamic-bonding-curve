import {
	ComputeBudgetProgram,
	Keypair,
	PublicKey,
	SystemProgram,
	Transaction,
	TransactionInstruction,
} from "@solana/web3.js";
import {
	getVirtualPool,
	processTransactionMaybeThrow,
	VirtualCurveProgram,
	getConfig,
	deriveDammV2PoolAddress,
	DAMM_V2_PROGRAM_ID,
	deriveMigrationDammV2MetadataAddress,
	derivePoolAuthority,
} from "../../utils";
import {
	deriveEventAuthority,
	readIxData
} from "../utils";
import { BanksClient } from "solana-bankrun";
import {
	TOKEN_2022_PROGRAM_ID,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

export type CreateMeteoraDammV2Metadata = {
	payer: Keypair;
	virtualPool: PublicKey;
	config: PublicKey;
};

export async function createMeteoraDammV2Metadata(
	banksClient: BanksClient,
	program: VirtualCurveProgram,
	params: CreateMeteoraDammV2Metadata
): Promise<void> {
	const { payer, virtualPool, config } = params;
	const migrationMetadata = deriveMigrationDammV2MetadataAddress(virtualPool);
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
		data: await readIxData("migrationDammV2CreateMetadata"),
	});

	const tx = new Transaction().add(ix);
	tx.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
	tx.sign(payer);
	await processTransactionMaybeThrow(banksClient, tx);
}

export type MigrateMeteoraDammV2Params = {
	payer: Keypair;
	virtualPool: PublicKey;
	dammConfig: PublicKey;
};

export async function migrateToDammV2(
	banksClient: BanksClient,
	program: VirtualCurveProgram,
	params: MigrateMeteoraDammV2Params
): Promise<any> {
	const { payer, virtualPool, dammConfig } = params;
	const virtualPoolState = await getVirtualPool(banksClient, program, virtualPool);
	const configState = await getConfig(banksClient, program, virtualPoolState.config);
	const poolAuthority = derivePoolAuthority();
	const migrationMetadata = deriveMigrationDammV2MetadataAddress(virtualPool);
	const dammPool = deriveDammV2PoolAddress(dammConfig, virtualPoolState.baseMint, configState.quoteMint);

	const firstPositionNftKP = Keypair.generate();
	const firstPosition = derivePositionAddress(firstPositionNftKP.publicKey);
	const firstPositionNftAccount = derivePositionNftAccount(firstPositionNftKP.publicKey);

	const secondPositionNftKP = Keypair.generate();
	const secondPosition = derivePositionAddress(secondPositionNftKP.publicKey);
	const secondPositionNftAccount = derivePositionNftAccount(secondPositionNftKP.publicKey);

	const dammPoolAuthority = deriveDammV2PoolAuthority();
	const tokenAVault = deriveTokenVaultAddress(virtualPoolState.baseMint, dammPool);
	const tokenBVault = deriveTokenVaultAddress(configState.quoteMint, dammPool);

	const tokenBaseProgram =
		configState.tokenType === 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
	const tokenQuoteProgram =
		configState.quoteTokenFlag === 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

	const eventAuthority = deriveEventAuthority(program);
	const dammEventAuthority = deriveDammV2EventAuthority();

	const ix = new TransactionInstruction({
		programId: program.programId,
		keys: [
			{ pubkey: virtualPool, isSigner: false, isWritable: true },
			{ pubkey: migrationMetadata, isSigner: false, isWritable: false },
			{ pubkey: virtualPoolState.config, isSigner: false, isWritable: false },
			{ pubkey: poolAuthority, isSigner: false, isWritable: true },
			{ pubkey: dammPool, isSigner: false, isWritable: true },
			{ pubkey: firstPositionNftKP.publicKey, isSigner: false, isWritable: true },
			{ pubkey: firstPositionNftAccount, isSigner: false, isWritable: true },
			{ pubkey: firstPosition, isSigner: false, isWritable: true },
			{ pubkey: secondPositionNftKP.publicKey, isSigner: false, isWritable: true },
			{ pubkey: secondPositionNftAccount, isSigner: false, isWritable: true },
			{ pubkey: secondPosition, isSigner: false, isWritable: true },
			{ pubkey: dammPoolAuthority, isSigner: false, isWritable: false },
			{ pubkey: DAMM_V2_PROGRAM_ID, isSigner: false, isWritable: false },
			{ pubkey: virtualPoolState.baseMint, isSigner: false, isWritable: true },
			{ pubkey: configState.quoteMint, isSigner: false, isWritable: true },
			{ pubkey: tokenAVault, isSigner: false, isWritable: true },
			{ pubkey: tokenBVault, isSigner: false, isWritable: true },
			{ pubkey: virtualPoolState.baseVault, isSigner: false, isWritable: true },
			{ pubkey: virtualPoolState.quoteVault, isSigner: false, isWritable: true },
			{ pubkey: payer.publicKey, isSigner: true, isWritable: true },
			{ pubkey: tokenBaseProgram, isSigner: false, isWritable: false },
			{ pubkey: tokenQuoteProgram, isSigner: false, isWritable: false },
			{ pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
			{ pubkey: dammEventAuthority, isSigner: false, isWritable: false },
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
			{ pubkey: dammConfig, isSigner: false, isWritable: false },
		],
		data: await readIxData("migrationDammV2"),
	});

	const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
		units: 500_000,
	});

	const tx = new Transaction()
		.add(ix)
		.add(computeBudgetIx);

	tx.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
	tx.sign(payer, firstPositionNftKP, secondPositionNftKP);
	await processTransactionMaybeThrow(banksClient, tx);
}

export function deriveDammV2EventAuthority() {
	return PublicKey.findProgramAddressSync(
		[Buffer.from("__event_authority")],
		DAMM_V2_PROGRAM_ID
	)[0];
}
export function derivePositionAddress(positionNft: PublicKey): PublicKey {
	return PublicKey.findProgramAddressSync(
		[Buffer.from("position"), positionNft.toBuffer()],
		DAMM_V2_PROGRAM_ID
	)[0];
}

export function derivePositionNftAccount(
	positionNftMint: PublicKey
): PublicKey {
	return PublicKey.findProgramAddressSync(
		[Buffer.from("position_nft_account"), positionNftMint.toBuffer()],
		DAMM_V2_PROGRAM_ID
	)[0];
}


export function deriveDammV2PoolAuthority(): PublicKey {
	return PublicKey.findProgramAddressSync(
		[Buffer.from("pool_authority")],
		DAMM_V2_PROGRAM_ID
	)[0];
}

export function deriveTokenVaultAddress(
	tokenMint: PublicKey,
	pool: PublicKey
): PublicKey {
	return PublicKey.findProgramAddressSync(
		[Buffer.from("token_vault"), tokenMint.toBuffer(), pool.toBuffer()],
		DAMM_V2_PROGRAM_ID
	)[0];
}
