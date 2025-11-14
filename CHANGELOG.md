# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `create_config_for_dammv2_migration` endpoint to allow create `PoolConfig` account for only DAMM v2 migration with LP vesting configuration.
- `creator_lp_vesting_info` and `partner_lp_vesting_info` fields. Only applicable to DAMM v2 migration option. It store vesting parameters required for `lock_position` cpi during DAMM v2 migration.

### Removed

- Removed `protocol_fee_percentage` and `referral_fee_percentage` fields from `PoolFeesConfig`. Will be using defined constant `PROTOCOL_FEE_PERCENTAGE` and `HOST_FEE_PERCENTAGE` as replacement.

### Changed

- `migration_damm_v2` endpoint require `vesting` account for `first_position` and `second_position` if LP vesting was configured.
- Increase migration fee for DAMMv2 token2022 pool from `0.01` to `0.015` SOL due to user able to get more lamports by closing `vesting` account from `lock_position`.

### Changed

### Deprecated

### Removed

### Fixed

### Security

### Breaking Changes

## dynamic_bonding_curve [0.1.8] [PR #151](https://github.com/MeteoraAg/dynamic-bonding-curve/pull/151)

### Added

- Add new endpoint `claim_partner_pool_creation_fee` to allow partners to withdraw the pool creation fee.
- Add new endpoint `claim_protocol_pool_creation_fee` to allow protocol to withdraw the pool creation fee.

### Changed

- Allowed partners to configure the `pool_creation_fee` when creating a config. The value is in SOL lamport, so when token creator create pool (throught endpoint `initialize_virtual_pool_with_spl_token` and `initialize_virtual_pool_with_token2022`), they would need to pay `pool_creation_fee` in SOL lamport. Later partner would be able to claim that fee (Meteora would take 10% from that fee)
- Update field `creation_fee_bits` to field `legacy_creation_fee_bits` in pool account state
- Removed the legacy pool creation fee logic from the `initialize_virtual_pool_with_token2022` endpoint.

### Breaking Changes

All breaking changes are related to admin/operator functions

- Remove endpoint `withdraw_lamports_from_pool_authority`
- Change endpoint `claim_pool_creation_fee` to new endpoint `claim_legacy_pool_creation_fee`
- Add new `payer` account in admin endpoint `create_claim_fee_operator`, that allow to payer to pay rent fee, instead of admin
- Add new accounts `signer` and `claim_fee_operator` in endpoint `protocol_withdraw_surplus`, move the endpoint to permissioned

## dynamic_bonding_curve [0.1.7] [PR #129](https://github.com/MeteoraAg/dynamic-bonding-curve/pull/129)

### Changed

- A pool creation fee of 0.01 SOL will be charged if the pool `collect_fee_mode` is `CollectFeeMode::OutputToken` and `base_mint` is `token_2022` (endpoint: `initialize_virtual_pool_with_token2022`)
- Optimize SOL transferred to pool authority during migration by transferring only necessary needed amount. Implement flash rent in migration to damm and damm v2 as well as create locker that requires at least 1 SOL in `pool authority`
- Increase max migrate fee to 99%

### Added

- Adding new endpoint `claim_pool_creation_fee` to claim pool creation fee charged to treasury
- Adding new endpoint `withdraw_lamports_from_pool_authority` to withdraw excessive lamports to treasury

### Deprecated

- Endpoint `migration_damm_v2_create_metadata` and `migration_metadata` account, migrator doesn't need `migration_metadata` anymore in damm v2

### Fixed

- Using `saturating_sub` instead of `safe_sub` for `elapsed` calculation
- Rate limiter is not apply for swap2
- Validating base fee for rate limiter

### Breaking Changes

- Swap ExactIn and SwapExactOut won't take surplus for the last swap, instead of returning error if `pool.sqrt_price` is over `migration_sqrt_price`
- Changing min base fee from 1 bps (0.01%) to 25 bps (0.25%). Effected to endpoints: `create_config`, `initialize_virtual_pool_with_spl_token` and `initialize_virtual_pool_with_token2022`. Not able to work if min base fee less than 25 bps.

## dynamic_bonding_curve [0.1.6] [PR #119](https://github.com/MeteoraAg/dynamic-bonding-curve/pull/119)

### Added

- Add new endpoint `swap2`, that includes 3 `swap_mode`: 0 (ExactIn), 1 (PartialFill) and 2 (ExactOut)
- Emit new event in 2 swap endpoints `EvtSwap2`, that includes more information about `quote_reserve_amount`, `migration_threshold` and `included_fee_input_amount`

## dynamic_bonding_curve [0.1.5] [PR #113](https://github.com/MeteoraAg/dynamic-bonding-curve/pull/113)

### Added

- Allow more option for migration fee on Damm V2, and partner can config a customizable fee when token is migrated.
- Migrator needs to check the new value for `migration_fee_option`, if the value is 6 (Customizable), then need to use the new config key for DammV2 migration (A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck)
- Emit new event when partner create a new config key, that includes more information: `EvtCreateConfigV2`

## dynamic_bonding_curve [0.1.4] [PR #100](https://github.com/MeteoraAg/dynamic-bonding-curve/pull/100)

### Added

- Allow more options for token authority configuration: `PartnerUpdateAuthority`, `CreatorUpdateAndMintAuthority` and `PartnerUpdateAndMintAuthority`

## dynamic_bonding_curve [0.1.3] [PR #89](https://github.com/MeteoraAg/dynamic-bonding-curve/pull/89)

### Added

- Allow partner to config another mode for base fee, called rate limiter. With the mode is enable, fee slope will increase if user buy with higher amount. The rate limiter mode is only available if collect fee mode is in quote token only, and when user buy token (not sell). Rate limiter doesn't allow user to send multiple swap instructions (or CPI) to the same pool in 1 transaction

### Changed

- In base fee, we rename: `reduction_factor` to `third_factor`, `period_frequency` to `second_factor`, `number_of_period` to `first_factor`.
- Add a new field `base_fee_mode` in base fee state, that indicates whether the base fee is fee scheduler or rate limiter

### Breaking Changes

- Update max fee to 99%
- In swap instruction, if rate limiter is enable, user need to submit `instruction_sysvar_account` in remaining account, otherwise transaction will be failed
- Quote function can be changed by rate limiter and updated max fee

## dynamic_bonding_curve [0.1.2] [PR #87](https://github.com/MeteoraAg/dynamic-bonding-curve/pull/87)

### Added

- Add new endpoint `transfer_pool_creator` to allow pool creator to transfer to new creator
- When creating config, partner can specify the field `token_update_authority`. 0: creator can update token metadata, 1: creator can't update token metadata
- Allow partner to config migration fee, add new endpoint `withdraw_migration_fee`, so partner and creator can withdraw migration fee

### Changed

- Config state add a new field: `token_update_authority`, `migration_fee_percentage` and `creator_migration_fee_percentage`

## dynamic_bonding_curve [0.1.1] [PR #71](https://github.com/MeteoraAg/dynamic-bonding-curve/pull/71)

### Added

- Allow more migrated fee options (4% and 6%)
- Allow partner to specify `creator_trading_fee_percentage` when creating config key. Trading fee and surplus will be shared between partner and creator.
- Creator can claim trading fee and surplus through 2 endpoints: `claim_creator_trading_fee` and `creator_withdraw_surplus`

### Changed

- Rename `trading_base_fee` to `partner_base_fee` and `trading_quote_fee` to `partner_quote_fee` in VirtualPool state
- Add new field `creator_base_fee` and `creator_quote_fee` to track creator trading fee in VirtualPool state
