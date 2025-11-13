import {
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  unpackAccount,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import {
  BaseFee,
  ConfigParameters,
  createConfig,
  CreateConfigParams,
  createPoolWithSplToken,
  swap,
  SwapMode,
  SwapParams,
} from "./instructions";
import {
  createMeteoraMetadata,
  creatorClaimLpDamm,
  lockLpForCreatorDamm,
  lockLpForPartnerDamm,
  MigrateMeteoraParams,
  migrateToMeteoraDamm,
  partnerClaimLpDamm,
} from "./instructions/meteoraMigration";
import {
  createDammConfig,
  createDammProgram,
  createVirtualCurveProgram,
  deriveDammPoolAddress,
  deriveLpMintAddress,
  derivePoolAuthority,
  generateAndFund,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  startSvm,
  U64_MAX,
} from "./utils";
import {
  getConfig,
  getLockEscrow,
  getMeteoraDammMigrationMetadata,
  getVirtualPool,
} from "./utils/fetcher";
import { VirtualCurveProgram } from "./utils/types";

async function createPartnerConfig(
  payer: Keypair,
  owner: PublicKey,
  feeClaimer: PublicKey,
  svm: LiteSVM,
  program: VirtualCurveProgram
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
    collectFeeMode: 0,
    migrationOption: 0,
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
    poolCreationFee: new BN(0),
    curve: curves,
  };
  const params: CreateConfigParams<ConfigParameters> = {
    payer,
    leftoverReceiver: owner,
    feeClaimer,
    quoteMint: NATIVE_MINT,
    instructionParams,
  };
  return createConfig(svm, program, params);
}

async function setupPrerequisite(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  payer: Keypair,
  poolCreator: Keypair,
  swapInitiator: Keypair,
  admin: Keypair,
  config: PublicKey
): Promise<{
  virtualPool: PublicKey;
  dammConfig: PublicKey;
  migrationMetadata: PublicKey;
}> {
  const virtualPool = await createPoolWithSplToken(svm, program, {
    payer,
    poolCreator,
    quoteMint: NATIVE_MINT,
    config,
    instructionParams: {
      name: "test token spl",
      symbol: "TEST",
      uri: "abc.com",
    },
  });

  const virtualPoolState = getVirtualPool(svm, program, virtualPool);

  const params: SwapParams = {
    config,
    payer: swapInitiator,
    pool: virtualPool,
    inputTokenMint: NATIVE_MINT,
    outputTokenMint: virtualPoolState.baseMint,
    amountIn: new BN(LAMPORTS_PER_SOL * 5.5),
    minimumAmountOut: new BN(0),
    swapMode: SwapMode.PartialFill,
    referralTokenAccount: null,
  };

  await swap(svm, program, params);

  const migrationMetadata = await createMeteoraMetadata(svm, program, {
    payer: admin,
    virtualPool,
    config,
  });

  const poolAuthority = derivePoolAuthority();
  const dammConfig = await createDammConfig(svm, admin, poolAuthority);
  const migrationParams: MigrateMeteoraParams = {
    payer: admin,
    virtualPool,
    dammConfig,
  };

  await migrateToMeteoraDamm(svm, program, migrationParams);

  return {
    virtualPool,
    dammConfig,
    migrationMetadata,
  };
}

function startTestSvm(): {
  svm: LiteSVM;
  admin: Keypair;
  operator: Keypair;
  partner: Keypair;
  user: Keypair;
  poolCreator: Keypair;
  program: VirtualCurveProgram;
} {
  const svm = startSvm();
  const operator = generateAndFund(svm);
  const partner = generateAndFund(svm);
  const user = generateAndFund(svm);
  const poolCreator = generateAndFund(svm);
  const admin = generateAndFund(svm);

  const program = createVirtualCurveProgram();

  return {
    svm,
    admin,
    operator,
    partner,
    user,
    poolCreator,
    program,
  };
}

