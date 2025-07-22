import { BN } from "bn.js";
import { ProgramTestContext } from "solana-bankrun";
import {
  deserializeMetadata,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  BaseFee,
  ConfigParameters,
  createConfig,
  CreateConfigParams,
  createPoolWithSplToken,
  createPoolWithToken2022,
} from "./instructions";
import { Pool, VirtualCurveProgram } from "./utils/types";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { deriveMetadataAccount, fundSol, getMint, startTest } from "./utils";
import {
  createVirtualCurveProgram,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  U64_MAX,
} from "./utils";
import { getVirtualPool } from "./utils/fetcher";
import {
  ACCOUNT_SIZE,
  ACCOUNT_TYPE_SIZE,
  ExtensionType,
  getExtensionData,
  MetadataPointerLayout,
  NATIVE_MINT,
} from "@solana/spl-token";
import { expect } from "chai";

describe("Create pool with token2022", () => {
  let context: ProgramTestContext;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let user: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;
  let mutConfig: PublicKey;
  let immutConfig: PublicKey;
  let mutConfigSplToken: PublicKey;
  let immutConfigSplToken: PublicKey;
  let virtualPool: PublicKey;
  let virtualPoolState: Pool;

  before(async () => {
    context = await startTest();
    admin = context.payer;
    operator = Keypair.generate();
    partner = Keypair.generate();
    user = Keypair.generate();
    poolCreator = Keypair.generate();
    const receivers = [
      operator.publicKey,
      partner.publicKey,
      user.publicKey,
      poolCreator.publicKey,
    ];
    await fundSol(context.banksClient, admin, receivers);
    program = createVirtualCurveProgram();
  });

  it("Partner create config", async () => {
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
      migrationOption: 1, // damm v2
      tokenType: 1, // token 2022
      tokenDecimal: 6,
      migrationQuoteThreshold: new BN(LAMPORTS_PER_SOL * 5),
      partnerLpPercentage: 0,
      creatorLpPercentage: 0,
      partnerLockedLpPercentage: 95,
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
      tokenUpdateAuthority: 0, // mutable
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
    let params: CreateConfigParams = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: NATIVE_MINT,
      instructionParams,
    };
    mutConfig = await createConfig(context.banksClient, program, params);
    params.instructionParams.tokenType = 0;
    mutConfigSplToken = await createConfig(
      context.banksClient,
      program,
      params
    );

    params.instructionParams.tokenUpdateAuthority = 1; // Immutable
    params.instructionParams.tokenType = 1;
    immutConfig = await createConfig(context.banksClient, program, params);
    params.instructionParams.tokenType = 0;
    immutConfigSplToken = await createConfig(
      context.banksClient,
      program,
      params
    );
  });

  it("Create token2022 pool from mutable config", async () => {
    const name = "test token 2022";
    const symbol = "TOKEN2022";
    const uri = "token2022.com";

    virtualPool = await createPoolWithToken2022(context.banksClient, program, {
      payer: operator,
      poolCreator,
      quoteMint: NATIVE_MINT,
      config: mutConfig,
      instructionParams: {
        name,
        symbol,
        uri,
      },
    });
    virtualPoolState = await getVirtualPool(
      context.banksClient,
      program,
      virtualPool
    );

    const tlvData = (
      await context.banksClient.getAccount(virtualPoolState.baseMint)
    ).data.slice(ACCOUNT_SIZE + ACCOUNT_TYPE_SIZE);
    const metadataPointer = MetadataPointerLayout.decode(
      getExtensionData(ExtensionType.MetadataPointer, Buffer.from(tlvData))
    );
    expect(metadataPointer.authority.toString()).eq(
      poolCreator.publicKey.toString()
    );
  });

  it("Create token2022 pool from immutable config", async () => {
    const name = "test token 2022";
    const symbol = "TOKEN2022";
    const uri = "token2022.com";

    virtualPool = await createPoolWithToken2022(context.banksClient, program, {
      payer: operator,
      poolCreator,
      quoteMint: NATIVE_MINT,
      config: immutConfig,
      instructionParams: {
        name,
        symbol,
        uri,
      },
    });
    virtualPoolState = await getVirtualPool(
      context.banksClient,
      program,
      virtualPool
    );

    const tlvData = (
      await context.banksClient.getAccount(virtualPoolState.baseMint)
    ).data.slice(ACCOUNT_SIZE + ACCOUNT_TYPE_SIZE);
    const metadataPointer = MetadataPointerLayout.decode(
      getExtensionData(ExtensionType.MetadataPointer, Buffer.from(tlvData))
    );

    expect(metadataPointer.authority.toString()).eq(
      PublicKey.default.toString()
    );
  });

  it("Create spl token pool from mutable config", async () => {
    virtualPool = await createPoolWithSplToken(context.banksClient, program, {
      poolCreator,
      payer: operator,
      quoteMint: NATIVE_MINT,
      config: mutConfigSplToken,
      instructionParams: {
        name: "test token spl",
        symbol: "TEST",
        uri: "abc.com",
      },
    });
    virtualPoolState = await getVirtualPool(
      context.banksClient,
      program,
      virtualPool
    );

    const metadataAddress = deriveMetadataAccount(virtualPoolState.baseMint);

    let metadataAccount = await context.banksClient.getAccount(metadataAddress);

    const data = {
      executable: metadataAccount.executable,
      owner: metadataAccount.owner,
      lamports: metadataAccount.lamports,
      rentEpoch: metadataAccount.rentEpoch,
      data: metadataAccount.data,
      publicKey: metadataAddress,
    };
    const metadata = deserializeMetadata(data as any);

    expect(metadata.updateAuthority).eq(poolCreator.publicKey.toString());
  });

  it("Create spl pool from immutable config", async () => {
    virtualPool = await createPoolWithSplToken(context.banksClient, program, {
      poolCreator,
      payer: operator,
      quoteMint: NATIVE_MINT,
      config: immutConfigSplToken,
      instructionParams: {
        name: "test token spl",
        symbol: "TEST",
        uri: "abc.com",
      },
    });
    virtualPoolState = await getVirtualPool(
      context.banksClient,
      program,
      virtualPool
    );

    const metadataAddress = deriveMetadataAccount(virtualPoolState.baseMint);

    let metadataAccount = await context.banksClient.getAccount(metadataAddress);

    const data = {
      executable: metadataAccount.executable,
      owner: metadataAccount.owner,
      lamports: metadataAccount.lamports,
      rentEpoch: metadataAccount.rentEpoch,
      data: metadataAccount.data,
      publicKey: metadataAddress,
    };
    const metadata = deserializeMetadata(data as any);

    expect(metadata.updateAuthority).eq(PublicKey.default.toString());
  });
});
