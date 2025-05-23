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

## dynamic_bonding_curve [0.1.1] [PR #71](https://github.com/MeteoraAg/dynamic-bonding-curve/pull/71)


### Added
- Allow more migrated fee options (4% and 6%)
- Allow partner to specify `creator_trading_fee_percentage` when creating config key. Trading fee and surplus will be shared between partner and creator.
- Creator can claim trading fee and surplus through 2 endpoints: `claim_creator_trading_fee` and `creator_withdraw_surplus`


### Changed
- Rename `trading_base_fee` to `partner_base_fee` and `trading_quote_fee` to `partner_quote_fee` in VirtualPool state
- Add new field `creator_base_fee` and `creator_quote_fee` to track creator trading fee in VirtualPool state