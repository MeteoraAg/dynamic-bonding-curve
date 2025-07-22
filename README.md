# Dynamic Bonding Curve

The Dynamic Bonding Curve program is a launch pool protocol that allows any launch partners to enable their users to launch tokens with customizable virtual curves directly on their platforms. With direct integration into Jupiter and other trading platforms, traders can trade these launch tokens immediately across all these integrations. The Virtual Cuvre program provides a few benefits:

- Launch partners can have different configurations for their launch pools, for example, customizable quote token (SOL/USDC/etc), customizable curve for token graduation, customizable fees, etc.
- Users on these launch platforms can easily create tokens and launch pools directly with the partners' configurations directly on their partners' UI.
- Trading platforms/bots can immediately trade on these tokens with our direct integrations.
- Tokens will graduate to various AMM (rightnow we only support Meteora DAMM v1 and Meteora DAMM v2), based on partner configuration. With locked LP tokens, launchers can claim fees on the locked LPs.
- Full API supports for easy integration for launch partners and trading platforms/bots.

## Notable Features

- multiple quote tokens support: SOL, USDC, etc
- SPL Token and Token2022 support
- fee scheduler/rate limiter + dynamic-fee
- flexible fee collect mode (ex: collect fee only in quote token)
- customizable liquidity distribution (up to 20 price ranges with different liquidity curve)

## Customizable Fees

- Virtual pool will collect trading fee evey time user trade with that pool (buy or sell).
- A percentage of trading fee will be paid to the Dynamic Bonding Curve protocol. A swap host (Jupiter/Photon/Trading bots) can submit the swap transaction with a referal account to get some referal fee as part of protocol fee. The rest of trading fee belongs to partner.
- After token has graduated and is migrated, LP is locked for partner and token creator. The ratio of the locked LP is based on what partner has configured in the configuration. With this, partner and token creator can claim fees based on the locked LP on Meteora DAMM.
- The last swap will create a surplus on quote token, that will be shared between the partner and the protocol.

## Customizable Pool Configuration

Partner can specify these parameters when they create a configuration on all their pools:

