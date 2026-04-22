import { BN } from "@anchor-lang/core";
import { NATIVE_MINT } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import {
  claimProtocolFee2,
  createPoolWithSplToken,
  swap,
  SwapMode,
} from "./instructions";
import {
  createDbcConfig,
  createVirtualCurveProgram,
  expectThrowsAsync,
  generateAndFund,
  getOrCreateAta,
  startSvm,
} from "./utils";
import { wrapSOL } from "./utils/token";
import { getConfig, getVirtualPool } from "./utils/fetcher";
import { VirtualCurveProgram } from "./utils/types";

import { LiteSVM } from "litesvm";

const ANCHOR_CONSTRAINT_ADDRESS_ERROR = "ConstraintAddress";

describe("Claim protocol fee 2", () => {
  let svm: LiteSVM;
  let admin: Keypair;
  let operator: Keypair;
  let partner: Keypair;
  let poolCreator: Keypair;
  let program: VirtualCurveProgram;
  let config: PublicKey;
  let virtualPool: PublicKey;

  before(async () => {
    svm = startSvm();
    admin = generateAndFund(svm);
    operator = generateAndFund(svm);
    partner = generateAndFund(svm);
    poolCreator = generateAndFund(svm);
    program = createVirtualCurveProgram();

    config = await createDbcConfig(
      svm,
      program,
      1,
      6,
      { poolFeeBps: 100, collectFeeMode: 0, dynamicFee: 0 },
      partner
    );

    virtualPool = await createPoolWithSplToken(svm, program, {
      payer: poolCreator,
      poolCreator,
      quoteMint: NATIVE_MINT,
      config,
      instructionParams: {
        name: "test token spl",
        symbol: "TEST",
        uri: "abc.com",
      },
    });

    const baseMint = getVirtualPool(svm, program, virtualPool).baseMint;

    wrapSOL(svm, poolCreator, new BN(LAMPORTS_PER_SOL * 10));

    const swapBuy = {
      config,
      payer: poolCreator,
      pool: virtualPool,
      inputTokenMint: NATIVE_MINT,
      outputTokenMint: baseMint,
      amountIn: new BN(LAMPORTS_PER_SOL * 2),
      minimumAmountOut: new BN(0),
      swapMode: SwapMode.PartialFill,
      referralTokenAccount: null,
    };

    const swapSell = {
      config,
      payer: poolCreator,
      pool: virtualPool,
      inputTokenMint: baseMint,
      outputTokenMint: NATIVE_MINT,
      amountIn: new BN(1_000_000),
      minimumAmountOut: new BN(0),
      swapMode: SwapMode.PartialFill,
      referralTokenAccount: null,
    };

    await swap(svm, program, swapBuy);
    await swap(svm, program, swapSell);

    const poolState = getVirtualPool(svm, program, virtualPool);
    expect(poolState.protocolBaseFee.gtn(0)).to.be.true;
    expect(poolState.protocolQuoteFee.gtn(0)).to.be.true;
  });

  it("rejects when signed by operator (not protocol_fee_authority)", async () => {
    const configState = getConfig(svm, program, config);

    const receiverTokenAccount = getOrCreateAta(
      svm,
      operator,
      configState.quoteMint,
      admin.publicKey
    );

    await expectThrowsAsync(
      () =>
        claimProtocolFee2(svm, program, {
          signerKP: operator,
          pool: virtualPool,
          isTokenBase: false,
          receiverTokenAccount,
        }),
      ANCHOR_CONSTRAINT_ADDRESS_ERROR
    );
  });

  it("rejects when signed by admin", async () => {
    const configState = getConfig(svm, program, config);

    const receiverTokenAccount = getOrCreateAta(
      svm,
      admin,
      configState.quoteMint,
      admin.publicKey
    );

    await expectThrowsAsync(
      () =>
        claimProtocolFee2(svm, program, {
          signerKP: admin,
          pool: virtualPool,
          isTokenBase: true,
          receiverTokenAccount,
        }),
      ANCHOR_CONSTRAINT_ADDRESS_ERROR
    );
  });
});
