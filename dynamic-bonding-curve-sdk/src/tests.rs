use std::fs;

use dynamic_bonding_curve::state::{PoolConfig, VirtualPool};

fn get_accounts() -> (PoolConfig, VirtualPool) {
    let account_data = fs::read(&"./fixtures/config.bin").expect("Failed to read account data");

    let mut data_without_discriminator = account_data[8..].to_vec();
    let config_state: &PoolConfig = bytemuck::from_bytes(&mut data_without_discriminator);

    let account_data = fs::read(&"./fixtures/pool.bin").expect("Failed to read account data");

    let mut data_without_discriminator = account_data[8..].to_vec();
    let pool_state: &VirtualPool = bytemuck::from_bytes_mut(&mut data_without_discriminator);

    (*config_state, *pool_state)
}

#[test]
fn test_quote_exact_out() {
    let (config, pool) = get_accounts();
}
