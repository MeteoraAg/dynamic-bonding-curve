import { IdlAccounts } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createBurnInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackAccount,
} from "@solana/spl-token";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { BN } from "bn.js";
import { expect } from "chai";
import { BanksClient, ProgramTestContext } from "solana-bankrun";
import {
  createConfig,
  createMeteoraDammV2Metadata,
  createMeteoraMetadata,
  createPoolWithSplToken,
  createPoolWithToken2022,
  creatorClaimLpDamm,
  deriveDammV2PoolAuthority,
  derivePositionNftAccount,
  MigrateMeteoraDammV2Params,
  migrateToDammV2,
  migrateToMeteoraDamm,
  partnerClaimLpDamm,
  swap2,
} from "./instructions";
import {
  createDammConfig,
  createDammV2Config,
  createDammV2Program,
  createVirtualCurveProgram,
  deriveLpMintAddress,
  derivePoolAuthority,
  designGraphCurve,
  fundSol,
  getConfig,
  getVirtualPool,
  startTest,
  U64_MAX,
  VirtualCurveProgram,
} from "./utils";
import { CpAmm } from "./utils/idl/damm_v2";
import { createToken, mintSplTokenTo } from "./utils/token";

type Position = IdlAccounts<CpAmm>["position"];
type Pool = IdlAccounts<CpAmm>["pool"];

