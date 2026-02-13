import { AnchorProvider, BN, Program, Wallet, web3 } from "@coral-xyz/anchor";
import {
  AccountLayout,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
  MintLayout,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  FailedTransactionMetadata,
  LiteSVM,
  TransactionMetadata,
} from "litesvm";
import VirtualCurveIDL from "../../target/idl/dynamic_bonding_curve.json";
import { DynamicBondingCurve as VirtualCurve } from "../../target/types/dynamic_bonding_curve";
import VaultIDL from "../../idls/dynamic_vault.json";
import { DynamicVault as Vault } from "./idl/dynamic_vault";
import AmmIDL from "../../idls/dynamic_amm.json";
import DammV2IDL from "../../idls/damm_v2.json";
import { DynamicAmm as Damm } from "./idl/dynamic_amm";
import { CpAmm as DammV2 } from "./idl/damm_v2";
import {
  BaseFee,
  ConfigParameters,
  createConfig,
  CreateConfigParams,
  createMeteoraMetadata,
  createPoolWithSplToken,
  MigrateMeteoraParams,
  migrateToMeteoraDamm,
  swap,
  SwapMode,
  createMeteoraDammV2Metadata,
  MigrateMeteoraDammV2Params,
  migrateToDammV2,
} from "../instructions";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  Signer,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { derivePoolAuthority } from "./accounts";
import {
  DAMM_PROGRAM_ID,
  DAMM_V2_PROGRAM_ID,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  U64_MAX,
} from "./constants";
import {
  BorshFeeTimeScheduler,
  DynamicVault,
  VirtualCurveProgram,
} from "./types";
import { getVirtualPool } from "./fetcher";

const BASE_ADDRESS = new PublicKey(
  "HWzXGcGHy4tcpYfaRDCyLNzXqBTv3E6BttpCH2vJxArv"
);

export function createVirtualCurveProgram(): VirtualCurveProgram {
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(
    new Connection(clusterApiUrl("devnet")),
    wallet,
    {}
  );

  const program = new Program<VirtualCurve>(
    VirtualCurveIDL as VirtualCurve,
    provider
  );
  return program;
}

export function createVaultProgram(): Program<Vault> {
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(
    new Connection(clusterApiUrl("devnet")),
    wallet,
    {}
  );

  const program = new Program<Vault>(VaultIDL, provider);
  return program;
}

export function createDammProgram() {
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(
    new Connection(clusterApiUrl("devnet")),
    wallet,
    {}
  );
  const program = new Program<Damm>(AmmIDL, provider);
  return program;
}

export function createDammV2Program() {
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(
    new Connection(clusterApiUrl("devnet")),
    wallet,
    {}
  );
  const program = new Program<DammV2>(DammV2IDL, provider);
  return program;
}

export function sendTransactionMaybeThrow(
  svm: LiteSVM,
  transaction: Transaction,
  signers: Signer[],
  logs = false
) {
  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.sign(...signers);
  const transactionMeta = svm.sendTransaction(transaction);
  svm.expireBlockhash();

  if (transactionMeta instanceof FailedTransactionMetadata) {
    throw Error(transactionMeta.meta().logs().toString());
  }

  if (logs) {
    console.log((transactionMeta as TransactionMetadata).logs());
  }
}

export async function expectThrowsAsync(
  fn: () => Promise<void>,
  errorMessage: String
) {
  try {
    await fn();
  } catch (err) {
    if (!(err instanceof Error)) {
      throw err;
    } else {
      if (!err.message.toLowerCase().includes(errorMessage.toLowerCase())) {
        throw new Error(
          `Unexpected error: ${err.message}. Expected error: ${errorMessage}`
        );
      }
      return;
    }
  }
  throw new Error("Expected an error but didn't get one");
}

export function getDbcProgramErrorCodeHexString(errorMessage: String) {
  const error = VirtualCurveIDL.errors.find(
    (e) =>
      e.name.toLowerCase() === errorMessage.toLowerCase() ||
      e.msg.toLowerCase() === errorMessage.toLowerCase()
  );

  if (!error) {
    throw new Error(
      `Unknown stake for fee error message / name: ${errorMessage}`
    );
  }

  return "0x" + error.code.toString(16);
}

