import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  AccountMeta,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { LiteSVM } from "litesvm";
import {
  DAMM_V2_PROGRAM_ID,
  deriveDammV2PoolAddress,
  deriveMigrationDammV2MetadataAddress,
  derivePoolAuthority,
  getConfig,
  getVirtualPool,
  sendTransactionMaybeThrow,
  VirtualCurveProgram,
} from "../utils";

export type CreateMeteoraDammV2Metadata = {
  payer: Keypair;
  virtualPool: PublicKey;
  config: PublicKey;
};

export async function createMeteoraDammV2Metadata(
  svm: LiteSVM,
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

  sendTransactionMaybeThrow(svm, transaction, [payer]);
}

export type MigrateMeteoraDammV2Params = {
  payer: Keypair;
  virtualPool: PublicKey;
  dammConfig: PublicKey;
};

export async function migrateToDammV2(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: MigrateMeteoraDammV2Params
): Promise<{
  dammPool: PublicKey;
  firstPosition: PublicKey;
  secondPosition: PublicKey;
}> {
  const { payer, virtualPool, dammConfig } = params;
  const virtualPoolState = getVirtualPool(svm, program, virtualPool);

  const configState = getConfig(svm, program, virtualPoolState.config);

  const poolAuthority = derivePoolAuthority();
  const migrationMetadata = deriveMigrationDammV2MetadataAddress(virtualPool);

  const dammPool = deriveDammV2PoolAddress(
    dammConfig,
    virtualPoolState.baseMint,
    configState.quoteMint
  );

  const firstPositionNftKP = Keypair.generate();
  const firstPosition = derivePositionAddress(firstPositionNftKP.publicKey);
  const firstPositionNftAccount = derivePositionNftAccount(
    firstPositionNftKP.publicKey
  );

  const secondPositionNftKP = Keypair.generate();
  const secondPosition = derivePositionAddress(secondPositionNftKP.publicKey);
  const secondPositionNftAccount = derivePositionNftAccount(
    secondPositionNftKP.publicKey
  );

  const dammPoolAuthority = deriveDammV2PoolAuthority();

  const tokenAVault = deriveTokenVaultAddress(
    virtualPoolState.baseMint,
    dammPool
  );
  const tokenBVault = deriveTokenVaultAddress(configState.quoteMint, dammPool);

  const tokenBaseProgram =
    configState.tokenType == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  const tokenQuoteProgram =
    configState.quoteTokenFlag == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  const remainingAccounts: AccountMeta[] = [
    {
      isSigner: false,
      isWritable: false,
      pubkey: dammConfig,
    },
  ];

  const partnerLpPercentage =
    configState.partnerLockedLpPercentage +
    configState.partnerLpPercentage +
    configState.partnerLpVestingInfo.vestingPercentage;

  const creatorLpPercentage =
    configState.creatorLockedLpPercentage +
    configState.creatorLpPercentage +
    configState.creatorLpVestingInfo.vestingPercentage;

  const minLpPercentage = Math.min(partnerLpPercentage, creatorLpPercentage);
  const maxLpPercentage = Math.max(partnerLpPercentage, creatorLpPercentage);

  if (maxLpPercentage > 0) {
    const vestingAddress = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting"), firstPosition.toBytes()],
      program.programId
    )[0];

    remainingAccounts.push({
      isSigner: false,
      isWritable: true,
      pubkey: vestingAddress,
    });
  }

  if (minLpPercentage > 0) {
    const vestingAddress = PublicKey.findProgramAddressSync(
      [Buffer.from("vesting"), secondPosition.toBytes()],
      program.programId
    )[0];

    remainingAccounts.push({
      isSigner: false,
      isWritable: true,
      pubkey: vestingAddress,
    });
  }

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
    })
    .remainingAccounts(remainingAccounts)
    .transaction();
  transaction.add(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: 600_000,
    })
  );
  sendTransactionMaybeThrow(svm, transaction, [
    payer,
    firstPositionNftKP,
    secondPositionNftKP,
  ]);

  return {
    dammPool,
    firstPosition,
    secondPosition,
  };
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
  dbcCollectFeeMode: number
): number {
  if (dbcCollectFeeMode == 0) {
    return 1;
  } else if (dbcCollectFeeMode == 1) {
    return 0;
  } else {
    throw Error("Not supported");
  }
}
