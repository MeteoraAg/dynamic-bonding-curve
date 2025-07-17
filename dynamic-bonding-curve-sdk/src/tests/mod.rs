use std::fs;

use dynamic_bonding_curve::state::{PoolConfig, VirtualPool};

mod test_quote_exact_out;
mod test_quote_partial_fill;

struct TestAccounts {
    config: PoolConfig,
    pool: VirtualPool,
    current_timestamp: u64,
    current_slot: u64,
}

fn get_fee_in_quote_accounts() -> TestAccounts {
    let account_data =
        fs::read(&"./fixtures/fee_in_quote_config.bin").expect("Failed to read account data");

    let mut data_without_discriminator = account_data[8..].to_vec();
    let &config: &PoolConfig = bytemuck::from_bytes(&mut data_without_discriminator);

    assert!(config.collect_fee_mode == 0); // fee in quote

    let account_data =
        fs::read(&"./fixtures/fee_in_quote_pool.bin").expect("Failed to read account data");

    let mut data_without_discriminator = account_data[8..].to_vec();
    let &pool: &VirtualPool = bytemuck::from_bytes_mut(&mut data_without_discriminator);

    TestAccounts {
        config,
        pool,
        current_timestamp: 1_750_997_303,
        current_slot: 327_665_017,
    }
}

fn get_fee_in_both_accounts() -> TestAccounts {
    let account_data =
        fs::read(&"./fixtures/fee_in_both_config.bin").expect("Failed to read account data");

    let mut data_without_discriminator = account_data[8..].to_vec();
    let &config: &PoolConfig = bytemuck::from_bytes(&mut data_without_discriminator);

    assert!(config.collect_fee_mode == 1); // fee in both

    let account_data =
        fs::read(&"./fixtures/fee_in_both_pool.bin").expect("Failed to read account data");

    let mut data_without_discriminator = account_data[8..].to_vec();
    let &pool: &VirtualPool = bytemuck::from_bytes_mut(&mut data_without_discriminator);

    TestAccounts {
        config,
        pool,
        current_timestamp: 1_752_714_721,
        current_slot: 353797458,
    }
}