export const wrapSOLInstruction = (
  from: PublicKey,
  to: PublicKey,
  amount: bigint
): TransactionInstruction[] => {
  return [
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: to,
      lamports: amount,
    }),
    new TransactionInstruction({
      keys: [
        {
          pubkey: to,
          isSigner: false,
          isWritable: true,
        },
      ],
      data: Buffer.from(new Uint8Array([17])),
      programId: TOKEN_PROGRAM_ID,
    }),
  ];
};

export const unwrapSOLInstruction = (
  owner: PublicKey,
  allowOwnerOffCurve = true
) => {
  const wSolATAAccount = getAssociatedTokenAddressSync(
    NATIVE_MINT,
    owner,
    allowOwnerOffCurve
  );
  if (wSolATAAccount) {
    const closedWrappedSolInstruction = createCloseAccountInstruction(
      wSolATAAccount,
      owner,
      owner,
      [],
      TOKEN_PROGRAM_ID
    );
    return closedWrappedSolInstruction;
  }
  return null;
};

export function getOrCreateAssociatedTokenAccount(
  svm: LiteSVM,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  program: PublicKey
): { ata: PublicKey; ix?: TransactionInstruction } {
  const ataKey = getAssociatedTokenAddressSync(mint, owner, true, program);

  const account = svm.getAccount(ataKey);
  if (account === null) {
    const createAtaIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      ataKey,
      owner,
      mint,
      program
    );
    return { ata: ataKey, ix: createAtaIx };
  }

  return { ata: ataKey, ix: undefined };
}

export function getTokenAccount(svm: LiteSVM, key: PublicKey) {
  const account = svm.getAccount(key);
  if (!account) {
    return null;
  }
  const tokenAccountState = AccountLayout.decode(account.data);
  return tokenAccountState;
}

export function getBalance(svm: LiteSVM, wallet: PublicKey) {
  const account = svm.getAccount(wallet)!;
  return account.lamports;
}

export function getMint(svm: LiteSVM, mint: PublicKey) {
  const account = svm.getAccount(mint)!;
  const mintState = MintLayout.decode(account.data);
  return mintState;
}

export async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

export function getCurrentSlot(svm: LiteSVM): BN {
  const slot = svm.getClock().slot;
  return new BN(slot.toString());
}

export function warpSlotBy(svm: LiteSVM, slots: BN) {
  svm.warpToSlot(BigInt(slots.toString()));
}

export const SET_COMPUTE_UNIT_LIMIT_IX =
  web3.ComputeBudgetProgram.setComputeUnitLimit({
    units: 1_400_000,
  });

