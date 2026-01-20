import {
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  AccountMeta,
  ComputeBudgetProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  BaseFee,
  ConfigParameters,
  createConfig,
  CreateConfigParams,
  createMeteoraMetadata,
  createOperatorAccount,
  createPoolWithSplToken,
  MigrateMeteoraParams,
  migrateToMeteoraDamm,
  OperatorPermission,
  swap,
  SwapMode,
} from "./instructions";
import {
  createDammConfig,
  createDammProgram,
  createDammV2DynamicConfig,
  createDammV2Operator,
  createDammV2Program,
  createVirtualCurveProgram,
  DAMM_V2_PROGRAM_ID,
  DammV2OperatorPermission,
  deriveDammPoolAddress,
  deriveDammV2PoolAddress,
  deriveOperatorAddress,
  derivePoolAuthority,
  encodePermissions,
  generateAndFund,
  getTokenAccount,
  JUP_V6_EVENT_AUTHORITY,
  JUPITER_V6_PROGRAM_ID,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  sendTransactionMaybeThrow,
  startSvm,
  TREASURY,
  U64_MAX,
  VAULT_PROGRAM_ID,
  ZAP_PROGRAM_ID,
} from "./utils";
import {
  getConfig,
  getDammV1Pool,
  getDammV2Pool,
  getVaultAccount,
  getVirtualPool,
} from "./utils/fetcher";
import { DammV1Pool, DammV2Pool, VirtualCurveProgram } from "./utils/types";

import * as borsh from "@coral-xyz/borsh";
import { BN } from "@coral-xyz/anchor";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  createMeteoraDammV2Metadata,
  MigrateMeteoraDammV2Params,
  migrateToDammV2,
} from "./instructions/dammV2Migration";
import { getOrCreateAssociatedTokenAccount } from "./utils/token";

const DAMM_V1_SWAP_ENUM_IN_JUP_V6 = 19;
const DAMM_V2_SWAP_ENUM_IN_JUP_V6 = 77;

describe("Claim protocol liquidity migration fee", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;

  before(async () => {
    svm = startSvm();
    admin = generateAndFund(svm);
    operator = generateAndFund(svm);
    partner = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    program = createVirtualCurveProgram();

    await createOperatorAccount(svm, program, {
      admin,
      whitelistedAddress: operator.publicKey,
      permissions: [OperatorPermission.ZapProtocolFee],
    });

    await createDammV2Operator(svm, {
      whitelistAddress: admin.publicKey,
      admin,
      permission: encodePermissions([DammV2OperatorPermission.CreateConfigKey]),
    });
  });

  it("Claim protocol liquidity migration fee after migrate to damm v2", async () => {
    const migrationOptionDammV2 = 1;
    const customizableMigrationFeeOption = 6;

    const config = await createDbcConfig(
      svm,
      program,
      migrationOptionDammV2,
      customizableMigrationFeeOption,
      {
        poolFeeBps: 100,
        collectFeeMode: 0,
        dynamicFee: 0,
      },
      partner,
    );

    const virtualPoolAddress = await createPoolAndSwapForMigration(
      svm,
      program,
      config,
      poolCreator,
    );

    await dammV2Migration(
      svm,
      program,
      poolCreator,
      admin,
      virtualPoolAddress,
      config,
    );

    const virtualPoolState = getVirtualPool(svm, program, virtualPoolAddress);
    const configState = getConfig(svm, program, config);

    const baseMint = virtualPoolState.baseMint;
    const quoteMint = configState.quoteMint;

    createAta(svm, admin, baseMint, quoteMint, operator);

    const dammV2Config = PublicKey.findProgramAddressSync(
      [Buffer.from("config"), new BN(0).toBuffer("le", 8)],
      DAMM_V2_PROGRAM_ID,
    )[0];

    const dammV2Pool = deriveDammV2PoolAddress(
      dammV2Config,
      virtualPoolState.baseMint,
      configState.quoteMint,
    );

    await zapProtocolFeeAndAssert(
      svm,
      program,
      virtualPoolAddress,
      config,
      true,
      operator,
      dammV2Pool,
      NATIVE_MINT,
      buildZapOutJupV6UsingDammV2RouteInstruction,
    );
  });

  it("Claim protocol liquidity migration fee after migrate to damm", async () => {
    const migrationOptionDamm = 0;
    const fixedFeeBps0MigrationFeeOption = 0;

    const config = await createDbcConfig(
      svm,
      program,
      migrationOptionDamm,
      fixedFeeBps0MigrationFeeOption,
      {
        poolFeeBps: 0,
        collectFeeMode: 0,
        dynamicFee: 0,
      },
      partner,
    );

    const virtualPoolAddress = await createPoolAndSwapForMigration(
      svm,
      program,
      config,
      poolCreator,
    );

    await dammMigration(
      svm,
      admin,
      poolCreator,
      program,
      virtualPoolAddress,
      config,
    );

    const virtualPoolState = getVirtualPool(svm, program, virtualPoolAddress);
    const configState = getConfig(svm, program, config);

    const baseMint = virtualPoolState.baseMint;
    const quoteMint = configState.quoteMint;

    createAta(svm, admin, baseMint, quoteMint, operator);

    const dammConfig = await createDammConfig(
      svm,
      admin,
      derivePoolAuthority(),
    );
    const dammV1Pool = deriveDammPoolAddress(dammConfig, baseMint, quoteMint);

    await zapProtocolFeeAndAssert(
      svm,
      program,
      virtualPoolAddress,
      config,
      true,
      operator,
      dammV1Pool,
      NATIVE_MINT,
      buildZapOutJupV6UsingDammV1RouteInstruction,
    );
  });
});

