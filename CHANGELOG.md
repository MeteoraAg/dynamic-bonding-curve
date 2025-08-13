# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

### Breaking Changes

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