- `pool_fees`: include `base_fee` and `dynamic_fee` (optional). Partner can add fee scheduler or rate limiter in `base_fee` or just a fixed fee. `pool_fees` defines the trading fee for any pool that is created from this configuration.
- `collect_fee_mode` (`0 | 1`): `0` means the virtual pool will only collect fee in quote token, `1` means virtual pool will collect fee in both tokens.
- `migration_option` (`0 | 1`):  `0` means DammV1 and `1` means DammV2
- `activation_type` (`0 | 1`): `0` means slot, `1` means timestamp, this field indicates the time unit that pool will work with, mostly in calculating fee scheduler/ rate limiter and dynamic fee.
- `token_type` (`0 | 1`): `0` means SPL Token, `1` means Token2022.
- `token_decimal`: the token decimals that the token will use when user creates the virtual pool with this configuration, we only support token decimals from 6 to 9.
- `partner_lp_percentage`: the percentage of LP that partner can claim after token is migrated.
- `partner_locked_lp_percentage`: the percentage of LP that partner will locked after token is migrated.
- `creator_lp_percentage`: the percentage of LP that creator can claim after token is migrated.
- `creator_locked_lp_percentage`: the percentage of LP that creator will be locked after token is migrated.
- `migration_quote_threshold`: the threhold for quote token, that after virtual pool reserve get such quote token amount, the token will graduate from the launch pool and will be migrated.
- `fee_claimer`: the address of partner that can claim trading fees from the virtual pools as well as fees from the locked LPs.
- `owner`: owner of the configuration.
- `quote_mint`: the quote mint address that virtual pool will support.
- `locked_vesting`: locked vesting for creator after token is migrated (token will be migrated to [Jup lock](https://lock.jup.ag/))
- `migration_fee_option`: allow partner to choose a fee option on graduated pool (currently support 0.25% | 0.3% | 1% | 2% | 4% | 6% | Customizable (only for DammV2 migration))
- `migrated_pool_fee`: allow partner to choose fees on migration pool, that param is only valid if `migration_fee_option == Customizable` and `migration_option == 1` (DammV2 migration)
- `token_supply`: when the fields are specified, token will have fixed supply in pre and post migration, leftover will be returned to leftover_receiver (configured in config key)
- `creator_trading_fee_percentage`: the percentage of trading fee and surplus pool creator can get for a pool
- `token_update_authority`: the option to allow creator/partner to config token authority, 0: creator can update token metadata, 1: immutable, 2: partner can update token metadata, 3: creator can update token metadata and mint token, 4: partner can update token metadata and mint token.
- `migration_fee`: the option to allow partner can config migration fee from migration quote threshold. Migration fee can be shared between partner and creator
- `sqrt_start_price`: square root of min price in the bonding curve for the virtual pools.
- `curve`: an array of square price and liquidity, that defines the liquidity distribution for the virtual pools.

## Bonding Curve

A simple constant product `x * y = virtual_base_reserve * virtual_curve_reserve` can be presented as `x * y = liquidity * liquidity`, while `liquidity = sqrt(virtual_base_reserve * virtual_curve_reserve)`. With a contraint on `migration_quote_threshold`, it can be presented as a function of `liquidity`, `min_price`, `max_price`. We denote `liquidity = l`, `min_price = pa`, `max_price = pb`. So we have:

`bonding_curve_constant_product = function(l, pa, pb)`

On our dynamic bonding curve protocol:

`bonding_curve = function([l_i, pa_i, pb_i])`

That means partner can configure a bonding curve with any liquidity distribution up on their strategy.

For example, if the pool has this configuration:

- `sqrt_start_price = 1`
- `curve = [sqrt_price = 2, liquidity = 100), (sqrt_price = 4, liquidity = 500)]`

Then the bonding curve will function of 2 price ranges: `(l = 100, pa = 1, pb = 2)` and `(l = 500, pa = 2, pb = 4)`.

## Development

### Dependencies

- anchor 0.31.0
- solana 2.1.0
- rust 1.79.0

### Build

Program

```
anchor build -p dynamic_bonding_curve
```

### Test

```
pnpm install
pnpm test
```

### Program Address

- Mainnet-beta: dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN
- Devnet: dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN


### Config key for migration 

#### Meteora damm (v1):
- migration_fee_option == 0: 8f848CEy8eY6PhJ3VcemtBDzPPSD4Vq7aJczLZ3o8MmX
- migration_fee_option == 1: HBxB8Lf14Yj8pqeJ8C4qDb5ryHL7xwpuykz31BLNYr7S
- migration_fee_option == 2: 7v5vBdUQHTNeqk1HnduiXcgbvCyVEZ612HLmYkQoAkik
- migration_fee_option == 3: EkvP7d5yKxovj884d2DwmBQbrHUWRLGK6bympzrkXGja
- migration_fee_option == 4: 9EZYAJrcqNWNQzP2trzZesP7XKMHA1jEomHzbRsdX8R2
- migration_fee_option == 5: 8cdKo87jZU2R12KY1BUjjRPwyjgdNjLGqSGQyrDshhud

#### Damm v2:
- migration_fee_option == 0: 7F6dnUcRuyM2TwR8myT1dYypFXpPSxqwKNSFNkxyNESd
- migration_fee_option == 1: 2nHK1kju6XjphBLbNxpM5XRGFj7p9U8vvNzyZiha1z6k
- migration_fee_option == 2: Hv8Lmzmnju6m7kcokVKvwqz7QPmdX9XfKjJsXz8RXcjp
- migration_fee_option == 3: 2c4cYd4reUYVRAB9kUUkrq55VPyy2FNQ3FDL4o12JXmq
- migration_fee_option == 4: AkmQWebAwFvWk55wBoCr5D62C6VVDTzi84NJuD9H7cFD
- migration_fee_option == 5: DbCRBj8McvPYHJG1ukj8RE15h2dCNUdTAESG49XpQ44u
- migration_fee_option == 6: A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck


## Audits

The program has been audited. You can find the audit report [here](https://docs.meteora.ag/resources/audits#id-4.-dbc-dynamic-bonding-curve).