export async function createInitializePermissionlessDynamicVaultIx(
  mint: PublicKey,
  payer: PublicKey
): Promise<{
  vaultKey: PublicKey;
  tokenVaultKey: PublicKey;
  lpMintKey: PublicKey;
  instruction: TransactionInstruction;
}> {
  const program = createVaultProgram();
  const vaultKey = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), mint.toBuffer(), BASE_ADDRESS.toBuffer()],
    program.programId
  )[0];

  const tokenVaultKey = PublicKey.findProgramAddressSync(
    [Buffer.from("token_vault"), vaultKey.toBuffer()],
    program.programId
  )[0];

  const lpMintKey = PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint"), vaultKey.toBuffer()],
    program.programId
  )[0];

  const ix = await program.methods
    .initialize()
    .accountsPartial({
      vault: vaultKey,
      tokenVault: tokenVaultKey,
      tokenMint: mint,
      lpMint: lpMintKey,
      payer,
      rent: SYSVAR_RENT_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  return {
    instruction: ix,
    vaultKey,
    tokenVaultKey,
    lpMintKey,
  };
}

export async function createVaultIfNotExists(
  svm: LiteSVM,
  mint: PublicKey,
  payer: Keypair
): Promise<{
  vaultPda: PublicKey;
  tokenVaultPda: PublicKey;
  lpMintPda: PublicKey;
}> {
  const vaultIx = await createInitializePermissionlessDynamicVaultIx(
    mint,
    payer.publicKey
  );

  const vaultAccount = svm.getAccount(vaultIx.vaultKey);
  if (!vaultAccount) {
    let tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.add(vaultIx.instruction);
    tx.sign(payer);
    svm.sendTransaction(tx);
  }

  return {
    vaultPda: vaultIx.vaultKey,
    tokenVaultPda: vaultIx.tokenVaultKey,
    lpMintPda: vaultIx.lpMintKey,
  };
}

export function getDynamicVault(svm: LiteSVM, vault: PublicKey): DynamicVault {
  const program = createVaultProgram();
  const account = svm.getAccount(vault)!;
  return program.coder.accounts.decode("Vault", Buffer.from(account.data));
}

export async function createDammConfig(
  svm: LiteSVM,
  payer: Keypair,
  poolCreatorAuthority: PublicKey
): Promise<PublicKey> {
  const program = createDammProgram();
  const params = {
    tradeFeeNumerator: new BN(250),
    protocolTradeFeeNumerator: new BN(10),
    activationDuration: new BN(0),
    vaultConfigKey: PublicKey.default,
    poolCreatorAuthority: poolCreatorAuthority,
    partnerFeeNumerator: new BN(0),
    activationType: 0, //slot
    index: new BN(1),
  };
  const [config] = PublicKey.findProgramAddressSync(
    [Buffer.from("config"), params.index.toBuffer("le", 8)],
    DAMM_PROGRAM_ID
  );

  const account = svm.getAccount(config);
  if (account) {
    return config;
  }

  const transaction = await program.methods
    .createConfig(params)
    .accounts({
      config,
      admin: payer.publicKey,
    })
    .transaction();

  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.sign(payer);
  svm.sendTransaction(transaction);

  return config;
}

export enum DammV2OperatorPermission {
  CreateConfigKey, // 0
  RemoveConfigKey, // 1
  CreateTokenBadge, // 2
  CloseTokenBadge, // 3
  SetPoolStatus, // 4
  InitializeReward, // 5
  UpdateRewardDuration, // 6
  UpdateRewardFunder, // 7
  UpdatePoolFees, // 8
  ClaimProtocolFee, // 9
}

export function encodePermissions(permissions: DammV2OperatorPermission[]): BN {
  return permissions.reduce((acc, perm) => {
    return acc.or(new BN(1).shln(perm));
  }, new BN(0));
}

function deriveDammV2OperatorAddress(
  whitelistedAddress: PublicKey,
  programId: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("operator"), whitelistedAddress.toBuffer()],
    programId
  )[0];
}

export type CreateOperatorParams = {
  admin: Keypair;
  whitelistAddress: PublicKey;
  permission: BN;
};

