import { readFile } from "fs/promises";
import { PublicKey } from "@solana/web3.js";
import { VirtualCurveProgram } from "../utils/types";

export async function readIxData(ix: String): Promise<Buffer> {
	const ixData: Buffer = await readFile(`tests/fixtures/ix_data/ix_data-${ix}.bin`);
	return ixData;
}

export function deriveEventAuthority(program: VirtualCurveProgram): PublicKey {

	const [eventAuthority] = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], program.programId);
	return eventAuthority;
}
