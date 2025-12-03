import { BN } from "@coral-xyz/anchor";
import {
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  createVirtualCurveProgram,
  derivePartnerMetadata,
  derivePoolAuthority,
  getOrCreateAssociatedTokenAccount,
  getTokenAccount,
  getTokenProgram,
  sendTransactionMaybeThrow,
  unwrapSOLInstruction,
} from "../utils";
import {
  getConfig,
  getPartnerMetadata,
  getVirtualPool,
} from "../utils/fetcher";
import { VirtualCurveProgram } from "../utils/types";

export type BaseFee = {
  cliffFeeNumerator: BN;
  firstFactor: number;
  secondFactor: BN;
  thirdFactor: BN;
  baseFeeMode: number;
};

export type DynamicFee = {
  binStep: number;
  binStepU128: BN;
  filterPeriod: number;
  decayPeriod: number;
  reductionFactor: number;
  maxVolatilityAccumulator: number;
  variableFeeControl: number;
};

export type LockedVestingParams = {
  amountPerPeriod: BN;
  cliffDurationFromMigrationTime: BN;
  frequency: BN;
  numberOfPeriod: BN;
  cliffUnlockAmount: BN;
};

export type TokenSupplyParams = {
  preMigrationTokenSupply: BN;
  postMigrationTokenSupply: BN;
};

export type LiquidityDistributionParameters = {
  sqrtPrice: BN;
  liquidity: BN;
};

export type MigrationFeeParams = {
  feePercentage: number;
  creatorFeePercentage: number;
};

export type LpImpermanentLockInfoParams = {
  lockPercentage: number;
  lockDuration: number;
};

export type ConfigParameters = {
  poolFees: {
    baseFee: BaseFee;
    dynamicFee: DynamicFee | null;
  };
  collectFeeMode: number;
  migrationOption: number;
  activationType: number;
  tokenType: number;
  tokenDecimal: number;
  migrationQuoteThreshold: BN;
  partnerLpPercentage: number;
  partnerLockedLpPercentage: number;
  creatorLpPercentage: number;
  creatorLockedLpPercentage: number;
  sqrtStartPrice: BN;
  lockedVesting: LockedVestingParams;
  migrationFeeOption: number;
  tokenSupply: TokenSupplyParams | null;
  creatorTradingFeePercentage: number;
  tokenUpdateAuthority: number;
  migrationFee: MigrationFeeParams;
  migratedPoolFee: {
    poolFeeBps: number;
    collectFeeMode: number;
    dynamicFee: number;
  };
  poolCreationFee: BN;
  curve: Array<LiquidityDistributionParameters>;
};

export type LpVestingInfoParams = {
  vestingPercentage: number;
  cliffDurationFromMigrationTime: number;
  bpsPerPeriod: number;
  frequency: BN;
  numberOfPeriods: number;
};

export type LpDistributionInfo = {
  lpPercentage: number;
  lpPermanentLockPercentage: number;
  lpVestingInfo: LpVestingInfoParams;
};

export type DammV2ConfigParameters = {
  virtualPoolFeesConfiguration: {
    baseFee: BaseFee;
    dynamicFee: DynamicFee | null;
    collectFeeMode: number;
    creatorTradingFeePercentage: number;
    poolCreationFee: BN;
  };
  virtualPoolConfiguration: {
    activationType: number;
    migrationQuoteThreshold: BN;
    sqrtStartPrice: BN;
  };
  dammV2MigrationConfiguration: {
    migrationFee: MigrationFeeParams;
    migratedPoolFee: {
      poolFeeBps: number;
      collectFeeMode: number;
      dynamicFee: number;
    };
  };
  liquidityDistributionConfiguration: {
    partnerLpInfo: LpDistributionInfo;
    creatorLpInfo: LpDistributionInfo;
  };
  mintConfiguration: {
    tokenType: number;
    tokenDecimal: number;
    tokenUpdateAuthority: number;
    tokenSupply: TokenSupplyParams;
    lockedVesting: LockedVestingParams;
  };
  curve: Array<LiquidityDistributionParameters>;
};

export type CreateConfigParams<T> = {
  payer: Keypair;
  leftoverReceiver: PublicKey;
  feeClaimer: PublicKey;
  quoteMint: PublicKey;
  instructionParams: T;
};

