import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import IDL from "./idl/release_0.1.6.json";

async function main() {
  const connection = new Connection(
    process.env.RPC_ENDPOINT || "https://api.mainnet-beta.solana.com",
    "confirmed"
  );
  const dbcProgramId = new PublicKey(
    "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"
  );

  console.log("Fetching Config Accounts...");

  const configAccountDisc = Buffer.from([26, 108, 14, 123, 116, 230, 129, 43]);

  const configAccounts = await connection.getProgramAccounts(dbcProgramId, {
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: bs58.encode(configAccountDisc),
        },
      },
    ],
  });

  console.log("Total Config Accounts:", configAccounts.length);

  const program = new Program(
    IDL as any,
    new AnchorProvider(connection, new Wallet(Keypair.generate()))
  );

  const parsedConfigAccounts = configAccounts.map(({ pubkey, account }) => {
    const decodedAccount = program.coder.accounts.decode(
      "poolConfig",
      account.data
    );

    return {
      pubkey,
      account: decodedAccount,
    };
  });

  let minLockedLpPercentage = 100;
  let forfeitedConfigCount = 0;

  for (const { account } of parsedConfigAccounts) {
    const sumLockedLpPercentage =
      account.partnerLockedLpPercentage + account.creatorLockedLpPercentage;

    if (sumLockedLpPercentage > 0) {
      if (sumLockedLpPercentage < minLockedLpPercentage) {
        minLockedLpPercentage = sumLockedLpPercentage;
      }
    } else {
      forfeitedConfigCount++;
    }
  }

  console.log(`Minimum Locked LP Percentage: ${minLockedLpPercentage}%`);
  console.log(`Forfeited Config Accounts: ${forfeitedConfigCount}`);
}

main().catch(console.error);
