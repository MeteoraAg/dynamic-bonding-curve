import { ProgramTestContext } from "solana-bankrun";
import {
	createConfigForSwapDammv2,
	CreateConfigForSwapParams,
	createPoolWithSplToken,
	swap,
	SwapParams,
	creatorWithdrawMigrationFee,
	CreatorWithdrawMigrationFeeParams,
	withdrawLeftover,
} from "./instructions";
import { Pool, VirtualCurveProgram } from "../utils/types";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createDammV2Config, fundSol, getMint, startTest } from "../utils";
import {
	createVirtualCurveProgram,
	derivePoolAuthority,
} from "../utils";
import { getVirtualPool } from "../utils/fetcher";
import { NATIVE_MINT } from "@solana/spl-token";

import { createMeteoraDammV2Metadata, MigrateMeteoraDammV2Params, migrateToDammV2 } from "./instructions/dammV2Migration";

describe("Backwards compatibility - DAMMv2 migration", () => {
	let context: ProgramTestContext;
	let admin: Keypair;
	let operator: Keypair;
	let partner: Keypair;
	let user: Keypair;
	let poolCreator: Keypair;
	let program: VirtualCurveProgram;
	let config: PublicKey;
	let virtualPool: PublicKey;
	let virtualPoolState: Pool;
	let dammConfig: PublicKey;

	before(async () => {
		context = await startTest();
		admin = context.payer;
		operator = Keypair.generate();
		partner = Keypair.generate();
		user = Keypair.generate();
		poolCreator = Keypair.generate();
		const receivers = [
			operator.publicKey,
			partner.publicKey,
			user.publicKey,
			poolCreator.publicKey,
		];
		await fundSol(context.banksClient, admin, receivers);
		program = createVirtualCurveProgram();
	});

	it("createConfigSplTokenForSwapDammv2", async () => {
		const params: CreateConfigForSwapParams = {
			payer: partner,
			leftoverReceiver: partner.publicKey,
			feeClaimer: partner.publicKey,
			quoteMint: NATIVE_MINT,
		};
		config = await createConfigForSwapDammv2(context.banksClient, program, params);
	});

	it("initializeVirtualPoolWithSplToken", async () => {
		virtualPool = await createPoolWithSplToken(context.banksClient, program, {
			poolCreator,
			payer: operator,
			quoteMint: NATIVE_MINT,
			config,
		});
		virtualPoolState = await getVirtualPool(
			context.banksClient,
			program,
			virtualPool
		);
	});

	it("swap", async () => {
		const params: SwapParams = {
			config,
			payer: user,
			pool: virtualPool,
			inputTokenMint: NATIVE_MINT,
			outputTokenMint: virtualPoolState.baseMint,
			referralTokenAccount: null,
		};
		await swap(context.banksClient, program, params);
	});

	it("createConfigSplTokenForSwapDammv2", async () => {
		await createMeteoraDammV2Metadata(context.banksClient, program, {
			payer: admin,
			virtualPool,
			config,
		});
	});

	it("migrationDammV2", async () => {
		const poolAuthority = derivePoolAuthority();
		dammConfig = await createDammV2Config(
			context.banksClient,
			admin,
			poolAuthority
		);
		const migrationParams: MigrateMeteoraDammV2Params = {
			payer: admin,
			virtualPool,
			dammConfig,
		};

		await migrateToDammV2(context.banksClient, program, migrationParams);
	});

	it("withdrawMigrationFee", async () => {
		const migrationParams: CreatorWithdrawMigrationFeeParams = {
			creator: poolCreator,
			virtualPool,
		};

		await creatorWithdrawMigrationFee(context.banksClient, program, migrationParams);
	});

	it("withdrawLeftover", async () => {
		const withdrawLeftoverParams = {
			payer: poolCreator,
			virtualPool,
		};

		await withdrawLeftover(context.banksClient, program, withdrawLeftoverParams);
	});
});