export async function createDammV2Operator(
  svm: LiteSVM,
  params: CreateOperatorParams
) {
  const program = createDammV2Program();
  const { admin, permission, whitelistAddress } = params;

  const operator = deriveDammV2OperatorAddress(
    whitelistAddress,
    program.programId
  );

  const transaction = await program.methods
    .createOperatorAccount(permission)
    .accountsPartial({
      operator,
      whitelistedAddress: whitelistAddress,
      signer: admin.publicKey,
      payer: admin.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .transaction();
  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.sign(admin);

  svm.sendTransaction(transaction);
}

export async function createDammV2Config(
  svm: LiteSVM,
  operator: Keypair,
  poolCreatorAuthority: PublicKey,
  activationType: number = 0
): Promise<PublicKey> {
  const program = createDammV2Program();

  const feeTimeScheduler: BorshFeeTimeScheduler = {
    cliffFeeNumerator: new BN(2_500_000),
    numberOfPeriod: 0,
    reductionFactor: new BN(0),
    periodFrequency: new BN(0),
    baseFeeMode: 0,
    padding: Array(3).fill(0),
  };

  const baseFeeData = program.coder.types.encode(
    "borshFeeTimeScheduler",
    feeTimeScheduler
  );

  const params = {
    index: new BN(0),
    poolFees: {
      baseFee: {
        data: Array.from(baseFeeData),
      },
      protocolFeePercent: 10,
      partnerFeePercent: 0,
      referralFeePercent: 0,
      dynamicFee: null,
    },
    sqrtMinPrice: new BN(MIN_SQRT_PRICE),
    sqrtMaxPrice: new BN(MAX_SQRT_PRICE),
    vaultConfigKey: PublicKey.default,
    poolCreatorAuthority,
    activationType,
    collectFeeMode: 0,
  };
  const [config] = PublicKey.findProgramAddressSync(
    [Buffer.from("config"), params.index.toBuffer("le", 8)],
    DAMM_V2_PROGRAM_ID
  );

  const operatorPda = deriveDammV2OperatorAddress(
    operator.publicKey,
    program.programId
  );

  const transaction = await program.methods
    .createConfig(new BN(0), params)
    .accountsPartial({
      config,
      operator: operatorPda,
      payer: operator.publicKey,
      signer: operator.publicKey,
    })
    .transaction();

  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.sign(operator);
  svm.sendTransaction(transaction);

  return config;
}

export async function createDammV2DynamicConfig(
  svm: LiteSVM,
  operator: Keypair,
  poolCreatorAuthority: PublicKey
): Promise<PublicKey> {
  const program = createDammV2Program();

  const [config] = PublicKey.findProgramAddressSync(
    [Buffer.from("config"), new BN(0).toBuffer("le", 8)],
    DAMM_V2_PROGRAM_ID
  );

  const operatorPda = deriveDammV2OperatorAddress(
    operator.publicKey,
    program.programId
  );

  const transaction = await program.methods
    .createDynamicConfig(new BN(0), { poolCreatorAuthority })
    .accountsPartial({
      config,
      operator: operatorPda,
      signer: operator.publicKey,
      payer: operator.publicKey,
    })
    .transaction();

  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.sign(operator);
  svm.sendTransaction(transaction);

  return config;
}

export async function createLockEscrowIx(
  svm: LiteSVM,
  payer: Keypair,
  pool: PublicKey,
  lpMint: PublicKey,
  escrowOwner: PublicKey,
  lockEscrowKey: PublicKey
): Promise<PublicKey> {
  const program = createDammProgram();

  const transaction = await program.methods
    .createLockEscrow()
    .accountsPartial({
      pool,
      lpMint,
      owner: escrowOwner,
      lockEscrow: lockEscrowKey,
      systemProgram: SystemProgram.programId,
      payer: payer.publicKey,
    })
    .transaction();

  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.sign(payer);
  svm.sendTransaction(transaction);

  return lockEscrowKey;
}

export function getOrCreateAta(
  svm: LiteSVM,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey
) {
  const ataKey = getAssociatedTokenAddressSync(mint, owner, true);

  const account = svm.getAccount(ataKey);
  if (account === null) {
    const createAtaIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      ataKey,
      owner,
      mint
    );
    let transaction = new Transaction();
    transaction.recentBlockhash = svm.latestBlockhash();
    transaction.add(createAtaIx);
    transaction.sign(payer);
    svm.sendTransaction(transaction);
  }

  return ataKey;
}

export function getTokenProgram(flag: number): PublicKey {
  return flag == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
}

export async function createDbcConfig(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  migrationOption: number,
  migrationFeeOption: number,
  migratedPoolFee: {
    poolFeeBps: number;
    collectFeeMode: number;
    dynamicFee: number;
  },
  partner: Keypair,
): Promise<PublicKey> {
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
    collectFeeMode: 1, // BothToken
    migrationOption,
    tokenType: 0, // spl_token
    tokenDecimal: 6,
    migrationQuoteThreshold: new BN(LAMPORTS_PER_SOL * 5),
    partnerLiquidityPercentage: 20,
    creatorLiquidityPercentage: 20,
    partnerPermanentLockedLiquidityPercentage: 55,
    creatorPermanentLockedLiquidityPercentage: 5,
    sqrtStartPrice: MIN_SQRT_PRICE.shln(32),
    lockedVesting: {
      amountPerPeriod: new BN(0),
      cliffDurationFromMigrationTime: new BN(0),
      frequency: new BN(0),
      numberOfPeriod: new BN(0),
      cliffUnlockAmount: new BN(0),
    },
    migrationFeeOption,
    tokenSupply: null,
    creatorTradingFeePercentage: 0,
    tokenUpdateAuthority: 0,
    migrationFee: {
      feePercentage: 0,
      creatorFeePercentage: 0,
    },
    poolCreationFee: new BN(0),
    migratedPoolFee,
    curve: curves,
    creatorLiquidityVestingInfo: {
      vestingPercentage: 0,
      cliffDurationFromMigrationTime: 0,
      bpsPerPeriod: 0,
      numberOfPeriods: 0,
      frequency: 0,
    },
    partnerLiquidityVestingInfo: {
      vestingPercentage: 0,
      cliffDurationFromMigrationTime: 0,
      bpsPerPeriod: 0,
      numberOfPeriods: 0,
      frequency: 0,
    },
    migratedPoolBaseFeeMode: 0,
    migratedPoolMarketCapFeeSchedulerParams: null,
    enableFirstSwapWithMinFee: false,
  };
  const params: CreateConfigParams<ConfigParameters> = {
    payer: partner,
    leftoverReceiver: partner.publicKey,
    feeClaimer: partner.publicKey,
    quoteMint: NATIVE_MINT,
    instructionParams,
  };
  const config = await createConfig(svm, program, params);

  return config;
}