export async function createConfig(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: CreateConfigParams<ConfigParameters>
): Promise<PublicKey> {
  const { payer, leftoverReceiver, feeClaimer, quoteMint, instructionParams } =
    params;
  const config = Keypair.generate();

  const transaction = await program.methods
    .createConfig({
      ...instructionParams,
      padding: new Array(64).fill(new BN(7)),
    })
    .accountsPartial({
      config: config.publicKey,
      feeClaimer,
      leftoverReceiver,
      quoteMint,
      payer: payer.publicKey,
    })
    .transaction();

  sendTransactionMaybeThrow(svm, transaction, [payer, config]);
  //
  const configState = getConfig(svm, program, config.publicKey);
  // TODO add assertion data fields
  expect(configState.quoteMint.toString()).equal(quoteMint.toString());
  expect(configState.partnerLpPercentage).equal(
    instructionParams.partnerLpPercentage
  );
  expect(configState.partnerLockedLpPercentage).equal(
    instructionParams.partnerLockedLpPercentage
  );
  expect(configState.creatorLpPercentage).equal(
    instructionParams.creatorLpPercentage
  );
  expect(configState.creatorLockedLpPercentage).equal(
    instructionParams.creatorLockedLpPercentage
  );

  return config.publicKey;
}

export async function createDammV2OnlyConfig(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: CreateConfigParams<DammV2ConfigParameters>
): Promise<PublicKey> {
  const { payer, leftoverReceiver, feeClaimer, quoteMint, instructionParams } =
    params;
  const config = Keypair.generate();

  const transaction = await program.methods
    .createConfigForDammv2Migration({
      ...instructionParams,
      padding: new Array(64).fill(new BN(7)),
    })
    .accountsPartial({
      config: config.publicKey,
      feeClaimer,
      leftoverReceiver,
      quoteMint,
      payer: payer.publicKey,
    })
    .transaction();

  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.sign(payer, config);

  sendTransactionMaybeThrow(svm, transaction, [payer, config]);
  const configState = getConfig(svm, program, config.publicKey);
  expect(configState.quoteMint.toString()).equal(quoteMint.toString());

  expect(configState.partnerLpPercentage).equal(
    instructionParams.liquidityDistributionConfiguration.partnerLpInfo
      .lpPercentage
  );

  let vestingLpInfo = configState.partnerLpVestingInfo;
  let ixVestingLpInfo =
    instructionParams.liquidityDistributionConfiguration.partnerLpInfo
      .lpVestingInfo;

  expect(vestingLpInfo.vestingPercentage).equal(
    ixVestingLpInfo.vestingPercentage
  );
  expect(
    new BN(vestingLpInfo.cliffDurationFromMigrationTime, "le").toNumber()
  ).equal(ixVestingLpInfo.cliffDurationFromMigrationTime);
  expect(new BN(vestingLpInfo.bpsPerPeriod, "le").toNumber()).equal(
    ixVestingLpInfo.bpsPerPeriod
  );
  expect(new BN(vestingLpInfo.frequency, "le").toNumber()).equal(
    ixVestingLpInfo.frequency.toNumber()
  );
  expect(new BN(vestingLpInfo.numberOfPeriods, "le").toNumber()).equal(
    ixVestingLpInfo.numberOfPeriods
  );

  vestingLpInfo = configState.creatorLpVestingInfo;
  ixVestingLpInfo =
    instructionParams.liquidityDistributionConfiguration.creatorLpInfo
      .lpVestingInfo;

  expect(vestingLpInfo.vestingPercentage).equal(
    ixVestingLpInfo.vestingPercentage
  );
  expect(
    new BN(vestingLpInfo.cliffDurationFromMigrationTime, "le").toNumber()
  ).equal(ixVestingLpInfo.cliffDurationFromMigrationTime);
  expect(new BN(vestingLpInfo.bpsPerPeriod, "le").toNumber()).equal(
    ixVestingLpInfo.bpsPerPeriod
  );
  expect(new BN(vestingLpInfo.frequency, "le").toNumber()).equal(
    ixVestingLpInfo.frequency.toNumber()
  );
  expect(new BN(vestingLpInfo.numberOfPeriods, "le").toNumber()).equal(
    ixVestingLpInfo.numberOfPeriods
  );

  return config.publicKey;
}

