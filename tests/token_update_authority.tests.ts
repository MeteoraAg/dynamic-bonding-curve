import { deserializeMetadata } from "@metaplex-foundation/mpl-token-metadata";
import {
  ACCOUNT_SIZE,
  ACCOUNT_TYPE_SIZE,
  ExtensionType,
  getExtensionData,
  MetadataPointerLayout,
  NATIVE_MINT,
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
  createPoolWithToken2022,
} from "./instructions";
import {
  createVirtualCurveProgram,
  deriveMetadataAccount,
  generateAndFund,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  startSvm,
  U64_MAX,
} from "./utils";
import { getVirtualPool } from "./utils/fetcher";
import { Pool, VirtualCurveProgram } from "./utils/types";

describe("Create pool with token2022", () => {
  let svm: LiteSVM;
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
    svm = startSvm();
    admin = generateAndFund(svm);
    operator = generateAndFund(svm);
    partner = generateAndFund(svm);
    user = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
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
      partnerLiquidityPercentage: 0,
      creatorLiquidityPercentage: 0,
      partnerPermanentLockedLiquidityPercentage: 95,
      creatorPermanentLockedLiquidityPercentage: 5,
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
      poolCreationFee: new BN(0),
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
    };
    let params: CreateConfigParams<ConfigParameters> = {
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: NATIVE_MINT,
      instructionParams,
    };
    mutConfig = await createConfig(svm, program, params);
    params.instructionParams.tokenType = 0;
    mutConfigSplToken = await createConfig(svm, program, params);

    params.instructionParams.tokenUpdateAuthority = 1; // Immutable
    params.instructionParams.tokenType = 1;
    immutConfig = await createConfig(svm, program, params);
    params.instructionParams.tokenType = 0;
    immutConfigSplToken = await createConfig(svm, program, params);
  });

  it("Create token2022 pool from mutable config", async () => {
    const name = "test token 2022";
    const symbol = "TOKEN2022";
    const uri = "token2022.com";

    virtualPool = await createPoolWithToken2022(svm, program, {
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
    virtualPoolState = getVirtualPool(svm, program, virtualPool);

    const tlvData = svm
      .getAccount(virtualPoolState.baseMint)
      .data.slice(ACCOUNT_SIZE + ACCOUNT_TYPE_SIZE);
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

    virtualPool = await createPoolWithToken2022(svm, program, {
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
    virtualPoolState = getVirtualPool(svm, program, virtualPool);

    const tlvData = svm
      .getAccount(virtualPoolState.baseMint)
      .data.slice(ACCOUNT_SIZE + ACCOUNT_TYPE_SIZE);
    const metadataPointer = MetadataPointerLayout.decode(
      getExtensionData(ExtensionType.MetadataPointer, Buffer.from(tlvData))
    );

    expect(metadataPointer.authority.toString()).eq(
      PublicKey.default.toString()
    );
  });

  it("Create spl token pool from mutable config", async () => {
    virtualPool = await createPoolWithSplToken(svm, program, {
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
    virtualPoolState = getVirtualPool(svm, program, virtualPool);

    const metadataAddress = deriveMetadataAccount(virtualPoolState.baseMint);

    let metadataAccount = svm.getAccount(metadataAddress);

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
    virtualPool = await createPoolWithSplToken(svm, program, {
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
    virtualPoolState = getVirtualPool(svm, program, virtualPool);

    const metadataAddress = deriveMetadataAccount(virtualPoolState.baseMint);

    let metadataAccount = svm.getAccount(metadataAddress);

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
