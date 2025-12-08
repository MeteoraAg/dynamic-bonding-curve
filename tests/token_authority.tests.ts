import { deserializeMetadata } from "@metaplex-foundation/mpl-token-metadata";
import {
  ACCOUNT_SIZE,
  ACCOUNT_TYPE_SIZE,
  ExtensionType,
  getExtensionData,
  MetadataPointerLayout,
  MintLayout,
  NATIVE_MINT,
} from "@solana/spl-token";
import { unpack } from "@solana/spl-token-metadata";
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
  getMint,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  startSvm,
  U64_MAX,
} from "./utils";
import { getVirtualPool } from "./utils/fetcher";
import { VirtualCurveProgram } from "./utils/types";

describe("Token authority with token2022", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let user: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;

  before(async () => {
    svm = startSvm();
    admin = generateAndFund(svm);
    operator = generateAndFund(svm);
    partner = generateAndFund(svm);
    user = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    program = createVirtualCurveProgram();
  });

  it("Token2022: creator can update update_authority", async () => {
    const tokenUpdateAuthority = 0;
    const tokenType = 1;

    const virtualPool = await createPool(
      svm,
      program,
      partner,
      poolCreator,
      tokenUpdateAuthority,
      tokenType
    );
    const virtualPoolState = getVirtualPool(svm, program, virtualPool);

    const tlvData = svm
      .getAccount(virtualPoolState.baseMint)
      .data.slice(ACCOUNT_SIZE + ACCOUNT_TYPE_SIZE);
    const metadataPointer = MetadataPointerLayout.decode(
      getExtensionData(ExtensionType.MetadataPointer, Buffer.from(tlvData))
    );

    expect(metadataPointer.authority.toString()).eq(
      poolCreator.publicKey.toString()
    );
    // validate token metadata update authority
    const tokenMetadata = unpack(
      getExtensionData(ExtensionType.TokenMetadata, Buffer.from(tlvData))
    );
    expect(tokenMetadata.updateAuthority.toString()).eq(
      poolCreator.publicKey.toString()
    );

    // validate mint authority
    const baseMintData = getMint(svm, virtualPoolState.baseMint);
    expect(baseMintData.mintAuthorityOption).eq(0);
  });

  it("Token2022: immutable", async () => {
    const tokenUpdateAuthority = 1;
    const tokenType = 1;

    const virtualPool = await createPool(
      svm,
      program,
      partner,
      poolCreator,
      tokenUpdateAuthority,
      tokenType
    );
    const virtualPoolState = getVirtualPool(svm, program, virtualPool);
    const tlvData = svm
      .getAccount(virtualPoolState.baseMint)
      .data.slice(ACCOUNT_SIZE + ACCOUNT_TYPE_SIZE);
    const metadataPointer = MetadataPointerLayout.decode(
      getExtensionData(ExtensionType.MetadataPointer, Buffer.from(tlvData))
    );

    expect(metadataPointer.authority.toString()).eq(
      PublicKey.default.toString()
    );
    // validate token metadata update authority
    const tokenMetadata = unpack(
      getExtensionData(ExtensionType.TokenMetadata, Buffer.from(tlvData))
    );
    expect(tokenMetadata.updateAuthority).to.be.undefined;

    // validate mint authority
    const baseMintData = getMint(svm, virtualPoolState.baseMint);
    expect(baseMintData.mintAuthorityOption).eq(0);
  });

  it("Token2022: partner can update update_authority", async () => {
    const tokenUpdateAuthority = 2;
    const tokenType = 1;

    const virtualPool = await createPool(
      svm,
      program,
      partner,
      poolCreator,
      tokenUpdateAuthority,
      tokenType
    );
    const virtualPoolState = getVirtualPool(svm, program, virtualPool);

    const tlvData = svm
      .getAccount(virtualPoolState.baseMint)
      .data.slice(ACCOUNT_SIZE + ACCOUNT_TYPE_SIZE);
    const metadataPointer = MetadataPointerLayout.decode(
      getExtensionData(ExtensionType.MetadataPointer, Buffer.from(tlvData))
    );
    expect(metadataPointer.authority.toString()).eq(
      partner.publicKey.toString()
    );
    // validate token metadata update authority
    const tokenMetadata = unpack(
      getExtensionData(ExtensionType.TokenMetadata, Buffer.from(tlvData))
    );
    expect(tokenMetadata.updateAuthority.toString()).eq(
      partner.publicKey.toString()
    );

    // validate mint authority
    const baseMintData = getMint(svm, virtualPoolState.baseMint);
    expect(baseMintData.mintAuthorityOption).eq(0);
  });

  it("Token2022: Creator can update update_authority and as mint authority", async () => {
    const tokenUpdateAuthority = 3;
    const tokenType = 1;

    const virtualPool = await createPool(
      svm,
      program,
      partner,
      poolCreator,
      tokenUpdateAuthority,
      tokenType
    );
    const virtualPoolState = getVirtualPool(svm, program, virtualPool);

    const tlvData = svm
      .getAccount(virtualPoolState.baseMint)
      .data.slice(ACCOUNT_SIZE + ACCOUNT_TYPE_SIZE);
    const dataDecoded = MintLayout.decode(Buffer.from(tlvData));
    expect(dataDecoded.mintAuthority.toString()).eq(
      poolCreator.publicKey.toString()
    );
    expect(dataDecoded.mintAuthorityOption).not.eq(0);

    const metadataPointer = MetadataPointerLayout.decode(
      getExtensionData(ExtensionType.MetadataPointer, Buffer.from(tlvData))
    );
    expect(metadataPointer.authority.toString()).eq(
      poolCreator.publicKey.toString()
    );
    // validate token metadata update authority
    const tokenMetadata = unpack(
      getExtensionData(ExtensionType.TokenMetadata, Buffer.from(tlvData))
    );
    expect(tokenMetadata.updateAuthority.toString()).eq(
      poolCreator.publicKey.toString()
    );
  });

  it("Token2022: partner can update update_authority and as mint authority", async () => {
    const tokenUpdateAuthority = 4;
    const tokenType = 1;

    const virtualPool = await createPool(
      svm,
      program,
      partner,
      poolCreator,
      tokenUpdateAuthority,
      tokenType
    );
    const virtualPoolState = getVirtualPool(svm, program, virtualPool);

    const tlvData = svm
      .getAccount(virtualPoolState.baseMint)
      .data.slice(ACCOUNT_SIZE + ACCOUNT_TYPE_SIZE);
    const dataDecoded = MintLayout.decode(Buffer.from(tlvData));
    expect(dataDecoded.mintAuthority.toString()).eq(
      partner.publicKey.toString()
    );
    expect(dataDecoded.mintAuthorityOption).not.eq(0);

    const metadataPointer = MetadataPointerLayout.decode(
      getExtensionData(ExtensionType.MetadataPointer, Buffer.from(tlvData))
    );
    expect(metadataPointer.authority.toString()).eq(
      partner.publicKey.toString()
    );
    // validate token metadata update authority
    const tokenMetadata = unpack(
      getExtensionData(ExtensionType.TokenMetadata, Buffer.from(tlvData))
    );
    expect(tokenMetadata.updateAuthority.toString()).eq(
      partner.publicKey.toString()
    );
  });
});

