# OpenFour FairLaunch Module Example

Language: English | [繁體中文](./zh-Hant/sample.md)

This folder is a public-facing contract skeleton for building a custom OpenFour preset. The example preset is `FairLaunch`: a fixed-price launch with optional sell support, per-trade and per-address buy limits, post-trade custom data, and migration after sellout, soft cap, or timeout.

Use this folder as a reference for module authoring. It is not the canonical production deployment source. These example contracts are unaudited and are provided only as demo/reference code; they must not be used for any other formal production purpose.

## Guides

- `integration-guide.md`: for wallets, trading UIs, indexers, data backends, launch platforms, and aggregators integrating token creation, estimation, trading, event indexing, token/module recognition, and error handling.
- `developer-guide.md`: for developers building new OpenFour modules, Presets, token extensions, validators, and gameplay logic.

## Module Architecture

`OpenFourCore` is the execution coordinator. It creates tokens, routes buys and sells, asks modules for pricing and policy decisions, updates vault accounting, calls custom-data hooks, and triggers migration when the migrate module says the launch is complete.

Each module owns one part of the preset: the token module initializes token identity and wiring, the vault module owns asset custody and sale accounting, the curve module prices trades, the trade module applies policy and fees, the custom-data module stores optional gameplay state, and the migrate module decides when and how the launch exits into its final state.

`StandardTokenModule` and `OpenFourToken` define token identity and module wiring. The token module initializes the token clone, while `OpenFourToken` stores references to the vault, curve, trade, migrate, token, and custom-data modules for that token.

`StandardVault` owns launch custody and accounting. It tracks sale inventory, quote raised, phase, and migration transfer operations. It does not decide price or eligibility.

`FairLaunchCurveModule` owns pricing. Core passes it the current sale state, and it returns the fixed-price quote and any execution adjustment.

`FairLaunchTradeModule` owns trade policy. It returns per-trade limits and optional fees. When cumulative buy limits are enabled, it reads historical totals from `FairLaunchCustomDataModule`, but it does not write state itself.

`FairLaunchCustomDataModule` owns optional preset state. Core calls it after trades and after migration, allowing the preset to record cumulative buys, sells, last trade metadata, and migration snapshots.

`FairLaunchMigrateModule` owns launch completion rules. It checks sellout, soft cap, and timeout conditions, then optionally delegates DEX-specific liquidity work to a migration adapter.

## What Is Included

- `contracts/interfaces/*.sol`: protocol-facing interfaces that custom modules must implement.
- `contracts/libraries/OpenFourTypes.sol`: shared structs used by Core, modules, tools, and UIs.
- `contracts/token/OpenFourToken.sol`: a standard token implementation wired to module addresses.
- `contracts/modules/token/StandardTokenModule.sol`: token initialization module.
- `contracts/modules/vault/StandardVault.sol`: sale accounting and asset custody module.
- `contracts/modules/curve/FairLaunchCurveModule.sol`: fixed-price curve module.
- `contracts/modules/trade/FairLaunchTradeModule.sol`: trade policy and fee module.
- `contracts/modules/data/FairLaunchCustomDataModule.sol`: post-trade and post-migration state module.
- `contracts/modules/migrate/FairLaunchMigrateModule.sol`: launch completion and liquidity migration module.
- `contracts/interfaces/IOpenFourPresetValidator.sol`: preset-level validation interface.
- `contracts/validators/FairLaunchPresetValidator.sol`: cross-module FairLaunch parameter validator.

This skeleton intentionally does not include protocol internals such as `OpenFourCore`, `OpenFourRegistry`, `OpenFourDeployer`, manager contracts, or low-level DEX migration libraries. When a docs example needs external DEX behavior, it should keep that behavior behind a small interface or adapter.

## FairLaunch Flow

The preset is split into small modules so each part has one responsibility.

1. The token is created through `StandardTokenModule`, which initializes `OpenFourToken` with all module addresses.
2. `StandardVault` stores the initial sale inventory and tracks `totalRaised`, `remainingForSale`, and phase.
3. A buy asks `FairLaunchCurveModule` for the fixed-price quote.
4. The same buy asks `FairLaunchTradeModule` whether the amount is allowed and whether extra fee tiers apply.
5. Core processes payment and calls `StandardVault.onBuy()` to update custody and sale accounting.
6. Core calls `FairLaunchCustomDataModule.afterHook()` so the preset can record cumulative trader statistics.
7. Core checks `FairLaunchMigrateModule.evaluate()` to see whether the launch should migrate.
8. When migration runs, `FairLaunchMigrateModule.executeMigration()` performs the optional adapter call, and Core calls `FairLaunchCustomDataModule.onMigrate()`.