async function zapProtocolFeeAndAssert(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  virtualPool: PublicKey,
  config: PublicKey,
  isClaimingBase: boolean,
  operatorKeypair: Keypair,
  zapPoolAddress: PublicKey,
  zapOutputMint: PublicKey,
  zapOutIxFn: (
    svm: LiteSVM,
    pool: PublicKey,
    protocolFeeAmount: BN,
    outputMint: PublicKey,
    operatorAddress: PublicKey,
    treasuryAddress: PublicKey,
  ) => Promise<TransactionInstruction>,
) {
  const poolState = getVirtualPool(svm, program, virtualPool);
  const configState = getConfig(svm, program, config);
  const operatorAddress = operatorKeypair.publicKey;

  const tokenVault = isClaimingBase
    ? poolState.baseVault
    : poolState.quoteVault;
  const claimTokenMint = isClaimingBase
    ? poolState.baseMint
    : configState.quoteMint;

  const claimAmount = isClaimingBase
    ? poolState.protocolBaseFee
    : poolState.protocolQuoteFee;

  const receiverToken = getAssociatedTokenAddressSync(
    claimTokenMint,
    operatorKeypair.publicKey,
    true,
  );

  const treasuryTokenAccount = getAssociatedTokenAddressSync(
    zapOutputMint,
    TREASURY,
    true,
  );

  const beforeTreasuryAccount = getTokenAccount(svm, treasuryTokenAccount);
  const beforeTreasuryBalance = beforeTreasuryAccount
    ? new BN(beforeTreasuryAccount.amount.toString())
    : new BN(0);

  const zapOutIx = await zapOutIxFn(
    svm,
    zapPoolAddress,
    claimAmount,
    zapOutputMint,
    operatorAddress,
    TREASURY,
  );

  await zapProtocolFee({
    svm,
    program,
    config,
    pool: virtualPool,
    tokenVault,
    tokenMint: claimTokenMint,
    receiverToken,
    operator: deriveOperatorAddress(operatorAddress),
    signer: operatorKeypair,
    tokenBaseProgram: TOKEN_PROGRAM_ID,
    tokenQuoteProgram: TOKEN_PROGRAM_ID,
    maxAmount: claimAmount,
    postInstruction: zapOutIx,
  });

  const afterTreasuryAccount = getTokenAccount(svm, treasuryTokenAccount);
  const afterTreasuryBalance = afterTreasuryAccount
    ? new BN(afterTreasuryAccount.amount.toString())
    : new BN(0);

  expect(afterTreasuryBalance.gt(beforeTreasuryBalance)).to.be.true;
}