describe("Token authority with spl token", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let user: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;

  before(async () => {
    svm = startSvm();
    admin = generateAndFund(svm);
    operator = generateAndFund(svm);
    partner = generateAndFund(svm);
    user = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    program = createVirtualCurveProgram();
  });

  it("Spl token: creator can update update_authority", async () => {
    const tokenUpdateAuthority = 0;
    const tokenType = 0;

    const virtualPool = await createPool(
      svm,
      program,
      partner,
      poolCreator,
      tokenUpdateAuthority,
      tokenType
    );

    const virtualPoolState = getVirtualPool(svm, program, virtualPool);

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

    // validate mint authority
    const baseMintData = getMint(svm, virtualPoolState.baseMint);
    expect(baseMintData.mintAuthorityOption).eq(0);
  });

  it("Spl token: immutable", async () => {
    const tokenUpdateAuthority = 1;
    const tokenType = 0;

    const virtualPool = await createPool(
      svm,
      program,
      partner,
      poolCreator,
      tokenUpdateAuthority,
      tokenType
    );
    const virtualPoolState = getVirtualPool(svm, program, virtualPool);

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

    // validate mint authority
    const baseMintData = getMint(svm, virtualPoolState.baseMint);
    expect(baseMintData.mintAuthorityOption).eq(0);
  });

  it("Spl token: partner can update update_authority", async () => {
    const tokenUpdateAuthority = 2;
    const tokenType = 0;

    const virtualPool = await createPool(
      svm,
      program,
      partner,
      poolCreator,
      tokenUpdateAuthority,
      tokenType
    );
    const virtualPoolState = getVirtualPool(svm, program, virtualPool);

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

    expect(metadata.updateAuthority).eq(partner.publicKey.toString());
    // validate mint authority
    const baseMintData = getMint(svm, virtualPoolState.baseMint);
    expect(baseMintData.mintAuthorityOption).eq(0);
  });

  it("Spl token: creator can update update_authority and mint authority", async () => {
    const tokenUpdateAuthority = 3;
    const tokenType = 0;

    const virtualPool = await createPool(
      svm,
      program,
      partner,
      poolCreator,
      tokenUpdateAuthority,
      tokenType
    );
    const virtualPoolState = getVirtualPool(svm, program, virtualPool);

    const data = svm.getAccount(virtualPoolState.baseMint).data;
    const dataDecoded = MintLayout.decode(Buffer.from(data));
    expect(dataDecoded.mintAuthority.toString()).eq(
      poolCreator.publicKey.toString()
    );
    expect(dataDecoded.mintAuthorityOption).not.eq(0);

    const metadataAddress = deriveMetadataAccount(virtualPoolState.baseMint);

    let metadataAccount = svm.getAccount(metadataAddress);

    const dataDecode = {
      executable: metadataAccount.executable,
      owner: metadataAccount.owner,
      lamports: metadataAccount.lamports,
      rentEpoch: metadataAccount.rentEpoch,
      data: metadataAccount.data,
      publicKey: metadataAddress,
    };
    const metadata = deserializeMetadata(dataDecode as any);

    expect(metadata.updateAuthority).eq(poolCreator.publicKey.toString());
  });

  it("Spl token: partner can update update_authority and mint authority", async () => {
    const tokenUpdateAuthority = 4;
    const tokenType = 0;

    const virtualPool = await createPool(
      svm,
      program,
      partner,
      poolCreator,
      tokenUpdateAuthority,
      tokenType
    );
    const virtualPoolState = getVirtualPool(svm, program, virtualPool);

    const data = svm.getAccount(virtualPoolState.baseMint).data;
    const dataDecoded = MintLayout.decode(Buffer.from(data));
    expect(dataDecoded.mintAuthority.toString()).eq(
      partner.publicKey.toString()
    );
    expect(dataDecoded.mintAuthorityOption).not.eq(0);

    const metadataAddress = deriveMetadataAccount(virtualPoolState.baseMint);

    let metadataAccount = svm.getAccount(metadataAddress);

    const dataDecode = {
      executable: metadataAccount.executable,
      owner: metadataAccount.owner,
      lamports: metadataAccount.lamports,
      rentEpoch: metadataAccount.rentEpoch,
      data: metadataAccount.data,
      publicKey: metadataAddress,
    };
    const metadata = deserializeMetadata(dataDecode as any);

    expect(metadata.updateAuthority).eq(partner.publicKey.toString());
  });
});