export async function createPoolAndSwapForMigration(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  config: PublicKey,
  poolCreator: Keypair,
) {
  const virtualPool = await createPoolWithSplToken(svm, program, {
    poolCreator,
    payer: poolCreator,
    quoteMint: NATIVE_MINT,
    config,
    instructionParams: {
      name: "test token spl",
      symbol: "TEST",
      uri: "abc.com",
    },
  });
  const virtualPoolState = getVirtualPool(svm, program, virtualPool);

  await swap(svm, program, {
    config,
    payer: poolCreator,
    pool: virtualPool,
    inputTokenMint: NATIVE_MINT,
    outputTokenMint: virtualPoolState.baseMint,
    amountIn: new BN(LAMPORTS_PER_SOL * 5.5),
    minimumAmountOut: new BN(0),
    swapMode: SwapMode.PartialFill,
    referralTokenAccount: null,
  });

  return virtualPool;
}

export async function dammV2Migration(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  poolCreator: Keypair,
  admin: Keypair,
  virtualPoolAddress: PublicKey,
  config: PublicKey,
) {
  await createMeteoraDammV2Metadata(svm, program, {
    payer: poolCreator,
    virtualPool: virtualPoolAddress,
    config,
  });

  const poolAuthority = derivePoolAuthority();
  const dammConfig = await createDammV2DynamicConfig(svm, admin, poolAuthority);
  const migrationParams: MigrateMeteoraDammV2Params = {
    payer: admin,
    virtualPool: virtualPoolAddress,
    dammConfig,
  };

  await migrateToDammV2(svm, program, migrationParams);
}

export async function dammMigration(
  svm: LiteSVM,
  admin: Keypair,
  poolCreator: Keypair,
  program: VirtualCurveProgram,
  virtualPool: PublicKey,
  config: PublicKey,
) {
  const poolAuthority = derivePoolAuthority();
  const dammConfig = await createDammConfig(svm, admin, poolAuthority);
  const migrationParams: MigrateMeteoraParams = {
    payer: poolCreator,
    virtualPool,
    dammConfig,
  };
  await createMeteoraMetadata(svm, program, {
    payer: admin,
    virtualPool,
    config,
  });

  await migrateToMeteoraDamm(svm, program, migrationParams);
}