async function zapProtocolFee(params: {
  svm: LiteSVM;
  program: VirtualCurveProgram;
  config: PublicKey;
  pool: PublicKey;
  tokenVault: PublicKey;
  tokenMint: PublicKey;
  receiverToken: PublicKey;
  operator: PublicKey;
  signer: Keypair;
  tokenBaseProgram: PublicKey;
  tokenQuoteProgram: PublicKey;
  maxAmount: BN;
  postInstruction?: TransactionInstruction;
}) {
  const {
    svm,
    program,
    config,
    pool,
    tokenVault,
    tokenMint,
    receiverToken,
    operator,
    signer,
    tokenBaseProgram,
    tokenQuoteProgram,
    maxAmount,
    postInstruction,
  } = params;

  const tx = await program.methods
    .zapProtocolFee(maxAmount)
    .accountsPartial({
      poolAuthority: derivePoolAuthority(),
      config,
      pool,
      tokenVault,
      tokenMint,
      receiverToken,
      operator,
      signer: signer.publicKey,
      tokenBaseProgram,
      tokenQuoteProgram,
      sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
    })
    .postInstructions(postInstruction ? [postInstruction] : [])
    .transaction();

  return sendTransactionMaybeThrow(svm, tx, [signer]);
}

const authorityId = 0;
const jupProgramAuthority = PublicKey.findProgramAddressSync(
  [Buffer.from("authority"), new BN(authorityId).toBuffer("le", 1)],
  JUPITER_V6_PROGRAM_ID,
);

async function getDammV1SwapIx(
  svm: LiteSVM,
  pool: PublicKey,
  protocolFeeAmount: BN,
  outputMint: PublicKey,
  operatorAddress: PublicKey,
  treasuryAddress: PublicKey,
) {
  const poolAccount = getDammV1Pool(svm, pool);

  const [userSourceToken, userDestinationToken] = outputMint.equals(
    poolAccount.tokenAMint,
  )
    ? [
        getAssociatedTokenAddressSync(
          poolAccount.tokenBMint,
          operatorAddress,
          true,
        ),
        getAssociatedTokenAddressSync(
          poolAccount.tokenAMint,
          treasuryAddress,
          true,
        ),
      ]
    : [
        getAssociatedTokenAddressSync(
          poolAccount.tokenAMint,
          operatorAddress,
          true,
        ),
        getAssociatedTokenAddressSync(
          poolAccount.tokenBMint,
          treasuryAddress,
          true,
        ),
      ];

  const aVault = getVaultAccount(svm, poolAccount.aVault);
  const bVault = getVaultAccount(svm, poolAccount.bVault);
  const protocolTokenFee = outputMint.equals(poolAccount.tokenAMint)
    ? poolAccount.protocolTokenBFee
    : poolAccount.protocolTokenAFee;

  const program = createDammProgram();

  const swapIx = await program.methods
    .swap(protocolFeeAmount, new BN(0))
    .accountsPartial({
      aTokenVault: aVault.tokenVault,
      bTokenVault: bVault.tokenVault,
      aVault: poolAccount.aVault,
      bVault: poolAccount.bVault,
      aVaultLp: poolAccount.aVaultLp,
      bVaultLp: poolAccount.bVaultLp,
      aVaultLpMint: aVault.lpMint,
      bVaultLpMint: bVault.lpMint,
      userSourceToken,
      userDestinationToken,
      user: operatorAddress,
      protocolTokenFee,
      pool,
      tokenProgram: TOKEN_PROGRAM_ID,
      vaultProgram: VAULT_PROGRAM_ID,
    })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 1_400_000,
      }),
    ])
    .instruction();

  return swapIx;
}

