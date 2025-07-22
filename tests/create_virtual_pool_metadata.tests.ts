import { BN } from "bn.js";
import { ProgramTestContext } from "solana-bankrun";
import {
    BaseFee,
    ConfigParameters,
    createConfig,
    CreateConfigParams,
    createPoolWithSplToken,
    createVirtualPoolMetadata,
} from "./instructions";
import { VirtualCurveProgram } from "./utils/types";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { fundSol, startTest } from "./utils";
import {
    createVirtualCurveProgram,
    MAX_SQRT_PRICE,
    MIN_SQRT_PRICE,
    U64_MAX,
} from "./utils";
import { NATIVE_MINT } from "@solana/spl-token";

describe("Create virtual pool metadata", () => {
    let context: ProgramTestContext;
    let admin: Keypair;
    let operator: Keypair;
    let partner: Keypair;
    let user: Keypair;
    let poolCreator: Keypair;
    let program: VirtualCurveProgram;
    let config: PublicKey;
    let virtualPool: PublicKey;

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

    it("Partner create config", async () => {
        const baseFee: BaseFee = {
            cliffFeeNumerator: new BN(2_500_000),
            firstFactor: 0,
            secondFactor: new BN(0),
            thirdFactor: new BN(0),
            baseFeeMode: 0,
        };

        const curves = [];

        for (let i = 1; i <= 16; i++) {
            if (i == 16) {
                curves.push({
                    sqrtPrice: MAX_SQRT_PRICE,
                    liquidity: U64_MAX.shln(30 + i),
                });
            } else {
                curves.push({
                    sqrtPrice: MAX_SQRT_PRICE.muln(i * 5).divn(100),
                    liquidity: U64_MAX.shln(30 + i),
                });
            }
        }

        const instructionParams: ConfigParameters = {
            poolFees: {
                baseFee,
                dynamicFee: null,
            },
            activationType: 0,
            collectFeeMode: 0,
            migrationOption: 1,
            tokenType: 0, // spl_token
            tokenDecimal: 6,
            migrationQuoteThreshold: new BN(LAMPORTS_PER_SOL * 5),
            partnerLpPercentage: 20,
            creatorLpPercentage: 20,
            partnerLockedLpPercentage: 55,
            creatorLockedLpPercentage: 5,
            sqrtStartPrice: MIN_SQRT_PRICE.shln(32),
            lockedVesting: {
                amountPerPeriod: new BN(0),
                cliffDurationFromMigrationTime: new BN(0),
                frequency: new BN(0),
                numberOfPeriod: new BN(0),
                cliffUnlockAmount: new BN(0),
            },
            migrationFeeOption: 0,
            tokenSupply: null,
            creatorTradingFeePercentage: 0,
            tokenUpdateAuthority: 0,
            migrationFee: {
                feePercentage: 0,
                creatorFeePercentage: 0,
            },
            migratedPoolFee: {
                collectFeeMode: 0,
                dynamicFee: 0,
                poolFeeBps: 0,
            },
            padding: [],
            curve: curves,
        };
        const params: CreateConfigParams = {
            payer: partner,
            leftoverReceiver: partner.publicKey,
            feeClaimer: partner.publicKey,
            quoteMint: NATIVE_MINT,
            instructionParams,
        };
        config = await createConfig(context.banksClient, program, params);
    });

    it("Create spl pool from config", async () => {
        virtualPool = await createPoolWithSplToken(context.banksClient, program, {
            poolCreator,
            payer: operator,
            quoteMint: NATIVE_MINT,
            config,
            instructionParams: {
                name: "test token spl",
                symbol: "TEST",
                uri: "abc.com",
            },
        });
    });


    it("creator create a metadata", async () => {
        await createVirtualPoolMetadata(
            context.banksClient,
            program,
            {
                virtualPool,
                name: "Moonshot",
                website: "moonshot.com",
                logo: "https://raw.githubusercontent.com/MeteoraAg/token-metadata/main/meteora_permission_lp.png",
                creator: poolCreator,
                payer: poolCreator,
            }
        );
    });
});