describe("Rent fee farm", () => {
  let context: ProgramTestContext;
  let admin: Keypair;
  let exploiterPartner: Keypair;
  let exploiterCreator: Keypair;
  let migrator: Keypair;
  let program: VirtualCurveProgram;

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

  let referenceAmount = new BN(1_000_000_000);
  let migrateDammV1Config: PublicKey;
  let migrateDammV2Config: PublicKey;
  let migrateDammV1ConfigToken2022: PublicKey;
  let quoteMint: PublicKey;

  beforeEach(async () => {
    context = await startTest();
    admin = context.payer;
    exploiterPartner = Keypair.generate();
    migrator = Keypair.generate();
    exploiterCreator = Keypair.generate();

    const receivers = [
      exploiterPartner.publicKey,
      migrator.publicKey,
      exploiterCreator.publicKey,
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
      exploiterCreator.publicKey,
      BigInt(U64_MAX.toString())
    );

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
    // Meteora migrator only migrate for SOL/USDC/JUP/TRUMP quote mint pools
    instructionParams.collectFeeMode = 1; // Output only

    migrateDammV1Config = await createConfig(context.banksClient, program, {
      payer: exploiterPartner,
      leftoverReceiver: exploiterPartner.publicKey,
      feeClaimer: exploiterPartner.publicKey,
      quoteMint,
      instructionParams,
    });

    instructionParams.migrationOption = 1;

    migrateDammV2Config = await createConfig(context.banksClient, program, {
      payer: exploiterPartner,
      leftoverReceiver: exploiterPartner.publicKey,
      feeClaimer: exploiterPartner.publicKey,
      quoteMint,
      instructionParams,
    });

    instructionParams.tokenType = 1;

    migrateDammV1ConfigToken2022 = await createConfig(
      context.banksClient,
      program,
      {
        payer: exploiterPartner,
        leftoverReceiver: exploiterPartner.publicKey,
        feeClaimer: exploiterPartner.publicKey,
        quoteMint,
        instructionParams,
      }
    );
  });

  describe("Farm rent fee DAMM v1", async () => {
    async function dammV1FarmSolFailure(
      poolCreationFn: () => Promise<PublicKey>
    ) {
      let totalCreationRent = BigInt(0);

      const beforeBalance = await context.banksClient.getBalance(
        exploiterCreator.publicKey
      );

      const virtualPool = await poolCreationFn();

      let virtualPoolState = await getVirtualPool(
        context.banksClient,
        program,
        virtualPool
      );

      expect(virtualPoolState.creationFeeBits).to.equal(0);

      const configState = await getConfig(
        context.banksClient,
        program,
        virtualPoolState.config
      );

      const afterBalance = await context.banksClient.getBalance(
        exploiterCreator.publicKey
      );

      // Include tx fee
      const lamportUsed = beforeBalance - afterBalance;
      totalCreationRent += lamportUsed;

      await swap2(context.banksClient, program, {
        inputTokenMint: quoteMint,
        outputTokenMint: virtualPoolState.baseMint,
        config: virtualPoolState.config,
        payer: exploiterCreator,
        amount0: configState.migrationQuoteThreshold
          .mul(new BN(120))
          .div(new BN(100)),
        amount1: new BN(0),
        swapMode: 1, // Partial fill
        pool: virtualPool,
        referralTokenAccount: null,
      });

      const poolAuthority = derivePoolAuthority();
      let dammConfig = await createDammConfig(
        context.banksClient,
        admin,
        poolAuthority
      );

      await createMeteoraMetadata(context.banksClient, program, {
        payer: admin,
        virtualPool,
        config: virtualPoolState.config,
      });

      const dammPoolAddress = await migrateToMeteoraDamm(
        context.banksClient,
        program,
        {
          payer: migrator,
          virtualPool,
          dammConfig,
        }
      );

      // Farm rent fee
      await partnerClaimLpDamm(context.banksClient, program, {
        payer: migrator,
        virtualPool,
        dammConfig,
      });

      await creatorClaimLpDamm(context.banksClient, program, {
        payer: migrator,
        virtualPool,
        dammConfig,
      });

      const lpMint = deriveLpMintAddress(dammPoolAddress);

      const partnerLpAddress = getAssociatedTokenAddressSync(
        lpMint,
        exploiterPartner.publicKey
      );

      const creatorLpAddress = getAssociatedTokenAddressSync(
        lpMint,
        exploiterCreator.publicKey
      );

      const partnerLpAccountInfo = await context.banksClient.getAccount(
        partnerLpAddress
      );

      const creatorLpAccountInfo = await context.banksClient.getAccount(
        creatorLpAddress
      );

      const partnerLpState = unpackAccount(partnerLpAddress, {
        ...partnerLpAccountInfo,
        data: Buffer.from(partnerLpAccountInfo.data),
      });
      const creatorLpState = unpackAccount(creatorLpAddress, {
        ...creatorLpAccountInfo,
        data: Buffer.from(creatorLpAccountInfo.data),
      });

      const closePartnerLpAccountIx = createCloseAccountInstruction(
        partnerLpAddress,
        exploiterPartner.publicKey,
        exploiterPartner.publicKey
      );

      const burnPartnerLpAccountIx = createBurnInstruction(
        partnerLpAddress,
        lpMint,
        exploiterPartner.publicKey,
        partnerLpState.amount
      );

      const closeCreatorLpAccountIx = createCloseAccountInstruction(
        creatorLpAddress,
        exploiterCreator.publicKey,
        exploiterCreator.publicKey
      );

      const burnCreatorLpAccountIx = createBurnInstruction(
        creatorLpAddress,
        lpMint,
        exploiterCreator.publicKey,
        creatorLpState.amount
      );

      const beforePartnerBalance = await context.banksClient.getBalance(
        exploiterPartner.publicKey
      );

      const beforeCreatorBalance = await context.banksClient.getBalance(
        exploiterCreator.publicKey
      );

      const [lastestBlockhash, lastestLastValidBlockHeight] =
        await context.banksClient.getLatestBlockhash();
      const tx = new Transaction({
        blockhash: lastestBlockhash,
        lastValidBlockHeight: Number(lastestLastValidBlockHeight.toString()),
      }).add(
        burnCreatorLpAccountIx,
        burnPartnerLpAccountIx,
        closeCreatorLpAccountIx,
        closePartnerLpAccountIx
      );

      tx.sign(exploiterCreator, exploiterPartner);

      await context.banksClient.processTransaction(tx);

      const afterPartnerBalance = await context.banksClient.getBalance(
        exploiterPartner.publicKey
      );

      const afterCreatorBalance = await context.banksClient.getBalance(
        exploiterCreator.publicKey
      );

      const partnerLamportRecovered =
        afterPartnerBalance - beforePartnerBalance;
      const creatorLamportRecovered =
        afterCreatorBalance - beforeCreatorBalance;

      const totalLamportRecovered =
        partnerLamportRecovered + creatorLamportRecovered;

      console.log(
        "Total creation rent (SOL): ",
        Number(totalCreationRent) / 1e9
      );
      console.log(
        "Total recovered rent (SOL): ",
        Number(totalLamportRecovered) / 1e9
      );

      console.log(
        "Earning (SOL): ",
        Number(totalLamportRecovered - totalCreationRent) / 1e9
      );

      expect(totalCreationRent > totalLamportRecovered).to.be.true;
    }

    it("spl-token", async () => {
      await dammV1FarmSolFailure(async () => {
        return createPoolWithSplToken(context.banksClient, program, {
          poolCreator: exploiterCreator,
          payer: exploiterCreator,
          quoteMint,
          config: migrateDammV1Config,
          instructionParams: {
            name: "test token spl",
            symbol: "TEST",
            uri: "https://example.com",
          },
        });
      });
    });
  });

  describe("Farm rent fee DAMM v2", async () => {
    async function dammV2FarmSolFailure(
      createPoolFn: () => Promise<PublicKey>,
      assertCreationFeeCharged: boolean = true
    ) {
      let totalCreationRent = BigInt(0);

      const beforeBalance = await context.banksClient.getBalance(
        exploiterCreator.publicKey
      );

      const virtualPool = await createPoolFn();

      let virtualPoolState = await getVirtualPool(
        context.banksClient,
        program,
        virtualPool
      );

      if (assertCreationFeeCharged) {
        expect(virtualPoolState.creationFeeBits).to.be.equal(1);
      } else {
        expect(virtualPoolState.creationFeeBits).to.be.equal(0);
      }

      const configState = await getConfig(
        context.banksClient,
        program,
        virtualPoolState.config
      );

      const afterBalance = await context.banksClient.getBalance(
        exploiterCreator.publicKey
      );

      // Include tx fee
      const lamportUsed = beforeBalance - afterBalance;
      totalCreationRent += lamportUsed;

      await swap2(context.banksClient, program, {
        inputTokenMint: quoteMint,
        outputTokenMint: virtualPoolState.baseMint,
        config: virtualPoolState.config,
        payer: exploiterCreator,
        amount0: configState.migrationQuoteThreshold
          .mul(new BN(120))
          .div(new BN(100)),
        amount1: new BN(0),
        swapMode: 1, // Partial fill
        pool: virtualPool,
        referralTokenAccount: null,
      });

      await createMeteoraDammV2Metadata(context.banksClient, program, {
        payer: migrator,
        virtualPool,
        config: virtualPoolState.config,
      });

      const poolAuthority = derivePoolAuthority();
      const dammV2Config = await createDammV2Config(
        context.banksClient,
        admin,
        poolAuthority
      );
      const migrationParams: MigrateMeteoraDammV2Params = {
        payer: migrator,
        virtualPool,
        dammConfig: dammV2Config,
      };

      const { dammPool, firstPosition, secondPosition } = await migrateToDammV2(
        context.banksClient,
        program,
        migrationParams
      );

      const lamportRecovered = await withdrawAndClosePosition(
        context.banksClient,
        firstPosition,
        dammPool,
        exploiterCreator
      );

      const lamportRecovered2 = await withdrawAndClosePosition(
        context.banksClient,
        secondPosition,
        dammPool,
        exploiterPartner
      );

      console.log(
        "Total creation rent (SOL): ",
        Number(totalCreationRent) / 1e9
      );

      console.log(
        "Recovered rent (creator) (SOL): ",
        Number(lamportRecovered) / 1e9
      );

      console.log(
        "Recovered rent (partner) (SOL): ",
        Number(lamportRecovered2) / 1e9
      );

      const totalLamportRecovered = lamportRecovered + lamportRecovered2;

      console.log(
        "Total rent recovered (SOL): ",
        Number(totalLamportRecovered) / 1e9
      );

      console.log(
        "Earning (SOL): ",
        Number(totalLamportRecovered - totalCreationRent) / 1e9
      );

      expect(totalCreationRent > totalLamportRecovered).to.be.true;
    }

    it("spl-token", async () => {
      await dammV2FarmSolFailure(async () => {
        return createPoolWithSplToken(context.banksClient, program, {
          poolCreator: exploiterCreator,
          payer: exploiterCreator,
          quoteMint,
          config: migrateDammV2Config,
          instructionParams: {
            name: "",
            symbol: "",
            uri: "",
          },
        });
      }, false);
    });

    it("token-2022", async () => {
      await dammV2FarmSolFailure(async () => {
        return createPoolWithToken2022(context.banksClient, program, {
          poolCreator: exploiterCreator,
          payer: exploiterCreator,
          quoteMint,
          config: migrateDammV1ConfigToken2022,
          instructionParams: {
            name: "",
            symbol: "",
            uri: "",
          },
        });
      });
    });
  });
});