export async function createPartnerMetadata(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: {
    name: string;
    website: string;
    logo: string;
    feeClaimer: Keypair;
    payer: Keypair;
  }
) {
  const { payer, feeClaimer, name, website, logo } = params;
  const partnerMetadata = derivePartnerMetadata(feeClaimer.publicKey);
  const transaction = await program.methods
    .createPartnerMetadata({
      padding: new Array(96).fill(0),
      name,
      website,
      logo,
    })
    .accountsPartial({
      partnerMetadata,
      feeClaimer: feeClaimer.publicKey,
      payer: payer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  sendTransactionMaybeThrow(svm, transaction, [payer, feeClaimer]);
  //
  const metadataState = getPartnerMetadata(svm, program, partnerMetadata);
  expect(metadataState.feeClaimer.toString()).equal(
    feeClaimer.publicKey.toString()
  );
  expect(metadataState.name.toString()).equal(name.toString());
  expect(metadataState.website.toString()).equal(website.toString());
  expect(metadataState.logo.toString()).equal(logo.toString());
}

export type ClaimTradeFeeParams = {
  feeClaimer: Keypair;
  pool: PublicKey;
  maxBaseAmount: BN;
  maxQuoteAmount: BN;
};
export async function claimTradingFee(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: ClaimTradeFeeParams
): Promise<any> {
  const { feeClaimer, pool, maxBaseAmount, maxQuoteAmount } = params;
  const poolState = getVirtualPool(svm, program, pool);
  const configState = getConfig(svm, program, poolState.config);
  const poolAuthority = derivePoolAuthority();

  const quoteMintInfo = getTokenAccount(svm, poolState.quoteVault);

  const tokenBaseProgram =
    configState.tokenType == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  const tokenQuoteProgram =
    configState.quoteTokenFlag == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  const preInstructions: TransactionInstruction[] = [];
  const postInstructions: TransactionInstruction[] = [];
  const [
    { ata: baseTokenAccount, ix: createBaseTokenAccountIx },
    { ata: quoteTokenAccount, ix: createQuoteTokenAccountIx },
  ] = [
    getOrCreateAssociatedTokenAccount(
      svm,
      feeClaimer,
      poolState.baseMint,
      feeClaimer.publicKey,
      tokenBaseProgram
    ),
    getOrCreateAssociatedTokenAccount(
      svm,
      feeClaimer,
      quoteMintInfo.mint,
      feeClaimer.publicKey,
      tokenQuoteProgram
    ),
  ];
  createBaseTokenAccountIx && preInstructions.push(createBaseTokenAccountIx);
  createQuoteTokenAccountIx && preInstructions.push(createQuoteTokenAccountIx);

  if (configState.quoteMint == NATIVE_MINT) {
    const unrapSOLIx = unwrapSOLInstruction(feeClaimer.publicKey);
    unrapSOLIx && postInstructions.push(unrapSOLIx);
  }
  const transaction = await program.methods
    .claimTradingFee(maxBaseAmount, maxQuoteAmount)
    .accountsPartial({
      poolAuthority,
      config: poolState.config,
      pool,
      tokenAAccount: baseTokenAccount,
      tokenBAccount: quoteTokenAccount,
      baseVault: poolState.baseVault,
      quoteVault: poolState.quoteVault,
      baseMint: poolState.baseMint,
      quoteMint: quoteMintInfo.mint,
      feeClaimer: feeClaimer.publicKey,
      tokenBaseProgram,
      tokenQuoteProgram,
    })
    .preInstructions(preInstructions)
    .postInstructions(postInstructions)
    .transaction();

  sendTransactionMaybeThrow(svm, transaction, [feeClaimer]);
}

export type PartnerWithdrawSurplusParams = {
  feeClaimer: Keypair;
  virtualPool: PublicKey;
};
export async function partnerWithdrawSurplus(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: PartnerWithdrawSurplusParams
): Promise<any> {
  const { feeClaimer, virtualPool } = params;
  const poolState = getVirtualPool(svm, program, virtualPool);
  const poolAuthority = derivePoolAuthority();

  const quoteMintInfo = getTokenAccount(svm, poolState.quoteVault);

  const preInstructions: TransactionInstruction[] = [];
  const postInstructions: TransactionInstruction[] = [];
  const { ata: tokenQuoteAccount, ix: createQuoteTokenAccountIx } =
    getOrCreateAssociatedTokenAccount(
      svm,
      feeClaimer,
      quoteMintInfo.mint,
      feeClaimer.publicKey,
      TOKEN_PROGRAM_ID
    );

  createQuoteTokenAccountIx && preInstructions.push(createQuoteTokenAccountIx);

  if (quoteMintInfo.mint == NATIVE_MINT) {
    const unrapSOLIx = unwrapSOLInstruction(feeClaimer.publicKey);
    unrapSOLIx && postInstructions.push(unrapSOLIx);
  }

  const transaction = await program.methods
    .partnerWithdrawSurplus()
    .accountsPartial({
      poolAuthority,
      config: poolState.config,
      virtualPool,
      tokenQuoteAccount,
      quoteVault: poolState.quoteVault,
      quoteMint: quoteMintInfo.mint,
      feeClaimer: feeClaimer.publicKey,
      tokenQuoteProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions(preInstructions)
    .postInstructions(postInstructions)
    .transaction();

  sendTransactionMaybeThrow(svm, transaction, [feeClaimer]);
}

export async function withdrawLeftover(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: {
    payer: Keypair;
    virtualPool: PublicKey;
  }
): Promise<any> {
  const { payer, virtualPool } = params;
  const poolState = getVirtualPool(svm, program, virtualPool);
  const configState = getConfig(svm, program, poolState.config);
  const poolAuthority = derivePoolAuthority();

  const tokenBaseProgram =
    configState.tokenType == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  const preInstructions: TransactionInstruction[] = [];
  const postInstructions: TransactionInstruction[] = [];
  const { ata: tokenBaseAccount, ix: createBaseTokenAccountIx } =
    getOrCreateAssociatedTokenAccount(
      svm,
      payer,
      poolState.baseMint,
      configState.leftoverReceiver,
      tokenBaseProgram
    );

  createBaseTokenAccountIx && preInstructions.push(createBaseTokenAccountIx);
  const transaction = await program.methods
    .withdrawLeftover()
    .accountsPartial({
      poolAuthority,
      config: poolState.config,
      virtualPool,
      tokenBaseAccount,
      baseVault: poolState.baseVault,
      baseMint: poolState.baseMint,
      leftoverReceiver: configState.leftoverReceiver,
      tokenBaseProgram,
    })
    .preInstructions(preInstructions)
    .postInstructions(postInstructions)
    .transaction();

  sendTransactionMaybeThrow(svm, transaction, [payer]);
}

export type PartnerWithdrawMigrationFeeParams = {
  partner: Keypair;
  virtualPool: PublicKey;
};
export async function partnerWithdrawMigrationFee(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  params: PartnerWithdrawMigrationFeeParams
): Promise<void> {
  const { partner, virtualPool } = params;
  const poolAuthority = derivePoolAuthority();
  const poolState = getVirtualPool(svm, program, virtualPool);
  const configState = getConfig(svm, program, poolState.config);

  const preInstructions: TransactionInstruction[] = [];
  const postInstructions: TransactionInstruction[] = [];
  const { ata: tokenQuoteAccount, ix: createQuoteTokenAccountIx } =
    getOrCreateAssociatedTokenAccount(
      svm,
      partner,
      configState.quoteMint,
      partner.publicKey,
      getTokenProgram(configState.quoteTokenFlag)
    );

  createQuoteTokenAccountIx && preInstructions.push(createQuoteTokenAccountIx);

  if (configState.quoteMint.equals(NATIVE_MINT)) {
    const unrapSOLIx = unwrapSOLInstruction(partner.publicKey);
    unrapSOLIx && postInstructions.push(unrapSOLIx);
  }

  const transaction = await program.methods
    .withdrawMigrationFee(0)
    .accountsPartial({
      poolAuthority,
      config: poolState.config,
      virtualPool,
      tokenQuoteAccount,
      quoteVault: poolState.quoteVault,
      quoteMint: configState.quoteMint,
      sender: partner.publicKey,
      tokenQuoteProgram: getTokenProgram(configState.quoteTokenFlag),
    })
    .preInstructions(preInstructions)
    .postInstructions(postInstructions)
    .transaction();

  sendTransactionMaybeThrow(svm, transaction, [partner]);
}

export async function claimPartnerPoolCreationFee(
  svm: LiteSVM,
  feeClaimer: Keypair,
  config: PublicKey,
  virtualPool: PublicKey,
  feeReceiver: PublicKey
) {
  const program = createVirtualCurveProgram();
  const transaction = await program.methods
    .claimPartnerPoolCreationFee()
    .accountsPartial({
      config,
      pool: virtualPool,
      feeClaimer: feeClaimer.publicKey,
      feeReceiver,
    })
    .transaction();
  sendTransactionMaybeThrow(svm, transaction, [feeClaimer]);
}
