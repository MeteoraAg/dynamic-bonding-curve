import { ProgramTestContext } from "solana-bankrun";
import { VirtualCurveProgram } from "../utils/types";
import { Keypair, PublicKey } from "@solana/web3.js";
import { startTest, } from "../utils";
import { createVirtualCurveProgram, } from "../utils";
import { NATIVE_MINT } from "@solana/spl-token";
import { createConfig, CreateConfigParams, createPartnerMetadata } from "./instructions/partnerInstructions";
import { createPoolWithSplToken, createPoolWithToken2022, CreatePoolToken2022Params, createVirtualPoolMetadata, CreateVirtualPoolMetadataParams } from "./instructions/userInstructions";
import { claimCreatorTradingFee } from "./instructions/creatorInstructions";

describe("Backwards compatibility - misc", () => {
	let context: ProgramTestContext;
	let user: Keypair;
	let program: VirtualCurveProgram;

	let configToken2022: PublicKey;
	let poolToken2022: PublicKey;
	let configSplToken: PublicKey;
	let poolSplToken: PublicKey;

	before(async () => {
		context = await startTest();
		user = context.payer;
		program = createVirtualCurveProgram();
	});

	it("createConfigSplToken", async () => {
		const configSplTokenParams: CreateConfigParams = {
			payer: user,
			leftoverReceiver: user.publicKey,
			feeClaimer: user.publicKey,
			quoteMint: NATIVE_MINT,
			token2022: false
		}
		configSplToken = await createConfig(context.banksClient, program, configSplTokenParams);
	});

	it("initializeVirtualPoolWithSplToken", async () => {
		const poolSplTokenParams: CreatePoolToken2022Params = {
			payer: user,
			poolCreator: user,
			quoteMint: NATIVE_MINT,
			config: configSplToken,
		};
		poolSplToken = await createPoolWithSplToken(context.banksClient, program, poolSplTokenParams);
	});

	it("createConfigToken2022", async () => {
		const configToken2022Params: CreateConfigParams = {
			payer: user,
			leftoverReceiver: user.publicKey,
			feeClaimer: user.publicKey,
			quoteMint: NATIVE_MINT,
			token2022: true
		}
		configToken2022 = await createConfig(context.banksClient, program, configToken2022Params);
	});

	it("initializeVirtualPoolWithToken2022", async () => {
		const poolToken2022Params: CreatePoolToken2022Params = {
			payer: user,
			poolCreator: user,
			quoteMint: NATIVE_MINT,
			config: configToken2022,
		};
		poolToken2022 = await createPoolWithToken2022(context.banksClient, program, poolToken2022Params);
	});

	it("createPartnerMetadata", async () => {
		const metadataParams: CreateVirtualPoolMetadataParams = {
			virtualPool: poolToken2022,
			creator: user,
			payer: user,
		};
		await createVirtualPoolMetadata(context.banksClient, program, metadataParams);
	});

	it("createVirtualPoolMetadata", async () => {
		const partnerMetadataParams = {
			payer: user,
			feeClaimer: user,
		}
		await createPartnerMetadata(context.banksClient, program, partnerMetadataParams);
	});

	it("claimCreatorTradingFee", async () => {
		const partnerMetadataParams = {
			creator: user,
			pool: poolToken2022,
		}
		await claimCreatorTradingFee(context.banksClient, program, partnerMetadataParams);
	});
});
