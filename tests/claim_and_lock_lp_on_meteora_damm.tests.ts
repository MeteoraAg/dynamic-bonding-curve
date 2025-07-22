import {
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  unpackAccount,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
import { expect } from "chai";
import { BanksClient, ProgramTestContext } from "solana-bankrun";
import {
  BaseFee,
  ConfigParameters,
  createConfig,
  CreateConfigParams,
  createPoolWithSplToken,
  swap,
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
  fundSol,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  startTest,
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
  banksClient: BanksClient,
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
    padding: [],
    curve: curves,
  };
  const params: CreateConfigParams = {
    payer,
    leftoverReceiver: owner,
    feeClaimer,
    quoteMint: NATIVE_MINT,
    instructionParams,
  };
  return createConfig(banksClient, program, params);
}

async function setupPrerequisite(
  banksClient: BanksClient,
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
  const virtualPool = await createPoolWithSplToken(banksClient, program, {
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

  const virtualPoolState = await getVirtualPool(
    banksClient,
    program,
    virtualPool
  );

  const params: SwapParams = {
    config,
    payer: swapInitiator,
    pool: virtualPool,
    inputTokenMint: NATIVE_MINT,
    outputTokenMint: virtualPoolState.baseMint,
    amountIn: new BN(LAMPORTS_PER_SOL * 5.5),
    minimumAmountOut: new BN(0),
    referralTokenAccount: null,
  };

  await swap(banksClient, program, params);

  const migrationMetadata = await createMeteoraMetadata(banksClient, program, {
    payer: admin,
    virtualPool,
    config,
  });

  const poolAuthority = derivePoolAuthority();
  const dammConfig = await createDammConfig(banksClient, admin, poolAuthority);
  const migrationParams: MigrateMeteoraParams = {
    payer: admin,
    virtualPool,
    dammConfig,
  };

  await migrateToMeteoraDamm(banksClient, program, migrationParams);

  return {
    virtualPool,
    dammConfig,
    migrationMetadata,
  };
}

async function startTestContext(): Promise<{
  context: ProgramTestContext;
  admin: Keypair;
  operator: Keypair;
  partner: Keypair;
  user: Keypair;
  poolCreator: Keypair;
  program: VirtualCurveProgram;
}> {
  const context = await startTest();
  const admin = context.payer;
  const operator = Keypair.generate();
  const partner = Keypair.generate();
  const user = Keypair.generate();
  const poolCreator = Keypair.generate();
  const receivers = [
    operator.publicKey,
    partner.publicKey,
    user.publicKey,
    poolCreator.publicKey,
  ];
  await fundSol(context.banksClient, admin, receivers);
  const program = createVirtualCurveProgram();

  return {
    context,
    admin,
    operator,
    partner,
    user,
    poolCreator,
    program,
  };
}

describe("Claim and lock lp on meteora dammm", () => {
  let context: ProgramTestContext;
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
        context: innerContext,
        admin: innerAdmin,
        operator: innerOperator,
        user: innerUser,
        poolCreator: innerPoolCreator,
        partner: innerPartner,
        program: innerProgram,
      } = await startTestContext();

      context = innerContext;
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
        context.banksClient,
        program
      );

      const {
        dammConfig: innerDammConfig,
        virtualPool: innerVirtualPool,
        migrationMetadata: innerMigrationMetadata,
      } = await setupPrerequisite(
        context.banksClient,
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
      const beforeMigrationMetadata = await getMeteoraDammMigrationMetadata(
        context.banksClient,
        program,
        migrationMetadata
      );

      const lockEscrowKey = await lockLpForPartnerDamm(
        context.banksClient,
        program,
        {
          payer: partner, // Partner or creator it's fine
          dammConfig,
          virtualPool,
        }
      );

      const afterMigrationMetadata = await getMeteoraDammMigrationMetadata(
        context.banksClient,
        program,
        migrationMetadata
      );

      expect(beforeMigrationMetadata.creatorLockedStatus).equal(Number(false));
      expect(beforeMigrationMetadata.partnerLockedStatus).equal(Number(false));

      expect(afterMigrationMetadata.creatorLockedStatus).equal(Number(true));
      expect(afterMigrationMetadata.partnerLockedStatus).equal(Number(true));

      const lockEscrowState = await getLockEscrow(
        context.banksClient,
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
      const configState = await getConfig(context.banksClient, program, config);

      const virtualPoolState = await getVirtualPool(
        context.banksClient,
        program,
        virtualPool
      );

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

      const beforeMigrationMetadata = await getMeteoraDammMigrationMetadata(
        context.banksClient,
        program,
        migrationMetadata
      );

      await creatorClaimLpDamm(context.banksClient, program, {
        payer: poolCreator,
        dammConfig,
        virtualPool,
      });

      const afterMigrationMetadata = await getMeteoraDammMigrationMetadata(
        context.banksClient,
        program,
        migrationMetadata
      );

      const creatorLpTokenAccount = await context.banksClient.getAccount(
        creatorLpAta
      );

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
        context: innerContext,
        admin: innerAdmin,
        operator: innerOperator,
        user: innerUser,
        poolCreator: innerPoolCreator,
        partner: innerPartner,
        program: innerProgram,
      } = await startTestContext();

      context = innerContext;
      admin = innerAdmin;
      operator = innerOperator;
      partner = innerPartner;
      user = innerUser;
      poolCreator = innerPoolCreator;
      program = innerProgram;

      config = await createPartnerConfig(
        admin,
        poolCreator.publicKey,
        partner.publicKey,
        context.banksClient,
        program
      );

      const {
        dammConfig: innerDammConfig,
        virtualPool: innerVirtualPool,
        migrationMetadata: innerMigrationMetadata,
      } = await setupPrerequisite(
        context.banksClient,
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
      const beforeMigrationMetadata = await getMeteoraDammMigrationMetadata(
        context.banksClient,
        program,
        migrationMetadata
      );

      const lockEscrowKey = await lockLpForCreatorDamm(
        context.banksClient,
        program,
        {
          payer: poolCreator,
          dammConfig,
          virtualPool,
        }
      );

      const afterMigrationMetadata = await getMeteoraDammMigrationMetadata(
        context.banksClient,
        program,
        migrationMetadata
      );

      expect(beforeMigrationMetadata.creatorLockedStatus).equal(Number(false));
      expect(afterMigrationMetadata.creatorLockedStatus).equal(Number(true));

      expect(beforeMigrationMetadata.partnerLockedStatus).equals(
        afterMigrationMetadata.partnerLockedStatus
      );

      const lockEscrowState = await getLockEscrow(
        context.banksClient,
        createDammProgram(),
        lockEscrowKey
      );

      const expectedTotalLockLp = beforeMigrationMetadata.creatorLockedLp;
      const totalLockLp = lockEscrowState.totalLockedAmount;

      expect(expectedTotalLockLp.toString()).equal(totalLockLp.toString());
    });

    it("Partner lock LP", async () => {
      const beforeMigrationMetadata = await getMeteoraDammMigrationMetadata(
        context.banksClient,
        program,
        migrationMetadata
      );

      const lockEscrowKey = await lockLpForPartnerDamm(
        context.banksClient,
        program,
        {
          payer: partner,
          dammConfig,
          virtualPool,
        }
      );

      const afterMigrationMetadata = await getMeteoraDammMigrationMetadata(
        context.banksClient,
        program,
        migrationMetadata
      );

      expect(beforeMigrationMetadata.partnerLockedStatus).equal(Number(false));
      expect(afterMigrationMetadata.partnerLockedStatus).equal(Number(true));

      expect(beforeMigrationMetadata.creatorLockedStatus).equals(
        afterMigrationMetadata.creatorLockedStatus
      );

      const lockEscrowState = await getLockEscrow(
        context.banksClient,
        createDammProgram(),
        lockEscrowKey
      );

      const expectedTotalLockLp = beforeMigrationMetadata.partnerLockedLp;
      const totalLockLp = lockEscrowState.totalLockedAmount;

      expect(expectedTotalLockLp.toString()).equal(totalLockLp.toString());
    });

    it("Creator claim LP", async () => {
      const configState = await getConfig(context.banksClient, program, config);

      const virtualPoolState = await getVirtualPool(
        context.banksClient,
        program,
        virtualPool
      );

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

      const beforeMigrationMetadata = await getMeteoraDammMigrationMetadata(
        context.banksClient,
        program,
        migrationMetadata
      );

      await creatorClaimLpDamm(context.banksClient, program, {
        payer: poolCreator,
        dammConfig,
        virtualPool,
      });

      const afterMigrationMetadata = await getMeteoraDammMigrationMetadata(
        context.banksClient,
        program,
        migrationMetadata
      );

      const creatorLpTokenAccount = await context.banksClient.getAccount(
        creatorLpAta
      );

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
      const configState = await getConfig(context.banksClient, program, config);

      const virtualPoolState = await getVirtualPool(
        context.banksClient,
        program,
        virtualPool
      );

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

      const beforeMigrationMetadata = await getMeteoraDammMigrationMetadata(
        context.banksClient,
        program,
        migrationMetadata
      );

      await partnerClaimLpDamm(context.banksClient, program, {
        payer: partner,
        dammConfig,
        virtualPool,
      });

      const afterMigrationMetadata = await getMeteoraDammMigrationMetadata(
        context.banksClient,
        program,
        migrationMetadata
      );

      const partnerLpTokenAccount = await context.banksClient.getAccount(
        partnerLpAta
      );

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
