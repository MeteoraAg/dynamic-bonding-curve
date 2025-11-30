import { NATIVE_MINT } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { LiteSVM } from "litesvm";
import { createVirtualCurveProgram, generateAndFund, startSvm } from "../utils";
import { VirtualCurveProgram } from "../utils/types";
import { claimCreatorTradingFee } from "./instructions/creatorInstructions";
import {
  createConfig,
  CreateConfigParams,
  createPartnerMetadata,
} from "./instructions/partnerInstructions";
import {
  CreatePoolToken2022Params,
  createPoolWithSplToken,
  createPoolWithToken2022,
  createVirtualPoolMetadata,
  CreateVirtualPoolMetadataParams,
} from "./instructions/userInstructions";

describe("Backwards compatibility - misc", () => {
  let svm: LiteSVM;
  let user: Keypair;
  let program: VirtualCurveProgram;

  let configToken2022: PublicKey;
  let poolToken2022: PublicKey;
  let configSplToken: PublicKey;
  let poolSplToken: PublicKey;

  before(async () => {
    svm = startSvm();
    user = generateAndFund(svm);
    program = createVirtualCurveProgram();
  });

  it("createConfigSplToken", async () => {
    const configSplTokenParams: CreateConfigParams = {
      payer: user,
      leftoverReceiver: user.publicKey,
      feeClaimer: user.publicKey,
      quoteMint: NATIVE_MINT,
      token2022: false,
    };
    configSplToken = await createConfig(svm, program, configSplTokenParams);
  });

  it("initializeVirtualPoolWithSplToken", async () => {
    const poolSplTokenParams: CreatePoolToken2022Params = {
      payer: user,
      poolCreator: user,
      quoteMint: NATIVE_MINT,
      config: configSplToken,
    };
    poolSplToken = await createPoolWithSplToken(
      svm,
      program,
      poolSplTokenParams
    );
  });

  it("createConfigToken2022", async () => {
    const configToken2022Params: CreateConfigParams = {
      payer: user,
      leftoverReceiver: user.publicKey,
      feeClaimer: user.publicKey,
      quoteMint: NATIVE_MINT,
      token2022: true,
    };
    configToken2022 = await createConfig(svm, program, configToken2022Params);
  });

  it("initializeVirtualPoolWithToken2022", async () => {
    const poolToken2022Params: CreatePoolToken2022Params = {
      payer: user,
      poolCreator: user,
      quoteMint: NATIVE_MINT,
      config: configToken2022,
    };
    poolToken2022 = await createPoolWithToken2022(
      svm,
      program,
      poolToken2022Params
    );
  });

  it("createPartnerMetadata", async () => {
    const metadataParams: CreateVirtualPoolMetadataParams = {
      virtualPool: poolToken2022,
      creator: user,
      payer: user,
    };
    await createVirtualPoolMetadata(svm, program, metadataParams);
  });

  it("createVirtualPoolMetadata", async () => {
    const partnerMetadataParams = {
      payer: user,
      feeClaimer: user,
    };
    await createPartnerMetadata(svm, program, partnerMetadataParams);
  });

  it("claimCreatorTradingFee", async () => {
    const partnerMetadataParams = {
      creator: user,
      pool: poolToken2022,
    };
    await claimCreatorTradingFee(svm, program, partnerMetadataParams);
  });
});