async function withdrawAndClosePosition(
  banksClient: BanksClient,
  position: PublicKey,
  pool: PublicKey,
  signer: Keypair
): Promise<bigint> {
  const dammV2Program = createDammV2Program();
  const poolAccount = await banksClient.getAccount(pool);
  const poolState: Pool = dammV2Program.coder.accounts.decode(
    "pool",
    Buffer.from(poolAccount.data)
  );

  const positionAccount = await banksClient.getAccount(position);
  const positionState: Position = dammV2Program.coder.accounts.decode(
    "position",
    Buffer.from(positionAccount.data)
  );

  const tokenAProgram =
    poolState.tokenAFlag == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  const tokenAAccount = getAssociatedTokenAddressSync(
    poolState.tokenAMint,
    signer.publicKey,
    true,
    tokenAProgram
  );

  const createTokenAAccountIx =
    createAssociatedTokenAccountIdempotentInstruction(
      signer.publicKey,
      tokenAAccount,
      signer.publicKey,
      poolState.tokenAMint,
      tokenAProgram
    );

  const tokenBProgram =
    poolState.tokenBFlag == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;

  const tokenBAccount = getAssociatedTokenAddressSync(
    poolState.tokenBMint,
    signer.publicKey,
    true,
    tokenBProgram
  );

  const createTokenBAccountIx =
    createAssociatedTokenAccountIdempotentInstruction(
      signer.publicKey,
      tokenBAccount,
      signer.publicKey,
      poolState.tokenBMint,
      tokenBProgram
    );

  const [lastestBlockhash, lastestLastValidBlockHeight] =
    await banksClient.getLatestBlockhash();

  const positionNftAccount = derivePositionNftAccount(positionState.nftMint);
  const createTx = new Transaction({
    blockhash: lastestBlockhash,
    lastValidBlockHeight: Number(lastestLastValidBlockHeight.toString()),
  }).add(createTokenAAccountIx, createTokenBAccountIx);
  createTx.sign(signer);
  await banksClient.processTransaction(createTx);

  const withdrawIx = await dammV2Program.methods
    .removeAllLiquidity(new BN(0), new BN(0))
    .accountsPartial({
      pool,
      position,
      owner: signer.publicKey,
      tokenAAccount,
      tokenBAccount,
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAVault: poolState.tokenAVault,
      tokenBVault: poolState.tokenBVault,
      positionNftAccount,
      tokenAProgram,
      tokenBProgram,
      poolAuthority: deriveDammV2PoolAuthority(),
    })
    .instruction();

  const closePositionIx = await dammV2Program.methods
    .closePosition()
    .accountsPartial({
      positionNftAccount,
      positionNftMint: positionState.nftMint,
      pool,
      position,
      rentReceiver: signer.publicKey,
      owner: signer.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      poolAuthority: deriveDammV2PoolAuthority(),
    })
    .instruction();

  const beforeBalance = await banksClient.getBalance(signer.publicKey);

  const closeTx = new Transaction({
    blockhash: lastestBlockhash,
    lastValidBlockHeight: Number(lastestLastValidBlockHeight.toString()),
  }).add(withdrawIx, closePositionIx);

  closeTx.sign(signer);
  await banksClient.processTransaction(closeTx);

  const afterBalance = await banksClient.getBalance(signer.publicKey);

  return afterBalance - beforeBalance;
}
