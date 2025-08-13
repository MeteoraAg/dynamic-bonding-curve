import { writeFile } from "fs/promises";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { clusterApiUrl, Connection, Keypair, PublicKey } from "@solana/web3.js";

import { MAX_SQRT_PRICE, MIN_SQRT_PRICE, U64_MAX } from "../tests/utils";
import {
  InitializePoolParameters,
  ConfigParameters,
} from "../tests/instructions";

import { DynamicBondingCurve as VirtualCurve } from "../target/types/dynamic_bonding_curve";

const args = process.argv.slice(2); // Remove node path and script path
var path = require("path");
var absolutePath = path.resolve("./scripts/idl/" + args[0]);
const VirtualCurveIDL = require(absolutePath);
const isOldVersion = VirtualCurveIDL.metadata.version == "0.1.2";

/* generate_ix_data_for_tests.ts
 *
 * This script uses the automatically generated program.methods.<instruction> functions
 * to generate valid IX data for all instructions of the program. Output is saved to
 * a bunch of files in tests/fixtures/ix_data.
 *
 * These files can then be used for backwards compatibility tests.
 */

// We only care about IX data, so we use this in every account so Anchor doesn't complain
const DUMMY_PUBKEY: PublicKey = Keypair.generate().publicKey;

/// PARTNER FUNCTIONS ////

async function createPartnerMetadata(
  program: Program<VirtualCurve>
): Promise<Buffer> {
  const instructionParams = {
    padding: new Array(96).fill(0),
    name: "name",
    website: "website",
    logo: "logo",
  };

  const ix = await program.methods
    .createPartnerMetadata(instructionParams)
    .accountsPartial({
      partnerMetadata: DUMMY_PUBKEY,
      payer: DUMMY_PUBKEY,
      feeClaimer: DUMMY_PUBKEY,
      systemProgram: DUMMY_PUBKEY,
    })
    .instruction();

  return ix.data;
}

async function createConfigSplToken(
  program: Program<VirtualCurve>
): Promise<Buffer> {
  let curves = [];
  for (let i = 1; i <= 10; i++) {
    curves.push({
      sqrtPrice: MIN_SQRT_PRICE.muln(i + 1),
      liquidity: U64_MAX.shln(10),
    });
  }

  curves[curves.length - 1].sqrtPrice = MAX_SQRT_PRICE;

  const instructionParams = {
    poolFees: {
      baseFee: {
        cliffFeeNumerator: new BN(2_500_000),
        numberOfPeriod: 0,
        reductionFactor: new BN(0),
        periodFrequency: new BN(0),
        feeSchedulerMode: 0,
      },
      dynamicFee: null,
    },
    activationType: 0,
    collectFeeMode: 1,
    migrationOption: 0,
    tokenType: 0,
    tokenDecimal: 6,
    // 5 SOL
    migrationQuoteThreshold: new BN(5e9),
    partnerLpPercentage: 20,
    creatorLpPercentage: 30,
    partnerLockedLpPercentage: 10,
    creatorLockedLpPercentage: 40,
    sqrtStartPrice: MIN_SQRT_PRICE,
    lockedVesting: {
      amountPerPeriod: new BN(2),
      cliffDurationFromMigrationTime: new BN(3),
      frequency: new BN(4),
      numberOfPeriod: new BN(5),
      cliffUnlockAmount: new BN(6),
    },
    migrationFeeOption: 0,
    tokenSupply: null,
    creatorTradingFeePercentage: 10,
    tokenUpdateAuthority: 1,
    migrationFee: {
      feePercentage: 30,
      creatorFeePercentage: 20,
    },
    padding0: [],
    padding1: [],
    curve: curves,
  };

  const ix = await program.methods
    .createConfig(instructionParams as any)
    .accounts({
      config: DUMMY_PUBKEY,
      feeClaimer: DUMMY_PUBKEY,
      leftoverReceiver: DUMMY_PUBKEY,
      quoteMint: DUMMY_PUBKEY,
      payer: DUMMY_PUBKEY,
    })
    .instruction();

  return ix.data;
}

