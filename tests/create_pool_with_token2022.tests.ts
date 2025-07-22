import { BN } from "bn.js";
import { ProgramTestContext } from "solana-bankrun";
import { unpack } from "@solana/spl-token-metadata";
import {
    BaseFee,
    claimProtocolFee,
    ClaimTradeFeeParams,
    claimTradingFee,
    ConfigParameters,
    createClaimFeeOperator,
    createConfig,
    CreateConfigParams,
    createPoolWithToken2022,
    swap,
    SwapParams,
} from "./instructions";
import { Pool, VirtualCurveProgram } from "./utils/types";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { fundSol, getMint, startTest } from "./utils";
import {
    createVirtualCurveProgram,
    MAX_SQRT_PRICE,
    MIN_SQRT_PRICE,
    U64_MAX,
} from "./utils";
import { getVirtualPool } from "./utils/fetcher";
import { ACCOUNT_SIZE, ACCOUNT_TYPE_SIZE, ExtensionType, getExtensionData, NATIVE_MINT } from "@solana/spl-token";
import { expect } from "chai";


describe("Create pool with token2022", () => {
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
    let claimFeeOperator: PublicKey;

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

        // admin create claimFeeOperator
        claimFeeOperator = await createClaimFeeOperator(
            context.banksClient,
            program,
            {
                admin,
                operator: operator.publicKey,
            }
        );
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
            migrationOption: 1, // damm v2
            tokenType: 1, // token 2022
            tokenDecimal: 6,
            migrationQuoteThreshold: new BN(LAMPORTS_PER_SOL * 5),
            partnerLpPercentage: 0,
            creatorLpPercentage: 0,
            partnerLockedLpPercentage: 95,
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

    it("Create token2022 pool from config", async () => {
        const name = "test token 2022";
        const symbol = "TOKEN2022";
        const uri = "token2022.com";

        virtualPool = await createPoolWithToken2022(context.banksClient, program, {
            payer: operator,
            poolCreator,
            quoteMint: NATIVE_MINT,
            config,
            instructionParams: {
                name,
                symbol,
                uri,
            },
        });
        virtualPoolState = await getVirtualPool(
            context.banksClient,
            program,
            virtualPool
        );

        // validate metadata
        const tlvData = (
            await context.banksClient.getAccount(virtualPoolState.baseMint)
        ).data.slice(ACCOUNT_SIZE + ACCOUNT_TYPE_SIZE);
        const metadata = unpack(
            getExtensionData(ExtensionType.TokenMetadata, Buffer.from(tlvData))
        );
        expect(metadata.name).eq(name);
        expect(metadata.symbol).eq(symbol);
        expect(metadata.uri).eq(uri);
        expect(metadata.updateAuthority.toString()).eq(poolCreator.publicKey.toString());

        // validate freeze authority
        const baseMintData = (
            await getMint(context.banksClient, virtualPoolState.baseMint)
        );
        expect(baseMintData.freezeAuthority.toString()).eq(PublicKey.default.toString())
        expect(baseMintData.mintAuthorityOption).eq(0)
    });

    it("Swap", async () => {
        const params: SwapParams = {
            config,
            payer: user,
            pool: virtualPool,
            inputTokenMint: NATIVE_MINT,
            outputTokenMint: virtualPoolState.baseMint,
            amountIn: new BN(LAMPORTS_PER_SOL * 5.5),
            minimumAmountOut: new BN(0),
            referralTokenAccount: null,
        };
        await swap(context.banksClient, program, params);
    });

    it("Partner claim trading fee", async () => {
        const claimTradingFeeParams: ClaimTradeFeeParams = {
            feeClaimer: partner,
            pool: virtualPool,
            maxBaseAmount: new BN(U64_MAX),
            maxQuoteAmount: new BN(U64_MAX),
        };
        await claimTradingFee(context.banksClient, program, claimTradingFeeParams);
    });

    it("Operator claim protocol fee", async () => {
        await claimProtocolFee(context.banksClient, program, {
            pool: virtualPool,
            operator: operator,
        });
    });
});
