import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { BanksClient, ProgramTestContext } from "solana-bankrun";
import {
  claimPartnerPoolCreationFee,
  claimProtocolPoolCreationFee,
  createClaimFeeOperator,
  createConfig,
  createPoolWithSplToken,
  createPoolWithToken2022,
} from "./instructions";
import {
  createVirtualCurveProgram,
  designGraphCurve,
  fundSol,
  getVirtualPool,
  startTest,
  U64_MAX,
  VirtualCurveProgram,
} from "./utils";
import { createToken, mintSplTokenTo } from "./utils/token";

const CREATION_FEE_CHARGED_MASK = 0b00000001;
const PROTOCOL_POOL_FEE_CLAIMED_MASK = 0b00000010;
const PARTNER_POOL_FEE_CLAIMED_MASK = 0b00000100;

describe("Config pool creation fee", () => {
  let context: ProgramTestContext;
  let admin: Keypair;
  let partner: Keypair;
  let poolCreator: Keypair;
  let migrator: Keypair;
  let program: VirtualCurveProgram;
  let operator: Keypair;
  let tokenQuoteDecimal = 9;
  let quoteMint: PublicKey;

  beforeEach(async () => {
    context = await startTest();
    admin = context.payer;
    partner = Keypair.generate();
    migrator = Keypair.generate();
    poolCreator = Keypair.generate();
    operator = Keypair.generate();

    const receivers = [
      partner.publicKey,
      migrator.publicKey,
      poolCreator.publicKey,
      operator.publicKey,
    ];
    await fundSol(context.banksClient, admin, receivers);
    program = createVirtualCurveProgram();

    quoteMint = await createToken(
      context.banksClient,
      admin,
      admin.publicKey,
      tokenQuoteDecimal
    );

    await mintSplTokenTo(
      context.banksClient,
      admin,
      quoteMint,
      admin,
      poolCreator.publicKey,
      BigInt(U64_MAX.toString())
    );

    await createClaimFeeOperator(context.banksClient, program, {
      admin,
      operator: operator.publicKey,
    });
  });

  it("Config without pool creation fee", async () => {
    const feeCreation = 0;
    const tokenType = 0;
    const configAccount = await createConfigAccount(
      context.banksClient,
      partner,
      quoteMint,
      new BN(feeCreation),
      tokenType
    );

    const pool = await createPoolWithSplToken(context.banksClient, program, {
      poolCreator: poolCreator,
      payer: poolCreator,
      quoteMint,
      config: configAccount,
      instructionParams: {
        name: "",
        symbol: "",
        uri: "",
      },
    });

    let poolState = await getVirtualPool(context.banksClient, program, pool);
    expect(poolState.creationFeeBits).equal(0);
  });

  it("create spl pool", async () => {
    const feeCreation = 1e9;
    const tokenType = 0;
    const configAccount = await createConfigAccount(
      context.banksClient,
      partner,
      quoteMint,
      new BN(feeCreation),
      tokenType
    );

    const pool = await createPoolWithSplToken(context.banksClient, program, {
      poolCreator: poolCreator,
      payer: poolCreator,
      quoteMint,
      config: configAccount,
      instructionParams: {
        name: "",
        symbol: "",
        uri: "",
      },
    });

    let poolState = await getVirtualPool(context.banksClient, program, pool);
    expect(poolState.creationFeeBits & CREATION_FEE_CHARGED_MASK).equal(1);
    expect(poolState.creationFee.toString()).eq(feeCreation.toString());

    const beforeLamport = (
      await context.banksClient.getAccount(partner.publicKey)
    ).lamports;

    // partner claim pool creation fee
    await claimPartnerPoolCreationFee(
      context.banksClient,
      partner,
      configAccount,
      pool,
      partner.publicKey
    );
    const afterLamports = (
      await context.banksClient.getAccount(partner.publicKey)
    ).lamports;

    expect(afterLamports > beforeLamport).to.be.true;
    poolState = await getVirtualPool(context.banksClient, program, pool);
    expect(poolState.creationFeeBits & PARTNER_POOL_FEE_CLAIMED_MASK).not.equal(
      0
    );

    // admin claim pool creation fee
    await claimProtocolPoolCreationFee(context.banksClient, program, {
      operator,
      pool,
    });

    poolState = await getVirtualPool(context.banksClient, program, pool);
    expect(
      poolState.creationFeeBits & PROTOCOL_POOL_FEE_CLAIMED_MASK
    ).not.equal(0);
  });

  it("create token2022 pool", async () => {
    const feeCreation = 1e9;
    const tokenType = 1;
    const configAccount = await createConfigAccount(
      context.banksClient,
      partner,
      quoteMint,
      new BN(feeCreation),
      tokenType
    );

    const pool = await createPoolWithToken2022(context.banksClient, program, {
      poolCreator: poolCreator,
      payer: poolCreator,
      quoteMint,
      config: configAccount,
      instructionParams: {
        name: "",
        symbol: "",
        uri: "",
      },
    });

    let poolState = await getVirtualPool(context.banksClient, program, pool);
    expect(poolState.creationFeeBits & CREATION_FEE_CHARGED_MASK).equal(1);
    expect(poolState.creationFee.toString()).eq(feeCreation.toString());

    const beforeLamport = (
      await context.banksClient.getAccount(partner.publicKey)
    ).lamports;

    // partner claim pool creation fee
    await claimPartnerPoolCreationFee(
      context.banksClient,
      partner,
      configAccount,
      pool,
      partner.publicKey
    );
    const afterLamports = (
      await context.banksClient.getAccount(partner.publicKey)
    ).lamports;

    expect(afterLamports > beforeLamport).to.be.true;
    poolState = await getVirtualPool(context.banksClient, program, pool);
    expect(poolState.creationFeeBits & PARTNER_POOL_FEE_CLAIMED_MASK).not.equal(
      0
    );

    // admin claim pool creation fee
    await claimProtocolPoolCreationFee(context.banksClient, program, {
      operator,
      pool,
    });

    poolState = await getVirtualPool(context.banksClient, program, pool);
    expect(
      poolState.creationFeeBits & PROTOCOL_POOL_FEE_CLAIMED_MASK
    ).not.equal(0);
  });
});