async function createConfigToken2022(
  program: Program<VirtualCurve>
): Promise<Buffer> {
  let curves = [];
  for (let i = 1; i <= 10; i++) {
    curves.push({
      sqrtPrice: MIN_SQRT_PRICE.muln(i + 1),
      liquidity: U64_MAX.shln(10),
    });
  }

  curves[curves.length - 1].sqrtPrice = MAX_SQRT_PRICE;

  const baseFee = isOldVersion
    ? {
      cliffFeeNumerator: new BN(2_500_000),
      numberOfPeriod: 0,
      reductionFactor: new BN(0),
      periodFrequency: new BN(0),
      feeSchedulerMode: 0,
    }
    : {
      cliffFeeNumerator: new BN(2_500_000),
      firstFactor: 0, // first factor | number_of_period
      thirdFactor: new BN(0), // third factor | reduction_factor
      secondFactor: new BN(0), // second factor | period_frequency
      baseFeeMode: 0,
    };

  const instructionParams = {
    poolFees: {
      baseFee,
      dynamicFee: null,
    },
    activationType: 0,
    collectFeeMode: 1,
    migrationOption: 1,
    tokenType: 1, // t22
    tokenDecimal: 6,
    // 5 SOL
    migrationQuoteThreshold: new BN(5e9),
    partnerLpPercentage: 20,
    creatorLpPercentage: 30,
    partnerLockedLpPercentage: 10,
    creatorLockedLpPercentage: 40,
    sqrtStartPrice: MIN_SQRT_PRICE,
    lockedVesting: {
      amountPerPeriod: new BN(2),
      cliffDurationFromMigrationTime: new BN(3),
      frequency: new BN(4),
      numberOfPeriod: new BN(5),
      cliffUnlockAmount: new BN(6),
    },
    migrationFeeOption: 0,
    tokenSupply: null,
    creatorTradingFeePercentage: 10,
    tokenUpdateAuthority: 1,
    migrationFee: {
      feePercentage: 30,
      creatorFeePercentage: 20,
    },
    padding0: [],
    padding1: [],
    curve: curves,
  };

  const ix = await program.methods
    .createConfig(instructionParams as any)
    .accounts({
      config: DUMMY_PUBKEY,
      feeClaimer: DUMMY_PUBKEY,
      leftoverReceiver: DUMMY_PUBKEY,
      quoteMint: DUMMY_PUBKEY,
      payer: DUMMY_PUBKEY,
    })
    .instruction();

  return ix.data;
}

async function createConfigSplTokenForSwapDamm(
  program: Program<VirtualCurve>
): Promise<Buffer> {
  let curves = [];
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

  const baseFee = isOldVersion
    ? {
      cliffFeeNumerator: new BN(2_500_000),
      numberOfPeriod: 0,
      reductionFactor: new BN(0),
      periodFrequency: new BN(0),
      feeSchedulerMode: 0,
    }
    : {
      cliffFeeNumerator: new BN(2_500_000),
      firstFactor: 0, // first factor | number_of_period
      thirdFactor: new BN(0), // third factor | reduction_factor
      secondFactor: new BN(0), // second factor | period_frequency
      baseFeeMode: 0,
    };

  const instructionParams = {
    poolFees: {
      baseFee,
      dynamicFee: null,
    },
    activationType: 0,
    collectFeeMode: 0,
    migrationOption: 0,
    tokenType: 0, // spl_token
    tokenDecimal: 6,
    migrationQuoteThreshold: new BN(5e9),
    partnerLpPercentage: 1,
    creatorLpPercentage: 1,
    partnerLockedLpPercentage: 94,
    creatorLockedLpPercentage: 4,
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
    padding0: [],
    padding1: [],
    curve: curves,
  };

  const ix = await program.methods
    .createConfig(instructionParams as any)
    .accounts({
      config: DUMMY_PUBKEY,
      feeClaimer: DUMMY_PUBKEY,
      leftoverReceiver: DUMMY_PUBKEY,
      quoteMint: DUMMY_PUBKEY,
      payer: DUMMY_PUBKEY,
    })
    .instruction();

  return ix.data;
}