async function getDammV2SwapIx(
  svm: LiteSVM,
  pool: PublicKey,
  protocolFeeAmount: BN,
  outputMint: PublicKey,
  operatorAddress: PublicKey,
  treasuryAddress: PublicKey,
) {
  const program = createDammV2Program();

  const poolState = getDammV2Pool(svm, pool);

  const [inputTokenAccount, outputTokenAccount] = outputMint.equals(
    poolState.tokenAMint,
  )
    ? [
        getAssociatedTokenAddressSync(
          poolState.tokenBMint,
          operatorAddress,
          true,
        ),
        getAssociatedTokenAddressSync(
          poolState.tokenAMint,
          treasuryAddress,
          true,
        ),
      ]
    : [
        getAssociatedTokenAddressSync(
          poolState.tokenAMint,
          operatorAddress,
          true,
        ),
        getAssociatedTokenAddressSync(
          poolState.tokenBMint,
          treasuryAddress,
          true,
        ),
      ];

  const swapIx = await program.methods
    .swap({
      amountIn: protocolFeeAmount,
      minimumAmountOut: new BN(0),
    })
    .accountsPartial({
      pool,
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAVault: poolState.tokenAVault,
      tokenBVault: poolState.tokenBVault,
      payer: operatorAddress,
      inputTokenAccount,
      outputTokenAccount,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      referralTokenAccount: null,
    })
    .instruction();

  return swapIx;
}

function buildZapOutParameter(params: {
  preUserTokenBalance: BN;
  maxSwapAmount: BN;
  offsetAmountIn: number;
  payloadData: Buffer;
}) {
  const { preUserTokenBalance, maxSwapAmount, offsetAmountIn, payloadData } =
    params;

  const zapOutDisc = [155, 108, 185, 112, 104, 210, 161, 64];
  const zapOutDiscBN = new BN(zapOutDisc, "le");

  const zapOutParameterSchema = borsh.struct([
    borsh.u64("discriminator"),
    borsh.u8("percentage"),
    borsh.u16("offsetAmountIn"),
    borsh.u64("preUserTokenBalance"),
    borsh.u64("maxSwapAmount"),
    borsh.vecU8("payloadData"),
  ]);

  const buffer = Buffer.alloc(1000);

  zapOutParameterSchema.encode(
    {
      discriminator: zapOutDiscBN,
      percentage: 100,
      offsetAmountIn,
      preUserTokenBalance,
      maxSwapAmount,
      payloadData,
    },
    buffer,
  );

  return buffer.subarray(0, zapOutParameterSchema.getSpan(buffer));
}