async function createPool(
  svm: LiteSVM,
  program: VirtualCurveProgram,
  partner: Keypair,
  user: Keypair,
  tokenUpdateAuthority: number,
  tokenType: number
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
    migrationOption: 1,
    tokenType: tokenType,
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
    migrationFee: {
      creatorFeePercentage: 0,
      feePercentage: 0,
    },
    creatorTradingFeePercentage: 0,
    tokenUpdateAuthority: tokenUpdateAuthority,
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
  };
  const params: CreateConfigParams<ConfigParameters> = {
    payer: partner,
    leftoverReceiver: partner.publicKey,
    feeClaimer: partner.publicKey,
    quoteMint: NATIVE_MINT,
    instructionParams,
  };

  const config = await createConfig(svm, program, params);

  let virtualPool: PublicKey;
  if (tokenType == 1) {
    virtualPool = await createPoolWithToken2022(svm, program, {
      payer: user,
      poolCreator: user,
      quoteMint: NATIVE_MINT,
      config: config,
      instructionParams: {
        name: "test",
        symbol: "test",
        uri: "test",
      },
    });
  } else {
    virtualPool = await createPoolWithSplToken(svm, program, {
      poolCreator: user,
      payer: user,
      quoteMint: NATIVE_MINT,
      config: config,
      instructionParams: {
        name: "test token spl",
        symbol: "TEST",
        uri: "abc.com",
      },
    });
  }

  return virtualPool;
}