async function createConfigSplTokenForSwapDammv2(
  program: Program<VirtualCurve>
): Promise<Buffer> {
  let curves = [];
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

  const baseFee = isOldVersion
    ? {
      cliffFeeNumerator: new BN(2_500_000),
      numberOfPeriod: 0,
      reductionFactor: new BN(0),
      periodFrequency: new BN(0),
      feeSchedulerMode: 0,
    }
    : {
      cliffFeeNumerator: new BN(2_500_000),
      firstFactor: 0, // first factor | number_of_period
      thirdFactor: new BN(0), // third factor | reduction_factor
      secondFactor: new BN(0), // second factor | period_frequency
      baseFeeMode: 0,
    };

  const instructionParams = {
    poolFees: {
      baseFee,
      dynamicFee: null,
    },
    activationType: 0,
    collectFeeMode: 0,
    migrationOption: 1,
    tokenType: 0, // spl_token
    tokenDecimal: 6,
    migrationQuoteThreshold: new BN(5e9),
    partnerLpPercentage: 1,
    creatorLpPercentage: 1,
    partnerLockedLpPercentage: 94,
    creatorLockedLpPercentage: 4,
    sqrtStartPrice: MIN_SQRT_PRICE.shln(32),
    lockedVesting: {
      amountPerPeriod: new BN(0),
      cliffDurationFromMigrationTime: new BN(0),
      frequency: new BN(0),
      numberOfPeriod: new BN(0),
      cliffUnlockAmount: new BN(0),
    },
    migrationFeeOption: 0,
    tokenSupply: {
      preMigrationTokenSupply: new BN(5e9),
      postMigrationTokenSupply: new BN(3e9),
    },
    creatorTradingFeePercentage: 0,
    tokenUpdateAuthority: 0,
    migrationFee: {
      feePercentage: 0,
      creatorFeePercentage: 0,
    },
    padding0: [],
    padding1: [],
    curve: curves,
  };

  const ix = await program.methods
    .createConfig(instructionParams as any)
    .accounts({
      config: DUMMY_PUBKEY,
      feeClaimer: DUMMY_PUBKEY,
      leftoverReceiver: DUMMY_PUBKEY,
      quoteMint: DUMMY_PUBKEY,
      payer: DUMMY_PUBKEY,
    })
    .instruction();

  return ix.data;
}

async function createConfigSplTokenWithBaseFeeParameters(
  program: Program<VirtualCurve>
): Promise<Buffer> {
  let curves = [];
  for (let i = 1; i <= 10; i++) {
    curves.push({
      sqrtPrice: MIN_SQRT_PRICE.muln(i + 1),
      liquidity: U64_MAX.shln(10),
    });
  }

  curves[curves.length - 1].sqrtPrice = MAX_SQRT_PRICE;

  const baseFee = isOldVersion
    ? {
      cliffFeeNumerator: new BN(2_500_000),
      numberOfPeriod: 10,
      reductionFactor: new BN(14),
      periodFrequency: new BN(3),
      feeSchedulerMode: 0,
    }
    : {
      cliffFeeNumerator: new BN(2_500_000),
      firstFactor: 10, // first factor | number_of_period
      thirdFactor: new BN(14), // third factor | reduction_factor
      secondFactor: new BN(3), // second factor | period_frequency
      baseFeeMode: 0,
    };

  const instructionParams = {
    poolFees: {
      baseFee,
      dynamicFee: null,
    },
    activationType: 0,
    collectFeeMode: 1,
    migrationOption: 0,
    tokenType: 0,
    tokenDecimal: 6,
    // 5 SOL
    migrationQuoteThreshold: new BN(5e9),
    partnerLpPercentage: 20,
    creatorLpPercentage: 30,
    partnerLockedLpPercentage: 10,
    creatorLockedLpPercentage: 40,
    sqrtStartPrice: MIN_SQRT_PRICE,
    lockedVesting: {
      amountPerPeriod: new BN(2),
      cliffDurationFromMigrationTime: new BN(3),
      frequency: new BN(4),
      numberOfPeriod: new BN(5),
      cliffUnlockAmount: new BN(6),
    },
    migrationFeeOption: 0,
    tokenSupply: null,
    creatorTradingFeePercentage: 10,
    tokenUpdateAuthority: 1,
    migrationFee: {
      feePercentage: 30,
      creatorFeePercentage: 20,
    },
    padding0: [],
    padding1: [],
    curve: curves,
  };

  const ix = await program.methods
    .createConfig(instructionParams as any)
    .accounts({
      config: DUMMY_PUBKEY,
      feeClaimer: DUMMY_PUBKEY,
      leftoverReceiver: DUMMY_PUBKEY,
      quoteMint: DUMMY_PUBKEY,
      payer: DUMMY_PUBKEY,
    })
    .instruction();

  return ix.data;
}

