import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
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
  const transaction = await program.methods
    .migrationMeteoraDammCreateMetadata()
    .accountsPartial({
      virtualPool,
      config,
      payer: payer.publicKey,
    })
    .transaction();
  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(payer);
  await processTransactionMaybeThrow(banksClient, transaction);

  return deriveMigrationMetadataAddress(virtualPool);
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
  const virtualPoolState = await getVirtualPool(
    banksClient,
    program,
    virtualPool
  );
  const quoteMintInfo = await getTokenAccount(
    banksClient,
    virtualPoolState.quoteVault
  );
  const poolAuthority = derivePoolAuthority();
  const migrationMetadata = deriveMigrationMetadataAddress(virtualPool);

  const dammPool = deriveDammPoolAddress(
    dammConfig,
    virtualPoolState.baseMint,
    quoteMintInfo.mint
  );

  const lpMint = deriveLpMintAddress(dammPool);

  const mintMetadata = deriveMetadataAccount(lpMint);

  const [protocolTokenAFee, protocolTokenBFee] = [
    deriveProtocolFeeAddress(virtualPoolState.baseMint, dammPool),
    deriveProtocolFeeAddress(quoteMintInfo.mint, dammPool),
  ];

  const {
    vaultPda: aVault,
    tokenVaultPda: aTokenVault,
    lpMintPda: aVaultLpMint,
  } = await createVaultIfNotExists(
    virtualPoolState.baseMint,
    banksClient,
    payer
  );

  const {
    vaultPda: bVault,
    tokenVaultPda: bTokenVault,
    lpMintPda: bVaultLpMint,
  } = await createVaultIfNotExists(quoteMintInfo.mint, banksClient, payer);

  const [aVaultLp, bVaultLp] = [
    deriveVaultLPAddress(aVault, dammPool),
    deriveVaultLPAddress(bVault, dammPool),
  ];

  const virtualPoolLp = getAssociatedTokenAddressSync(
    lpMint,
    poolAuthority,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const transaction = await program.methods
    .migrateMeteoraDamm()
    .accountsPartial({
      virtualPool,
      migrationMetadata,
      config: virtualPoolState.config,
      poolAuthority,
      pool: dammPool,
      dammConfig,
      lpMint,
      tokenAMint: virtualPoolState.baseMint,
      tokenBMint: quoteMintInfo.mint,
      aVault,
      bVault,
      aTokenVault,
      bTokenVault,
      aVaultLpMint,
      bVaultLpMint,
      aVaultLp,
      bVaultLp,
      baseVault: virtualPoolState.baseVault,
      quoteVault: virtualPoolState.quoteVault,
      virtualPoolLp,
      protocolTokenAFee,
      protocolTokenBFee,
      payer: payer.publicKey,
      rent: SYSVAR_RENT_PUBKEY,
      mintMetadata,
      metadataProgram: METAPLEX_PROGRAM_ID,
      ammProgram: DAMM_PROGRAM_ID,
      vaultProgram: VAULT_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .transaction();
  transaction.add(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: 400_000,
    })
  );
  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(payer);
  await processTransactionMaybeThrow(banksClient, transaction);

  return dammPool;
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
  const virtualPoolState = await getVirtualPool(
    banksClient,
    program,
    virtualPool
  );
  const quoteMintInfo = await getTokenAccount(
    banksClient,
    virtualPoolState.quoteVault
  );
  const dammPool = deriveDammPoolAddress(
    dammConfig,
    virtualPoolState.baseMint,
    quoteMintInfo.mint
  );
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
    [
      Buffer.from("lock_escrow"),
      dammPool.toBuffer(),
      virtualPoolState.creator.toBuffer(),
    ],
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
    true
  );
  const transaction = await program.methods
    .migrateMeteoraDammLockLpToken()
    .accountsPartial({
      virtualPool,
      migrationMetadata,
      poolAuthority,
      pool: dammPool,
      lpMint,
      lockEscrow: lockEscrowKey,
      owner: virtualPoolState.creator,
      sourceTokens,
      escrowVault,
      ammProgram: DAMM_PROGRAM_ID,
      aVault,
      bVault,
      aVaultLp,
      bVaultLp,
      aVaultLpMint,
      bVaultLpMint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions(preInstructions)
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(payer);
  await processTransactionMaybeThrow(banksClient, transaction);

  return lockEscrowKey;
}

export type LockLPDammForPartnerParams = LockLPDammForCreatorParams;

export async function lockLpForPartnerDamm(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  params: LockLPDammForPartnerParams
): Promise<PublicKey> {
  const { payer, virtualPool, dammConfig } = params;
  const virtualPoolState = await getVirtualPool(
    banksClient,
    program,
    virtualPool
  );
  const quoteMintInfo = await getTokenAccount(
    banksClient,
    virtualPoolState.quoteVault
  );
  const dammPool = deriveDammPoolAddress(
    dammConfig,
    virtualPoolState.baseMint,
    quoteMintInfo.mint
  );
  const poolAuthority = derivePoolAuthority();
  const migrationMetadata = deriveMigrationMetadataAddress(virtualPool);
  const meteoraMigrationDammMetadataState =
    await getMeteoraDammMigrationMetadata(
      banksClient,
      program,
      migrationMetadata
    );

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
    [
      Buffer.from("lock_escrow"),
      dammPool.toBuffer(),
      meteoraMigrationDammMetadataState.partner.toBuffer(),
    ],
    DAMM_PROGRAM_ID
  )[0];

  const lockEscrowData = await banksClient.getAccount(lockEscrowKey);
  if (!lockEscrowData) {
    await createLockEscrowIx(
      banksClient,
      payer,
      dammPool,
      lpMint,
      meteoraMigrationDammMetadataState.partner,
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
    true
  );
  const transaction = await program.methods
    .migrateMeteoraDammLockLpToken()
    .accountsPartial({
      virtualPool,
      migrationMetadata,
      poolAuthority,
      pool: dammPool,
      lpMint,
      lockEscrow: lockEscrowKey,
      owner: meteoraMigrationDammMetadataState.partner,
      sourceTokens,
      escrowVault,
      ammProgram: DAMM_PROGRAM_ID,
      aVault,
      bVault,
      aVaultLp,
      bVaultLp,
      aVaultLpMint,
      bVaultLpMint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions(preInstructions)
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(payer);
  await processTransactionMaybeThrow(banksClient, transaction);

  return lockEscrowKey;
}

export async function partnerClaimLpDamm(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  params: LockLPDammForPartnerParams
) {
  const { payer, virtualPool, dammConfig } = params;
  const virtualPoolState = await getVirtualPool(
    banksClient,
    program,
    virtualPool
  );
  const configState = await getConfig(
    banksClient,
    program,
    virtualPoolState.config
  );
  const dammPool = deriveDammPoolAddress(
    dammConfig,
    virtualPoolState.baseMint,
    configState.quoteMint
  );
  const poolAuthority = derivePoolAuthority();
  const migrationMetadata = deriveMigrationMetadataAddress(virtualPool);

  const lpMint = deriveLpMintAddress(dammPool);

  const preInstructions: TransactionInstruction[] = [];
  const { ata: destinationToken, ix: createDestinationTokenIx } =
    await getOrCreateAssociatedTokenAccount(
      banksClient,
      payer,
      lpMint,
      configState.feeClaimer,
      TOKEN_PROGRAM_ID
    );

  createDestinationTokenIx && preInstructions.push(createDestinationTokenIx);

  const sourceToken = getAssociatedTokenAddressSync(
    lpMint,
    poolAuthority,
    true
  );
  const transaction = await program.methods
    .migrateMeteoraDammClaimLpToken()
    .accountsPartial({
      virtualPool,
      owner: configState.feeClaimer,
      migrationMetadata,
      poolAuthority,
      lpMint,
      sourceToken,
      destinationToken,
      sender: payer.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions(preInstructions)
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(payer);
  await processTransactionMaybeThrow(banksClient, transaction);
}

export async function creatorClaimLpDamm(
  banksClient: BanksClient,
  program: VirtualCurveProgram,
  params: LockLPDammForPartnerParams
) {
  const { payer, virtualPool, dammConfig } = params;
  const virtualPoolState = await getVirtualPool(
    banksClient,
    program,
    virtualPool
  );
  const configState = await getConfig(
    banksClient,
    program,
    virtualPoolState.config
  );
  const dammPool = deriveDammPoolAddress(
    dammConfig,
    virtualPoolState.baseMint,
    configState.quoteMint
  );
  const poolAuthority = derivePoolAuthority();
  const migrationMetadata = deriveMigrationMetadataAddress(virtualPool);

  const lpMint = deriveLpMintAddress(dammPool);

  const preInstructions: TransactionInstruction[] = [];
  const { ata: destinationToken, ix: createDestinationTokenIx } =
    await getOrCreateAssociatedTokenAccount(
      banksClient,
      payer,
      lpMint,
      virtualPoolState.creator,
      TOKEN_PROGRAM_ID
    );

  createDestinationTokenIx && preInstructions.push(createDestinationTokenIx);

  const sourceToken = getAssociatedTokenAddressSync(
    lpMint,
    poolAuthority,
    true
  );
  const transaction = await program.methods
    .migrateMeteoraDammClaimLpToken()
    .accountsPartial({
      virtualPool,
      migrationMetadata,
      poolAuthority,
      owner: virtualPoolState.creator,
      lpMint,
      sourceToken,
      destinationToken,
      sender: payer.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions(preInstructions)
    .transaction();

  transaction.recentBlockhash = (await banksClient.getLatestBlockhash())[0];
  transaction.sign(payer);
  await processTransactionMaybeThrow(banksClient, transaction);
}