The important design rule is that modules do not all try to do everything. Pricing lives in the curve module, trade limits live in the trade module, custody lives in the vault, and historical per-trader state lives in custom data.

## Module Contract Rules

OpenFour modules are per-token clones. Each module should bind itself to exactly one token during `init`, store the calling `fourCore` address, and reject contexts for any other token.

Every module exposes a stable `descriptor()`. The tag identifies the module family, for example `module.curve.fair_launch`; the version is the implementation version passed into `init`.

Modules that accept encoded params should expose `moduleEncodeSchema()`. This schema helps builders render forms and ABI-encode params, but it is not validation. The module must still decode and validate params in `init`.

Modules should store raw initialization bytes and expose `getInitParams()` when their interface requires it. This lets indexers, UIs, and registries reconstruct the exact token configuration.

Hook data is not an authority boundary. If `evaluate()` returns data that is later passed into `executeMigration()`, the execution function must still re-check caller, token binding, migration conditions, and caps.

## Required Interfaces

Each module type must implement the protocol interface for its role. Modules that expose user-configurable params should also implement `IOpenFourModuleSchema` so tools can render and encode those params.

Required preset modules:

- Token module: must implement `IOpenFourTokenModule`. It creates or initializes the token implementation for the preset.
- Vault module: must implement `IOpenFourVault`. It owns custody, phase, sale inventory, and quote accounting.
- Curve module: must implement `IOpenFourCurveModule`. It prices buys/sells and exposes quote helpers.
- Trade module: must implement `IOpenFourTradeModule`. It returns trade allow/deny decisions, bounds, and fee tiers.
- Migrate module: must implement `IOpenFourMigrateModule`. It decides migration readiness and executes final migration actions.

Optional preset module:

- Custom data module: implement `IOpenFourCustomDataModule` only when the preset needs persistent custom state, Core hook handling, or data shared across modules. If the preset does not need stored gameplay data or cross-module state, this module can be omitted.

Schema support:

- Implement `IOpenFourModuleSchema` on modules with encoded params or UI-facing configuration. This is strongly recommended for custom modules, but it does not replace on-chain validation in `init`.

The token implementation can use `OpenFourToken` directly. If a preset needs to extend token behavior, the custom token implementation must inherit `OpenFourToken` so Core, modules, and off-chain tools can rely on the standard token-facing interface and stored module references.

## Token Module

`StandardTokenModule` is the entry point for token initialization.

It receives the token clone address, vault, curve module, trade module, migrate module, custom data module, token metadata, and token supply values. It calls `OpenFourToken.initialize()` and stores the raw `tokenParams` for later inspection.

Use this module when your custom preset can reuse the standard token behavior. Write a custom token module only when token creation itself changes, for example custom metadata layout, custom token implementation initialization, or extra token-level configuration.

Key files:

- `contracts/modules/token/StandardTokenModule.sol`
- `contracts/token/OpenFourToken.sol`

## Vault Module

`StandardVault` owns launch accounting and asset custody.

It stores the quote asset, initial sale amount, remaining sale inventory, total raised quote, wrapped native token address, creator, migration module, and phase. Core calls `onBuy()` and `onSell()` after curve and trade checks have passed. Migration modules can use vault migration functions to move quote or token liquidity.

The vault should not decide price or user eligibility. It should enforce custody and accounting invariants after Core has accepted a trade.

Use a custom vault when the asset custody model changes, for example vesting, escrow, alternative settlement, or special accounting.

Key file:

- `contracts/modules/vault/StandardVault.sol`

## Curve Module

`FairLaunchCurveModule` implements fixed-price pricing.

Its `Params` configure `fixedPrice`, `sellPenaltyBps`, `enableSell`, `minPurchase`, and `maxPurchase`. During `evaluate()`, the module receives `CurveContext` from Core, checks token binding and sale constraints, then returns `CurveResult` with the quote amount.

For buys, the module enforces remaining supply and min/max purchase size. For sells, it either rejects sells or prices them at the fixed price minus the configured sell penalty.

`evaluateReverse()` is a UI helper for quote-budget buys. It converts a quote budget into the largest accepted token amount for this fixed-price curve.