async function claimTradingFee(
  program: Program<VirtualCurve>
): Promise<Buffer> {
  const ix = await program.methods
    .claimTradingFee(new BN(123), new BN(321))
    .accountsPartial({
      poolAuthority: DUMMY_PUBKEY,
      config: DUMMY_PUBKEY,
      pool: DUMMY_PUBKEY,
      tokenAAccount: DUMMY_PUBKEY,
      tokenBAccount: DUMMY_PUBKEY,
      baseVault: DUMMY_PUBKEY,
      quoteVault: DUMMY_PUBKEY,
      baseMint: DUMMY_PUBKEY,
      quoteMint: DUMMY_PUBKEY,
      feeClaimer: DUMMY_PUBKEY,
      tokenBaseProgram: DUMMY_PUBKEY,
      tokenQuoteProgram: DUMMY_PUBKEY,
    })
    .instruction();

  return ix.data;
}

async function partnerWithdrawSurplus(
  program: Program<VirtualCurve>
): Promise<Buffer> {
  const ix = await program.methods
    .partnerWithdrawSurplus()
    .accountsPartial({
      poolAuthority: DUMMY_PUBKEY,
      config: DUMMY_PUBKEY,
      virtualPool: DUMMY_PUBKEY,
      tokenQuoteAccount: DUMMY_PUBKEY,
      quoteVault: DUMMY_PUBKEY,
      quoteMint: DUMMY_PUBKEY,
      feeClaimer: DUMMY_PUBKEY,
      tokenQuoteProgram: DUMMY_PUBKEY,
    })
    .instruction();

  return ix.data;
}

/// POOL CREATOR FUNCTIONS ///

async function initializeVirtualPoolWithSplToken(
  program: Program<VirtualCurve>
): Promise<Buffer> {
  const instructionParams: InitializePoolParameters = {
    name: "name",
    symbol: "symbol",
    uri: "uri",
  };

  const ix = await program.methods
    .initializeVirtualPoolWithSplToken(instructionParams)
    .accountsPartial({
      config: DUMMY_PUBKEY,
      creator: DUMMY_PUBKEY,
      baseMint: DUMMY_PUBKEY,
      pool: DUMMY_PUBKEY,
      mintMetadata: DUMMY_PUBKEY,
      payer: DUMMY_PUBKEY,
      tokenQuoteProgram: DUMMY_PUBKEY,
      quoteMint: DUMMY_PUBKEY,
      quoteVault: DUMMY_PUBKEY,
    })
    .instruction();

  return ix.data;
}

async function initializeVirtualPoolWithToken2022(
  program: Program<VirtualCurve>
): Promise<Buffer> {
  const instructionParams: InitializePoolParameters = {
    name: "name",
    symbol: "symbol",
    uri: "uri",
  };

  const ix = await program.methods
    .initializeVirtualPoolWithToken2022(instructionParams)
    .accountsPartial({
      config: DUMMY_PUBKEY,
      creator: DUMMY_PUBKEY,
      baseMint: DUMMY_PUBKEY,
      pool: DUMMY_PUBKEY,
      payer: DUMMY_PUBKEY,
      tokenQuoteProgram: DUMMY_PUBKEY,
      quoteMint: DUMMY_PUBKEY,
      quoteVault: DUMMY_PUBKEY,
    })
    .instruction();

  return ix.data;
}

async function createVirtualPoolMetadata(
  program: Program<VirtualCurve>
): Promise<Buffer> {
  const instructionParams = {
    padding: new Array(96).fill(0),
    name: "name",
    website: "website",
    logo: "logo",
  };

  const ix = await program.methods
    .createVirtualPoolMetadata(instructionParams)
    .accountsPartial({
      virtualPool: DUMMY_PUBKEY,
      virtualPoolMetadata: DUMMY_PUBKEY,
      creator: DUMMY_PUBKEY,
      payer: DUMMY_PUBKEY,
    })
    .instruction();

  return ix.data;
}

