import { NATIVE_MINT } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
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
  createVirtualCurveProgram,
  derivePoolAuthority,
  generateAndFund,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  startSvm,
  U64_MAX,
} from "./utils";
import { getVirtualPool } from "./utils/fetcher";
import { Pool, VirtualCurveProgram } from "./utils/types";

describe("Claim lp on meteora dammm", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let user: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;
  let config: PublicKey;
  let virtualPool: PublicKey;
  let virtualPoolState: Pool;
  let dammConfig: PublicKey;

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
      payer: partner,
      leftoverReceiver: partner.publicKey,
      feeClaimer: partner.publicKey,
      quoteMint: NATIVE_MINT,
      instructionParams,
    };
    config = await createConfig(svm, program, params);
  });

  it("Create spl pool from config", async () => {
    virtualPool = await createPoolWithSplToken(svm, program, {
      poolCreator,
      payer: operator,
      quoteMint: NATIVE_MINT,
      config,
      instructionParams: {
        name: "test token spl",
        symbol: "TEST",
        uri: "abc.com",
      },
    });
    virtualPoolState = getVirtualPool(svm, program, virtualPool);
  });

  it("Swap", async () => {
    const params: SwapParams = {
      config,
      payer: user,
      pool: virtualPool,
      inputTokenMint: NATIVE_MINT,
      outputTokenMint: virtualPoolState.baseMint,
      amountIn: new BN(LAMPORTS_PER_SOL * 5.5),
      minimumAmountOut: new BN(0),
      swapMode: SwapMode.PartialFill,
      referralTokenAccount: null,
    };
    await swap(svm, program, params);
  });

  it("Create meteora metadata", async () => {
    await createMeteoraMetadata(svm, program, {
      payer: admin,
      virtualPool,
      config,
    });
  });

  it("Migrate to Meteora Damm Pool", async () => {
    const poolAuthority = derivePoolAuthority();
    dammConfig = await createDammConfig(svm, admin, poolAuthority);
    const migrationParams: MigrateMeteoraParams = {
      payer: admin,
      virtualPool,
      dammConfig,
    };

    await migrateToMeteoraDamm(svm, program, migrationParams);
  });

  it("Partner lock LP", async () => {
    await lockLpForPartnerDamm(svm, program, {
      payer: partner,
      dammConfig,
      virtualPool,
    });
  });

  it("Creator lock LP", async () => {
    await lockLpForCreatorDamm(svm, program, {
      payer: poolCreator,
      dammConfig,
      virtualPool,
    });
  });

  it("Partner claim LP", async () => {
    await partnerClaimLpDamm(svm, program, {
      payer: partner,
      dammConfig,
      virtualPool,
    });
  });

  it("Creator claim LP", async () => {
    await creatorClaimLpDamm(svm, program, {
      payer: poolCreator,
      dammConfig,
      virtualPool,
    });
  });
});