Design points:

- Use `Math.mulDiv` for quote math to avoid large multiplication overflow.
- Keep curve modules view-only. They should calculate price and bounds, not record trader history.
- Return `adjustedAmount` only when the curve intentionally partial-fills a request.

Key file:

- `contracts/modules/curve/FairLaunchCurveModule.sol`

## Trade Module

`FairLaunchTradeModule` implements trade policy and optional extra fees.

Its `TradeConfig` configures `maxBuyAmount`, `maxPerAddress`, `maxSellAmount`, `buyFeeBps`, `sellFeeBps`, and `feeRecipient`. Core enforces the returned `TradeResult` values: `allowed`, `minAmount`, `maxAmount`, and `FeeTier[]`.

The latest trade interface is view-only, so this module does not write state. When `maxPerAddress` is enabled, it reads cumulative purchase data from the token's custom data module:

- `IOpenFourToken(ctx.token).customData()`
- `FairLaunchCustomDataModule.totalPurchased(ctx.trader)`

This demonstrates the intended split: trade modules can read historical state to make a decision, but custom data modules are responsible for writing that state through Core hooks.

Design points:

- Do not update per-address counters in `evaluate()`.
- Treat `FeeTier[]` as fee instructions for Core and FeeRouter.
- Validate non-zero `feeRecipient` whenever a fee bps value is non-zero.
- Keep fee bps bounded by `10_000`.

Key file:

- `contracts/modules/trade/FairLaunchTradeModule.sol`

## Custom Data Module

`FairLaunchCustomDataModule` is the optional stateful extension point for this preset. A custom data module is only needed when the preset must store extra data, receive Core hooks, or share state between modules.

Core calls `afterHook()` after a trade is fully executed. The module records per-trader `totalPurchased`, `totalSold`, `lastTradeTime`, and `lastTradeBlock`. Core calls `onMigrate()` after migration, and the module records `migrated`, `migratedAt`, `migrationTotalRaised`, and `migrationRemainingForSale`.

This module is useful because some gameplay rules need historical data, but the trade interface itself should stay view-only. In this example, `FairLaunchTradeModule` reads `totalPurchased()` from custom data to enforce a cumulative buy cap.

Design points:

- Only Core should be allowed to call hook writers.
- Hooks should verify `ctx.token` matches the bound token.
- Hooks should record facts after execution, not decide whether a trade is valid.
- Keep convenience getters for other modules and off-chain tools.

Key file:

- `contracts/modules/data/FairLaunchCustomDataModule.sol`

## Migrate Module

`FairLaunchMigrateModule` decides when the launch can finish and optionally performs liquidity migration.

Its input params configure `softCap`, `duration`, `migrationAdapter`, `lpRecipient`, `tokenLiquidityAmount`, and `maxQuoteToUse`. At initialization, `duration` is converted into an absolute `endTime`.

`evaluate()` returns `canMigrate` when one of these conditions is true:

- Sale inventory is exhausted.
- `softCap` is non-zero and `totalRaised >= softCap`.
- Current timestamp is at or past `endTime`.

If migration is allowed, `evaluate()` returns encoded hook data containing the capped quote amount. `executeMigration()` still re-checks the migration condition and caps the quote again before calling the adapter.

Design points:

- Treat `hookData` as a hint, not trusted input.
- Re-check `ctx.token`, caller, migration condition, and quote caps in `executeMigration()`.
- Keep low-level DEX logic behind an adapter interface in public examples.
- If `migrationAdapter` is zero, this example allows migration without an on-chain liquidity action.

Key file:

- `contracts/modules/migrate/FairLaunchMigrateModule.sol`

## Building Your Own Preset

Start from the module whose responsibility actually changes.

If only pricing changes, replace the curve module. If only user eligibility or extra fees change, replace the trade module. If you need post-trade history, add or replace the custom data module. If launch completion or liquidity routing changes, replace the migrate module. Only replace the vault when custody or accounting changes, and only replace the token module when token initialization changes.

When adding a module, keep these checks:

- Validate decoded params in `init`.
- Bind the module to one token and one Core address.
- Return a stable `descriptor()` tag.
- Expose a schema that matches the ABI-encoded params.
- Keep view modules view-only.
- Re-check execution invariants in state-changing functions.
- Keep external integrations behind small interfaces.

Use this folder as an implementation guide for custom gameplay modules, not as a full protocol deployment package.