async function claimCreatorTradingFee(
  program: Program<VirtualCurve>
): Promise<Buffer> {
  const ix = await program.methods
    .claimCreatorTradingFee(new BN(123), new BN(321))
    .accountsPartial({
      poolAuthority: DUMMY_PUBKEY,
      pool: DUMMY_PUBKEY,
      tokenAAccount: DUMMY_PUBKEY,
      tokenBAccount: DUMMY_PUBKEY,
      baseVault: DUMMY_PUBKEY,
      quoteVault: DUMMY_PUBKEY,
      baseMint: DUMMY_PUBKEY,
      quoteMint: DUMMY_PUBKEY,
      creator: DUMMY_PUBKEY,
      tokenBaseProgram: DUMMY_PUBKEY,
      tokenQuoteProgram: DUMMY_PUBKEY,
    })
    .instruction();

  return ix.data;
}

async function creatorWithdrawSurplus(
  program: Program<VirtualCurve>
): Promise<Buffer> {
  const ix = await program.methods
    .creatorWithdrawSurplus()
    .accountsPartial({
      poolAuthority: DUMMY_PUBKEY,
      config: DUMMY_PUBKEY,
      virtualPool: DUMMY_PUBKEY,
      tokenQuoteAccount: DUMMY_PUBKEY,
      quoteVault: DUMMY_PUBKEY,
      quoteMint: DUMMY_PUBKEY,
      creator: DUMMY_PUBKEY,
      tokenQuoteProgram: DUMMY_PUBKEY,
    })
    .instruction();

  return ix.data;
}

async function transferPoolCreator(
  program: Program<VirtualCurve>
): Promise<Buffer> {
  const ix = await program.methods
    .transferPoolCreator()
    .accountsPartial({
      virtualPool: DUMMY_PUBKEY,
      config: DUMMY_PUBKEY,
      creator: DUMMY_PUBKEY,
      newCreator: DUMMY_PUBKEY,
    })
    .instruction();

  return ix.data;
}

/// BOTH partner and creator FUNCTIONS ///

async function creatorWithdrawMigrationFee(
  program: Program<VirtualCurve>
): Promise<Buffer> {
  const ix = await program.methods
    .withdrawMigrationFee(1)
    .accountsPartial({
      poolAuthority: DUMMY_PUBKEY,
      config: DUMMY_PUBKEY,
      virtualPool: DUMMY_PUBKEY,
      tokenQuoteAccount: DUMMY_PUBKEY,
      quoteVault: DUMMY_PUBKEY,
      quoteMint: DUMMY_PUBKEY,
      sender: DUMMY_PUBKEY,
      tokenQuoteProgram: DUMMY_PUBKEY,
    })
    .instruction();

  return ix.data;
}

/// TRADING BOTS FUNCTIONS ////

async function swap(program: Program<VirtualCurve>): Promise<Buffer> {
  const instructionParams = {
    // 6 SOL
    amountIn: new BN(6e9),
    minimumAmountOut: new BN(321),
  };

  const ix = await program.methods
    .swap(instructionParams)
    .accountsPartial({
      poolAuthority: DUMMY_PUBKEY,
      config: DUMMY_PUBKEY,
      pool: DUMMY_PUBKEY,
      inputTokenAccount: DUMMY_PUBKEY,
      outputTokenAccount: DUMMY_PUBKEY,
      baseVault: DUMMY_PUBKEY,
      quoteVault: DUMMY_PUBKEY,
      baseMint: DUMMY_PUBKEY,
      quoteMint: DUMMY_PUBKEY,
      payer: DUMMY_PUBKEY,
      tokenBaseProgram: DUMMY_PUBKEY,
      tokenQuoteProgram: DUMMY_PUBKEY,
      referralTokenAccount: DUMMY_PUBKEY,
    })
    .instruction();

  return ix.data;
}

/// PERMISSIONLESS FUNCTIONS ///

async function createLocker(program: Program<VirtualCurve>): Promise<Buffer> {
  const ix = await program.methods
    .createLocker()
    .accountsPartial({
      virtualPool: DUMMY_PUBKEY,
      config: DUMMY_PUBKEY,
      poolAuthority: DUMMY_PUBKEY,
      baseVault: DUMMY_PUBKEY,
      baseMint: DUMMY_PUBKEY,
      base: DUMMY_PUBKEY,
      creator: DUMMY_PUBKEY,
      escrow: DUMMY_PUBKEY,
      escrowToken: DUMMY_PUBKEY,
      payer: DUMMY_PUBKEY,
      tokenProgram: DUMMY_PUBKEY,
      lockerProgram: DUMMY_PUBKEY,
      lockerEventAuthority: DUMMY_PUBKEY,
    })
    .instruction();

  return ix.data;
}

