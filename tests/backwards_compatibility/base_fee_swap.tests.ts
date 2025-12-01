import { NATIVE_MINT } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import { expect } from "chai";
import { LiteSVM } from "litesvm";
import { createVirtualCurveProgram, generateAndFund, startSvm } from "../utils";
import { VirtualCurveProgram } from "../utils/types";
import {
  createConfigSplTokenWithBaseFeeParameters,
  createConfigSplTokenWithBaseFeeParametersParams,
} from "./instructions/partnerInstructions";

describe("Backwards compatibility - PoolConfig account", () => {
  let svm: LiteSVM;
  let user: Keypair;
  let program: VirtualCurveProgram;

  before(async () => {
    svm = startSvm();
    user = generateAndFund(svm);
    program = createVirtualCurveProgram();
  });

  it("Check if account has fields where expected", async () => {
    const configSplTokenParams: createConfigSplTokenWithBaseFeeParametersParams =
      {
        payer: user,
        leftoverReceiver: user.publicKey,
        feeClaimer: user.publicKey,
        quoteMint: NATIVE_MINT,
      };
    const configSplToken = await createConfigSplTokenWithBaseFeeParameters(
      svm,
      program,
      configSplTokenParams
    );

    const account = svm.getAccount(configSplToken);
    const data = Buffer.from(account.data);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    // 8 bytes disc + 32 bytes quote_mint + 32 bytes fee_claimer + 32 bytes leftover_receiver
    const baseFeeOffset = 8 + 32 + 32 + 32;

    const cliffFeeNumerator = view.getBigUint64(baseFeeOffset, true);
    const periodFrequency = view.getBigUint64(baseFeeOffset + 8, true); // second factor | period_frequency
    const reductionFactor = view.getBigUint64(baseFeeOffset + 16, true); // third factor | reduction_factor
    const numberOfPeriod = view.getUint16(baseFeeOffset + 24, true); // first factor | number_of_period
    const feeSchedulerMode = view.getUint8(baseFeeOffset + 26); // base fee mode

    expect(cliffFeeNumerator).eq(BigInt(10_000_000));
    expect(periodFrequency).eq(BigInt(3));
    expect(reductionFactor).eq(BigInt(14));
    expect(numberOfPeriod).eq(10);
    expect(feeSchedulerMode).eq(0);
  });
});
