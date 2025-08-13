import { ProgramTestContext } from "solana-bankrun";
import {
	createPoolWithSplToken,
	swap,
	SwapParams,
} from "./instructions/userInstructions";
import {
	ClaimTradeFeeParams,
	claimTradingFee,
	partnerWithdrawSurplus,
	createConfigForSwapDamm,
	CreateConfigForSwapParams,
} from "./instructions/partnerInstructions";
import {
	creatorWithdrawSurplus,
	transferCreator,
} from "./instructions/creatorInstructions";
import { Pool, VirtualCurveProgram } from "../utils/types";
import { Keypair, PublicKey } from "@solana/web3.js";
import { fundSol, getMint, startTest } from "../utils";
import {
	createDammConfig,
	createVirtualCurveProgram,
	derivePoolAuthority,
} from "../utils";
import { getVirtualPool } from "../utils/fetcher";
import { NATIVE_MINT } from "@solana/spl-token";
import {
	createMeteoraMetadata,
	lockLpForCreatorDamm,
	lockLpForPartnerDamm,
	MigrateMeteoraParams,
	migrateToMeteoraDamm,
	partnerClaimLpDamm,
	creatorClaimLpDamm,
} from "./instructions/meteoraMigration";
import { expect } from "chai";

describe("Backwards compatibility - DAMM full flow", () => {
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

	it("createConfigSplTokenForSwapDamm", async () => {
		const params: CreateConfigForSwapParams = {
			payer: partner,
			leftoverReceiver: partner.publicKey,
			feeClaimer: partner.publicKey,
			quoteMint: NATIVE_MINT,
		};
		config = await createConfigForSwapDamm(context.banksClient, program, params);
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

		// validate freeze authority
		const baseMintData = await getMint(
			context.banksClient,
			virtualPoolState.baseMint
		);
		expect(baseMintData.freezeAuthority.toString()).eq(
			PublicKey.default.toString()
		);
		expect(baseMintData.mintAuthorityOption).eq(0);
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

	it("migrationMeteoraDammCreateMetadata", async () => {
		await createMeteoraMetadata(context.banksClient, program, {
			payer: admin,
			virtualPool,
			config,
		});
	});

	it("migrateMeteoraDamm", async () => {
		const poolAuthority = derivePoolAuthority();

		dammConfig = await createDammConfig(
			context.banksClient,
			admin,
			poolAuthority
		);
		const migrationParams: MigrateMeteoraParams = {
			payer: admin,
			virtualPool,
			dammConfig,
		};

		await migrateToMeteoraDamm(context.banksClient, program, migrationParams);

		// validate mint authority
		const baseMintData = await getMint(
			context.banksClient,
			virtualPoolState.baseMint
		);
		expect(baseMintData.mintAuthorityOption).eq(0);
	});

	it("migrateMeteoraDammLockLpToken - partner", async () => {
		await lockLpForPartnerDamm(context.banksClient, program, {
			payer: partner,
			dammConfig,
			virtualPool,
		});
	});

	it("migrateMeteoraDammLockLpToken - creator", async () => {
		await lockLpForCreatorDamm(context.banksClient, program, {
			payer: poolCreator,
			dammConfig,
			virtualPool,
		});
	});

	it("partnerWithdrawSurplus", async () => {
		await partnerWithdrawSurplus(context.banksClient, program, {
			feeClaimer: partner,
			virtualPool,
		});
	});

	it("creatorWithdrawSurplus", async () => {
		await creatorWithdrawSurplus(context.banksClient, program, {
			creator: poolCreator,
			virtualPool,
		});
	});

	it("claimTradingFee", async () => {
		const claimTradingFeeParams: ClaimTradeFeeParams = {
			feeClaimer: partner,
			pool: virtualPool,
		};
		await claimTradingFee(context.banksClient, program, claimTradingFeeParams);
	});

	it("migrateMeteoraDammClaimLpToken - partner", async () => {
		await partnerClaimLpDamm(context.banksClient, program, {
			payer: partner,
			dammConfig,
			virtualPool,
		});
	});

	it("migrateMeteoraDammClaimLpToken - creator", async () => {
		await creatorClaimLpDamm(context.banksClient, program, {
			payer: poolCreator,
			dammConfig,
			virtualPool,
		});
	});

	it("transferPoolCreator", async () => {
		const newCreator = Keypair.generate().publicKey;
		await transferCreator(context.banksClient, program, virtualPool, poolCreator, newCreator);
	});
});
