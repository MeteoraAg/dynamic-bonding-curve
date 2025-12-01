import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
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
  deriveClaimFeeOperatorAddress,
  designGraphCurve,
  expectThrowsAsync,
  generateAndFund,
  getDbcProgramErrorCodeHexString,
  getVirtualPool,
  startSvm,
  U64_MAX,
  VirtualCurveProgram,
} from "./utils";
import { createToken, mintSplTokenTo } from "./utils/token";

const PARTNER_POOL_FEE_CLAIMED_MASK = 0b10;
const PROTOCOL_POOL_FEE_CLAIMED_MASK = 0b01;

describe("Config pool creation fee", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let partner: Keypair;
  let poolCreator: Keypair;
  let migrator: Keypair;
  let program: VirtualCurveProgram;
  let operator: Keypair;
  let tokenQuoteDecimal = 9;
  let quoteMint: PublicKey;

  beforeEach(async () => {
    svm = startSvm();
    admin = generateAndFund(svm);
    partner = generateAndFund(svm);
    migrator = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    operator = generateAndFund(svm);
    program = createVirtualCurveProgram();

    quoteMint = createToken(svm, admin, admin.publicKey, tokenQuoteDecimal);

    mintSplTokenTo(
      svm,
      admin,
      quoteMint,
      admin,
      poolCreator.publicKey,
      BigInt(U64_MAX.toString())
    );

    await createClaimFeeOperator(svm, program, {
      admin,
      operator: operator.publicKey,
    });
  });

  it("Config without pool creation fee", async () => {
    const feeCreation = 0;
    const tokenType = 0;
    const configAccount = await createConfigAccount(
      svm,
      partner,
      quoteMint,
      new BN(feeCreation),
      tokenType
    );

    const pool = await createPoolWithSplToken(svm, program, {
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

    let poolState = getVirtualPool(svm, program, pool);
    expect(poolState.creationFeeBits).equal(0);
  });

  it("create spl pool", async () => {
    const feeCreation = 1e9;
    const tokenType = 0;
    const configAccount = await createConfigAccount(
      svm,
      partner,
      quoteMint,
      new BN(feeCreation),
      tokenType
    );

    const pool = await createPoolWithSplToken(svm, program, {
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

    let poolState = getVirtualPool(svm, program, pool);

    const beforeLamport = svm.getAccount(partner.publicKey).lamports;

    const errorCodeUnauthorized =
      getDbcProgramErrorCodeHexString("Unauthorized");
    expectThrowsAsync(async () => {
      await claimPartnerPoolCreationFee(
        svm,
        admin,
        configAccount,
        pool,
        admin.publicKey
      );
    }, errorCodeUnauthorized);

    // partner claim pool creation fee
    await claimPartnerPoolCreationFee(
      svm,
      partner,
      configAccount,
      pool,
      partner.publicKey
    );
    const afterLamports = svm.getAccount(partner.publicKey).lamports;

    expect(afterLamports > beforeLamport).to.be.true;
    poolState = getVirtualPool(svm, program, pool);
    expect(poolState.creationFeeBits & PARTNER_POOL_FEE_CLAIMED_MASK).not.equal(
      0
    );

    // error if partner reclaim
    const errorCode = getDbcProgramErrorCodeHexString(
      "PoolCreationFeeHasBeenClaimed"
    );
    expectThrowsAsync(async () => {
      await claimPartnerPoolCreationFee(
        svm,
        partner,
        configAccount,
        pool,
        partner.publicKey
      );
    }, errorCode);

    const claimFeeOperator = deriveClaimFeeOperatorAddress(operator.publicKey);

    expectThrowsAsync(async () => {
      await claimProtocolPoolCreationFee(svm, program, {
        operator: partner,
        pool,
        claimFeeOperator,
      });
    }, errorCodeUnauthorized);

    // admin claim pool creation fee
    await claimProtocolPoolCreationFee(svm, program, {
      operator,
      pool,
      claimFeeOperator,
    });

    poolState = getVirtualPool(svm, program, pool);
    expect(
      poolState.creationFeeBits & PROTOCOL_POOL_FEE_CLAIMED_MASK
    ).not.equal(0);

    expectThrowsAsync(async () => {
      await claimProtocolPoolCreationFee(svm, program, {
        operator,
        pool,
        claimFeeOperator,
      });
    }, errorCode);
  });

  it("create token2022 pool", async () => {
    const feeCreation = 1e9;
    const tokenType = 1;
    const configAccount = await createConfigAccount(
      svm,
      partner,
      quoteMint,
      new BN(feeCreation),
      tokenType
    );

    const pool = await createPoolWithToken2022(svm, program, {
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

    let poolState = getVirtualPool(svm, program, pool);

    const beforeLamport = svm.getAccount(partner.publicKey).lamports;

    // partner claim pool creation fee
    await claimPartnerPoolCreationFee(
      svm,
      partner,
      configAccount,
      pool,
      partner.publicKey
    );
    const afterLamports = svm.getAccount(partner.publicKey).lamports;

    expect(afterLamports > beforeLamport).to.be.true;
    poolState = getVirtualPool(svm, program, pool);
    expect(poolState.creationFeeBits & PARTNER_POOL_FEE_CLAIMED_MASK).not.equal(
      0
    );

    // error if partner reclaim
    const errorCode = getDbcProgramErrorCodeHexString(
      "PoolCreationFeeHasBeenClaimed"
    );
    expectThrowsAsync(async () => {
      await claimPartnerPoolCreationFee(
        svm,
        partner,
        configAccount,
        pool,
        partner.publicKey
      );
    }, errorCode);

    const claimFeeOperator = deriveClaimFeeOperatorAddress(operator.publicKey);
    // admin claim pool creation fee
    await claimProtocolPoolCreationFee(svm, program, {
      operator,
      pool,
      claimFeeOperator,
    });

    poolState = getVirtualPool(svm, program, pool);
    expect(
      poolState.creationFeeBits & PROTOCOL_POOL_FEE_CLAIMED_MASK
    ).not.equal(0);

    // error if protocol reclaim
    expectThrowsAsync(async () => {
      await claimProtocolPoolCreationFee(svm, program, {
        operator,
        pool,
        claimFeeOperator,
      });
    }, errorCode);
  });
});

async function createConfigAccount(
  svm: LiteSVM,
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

  const configAccount = await createConfig(svm, program, {
    payer: creator,
    leftoverReceiver: creator.publicKey,
    feeClaimer: creator.publicKey,
    quoteMint,
    instructionParams,
  });

  return configAccount;
}