describe("Claim and lock lp on meteora dammm", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let user: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;
  let config: PublicKey;
  let virtualPool: PublicKey;
  let dammConfig: PublicKey;
  let migrationMetadata: PublicKey;

  describe("Self partnered creator", () => {
    before(async () => {
      const {
        admin: innerAdmin,
        operator: innerOperator,
        user: innerUser,
        poolCreator: innerPoolCreator,
        partner: innerPartner,
        program: innerProgram,
        svm: innerSvm,
      } = startTestSvm();

      svm = innerSvm;
      admin = innerAdmin;
      operator = innerOperator;
      partner = innerPartner;
      user = innerUser;
      poolCreator = innerPoolCreator;
      program = innerProgram;

      config = await createPartnerConfig(
        admin,
        poolCreator.publicKey,
        poolCreator.publicKey,
        svm,
        program
      );

      const {
        dammConfig: innerDammConfig,
        virtualPool: innerVirtualPool,
        migrationMetadata: innerMigrationMetadata,
      } = await setupPrerequisite(
        svm,
        program,
        admin,
        poolCreator,
        user,
        admin,
        config
      );

      dammConfig = innerDammConfig;
      virtualPool = innerVirtualPool;
      migrationMetadata = innerMigrationMetadata;
    });

    it("Self partnered creator lock LP", async () => {
      const beforeMigrationMetadata = getMeteoraDammMigrationMetadata(
        svm,
        program,
        migrationMetadata
      );

      const lockEscrowKey = await lockLpForPartnerDamm(svm, program, {
        payer: partner, // Partner or creator it's fine
        dammConfig,
        virtualPool,
      });

      const afterMigrationMetadata = getMeteoraDammMigrationMetadata(
        svm,
        program,
        migrationMetadata
      );

      expect(beforeMigrationMetadata.creatorLockedStatus).equal(Number(false));
      expect(beforeMigrationMetadata.partnerLockedStatus).equal(Number(false));

      expect(afterMigrationMetadata.creatorLockedStatus).equal(Number(true));
      expect(afterMigrationMetadata.partnerLockedStatus).equal(Number(true));

      const lockEscrowState = getLockEscrow(
        svm,
        createDammProgram(),
        lockEscrowKey
      );

      const expectedTotalLockLp = beforeMigrationMetadata.creatorLockedLp.add(
        beforeMigrationMetadata.partnerLockedLp
      );

      const totalLockLp = lockEscrowState.totalLockedAmount;

      expect(expectedTotalLockLp.toString()).equal(totalLockLp.toString());
    });

    it("Self partnered creator claim LP", async () => {
      const configState = getConfig(svm, program, config);

      const virtualPoolState = getVirtualPool(svm, program, virtualPool);

      const dammPool = deriveDammPoolAddress(
        dammConfig,
        virtualPoolState.baseMint,
        configState.quoteMint
      );

      const lpMint = deriveLpMintAddress(dammPool);
      const creatorLpAta = getAssociatedTokenAddressSync(
        lpMint,
        poolCreator.publicKey
      );

      const beforeMigrationMetadata = getMeteoraDammMigrationMetadata(
        svm,
        program,
        migrationMetadata
      );

      await creatorClaimLpDamm(svm, program, {
        payer: poolCreator,
        dammConfig,
        virtualPool,
      });

      const afterMigrationMetadata = getMeteoraDammMigrationMetadata(
        svm,
        program,
        migrationMetadata
      );

      const creatorLpTokenAccount = svm.getAccount(creatorLpAta);

      const creatorLpTokenState = unpackAccount(
        creatorLpAta,
        creatorLpTokenAccount as any // TODO: find a better way
      );

      expect(beforeMigrationMetadata.creatorClaimStatus).equal(Number(false));
      expect(beforeMigrationMetadata.partnerClaimStatus).equal(Number(false));

      expect(afterMigrationMetadata.creatorClaimStatus).equal(Number(true));
      expect(afterMigrationMetadata.partnerClaimStatus).equal(Number(true));

      const expectedLpToClaim = beforeMigrationMetadata.creatorLp.add(
        beforeMigrationMetadata.partnerLp
      );

      expect(expectedLpToClaim.toString()).equal(
        creatorLpTokenState.amount.toString()
      );
    });
  });

  describe("Separated partner and creator", () => {
    before(async () => {
      const {
        svm: innerSvm,
        admin: innerAdmin,
        operator: innerOperator,
        user: innerUser,
        poolCreator: innerPoolCreator,
        partner: innerPartner,
        program: innerProgram,
      } = startTestSvm();

      operator = innerOperator;
      partner = innerPartner;
      user = innerUser;
      poolCreator = innerPoolCreator;
      program = innerProgram;
      svm = innerSvm;
      admin = innerAdmin;

      config = await createPartnerConfig(
        admin,
        poolCreator.publicKey,
        partner.publicKey,
        svm,
        program
      );

      const {
        dammConfig: innerDammConfig,
        virtualPool: innerVirtualPool,
        migrationMetadata: innerMigrationMetadata,
      } = await setupPrerequisite(
        svm,
        program,
        operator,
        poolCreator,
        user,
        admin,
        config
      );

      dammConfig = innerDammConfig;
      virtualPool = innerVirtualPool;
      migrationMetadata = innerMigrationMetadata;
    });

    it("Creator lock LP", async () => {
      const beforeMigrationMetadata = getMeteoraDammMigrationMetadata(
        svm,
        program,
        migrationMetadata
      );

      const lockEscrowKey = await lockLpForCreatorDamm(svm, program, {
        payer: poolCreator,
        dammConfig,
        virtualPool,
      });

      const afterMigrationMetadata = getMeteoraDammMigrationMetadata(
        svm,
        program,
        migrationMetadata
      );

      expect(beforeMigrationMetadata.creatorLockedStatus).equal(Number(false));
      expect(afterMigrationMetadata.creatorLockedStatus).equal(Number(true));

      expect(beforeMigrationMetadata.partnerLockedStatus).equals(
        afterMigrationMetadata.partnerLockedStatus
      );

      const lockEscrowState = getLockEscrow(
        svm,
        createDammProgram(),
        lockEscrowKey
      );

      const expectedTotalLockLp = beforeMigrationMetadata.creatorLockedLp;
      const totalLockLp = lockEscrowState.totalLockedAmount;

      expect(expectedTotalLockLp.toString()).equal(totalLockLp.toString());
    });

    it("Partner lock LP", async () => {
      const beforeMigrationMetadata = getMeteoraDammMigrationMetadata(
        svm,
        program,
        migrationMetadata
      );

      const lockEscrowKey = await lockLpForPartnerDamm(svm, program, {
        payer: partner,
        dammConfig,
        virtualPool,
      });

      const afterMigrationMetadata = getMeteoraDammMigrationMetadata(
        svm,
        program,
        migrationMetadata
      );

      expect(beforeMigrationMetadata.partnerLockedStatus).equal(Number(false));
      expect(afterMigrationMetadata.partnerLockedStatus).equal(Number(true));

      expect(beforeMigrationMetadata.creatorLockedStatus).equals(
        afterMigrationMetadata.creatorLockedStatus
      );

      const lockEscrowState = getLockEscrow(
        svm,
        createDammProgram(),
        lockEscrowKey
      );

      const expectedTotalLockLp = beforeMigrationMetadata.partnerLockedLp;
      const totalLockLp = lockEscrowState.totalLockedAmount;

      expect(expectedTotalLockLp.toString()).equal(totalLockLp.toString());
    });

    it("Creator claim LP", async () => {
      const configState = getConfig(svm, program, config);

      const virtualPoolState = getVirtualPool(svm, program, virtualPool);

      const dammPool = deriveDammPoolAddress(
        dammConfig,
        virtualPoolState.baseMint,
        configState.quoteMint
      );

      const lpMint = deriveLpMintAddress(dammPool);
      const creatorLpAta = getAssociatedTokenAddressSync(
        lpMint,
        poolCreator.publicKey
      );

      const beforeMigrationMetadata = getMeteoraDammMigrationMetadata(
        svm,
        program,
        migrationMetadata
      );

      await creatorClaimLpDamm(svm, program, {
        payer: poolCreator,
        dammConfig,
        virtualPool,
      });

      const afterMigrationMetadata = getMeteoraDammMigrationMetadata(
        svm,
        program,
        migrationMetadata
      );

      const creatorLpTokenAccount = svm.getAccount(creatorLpAta);

      const creatorLpTokenState = unpackAccount(
        creatorLpAta,
        creatorLpTokenAccount as any // TODO: find a better way
      );

      expect(beforeMigrationMetadata.creatorClaimStatus).equal(Number(false));
      expect(afterMigrationMetadata.creatorClaimStatus).equal(Number(true));

      expect(beforeMigrationMetadata.partnerClaimStatus).equal(
        afterMigrationMetadata.partnerClaimStatus
      );

      const expectedLpToClaim = beforeMigrationMetadata.creatorLp;

      expect(expectedLpToClaim.toString()).equal(
        creatorLpTokenState.amount.toString()
      );
    });

    it("Partner claim LP", async () => {
      const configState = getConfig(svm, program, config);

      const virtualPoolState = getVirtualPool(svm, program, virtualPool);

      const dammPool = deriveDammPoolAddress(
        dammConfig,
        virtualPoolState.baseMint,
        configState.quoteMint
      );

      const lpMint = deriveLpMintAddress(dammPool);
      const partnerLpAta = getAssociatedTokenAddressSync(
        lpMint,
        partner.publicKey
      );

      const beforeMigrationMetadata = getMeteoraDammMigrationMetadata(
        svm,
        program,
        migrationMetadata
      );

      await partnerClaimLpDamm(svm, program, {
        payer: partner,
        dammConfig,
        virtualPool,
      });

      const afterMigrationMetadata = getMeteoraDammMigrationMetadata(
        svm,
        program,
        migrationMetadata
      );

      const partnerLpTokenAccount = svm.getAccount(partnerLpAta);

      const partnerLpTokenState = unpackAccount(
        partnerLpAta,
        partnerLpTokenAccount as any // TODO: find a better way
      );

      expect(beforeMigrationMetadata.partnerClaimStatus).equal(Number(false));
      expect(afterMigrationMetadata.partnerClaimStatus).equal(Number(true));

      expect(beforeMigrationMetadata.creatorClaimStatus).equal(
        afterMigrationMetadata.creatorClaimStatus
      );

      const expectedLpToClaim = beforeMigrationMetadata.partnerLp;

      expect(expectedLpToClaim.toString()).equal(
        partnerLpTokenState.amount.toString()
      );
    });
  });
});
