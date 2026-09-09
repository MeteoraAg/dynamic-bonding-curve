import { PublicKey } from "@solana/web3.js";
import { LiteSVM } from "litesvm";

export const METEORA_DAMM_MIGRATION_OPTION = 0;

// 8 bytes disc + 32 bytes quote_mint + 32 bytes fee_claimer + 32 bytes leftover_receiver
// + 80 bytes pool_fees + 16 bytes partner_liquidity_vesting_info
// + 16 bytes creator_liquidity_vesting_info + 14 bytes padding_0 + 2 bytes padding_1
// + 1 byte collect_fee_mode
const CONFIG_MIGRATION_OPTION_OFFSET =
  8 + 32 + 32 + 32 + 80 + 16 + 16 + 14 + 2 + 1;

// Overwrite a config's migration option with the deprecated DAMM v1 option
export function setDeprecatedMeteoraDammConfig(
  svm: LiteSVM,
  config: PublicKey
) {
  const account = svm.getAccount(config);
  if (!account) {
    throw new Error(`Config ${config.toBase58()} does not exist`);
  }

  const data = Buffer.from(account.data);
  if (data.length <= CONFIG_MIGRATION_OPTION_OFFSET) {
    throw new Error(
      `Config ${config.toBase58()} is too small to hold a migration option`
    );
  }
  data.writeUInt8(
    METEORA_DAMM_MIGRATION_OPTION,
    CONFIG_MIGRATION_OPTION_OFFSET
  );

  svm.setAccount(config, {
    data: new Uint8Array(data),
    executable: account.executable,
    lamports: account.lamports,
    owner: account.owner,
  });
}