async function buildZapOutJupV6UsingDammV1RouteInstruction(
  svm: LiteSVM,
  pool: PublicKey,
  protocolFeeAmount: BN,
  outputMint: PublicKey,
  operatorAddress: PublicKey,
  treasuryAddress: PublicKey,
) {
  const poolAccount = svm.getAccount(pool);
  const dammV1Program = createDammProgram();

  if (poolAccount.owner.toBase58() != dammV1Program.programId.toBase58()) {
    throw new Error("Unsupported pool for JupV6 zap out");
  }

  const poolState: DammV1Pool = dammV1Program.coder.accounts.decode(
    "pool",
    Buffer.from(poolAccount!.data),
  );

  const inputMint = outputMint.equals(poolState.tokenAMint)
    ? poolState.tokenBMint
    : poolState.tokenAMint;

  const swapIx = await getDammV1SwapIx(
    svm,
    pool,
    protocolFeeAmount,
    outputMint,
    operatorAddress,
    treasuryAddress,
  );
  const inputTokenAccount = swapIx.keys[1].pubkey;

  const userTokenInAccount = getTokenAccount(svm, inputTokenAccount);
  const preUserTokenBalance = userTokenInAccount
    ? userTokenInAccount.amount
    : BigInt(0);

  const ROUTE_DISC = [229, 23, 203, 151, 122, 227, 173, 42];

  const routePlanStepSchema = borsh.struct([
    borsh.u8("enumValue"),
    borsh.u8("percent"),
    borsh.u8("inputIndex"),
    borsh.u8("outputIndex"),
  ]);

  const routeIxSchema = borsh.struct([
    borsh.u64("discriminator"),
    borsh.vec(routePlanStepSchema, "routePlan"),
    borsh.u64("inAmount"),
    borsh.u64("quotedOutAmount"),
    borsh.u16("slippageBps"),
    borsh.u8("platformFeeBps"),
  ]);

  const buffer = Buffer.alloc(1000);

  routeIxSchema.encode(
    {
      discriminator: new BN(ROUTE_DISC, "le"),
      routePlan: [
        {
          enumValue: DAMM_V1_SWAP_ENUM_IN_JUP_V6,
          percent: 100,
          inputIndex: 0,
          outputIndex: 1,
        },
      ],
      inAmount: protocolFeeAmount,
      quotedOutAmount: new BN(0),
      slippageBps: 0,
      platformFeeBps: 0,
    },
    buffer,
  );

  const routeIxData = buffer.subarray(0, routeIxSchema.getSpan(buffer));

  const zapOutRawParameters = buildZapOutParameter({
    preUserTokenBalance: new BN(preUserTokenBalance.toString()),
    maxSwapAmount: protocolFeeAmount,
    payloadData: routeIxData,
    offsetAmountIn: routeIxData.length - 19,
  });

  const zapOutAccounts: AccountMeta[] = [
    {
      pubkey: inputTokenAccount,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: JUPITER_V6_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
  ];

  const jupV6RouteAccounts: AccountMeta[] = [
    {
      pubkey: TOKEN_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: operatorAddress,
      isSigner: true,
      isWritable: false,
    },
    {
      pubkey: getAssociatedTokenAddressSync(inputMint, operatorAddress),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: getAssociatedTokenAddressSync(outputMint, operatorAddress),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: getAssociatedTokenAddressSync(outputMint, treasuryAddress, true),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: outputMint,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: JUPITER_V6_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: JUP_V6_EVENT_AUTHORITY,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: JUPITER_V6_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: dammV1Program.programId,
      isSigner: false,
      isWritable: false,
    },
  ];

  jupV6RouteAccounts.push(...swapIx.keys);
  zapOutAccounts.push(...jupV6RouteAccounts);

  const zapOutIx: TransactionInstruction = {
    programId: ZAP_PROGRAM_ID,
    keys: zapOutAccounts,
    data: zapOutRawParameters,
  };

  return zapOutIx;
}

async function buildZapOutJupV6UsingDammV2RouteInstruction(
  svm: LiteSVM,
  pool: PublicKey,
  protocolFeeAmount: BN,
  outputMint: PublicKey,
  operatorAddress: PublicKey,
  treasuryAddress: PublicKey,
) {
  const poolAccount = svm.getAccount(pool);
  const dammV2Program = createDammV2Program();

  if (poolAccount.owner.toBase58() != dammV2Program.programId.toBase58()) {
    throw new Error("Unsupported pool for JupV6 zap out");
  }

  const poolState: DammV2Pool = dammV2Program.coder.accounts.decode(
    "pool",
    Buffer.from(poolAccount!.data),
  );

  const inputMint = outputMint.equals(poolState.tokenAMint)
    ? poolState.tokenBMint
    : poolState.tokenAMint;

  const swapIx = await getDammV2SwapIx(
    svm,
    pool,
    protocolFeeAmount,
    outputMint,
    operatorAddress,
    treasuryAddress,
  );
  const inputTokenAccount = swapIx.keys[2].pubkey;

  const userTokenInAccount = getTokenAccount(svm, inputTokenAccount);
  const preUserTokenBalance = userTokenInAccount
    ? userTokenInAccount.amount
    : BigInt(0);

  const ROUTE_DISC = [229, 23, 203, 151, 122, 227, 173, 42];

  const routePlanStepSchema = borsh.struct([
    borsh.u8("enumValue"),
    borsh.u8("percent"),
    borsh.u8("inputIndex"),
    borsh.u8("outputIndex"),
  ]);

  const routeIxSchema = borsh.struct([
    borsh.u64("discriminator"),
    borsh.vec(routePlanStepSchema, "routePlan"),
    borsh.u64("inAmount"),
    borsh.u64("quotedOutAmount"),
    borsh.u16("slippageBps"),
    borsh.u8("platformFeeBps"),
  ]);

  const buffer = Buffer.alloc(1000);

  routeIxSchema.encode(
    {
      discriminator: new BN(ROUTE_DISC, "le"),
      routePlan: [
        {
          enumValue: DAMM_V2_SWAP_ENUM_IN_JUP_V6,
          percent: 100,
          inputIndex: 0,
          outputIndex: 1,
        },
      ],
      inAmount: protocolFeeAmount,
      quotedOutAmount: new BN(0),
      slippageBps: 0,
      platformFeeBps: 0,
    },
    buffer,
  );

  const routeIxData = buffer.subarray(0, routeIxSchema.getSpan(buffer));

  const zapOutRawParameters = buildZapOutParameter({
    preUserTokenBalance: new BN(preUserTokenBalance.toString()),
    maxSwapAmount: protocolFeeAmount,
    payloadData: routeIxData,
    offsetAmountIn: routeIxData.length - 19,
  });

  const zapOutAccounts: AccountMeta[] = [
    {
      pubkey: inputTokenAccount,
      isWritable: true,
      isSigner: false,
    },
    {
      pubkey: JUPITER_V6_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
  ];

  const jupV6RouteAccounts: AccountMeta[] = [
    {
      pubkey: TOKEN_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: operatorAddress,
      isSigner: true,
      isWritable: false,
    },
    {
      pubkey: getAssociatedTokenAddressSync(inputMint, operatorAddress),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: getAssociatedTokenAddressSync(outputMint, operatorAddress),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: getAssociatedTokenAddressSync(outputMint, treasuryAddress, true),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: outputMint,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: JUPITER_V6_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: JUP_V6_EVENT_AUTHORITY,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: JUPITER_V6_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: dammV2Program.programId,
      isSigner: false,
      isWritable: false,
    },
  ];

  jupV6RouteAccounts.push(...swapIx.keys);
  zapOutAccounts.push(...jupV6RouteAccounts);

  const zapOutIx: TransactionInstruction = {
    programId: ZAP_PROGRAM_ID,
    keys: zapOutAccounts,
    data: zapOutRawParameters,
  };

  return zapOutIx;
}

async function createDbcConfig(
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

async function createPoolAndSwapForMigration(
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

async function dammV2Migration(
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

async function dammMigration(
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

function createAta(
  svm: LiteSVM,
  admin: Keypair,
  baseMint: PublicKey,
  quoteMint: PublicKey,
  operator: Keypair,
) {
  getOrCreateAssociatedTokenAccount(
    svm,
    admin,
    baseMint,
    operator.publicKey,
    TOKEN_PROGRAM_ID,
  );
  getOrCreateAssociatedTokenAccount(
    svm,
    admin,
    quoteMint,
    operator.publicKey,
    TOKEN_PROGRAM_ID,
  );

  getOrCreateAssociatedTokenAccount(
    svm,
    admin,
    baseMint,
    TREASURY,
    TOKEN_PROGRAM_ID,
  );
  getOrCreateAssociatedTokenAccount(
    svm,
    admin,
    quoteMint,
    TREASURY,
    TOKEN_PROGRAM_ID,
  );

  getOrCreateAssociatedTokenAccount(
    svm,
    admin,
    baseMint,
    jupProgramAuthority[0],
    TOKEN_PROGRAM_ID,
  );
  getOrCreateAssociatedTokenAccount(
    svm,
    admin,
    quoteMint,
    jupProgramAuthority[0],
    TOKEN_PROGRAM_ID,
  );
}