async function createConfigAccount(
  banksClient: BanksClient,
  creator: Keypair,
  quoteMint: PublicKey,
  poolCreationFee: BN,
  tokenType: number
) {
  let totalTokenSupply = 1_000_000_000; // 1 billion
  let initialMarketcap = 30; // 30 SOL;
  let migrationMarketcap = 300; // 300 SOL;
  let tokenBaseDecimal = 6;
  let tokenQuoteDecimal = 9;
  let kFactor = 1.2;
  let lockedVesting = {
    amountPerPeriod: new BN(0),
    cliffDurationFromMigrationTime: new BN(0),
    frequency: new BN(0),
    numberOfPeriod: new BN(0),
    cliffUnlockAmount: new BN(0),
  };
  let leftOver = 10_000;
  const program = createVirtualCurveProgram();

  let instructionParams = designGraphCurve(
    totalTokenSupply,
    initialMarketcap,
    migrationMarketcap,
    0,
    tokenBaseDecimal,
    tokenQuoteDecimal,
    0,
    0,
    lockedVesting,
    leftOver,
    kFactor,
    {
      cliffFeeNumerator: new BN(10_000_000), // 100bps
      firstFactor: 0, // 10 bps
      secondFactor: new BN(0),
      thirdFactor: new BN(0),
      baseFeeMode: 0, // rate limiter mode
    }
  );

  instructionParams.partnerLpPercentage = 10;
  instructionParams.creatorLpPercentage = 90;
  instructionParams.creatorLockedLpPercentage = 0;
  instructionParams.partnerLockedLpPercentage = 0;
  instructionParams.collectFeeMode = 1; // Output only
  instructionParams.poolCreationFee = poolCreationFee;
  instructionParams.tokenType = tokenType;
  instructionParams.migrationOption = 1;

  const configAccount = await createConfig(banksClient, program, {
    payer: creator,
    leftoverReceiver: creator.publicKey,
    feeClaimer: creator.publicKey,
    quoteMint,
    instructionParams,
  });

  return configAccount;
}
