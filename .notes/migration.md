# Anchor v1.0.0 Migration Guide for Solana Programs

> Based on the LB-CLMM (Meteora DLMM) migration from Anchor `0.31.1` to `1.0.0`.
> Covers Rust program changes, TypeScript SDK changes, toolchain upgrades, and CI adjustments.

---

## Table of Contents

1. [Toolchain & Environment Upgrades](#1-toolchain--environment-upgrades)
2. [Cargo.toml & Workspace Changes](#2-cargotoml--workspace-changes)
3. [Anchor.toml Changes](#3-anchortoml-changes)
4. [Rust Program Changes](#4-rust-program-changes)
   - 4.1 [Context Lifetime Simplification](#41-context-lifetime-simplification)
   - 4.2 [CPI Context Changes (`CpiContext::new`)](#42-cpi-context-changes-cpicontextnew)
   - 4.3 [`#[allow(deprecated)]` for Known Anchor Issues](#43-allowdeprecated-for-known-anchor-issues)
   - 4.4 [`pubkey!` Macro Import Removal](#44-pubkey-macro-import-removal)
   - 4.5 [`AccountInfo` Constructor Change (Tests)](#45-accountinfo-constructor-change-tests)
   - 4.6 [`Interface` to `AccountInfo` in Token Transfer Helpers](#46-interface-to-accountinfo-in-token-transfer-helpers)
   - 4.7 [Feature Flags in Cargo.toml](#47-feature-flags-in-cargotoml)
   - 4.8 [Workspace Lints for `unexpected_cfgs`](#48-workspace-lints-for-unexpected_cfgs)
5. [SPL & Solana SDK Dependency Bumps](#5-spl--solana-sdk-dependency-bumps)
6. [TypeScript / Client SDK Changes](#6-typescript--client-sdk-changes)
   - 6.1 [Package Renames](#61-package-renames)
   - 6.2 [Package Manager (npm/pnpm to bun)](#62-package-manager-npmpnpm-to-bun)
   - 6.3 [tsconfig.json Adjustments](#63-tsconfigjson-adjustments)
   - 6.4 [ESM Module Type](#64-esm-module-type)
7. [CI / GitHub Actions Changes](#7-ci--github-actions-changes)
8. [Summary Checklist](#8-summary-checklist)

---

## 1. Toolchain & Environment Upgrades

| Component          | Before   | After               |
| ------------------ | -------- | ------------------- |
| **Anchor CLI**     | `0.31.1` | `1.0.0`             |
| **Solana CLI**     | `2.1.0`  | `3.1.10`            |
| **Rust toolchain** | `1.85.0` | `1.93.0`            |
| **Node.js**        | `20.x`   | Replaced by **Bun** |

**`rust-toolchain.toml`:**

```toml
[toolchain]
channel = "1.93.0"
```

---

## 2. Cargo.toml & Workspace Changes

### 2.1 Workspace Dependencies

Anchor 1.0.0 strongly encourages centralized workspace dependencies. Move all shared dependencies to the workspace `Cargo.toml`:

```toml
# Cargo.toml (workspace root)
[workspace.dependencies]
anchor-lang = { version = "1.0.0" }
anchor-spl = { version = "1.0.0" }
bytemuck = { version = "1.21", features = ["derive", "min_const_generics"] }
ruint = "1.12"
spl-transfer-hook-interface = "2.1.0"
# ... other shared deps
```

Then in each program's `Cargo.toml`, reference workspace dependencies:

```toml
# programs/your_program/Cargo.toml
[dependencies]
anchor-lang = { workspace = true, features = ["event-cpi", "init-if-needed"] }
anchor-spl = { workspace = true, features = ["memo"] }
bytemuck.workspace = true
```

NOTE: DO NOT INCLUDE UNNECESSARY DEPENDENCIES!

### 2.2 New Required Feature Flags

Anchor 1.0.0 introduces new feature flags that must be declared in `Cargo.toml`:

```toml
[features]
# Anchor required features
no-entrypoint = []
no-idl = []
no-log-ix-name = []
cpi = ["no-entrypoint"]
default = []
idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]
custom-heap = []        # NEW in Anchor 1.0
custom-panic = []       # NEW in Anchor 1.0
anchor-debug = []       # NEW in Anchor 1.0
```

### 2.3 Workspace Lints

Add workspace-level lints to suppress common warnings:

```toml
# Cargo.toml (workspace root)
[workspace.lints.rust]
unexpected_cfgs = { level = "warn", check-cfg = [
    'cfg(target_os, values("solana"))',
] }
```

Then in each crate:

```toml
[lints]
workspace = true
```

### 2.4 Solana SDK Bumps (Dev Dependencies)

| Crate                          | Before  | After    |
| ------------------------------ | ------- | -------- |
| `solana-program-test`          | `2.1.0` | `3.1.10` |
| `solana-sdk`                   | `2.1.0` | `3.0.0`  |
| `solana-client`                | `2.1.0` | `3.1.10` |
| `solana-account-decoder`       | `2.1.0` | `3.1.10` |
| `spl-associated-token-account` | `6`     | `8`      |
| `spl-pod`                      | `0.5.1` | `0.7`    |
| `spl-transfer-hook-interface`  | `0.9.0` | `2.1.0`  |

### 2.5 Library Crates

For internal library crates (e.g., `libs/`), add:

```toml
[lib]
doctest = false  # Prevents doctest failures during anchor build

[lints]
workspace = true

[features]
idl-build = ["anchor-lang/idl-build"]  # Required for IDL generation
```

---

## 3. Anchor.toml Changes

```toml
[toolchain]
anchor_version = "1.0.0"
solana_version = "3.1.10"
package_manager = "bun"    # NEW: Anchor 1.0 supports bun natively

[hooks]
# Empty but required section
```

**Removed:**

- `[[test.genesis]]` entries for local program overrides (Token-2022, etc.) -- Anchor 1.0 / Solana 3.x bundles these natively.
- `[scripts]` section -- replaced by `package.json` scripts.

---

## 4. Rust Program Changes

### 4.1 Context Lifetime Simplification

**This is the most widespread change.** Anchor 1.0.0 simplifies the `Context` type to use a single lifetime parameter instead of four.

**Before (Anchor 0.31.x):**

```rust
pub fn swap<'c: 'info, 'info>(
    ctx: Context<'_, '_, 'c, 'info, Swap<'info>>,
    amount_in: u64,
) -> Result<()> { ... }
```

**After (Anchor 1.0.0):**

```rust
pub fn swap<'info>(
    ctx: Context<'info, Swap<'info>>,
    amount_in: u64,
) -> Result<()> { ... }
```

**Migration rule:** Replace all `Context<'a, 'b, 'c, 'info, T<'info>>` with `Context<'info, T<'info>>`, and remove any additional lifetime parameters (`'a`, `'b`, `'c`) from the function signature. Remove lifetime bounds like `'c: 'info`.

This applies to:

- All instruction handler functions in `lib.rs`
- All `handle` functions in instruction modules
- All helper functions that accept `Context`
- Trait implementations that reference Context lifetimes (e.g., `impl<'a, 'b, 'c, 'info> Trait for MyAccounts<'info>` becomes `impl<'info> Trait for MyAccounts<'info>`)

### 4.2 CPI Context Changes (`CpiContext::new`)

Anchor 1.0.0 changes `CpiContext::new` to accept `Pubkey` instead of `AccountInfo` for the program parameter.

**Before:**

```rust
CpiContext::new(
    token_program.to_account_info(),   // AccountInfo
    Transfer { ... },
)
```

**After:**

```rust
CpiContext::new(
    *token_program.key,                // Pubkey
    Transfer { ... },
)
```

This affects all CPI calls including:

- `token::transfer(CpiContext::new(...))`
- `token_2022::transfer_checked(CpiContext::new(...))`
- `memo::build_memo(CpiContext::new(...))`
- Any `CpiContext::new_with_signer(...)` calls

### 4.3 `#[allow(deprecated)]` for Known Anchor Issues

Some Anchor 1.0.0 macros generate deprecated warnings. Add this to `lib.rs`:

```rust
// Ignored due to https://github.com/solana-foundation/anchor/issues/4378
#![allow(deprecated)]
```

This replaces the previous `#![allow(unexpected_cfgs)]` which is now handled via workspace lints.

### 4.4 `pubkey!` Macro Import Removal

The `pubkey!` macro is now directly available from `anchor_lang::prelude::*` without explicit import:

**Before:**

```rust
use anchor_lang::solana_program::pubkey;
// ...
pub const ADMINS: [Pubkey; 1] = [pubkey!("...")];
```

**After:**

```rust
// No import needed -- pubkey! comes from prelude
pub const ADMINS: [Pubkey; 1] = [pubkey!("...")];
```

Similarly, remove `use anchor_lang::solana_program::pubkey;` from `seeds.rs` or any module that used it.

### 4.5 `AccountInfo` Constructor Change (Tests)

In test code, `AccountInfo::new` no longer takes the `rent_epoch` parameter (last argument):

**Before:**

```rust
AccountInfo::new(
    &key,
    false,
    true,
    &mut lamports,
    &mut data.data,
    &data.owner,
    false,
    0,        // rent_epoch -- REMOVED
)
```

**After:**

```rust
AccountInfo::new(
    &key,
    false,
    true,
    &mut lamports,
    &mut data.data,
    &data.owner,
    false,
)
```

### 4.6 `Interface` to `AccountInfo` in Token Transfer Helpers

When writing generic token transfer helpers that work with both Token and Token-2022, the `token_program` parameter type changes:

**Before:**

```rust
pub fn transfer_from_user2<'a, 'c: 'info, 'info>(
    // ...
    token_program: &'a Interface<'info, TokenInterface>,
    // ...
)
```

**After:**

```rust
pub fn transfer_from_user2<'a, 'info>(
    // ...
    token_program: &'a AccountInfo<'info>,
    // ...
)
```

Also, `destination_token_account` in some helpers changes from `&InterfaceAccount<TokenAccount>` to `&AccountInfo`:

```rust
// Before
destination_token_account: &'a InterfaceAccount<'info, TokenAccount>,
// After
destination_token_account: &'a AccountInfo<'info>,
```

### 4.7 Feature Flags in Cargo.toml

Add the new Anchor 1.0 feature flags (`custom-heap`, `custom-panic`, `anchor-debug`) to your program's `Cargo.toml`. See [Section 2.2](#22-new-required-feature-flags).

### 4.8 Workspace Lints for `unexpected_cfgs`

Instead of `#![allow(unexpected_cfgs)]` in lib.rs, use workspace-level configuration:

```toml
# workspace Cargo.toml
[workspace.lints.rust]
unexpected_cfgs = { level = "warn", check-cfg = [
    'cfg(target_os, values("solana"))',
] }
```

---

## 5. SPL & Solana SDK Dependency Bumps

The Solana SDK has been bumped from `2.x` to `3.x`. Key changes:

| Dependency                     | Old Version | New Version |
| ------------------------------ | ----------- | ----------- |
| `anchor-lang`                  | `0.31.1`    | `1.0.0`     |
| `anchor-spl`                   | `0.31.1`    | `1.0.0`     |
| `solana-sdk`                   | `2.1.0`     | `3.0.0`     |
| `solana-program-test`          | `2.1.0`     | `3.1.10`    |
| `solana-client`                | `2.1.0`     | `3.1.10`    |
| `spl-associated-token-account` | `6`         | `8`         |
| `spl-pod`                      | `0.5.1`     | `0.7`       |
| `spl-transfer-hook-interface`  | `0.9.0`     | `2.1.0`     |
| `rand`                         | `0.7.3`     | `0.8`       |
| `proptest`                     | `1.2.0`     | `1.6`       |

New dependency:

- `solana-instructions-sysvar = "3.0.0"` -- may be required for instruction introspection.

---

## 6. TypeScript / Client SDK Changes

### 6.1 Package Renames

Anchor 1.0.0 moves its npm packages from `@coral-xyz/*` to `@anchor-lang/*`:

| Before              | After                |
| ------------------- | -------------------- |
| `@coral-xyz/anchor` | `@anchor-lang/core`  |
| `@coral-xyz/borsh`  | `@anchor-lang/borsh` |

**Update all imports:**

```typescript
// Before
import { BN, Program } from "@coral-xyz/anchor";
import { Event, IdlAccounts, IdlTypes } from "@coral-xyz/anchor";

// After
import { BN, Program } from "@anchor-lang/core";
import { Event, IdlAccounts, IdlTypes } from "@anchor-lang/core";
```

**package.json:**

```json
{
  "dependencies": {
    "@anchor-lang/core": "^1.0.0"
  },
  "devDependencies": {
    "@anchor-lang/borsh": "^1.0.0"
  }
}
```

### 6.2 Package Manager (npm/pnpm to bun)

Anchor 1.0.0 has native bun support. The migration switches from npm/pnpm to bun:

- Delete `package-lock.json` and/or `pnpm-lock.yaml`
- Run `bun install` to generate `bun.lock`
- Update scripts in `package.json`:

```json
{
  "scripts": {
    "build-local": "anchor build --ignore-keys -- --features localnet",
    "test": "ANCHOR_WALLET=keys/localnet/admin.json bunx ts-mocha -p ./tsconfig.json -t 1000000 tests/test_*/*.ts",
    "build-local-test": "bun run build-local && bun run test"
  }
}
```

- Try to update all typescript packages to their latest versions compatible with bun.

NOTE: MAKE SURE ONLY bun.lock IS PRESENT! Remove any `package-lock.json` or `pnpm-lock.yaml` or `yarn.lock` files to avoid confusion.

### 6.3 tsconfig.json Adjustments

You may need to relax TypeScript strictness due to Anchor 1.0 SDK type changes:

```json
{
  "compilerOptions": {
    "strictNullChecks": false,
    "noImplicitAny": false
  }
}
```

### 6.4 ESM Module Type

Add `"type": "module"` to `package.json`:

```json
{
  "type": "module"
}
```

---

## 7. CI / GitHub Actions Changes

Update environment variables:

```yaml
env:
  SOLANA_CLI_VERSION: 3.1.10 # was 2.1.0
  ANCHOR_CLI_VERSION: 1.0.0 # was 0.31.1
  TOOLCHAIN: 1.93.0 # was 1.76.0 / 1.85.0
```

Replace `npm` with `bun`:

```yaml
- uses: oven-sh/setup-bun@v2 # Add bun setup step
- run: bun install # was: npm install
- run: bun run build-local-test # was: npm test
```

Cache key should use `bun.lock` instead of `package-lock.json`:

```yaml
- uses: actions/cache@v4
  with:
    path: ./node_modules
    key: ${{ runner.os }}-${{ hashFiles('./bun.lock') }}
```

Consider caching the Anchor CLI binary to speed up CI:

```yaml
- name: Cache Anchor CLI
  uses: actions/cache@v4
  with:
    path: ~/.cargo/bin/anchor
    key: anchor-cli-${{ runner.os }}-${{ env.ANCHOR_CLI_VERSION }}
```

**Removed:** `[[test.genesis]]` overrides for Token-2022 and other local programs are no longer needed with Solana 3.x -- they're included in the validator by default.

---

## 8. Summary Checklist

### Rust / Cargo

- [ ] Update `rust-toolchain.toml` to `1.93.0`
- [ ] Add `[workspace.dependencies]` with `anchor-lang = "1.0.0"`, `anchor-spl = "1.0.0"`
- [ ] Add `[workspace.lints.rust]` for `unexpected_cfgs`
- [ ] Update each program's `Cargo.toml` to use `workspace = true` dependencies
- [ ] Add `custom-heap`, `custom-panic`, `anchor-debug` features
- [ ] Add `idl-build` feature to all library crates
- [ ] Add `[lints] workspace = true` to all crates
- [ ] Add `doctest = false` to library crates' `[lib]` section
- [ ] Bump Solana SDK deps from `2.x` to `3.x`
- [ ] Bump SPL crates (`spl-associated-token-account` 6->8, `spl-pod` 0.5->0.7, `spl-transfer-hook-interface` 0.9->2.1)

### Anchor Program Code

- [ ] Replace `#![allow(unexpected_cfgs)]` with `#![allow(deprecated)]`
- [ ] Simplify all `Context<'a, 'b, 'c, 'info, T>` to `Context<'info, T>`
- [ ] Remove extra lifetime params from function signatures and trait impls
- [ ] Change `CpiContext::new(program.to_account_info(), ...)` to `CpiContext::new(*program.key, ...)`
- [ ] Change `CpiContext::new_with_signer(program.to_account_info(), ...)` to `CpiContext::new_with_signer(*program.key, ...)`
- [ ] Remove `use anchor_lang::solana_program::pubkey;` -- `pubkey!` is in prelude
- [ ] Remove `rent_epoch` parameter from `AccountInfo::new` in tests
- [ ] Update `Interface<'info, TokenInterface>` to `AccountInfo<'info>` where needed in helper functions

### Anchor.toml

- [ ] Set `anchor_version = "1.0.0"`
- [ ] Set `solana_version = "3.1.10"`
- [ ] Add `package_manager = "bun"` (optional, if using bun)
- [ ] Remove `[[test.genesis]]` entries (Token-2022 etc. bundled in Solana 3.x)
- [ ] Remove `[scripts]` section (use package.json instead)

### TypeScript / Client

- [ ] Replace `@coral-xyz/anchor` with `@anchor-lang/core`
- [ ] Replace `@coral-xyz/borsh` with `@anchor-lang/borsh`
- [ ] Update all `import` statements across test and client files
- [ ] Add `"type": "module"` to `package.json`
- [ ] Adjust `tsconfig.json` if needed (`strictNullChecks`, `noImplicitAny`)
- [ ] Switch from npm/pnpm to bun (optional but recommended)

### CI

- [ ] Update Solana CLI version to `3.1.10`
- [ ] Update Anchor CLI version to `1.0.0`
- [ ] Update Rust toolchain to `1.93.0`
- [ ] Replace `npm install`/`npm test` with `bun install`/`bun run test`
- [ ] Update cache keys to use `bun.lock`
- [ ] Add Anchor CLI caching step
- [ ] Remove Node.js setup step if using bun exclusively

---

## Appendix: Common Build Errors & Fixes

### Error: `expected struct Pubkey, found &AccountInfo`

**Fix:** Change `CpiContext::new(program.to_account_info(), ...)` to `CpiContext::new(*program.key, ...)`.

### Error: `this function takes 7 arguments but 8 arguments were supplied`

**Fix:** Remove the `rent_epoch` (last) argument from `AccountInfo::new()`.

### Error: Multiple lifetime parameters on Context

**Fix:** Simplify `Context<'a, 'b, 'c, 'info, T>` to `Context<'info, T>` and remove extra lifetimes from the function signature.

### Warning: `unexpected_cfgs` / `deprecated`

**Fix:** Add `#![allow(deprecated)]` to lib.rs and configure workspace lints for `unexpected_cfgs`.

### Error: `unresolved import anchor_lang::solana_program::pubkey`

**Fix:** Remove the import. The `pubkey!` macro is available through `anchor_lang::prelude::*`.

### TypeScript: `Cannot find module '@coral-xyz/anchor'`

**Fix:** Replace with `@anchor-lang/core` in both `package.json` and all import statements.