async function withdrawLeftover(
  program: Program<VirtualCurve>
): Promise<Buffer> {
  const ix = await program.methods
    .withdrawLeftover()
    .accountsPartial({
      virtualPool: DUMMY_PUBKEY,
      config: DUMMY_PUBKEY,
      poolAuthority: DUMMY_PUBKEY,
      baseVault: DUMMY_PUBKEY,
      baseMint: DUMMY_PUBKEY,
      leftoverReceiver: DUMMY_PUBKEY,
      tokenBaseProgram: DUMMY_PUBKEY,
      tokenBaseAccount: DUMMY_PUBKEY,
    })
    .instruction();

  return ix.data;
}

async function migrationMeteoraDammCreateMetadata(
  program: Program<VirtualCurve>
): Promise<Buffer> {
  const ix = await program.methods
    .migrationMeteoraDammCreateMetadata()
    .accountsPartial({
      virtualPool: DUMMY_PUBKEY,
      config: DUMMY_PUBKEY,
      migrationMetadata: DUMMY_PUBKEY,
      payer: DUMMY_PUBKEY,
    })
    .instruction();

  return ix.data;
}

async function migrateMeteoraDammLockLpToken(
  program: Program<VirtualCurve>
): Promise<Buffer> {
  const ix = await program.methods
    .migrateMeteoraDammLockLpToken()
    .accountsPartial({
      virtualPool: DUMMY_PUBKEY,
      migrationMetadata: DUMMY_PUBKEY,
      poolAuthority: DUMMY_PUBKEY,
      pool: DUMMY_PUBKEY,
      lpMint: DUMMY_PUBKEY,
      lockEscrow: DUMMY_PUBKEY,
      owner: DUMMY_PUBKEY,
      sourceTokens: DUMMY_PUBKEY,
      escrowVault: DUMMY_PUBKEY,
      ammProgram: DUMMY_PUBKEY,
      aVault: DUMMY_PUBKEY,
      bVault: DUMMY_PUBKEY,
      aVaultLp: DUMMY_PUBKEY,
      bVaultLp: DUMMY_PUBKEY,
      aVaultLpMint: DUMMY_PUBKEY,
      bVaultLpMint: DUMMY_PUBKEY,
      tokenProgram: DUMMY_PUBKEY,
    })
    .instruction();

  return ix.data;
}

async function migrateMeteoraDammClaimLpToken(
  program: Program<VirtualCurve>
): Promise<Buffer> {
  const ix = await program.methods
    .migrateMeteoraDammClaimLpToken()
    .accountsPartial({
      virtualPool: DUMMY_PUBKEY,
      migrationMetadata: DUMMY_PUBKEY,
      poolAuthority: DUMMY_PUBKEY,
      lpMint: DUMMY_PUBKEY,
      sourceToken: DUMMY_PUBKEY,
      destinationToken: DUMMY_PUBKEY,
      owner: DUMMY_PUBKEY,
      sender: DUMMY_PUBKEY,
      tokenProgram: DUMMY_PUBKEY,
    })
    .instruction();

  return ix.data;
}

async function migrateMeteoraDamm(
  program: Program<VirtualCurve>
): Promise<Buffer> {
  const ix = await program.methods
    .migrateMeteoraDamm()
    .accountsPartial({
      virtualPool: DUMMY_PUBKEY,
      migrationMetadata: DUMMY_PUBKEY,
      config: DUMMY_PUBKEY,
      poolAuthority: DUMMY_PUBKEY,
      pool: DUMMY_PUBKEY,
      dammConfig: DUMMY_PUBKEY,
      lpMint: DUMMY_PUBKEY,
      tokenAMint: DUMMY_PUBKEY,
      tokenBMint: DUMMY_PUBKEY,
      aVault: DUMMY_PUBKEY,
      bVault: DUMMY_PUBKEY,
      aTokenVault: DUMMY_PUBKEY,
      bTokenVault: DUMMY_PUBKEY,
      aVaultLpMint: DUMMY_PUBKEY,
      bVaultLpMint: DUMMY_PUBKEY,
      aVaultLp: DUMMY_PUBKEY,
      bVaultLp: DUMMY_PUBKEY,
      baseVault: DUMMY_PUBKEY,
      quoteVault: DUMMY_PUBKEY,
      virtualPoolLp: DUMMY_PUBKEY,
      protocolTokenAFee: DUMMY_PUBKEY,
      protocolTokenBFee: DUMMY_PUBKEY,
      payer: DUMMY_PUBKEY,
      rent: DUMMY_PUBKEY,
      mintMetadata: DUMMY_PUBKEY,
      metadataProgram: DUMMY_PUBKEY,
      ammProgram: DUMMY_PUBKEY,
      vaultProgram: DUMMY_PUBKEY,
      tokenProgram: DUMMY_PUBKEY,
      associatedTokenProgram: DUMMY_PUBKEY,
      systemProgram: DUMMY_PUBKEY,
    })
    .instruction();

  return ix.data;
}

