import {
    ComputeBudgetProgram,
    Keypair,
    PublicKey,
    SystemProgram,
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
): Promise<any> {
    const { payer, virtualPool, config } = params;
    const migrationMetadata = deriveMigrationDammV2MetadataAddress(virtualPool);
    const transaction = await program.methods
        .migrationDammV2CreateMetadata()
        .accountsPartial({
            virtualPool,
            config,
            migrationMetadata,
            payer: payer.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .transaction();
    transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
    transaction.sign(payer);
    await processTransactionMaybeThrow(banksClient, transaction);
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
    const virtualPoolState = await getVirtualPool(
        banksClient,
        program,
        virtualPool
    );

    const configState = await getConfig(
        banksClient,
        program,
        virtualPoolState.config,
    );

    const poolAuthority = derivePoolAuthority();
    const migrationMetadata = deriveMigrationDammV2MetadataAddress(virtualPool);

    const dammPool = deriveDammV2PoolAddress(
        dammConfig,
        virtualPoolState.baseMint,
        configState.quoteMint
    );

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
        configState.tokenType == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

    const tokenQuoteProgram =
        configState.quoteTokenFlag == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

    const transaction = await program.methods
        .migrationDammV2()
        .accountsStrict({
            virtualPool,
            migrationMetadata,
            config: virtualPoolState.config,
            poolAuthority,
            pool: dammPool,
            firstPositionNftMint: firstPositionNftKP.publicKey,
            firstPosition,
            firstPositionNftAccount,
            secondPositionNftMint: secondPositionNftKP.publicKey,
            secondPosition,
            secondPositionNftAccount,
            dammPoolAuthority,
            ammProgram: DAMM_V2_PROGRAM_ID,
            baseMint: virtualPoolState.baseMint,
            quoteMint: configState.quoteMint,
            tokenAVault,
            tokenBVault,
            baseVault: virtualPoolState.baseVault,
            quoteVault: virtualPoolState.quoteVault,
            payer: payer.publicKey,
            tokenBaseProgram,
            tokenQuoteProgram,
            token2022Program: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            dammEventAuthority: deriveDammV2EventAuthority(),
        }).remainingAccounts([
            {
                isSigner: false,
                isWritable: false,
                pubkey: dammConfig,
            }
        ])
        .transaction();
    transaction.add(
        ComputeBudgetProgram.setComputeUnitLimit({
            units: 500_000,
        })
    );
    transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
    transaction.sign(payer, firstPositionNftKP, secondPositionNftKP);
    await processTransactionMaybeThrow(banksClient, transaction);

    return dammPool
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


export function convertCollectFeeModeToDammv2(
    dbcCollectFeeMode: number,
): number {
    if (dbcCollectFeeMode == 0) {
        return 1;
    } else if (dbcCollectFeeMode == 1) {
        return 0;
    } else {
        throw Error("Not supported")
    }
}
