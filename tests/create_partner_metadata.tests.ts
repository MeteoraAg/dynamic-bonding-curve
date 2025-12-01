import { Keypair } from "@solana/web3.js";
import { LiteSVM } from "litesvm";
import { createPartnerMetadata } from "./instructions";
import { createVirtualCurveProgram, generateAndFund, startSvm } from "./utils";
import { VirtualCurveProgram } from "./utils/types";

describe("Create partner metadata", () => {
  let svm: LiteSVM;
  let partner: Keypair;
  let user: Keypair;
  let program: VirtualCurveProgram;

  before(async () => {
    svm = startSvm();
    user = generateAndFund(svm);
    partner = Keypair.generate();
    program = createVirtualCurveProgram();
  });

  it("Partner create a metadata", async () => {
    await createPartnerMetadata(svm, program, {
      name: "Moonshot",
      website: "moonshot.com",
      logo: "https://raw.githubusercontent.com/MeteoraAg/token-metadata/main/meteora_permission_lp.png",
      feeClaimer: partner,
      payer: user,
    });
  });
});