async function migrationDammV2CreateMetadata(
  program: Program<VirtualCurve>
): Promise<Buffer> {
  const ix = await program.methods
    .migrationDammV2CreateMetadata()
    .accountsPartial({
      virtualPool: DUMMY_PUBKEY,
      config: DUMMY_PUBKEY,
      migrationMetadata: DUMMY_PUBKEY,
      payer: DUMMY_PUBKEY,
      systemProgram: DUMMY_PUBKEY,
    })
    .instruction();

  return ix.data;
}

async function migrationDammV2(
  program: Program<VirtualCurve>
): Promise<Buffer> {
  const ix = await program.methods
    .migrationDammV2()
    .accountsPartial({
      virtualPool: DUMMY_PUBKEY,
      migrationMetadata: DUMMY_PUBKEY,
      config: DUMMY_PUBKEY,
      poolAuthority: DUMMY_PUBKEY,
      pool: DUMMY_PUBKEY,
      firstPositionNftMint: DUMMY_PUBKEY,
      firstPositionNftAccount: DUMMY_PUBKEY,
      firstPosition: DUMMY_PUBKEY,
      secondPositionNftMint: DUMMY_PUBKEY,
      secondPositionNftAccount: DUMMY_PUBKEY,
      secondPosition: DUMMY_PUBKEY,
      dammPoolAuthority: DUMMY_PUBKEY,
      ammProgram: DUMMY_PUBKEY,
      baseMint: DUMMY_PUBKEY,
      quoteMint: DUMMY_PUBKEY,
      tokenAVault: DUMMY_PUBKEY,
      tokenBVault: DUMMY_PUBKEY,
      baseVault: DUMMY_PUBKEY,
      quoteVault: DUMMY_PUBKEY,
      payer: DUMMY_PUBKEY,
      tokenBaseProgram: DUMMY_PUBKEY,
      tokenQuoteProgram: DUMMY_PUBKEY,
      token2022Program: DUMMY_PUBKEY,
      dammEventAuthority: DUMMY_PUBKEY,
      systemProgram: DUMMY_PUBKEY,
    })
    .instruction();

  return ix.data;
}

async function main() {
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(
    new Connection(clusterApiUrl("devnet")),
    wallet,
    {}
  );

  const program = new Program<VirtualCurve>(
    VirtualCurveIDL as VirtualCurve,
    provider
  );

  const ixs: Array<(program: Program<VirtualCurve>) => Promise<Buffer>> = [
    createPartnerMetadata,
    createConfigSplToken,
    createConfigToken2022,
    createConfigSplTokenForSwapDamm,
    createConfigSplTokenForSwapDammv2,
    createConfigSplTokenWithBaseFeeParameters,
    claimTradingFee,
    partnerWithdrawSurplus,
    initializeVirtualPoolWithSplToken,
    initializeVirtualPoolWithToken2022,
    createVirtualPoolMetadata,
    claimCreatorTradingFee,
    creatorWithdrawSurplus,
    transferPoolCreator,
    creatorWithdrawMigrationFee,
    swap,
    createLocker,
    withdrawLeftover,
    migrationMeteoraDammCreateMetadata,
    migrateMeteoraDamm,
    migrateMeteoraDammLockLpToken,
    migrateMeteoraDammClaimLpToken,
    migrationDammV2CreateMetadata,
    migrationDammV2,
  ];

  for (const ix of ixs) {
    const ixData = await ix(program);
    writeFile(`./tests/fixtures/ix_data/ix_data-${ix.name}.bin`, ixData);
  }
}

main()
  .then(() =>
    console.log("IX data files were stored in tests/fixtures/ix_data")
  )
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
