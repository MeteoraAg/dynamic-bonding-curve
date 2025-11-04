import { BN } from "@coral-xyz/anchor";
import { BanksClient, ProgramTestContext } from "solana-bankrun";
import {
    ClaimCreatorTradeFeeParams,
    claimCreatorTradingFee,
    claimTradingFee,
    createConfig,
    CreateConfigParams,
    createLocker,
    createPoolWithSplToken,
    creatorWithdrawSurplus,
    partnerWithdrawSurplus,
    swap,
    SwapMode,
    SwapParams,
} from "./instructions";
import { VirtualCurveProgram } from "./utils/types";
import { Keypair, PublicKey } from "@solana/web3.js";
import { designCurve, fundSol, startTest } from "./utils";
import {
    createDammConfig,
    createVirtualCurveProgram,
    derivePoolAuthority,
    U64_MAX,
} from "./utils";
import { getConfig, getVirtualPool } from "./utils/fetcher";
import {
    createMeteoraMetadata,
    MigrateMeteoraParams,
    migrateToMeteoraDamm,
} from "./instructions/meteoraMigration";
import { expect } from "chai";
import { createToken, mintSplTokenTo } from "./utils/token";

describe("Creator and Partner share trading fees and surplus", () => {
    let context: ProgramTestContext;
    let admin: Keypair;
    let operator: Keypair;
    let partner: Keypair;
    let user: Keypair;
    let poolCreator: Keypair;
    let program: VirtualCurveProgram;

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

    it("50-50 fee between partner and creator", async () => {
        let totalTokenSupply = 1_000_000_000; // 1 billion
        let percentageSupplyOnMigration = 10; // 10%;
        let migrationQuoteThreshold = 300; // 300 sol
        let migrationOption = 0;
        let tokenBaseDecimal = 6;
        let tokenQuoteDecimal = 9;
        let lockedVesting = {
            amountPerPeriod: new BN(0),
            cliffDurationFromMigrationTime: new BN(0),
            frequency: new BN(0),
            numberOfPeriod: new BN(0),
            cliffUnlockAmount: new BN(0),
        };
        let creatorTradingFeePercentage = 50;
        let collectFeeMode = 1;
        let quoteMint = await createToken(context.banksClient, admin, admin.publicKey, tokenQuoteDecimal);
        let instructionParams = designCurve(
            totalTokenSupply,
            percentageSupplyOnMigration,
            migrationQuoteThreshold,
            migrationOption,
            tokenBaseDecimal,
            tokenQuoteDecimal,
            creatorTradingFeePercentage,
            collectFeeMode,
            lockedVesting,
            {
                feePercentage: 0,
                creatorFeePercentage: 0,
            }
        );
        const params: CreateConfigParams = {
            payer: partner,
            leftoverReceiver: partner.publicKey,
            feeClaimer: partner.publicKey,
            quoteMint,
            instructionParams,
        };
        let config = await createConfig(context.banksClient, program, params);
        let configState = await getConfig(context.banksClient, program, config);
        expect(configState.creatorTradingFeePercentage).eq(creatorTradingFeePercentage);
        await mintSplTokenTo(context.banksClient, user, quoteMint, admin, user.publicKey, instructionParams.migrationQuoteThreshold.mul(new BN(2)).toNumber());
        await fullFlow(context.banksClient, program, config, poolCreator, user, admin, quoteMint, partner);
    })


    it("0-100 fee between partner and creator", async () => {
        let totalTokenSupply = 1_000_000_000; // 1 billion
        let percentageSupplyOnMigration = 10; // 10%;
        let migrationQuoteThreshold = 300; // 300 sol
        let migrationOption = 0;
        let tokenBaseDecimal = 6;
        let tokenQuoteDecimal = 9;
        let lockedVesting = {
            amountPerPeriod: new BN(0),
            cliffDurationFromMigrationTime: new BN(0),
            frequency: new BN(0),
            numberOfPeriod: new BN(0),
            cliffUnlockAmount: new BN(0),
        };
        let creatorTradingFeePercentage = 100;
        let collectFeeMode = 0;
        let quoteMint = await createToken(context.banksClient, admin, admin.publicKey, tokenQuoteDecimal);
        let instructionParams = designCurve(
            totalTokenSupply,
            percentageSupplyOnMigration,
            migrationQuoteThreshold,
            migrationOption,
            tokenBaseDecimal,
            tokenQuoteDecimal,
            creatorTradingFeePercentage,
            collectFeeMode,
            lockedVesting,
            {
                feePercentage: 0,
                creatorFeePercentage: 0,
            }
        );
        const params: CreateConfigParams = {
            payer: partner,
            leftoverReceiver: partner.publicKey,
            feeClaimer: partner.publicKey,
            quoteMint,
            instructionParams,
        };
        let config = await createConfig(context.banksClient, program, params);
        let configState = await getConfig(context.banksClient, program, config);
        expect(configState.creatorTradingFeePercentage).eq(creatorTradingFeePercentage);
        await mintSplTokenTo(context.banksClient, user, quoteMint, admin, user.publicKey, instructionParams.migrationQuoteThreshold.mul(new BN(2)).toNumber());
        await fullFlow(context.banksClient, program, config, poolCreator, user, admin, quoteMint, partner);
    })


    it("100-0 fee between partner and creator", async () => {
        let totalTokenSupply = 1_000_000_000; // 1 billion
        let percentageSupplyOnMigration = 10; // 10%;
        let migrationQuoteThreshold = 300; // 300 sol
        let migrationOption = 0;
        let tokenBaseDecimal = 6;
        let tokenQuoteDecimal = 9;
        let lockedVesting = {
            amountPerPeriod: new BN(0),
            cliffDurationFromMigrationTime: new BN(0),
            frequency: new BN(0),
            numberOfPeriod: new BN(0),
            cliffUnlockAmount: new BN(0),
        };
        let creatorTradingFeePercentage = 0;
        let collectFeeMode = 1;
        let quoteMint = await createToken(context.banksClient, admin, admin.publicKey, tokenQuoteDecimal);
        let instructionParams = designCurve(
            totalTokenSupply,
            percentageSupplyOnMigration,
            migrationQuoteThreshold,
            migrationOption,
            tokenBaseDecimal,
            tokenQuoteDecimal,
            creatorTradingFeePercentage,
            collectFeeMode,
            lockedVesting,
            {
                feePercentage: 0,
                creatorFeePercentage: 0,
            }
        );
        const params: CreateConfigParams = {
            payer: partner,
            leftoverReceiver: partner.publicKey,
            feeClaimer: partner.publicKey,
            quoteMint,
            instructionParams,
        };
        let config = await createConfig(context.banksClient, program, params);
        let configState = await getConfig(context.banksClient, program, config);
        expect(configState.creatorTradingFeePercentage).eq(creatorTradingFeePercentage);
        await mintSplTokenTo(context.banksClient, user, quoteMint, admin, user.publicKey, instructionParams.migrationQuoteThreshold.mul(new BN(2)).toNumber());
        await fullFlow(context.banksClient, program, config, poolCreator, user, admin, quoteMint, partner);
    })

    it("20-80 fee between partner and creator", async () => {
        let totalTokenSupply = 1_000_000_000; // 1 billion
        let percentageSupplyOnMigration = 10; // 10%;
        let migrationQuoteThreshold = 300; // 300 sol
        let migrationOption = 0;
        let tokenBaseDecimal = 6;
        let tokenQuoteDecimal = 9;
        let lockedVesting = {
            amountPerPeriod: new BN(0),
            cliffDurationFromMigrationTime: new BN(0),
            frequency: new BN(0),
            numberOfPeriod: new BN(0),
            cliffUnlockAmount: new BN(0),
        };
        let creatorTradingFeePercentage = 80;
        let collectFeeMode = 0;
        let quoteMint = await createToken(context.banksClient, admin, admin.publicKey, tokenQuoteDecimal);
        let instructionParams = designCurve(
            totalTokenSupply,
            percentageSupplyOnMigration,
            migrationQuoteThreshold,
            migrationOption,
            tokenBaseDecimal,
            tokenQuoteDecimal,
            creatorTradingFeePercentage,
            collectFeeMode,
            lockedVesting,
            {
                feePercentage: 0,
                creatorFeePercentage: 0,
            }
        );
        const params: CreateConfigParams = {
            payer: partner,
            leftoverReceiver: partner.publicKey,
            feeClaimer: partner.publicKey,
            quoteMint,
            instructionParams,
        };
        let config = await createConfig(context.banksClient, program, params);
        let configState = await getConfig(context.banksClient, program, config);
        expect(configState.creatorTradingFeePercentage).eq(creatorTradingFeePercentage);
        await mintSplTokenTo(context.banksClient, user, quoteMint, admin, user.publicKey, instructionParams.migrationQuoteThreshold.mul(new BN(2)).toNumber());
        await fullFlow(context.banksClient, program, config, poolCreator, user, admin, quoteMint, partner);
    })
});


async function fullFlow(
    banksClient: BanksClient,
    program: VirtualCurveProgram,
    config: PublicKey,
    poolCreator: Keypair,
    user: Keypair,
    admin: Keypair,
    quoteMint: PublicKey,
    partner: Keypair
) {
    // create pool
    let virtualPool = await createPoolWithSplToken(banksClient, program, {
        payer: poolCreator,
        poolCreator: poolCreator,
        quoteMint,
        config,
        instructionParams: {
            name: "test token spl",
            symbol: "TEST",
            uri: "abc.com",
        },
    });
    let virtualPoolState = await getVirtualPool(
        banksClient,
        program,
        virtualPool
    );

    let configState = await getConfig(banksClient, program, config);

    let amountIn;
    if (configState.collectFeeMode == 0) {
        // over 20%
        amountIn = configState.migrationQuoteThreshold.mul(new BN(6)).div(new BN(5));
    } else {
        amountIn = configState.migrationQuoteThreshold
    }
    // swap
    const params: SwapParams = {
        config,
        payer: user,
        pool: virtualPool,
        inputTokenMint: quoteMint,
        outputTokenMint: virtualPoolState.baseMint,
        amountIn,
        minimumAmountOut: new BN(0),
        swapMode: SwapMode.PartialFill,
        referralTokenAccount: null,
    };
    await swap(banksClient, program, params);

    let creatorTradingFeePercentage = configState.creatorTradingFeePercentage;
    let partnerTradingFeePercentage = 100 - creatorTradingFeePercentage;
    virtualPoolState = await getVirtualPool(
        banksClient,
        program,
        virtualPool
    );

    if (creatorTradingFeePercentage == 0) {
        expect(virtualPoolState.creatorBaseFee.toString()).eq("0");
        expect(virtualPoolState.creatorQuoteFee.toString()).eq("0");
    } else if (partnerTradingFeePercentage == 0) {
        expect(virtualPoolState.partnerBaseFee.toString()).eq("0");
        expect(virtualPoolState.partnerQuoteFee.toString()).eq("0");
    } else {
        expect(virtualPoolState.creatorBaseFee.mul(new BN(partnerTradingFeePercentage)).toString()).eq(virtualPoolState.partnerBaseFee.mul(new BN(creatorTradingFeePercentage)).toString());
        expect(virtualPoolState.creatorQuoteFee.mul(new BN(partnerTradingFeePercentage)).toString()).eq(virtualPoolState.partnerQuoteFee.mul(new BN(creatorTradingFeePercentage)).toString());
    }

    // migrate
    const poolAuthority = derivePoolAuthority();
    let dammConfig = await createDammConfig(
        banksClient,
        admin,
        poolAuthority
    );
    const migrationParams: MigrateMeteoraParams = {
        payer: admin,
        virtualPool,
        dammConfig,
    };
    await createMeteoraMetadata(banksClient, program, {
        payer: admin,
        virtualPool,
        config,
    });

    if (configState.lockedVestingConfig.frequency.toNumber() != 0) {
        await createLocker(banksClient, program, {
            payer: admin,
            virtualPool,
        });
    }
    await migrateToMeteoraDamm(banksClient, program, migrationParams);

    // creator claim trading fee
    const claimTradingFeeParams: ClaimCreatorTradeFeeParams = {
        creator: poolCreator,
        pool: virtualPool,
        maxBaseAmount: new BN(U64_MAX),
        maxQuoteAmount: new BN(U64_MAX),
    };
    await claimCreatorTradingFee(banksClient, program, claimTradingFeeParams);

    // partner claim trading fee
    await claimTradingFee(banksClient, program, {
        feeClaimer: partner,
        pool: virtualPool,
        maxBaseAmount: new BN(U64_MAX),
        maxQuoteAmount: new BN(U64_MAX),
    })
    // creator withdraw surplus
    await creatorWithdrawSurplus(banksClient, program, {
        creator: poolCreator,
        virtualPool,
    });

    // partner withdraw surplus
    await partnerWithdrawSurplus(banksClient, program, {
        feeClaimer: partner,
        virtualPool,
    });
}
