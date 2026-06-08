# OpenFour Developer Guide

[English](./developer-guide.md) | [繁體中文](./zh-Hant/developer-guide.md)

This guide is for developers who want to build new launch mechanics, new Presets, new modules, or new token types on top of OpenFour. OpenFour is Four.Meme's modular launch engine. This document explains the OpenFour module architecture, module relationships, required interfaces, development boundaries, schema design, Preset registration points, and how to use the FairLaunch example in this directory as a starting point for a custom launch.

The example contracts are only for demos and development reference. They are not audited and must not be used for any other formal production purpose.

## 1. Architecture Principles

OpenFour splits a token launch into independent modules that are orchestrated by `OpenFourCore`. The Core does not know the details of a specific launch mechanic; it only calls modules through standard interfaces.

Each token is bound to a set of module instances at creation time:

- Token implementation: the ERC20 body.
- Token module: initializes the token.
- Vault module: asset custody and sale accounting.
- Curve module: pricing.
- Trade module: trading policy and fees.
- Migrate module: graduation/migration conditions and migration actions.
- Custom data module: optional; stores custom launch state and data shared across modules.

The goal of this architecture is to make launch mechanics composable, replaceable, and indexable, while allowing third-party frontends to render creation forms automatically from on-chain schemas.

## 2. Module Responsibilities

| Category | Registry `ModuleKind` | Interface | Required | Responsibility |
| --- | --- | --- | --- | --- |
| Token | 0 | `IOpenFourTokenModule` | Yes | Initialize token implementation, inject module references, and mint initial supply according to the preset. |
| Vault | 1 | `IOpenFourVault` | Yes | Custody quote assets, track `totalRaised` / `remainingForSale` / phase, and handle migration asset transfers. |
| Curve | 2 | `IOpenFourCurveModule` | Yes | Pricing logic: forward quote (`amount -> quote`) and reverse quote (`quote -> amount`). |
| Trade | 3 | `IOpenFourTradeModule` | Yes | Trading policy and fee calculation: limits, allow/deny checks, and fee tier decisions. |
| Migrate | 4 | `IOpenFourMigrateModule` | Yes | Migration policy and execution: decide when to migrate and execute migration actions. |
| CustomData | 5 | `IOpenFourCustomDataModule` | Optional | Per-token custom state, Core hooks (`afterHook` / `onMigrate`), and shared data for other modules. |

`OpenFourCore` is the execution coordinator. It creates tokens, routes buy/sell calls, calls curve/trade modules for decisions, calls the vault to update asset state, calls custom data hooks, and calls the migrate module to complete migration.

The Token module initializes the token. It should not handle trading, pricing, or migration.

The Vault module handles asset custody and accounting state. It records quote, remainingForSale, totalRaised, phase, and exposes interfaces for transferring assets during migration. It should not decide prices or whether a user can trade.

The Curve module handles pricing. It receives `CurveContext` from the Core and returns the quote amount and executability. It should remain view-only and should not record trading history.

The Trade module handles trading policy. It receives `TradeContext` and returns whether the trade is allowed, min/max amount, and FeeTier. The current trade interface is view-only, so it should not write state such as per-address counters.

The Migrate module determines when the internal market ends and what actions are executed during migration. It can delegate DEX-specific details to an adapter.

The Custom data module is an optional state module. Implement it only when a launch mechanic needs extra storage, Core hooks, or shared data between modules.

## 3. Required Interfaces

Each module category must implement its corresponding protocol interface.

Required modules:

- Token module must implement `IOpenFourTokenModule`.
- Vault module must implement `IOpenFourVault`.
- Curve module must implement `IOpenFourCurveModule`.
- Trade module must implement `IOpenFourTradeModule`.
- Migrate module must implement `IOpenFourMigrateModule`.

Optional modules:

- Custom data module should implement `IOpenFourCustomDataModule` only when state storage, hooks, or shared cross-module data are needed.

Schema:

- Modules with creation parameters or UI configuration are recommended to implement `IOpenFourModuleSchema`.
- `moduleEncodeSchema()` only helps frontends encode parameters. It does not replace on-chain `init` validation.

Token implementation:

- You can use `OpenFourToken` directly.
- If token behavior needs to be extended, the custom token must inherit `OpenFourToken` so the Core, modules, tools, and indexers can rely on standard getters and module references.

Descriptor:

- Tokens and modules should implement or inherit `ITagDescriptor`.
- `tag` should use stable names, such as `token.standard` and `module.curve.fair_launch`.
- `tagId = bytes8(keccak256(bytes(tag)))`.
- `version` should come from the Registry version snapshot injected at creation time.

## 4. Lifecycle Call Order

### 4.1 Creating a token

Typical creation order:

1. Core reads the Preset.
2. Core resolves the token/vault/curve/trade/migrate/customData module implementations bound by the Preset.
3. Core deploys or clones the token.
4. Core deploys or clones each module instance.
5. Core calls the token module to initialize the token.
6. Core calls `init` on vault/curve/trade/migrate/customData.
7. Core records runtime config.
8. Core emits `TokenCreated`, including module addresses and `encodedTags`.

Module `init` must:

- Bind the token address.
- Bind the fourCore address.
- Decode and validate raw params.
- Save raw init params.
- Save the module version.
- Prevent repeated initialization.

### 4.2 Buying

Typical buy order:

1. Core checks that the token exists, is not paused, the Preset is active, and the vault phase is Trading.
2. Core calls CurveModule `evaluate()` to get the price.
3. Core calls TradeModule `evaluate()` to get trading policy and fees.
4. Core handles user payment and fees.
5. Core calls Vault `onBuy()` to update accounting.
6. Core calls CustomData `afterHook()`, if present.
7. Core may switch `Trading -> SoldOut` if `vault.isSoldOut()` is true.
8. Core calls MigrateModule `evaluate()` to check whether automatic migration should happen.

`SoldOut` is a vault-defined sale-closed phase, not a universal migration prerequisite. Bonding presets commonly enter `SoldOut` after the sale inventory is exhausted. Other launch mechanics may remain in `Trading` until their own migration condition is met.

### 4.3 Selling

Typical sell order:

1. Core checks state.
2. Core calls CurveModule `evaluate()` to get the sell quote.
3. Core calls TradeModule `evaluate()` to get policy and fees.
4. Core transfers the user's tokens in.
5. Core calls Vault `onSell()` to update accounting.
6. Core pays quote to the user.
7. Core calls CustomData `afterHook()`, if present.

### 4.4 Migration

Typical migration order:

1. Core calls MigrateModule `evaluate()`.
2. If `canMigrate == false`, migration is not executed.
3. Core switches phase to MigratePending. The previous phase may be `Trading` or `SoldOut`.
4. Core calls MigrateModule `executeMigration()`.
5. Core calls CustomData `onMigrate()`, if present.
6. Core switches phase to Migrated.
7. Core emits `MigrateExecuted`.

Hook data returned by `evaluate()` can only be used as a hint. `executeMigration()` must revalidate conditions, token, caller, and amount caps.

## 5. FairLaunch Example Structure

This directory provides a FairLaunch demo:

- `contracts/modules/token/StandardTokenModule.sol`
- `contracts/token/OpenFourToken.sol`
- `contracts/modules/vault/StandardVault.sol`
- `contracts/modules/curve/FairLaunchCurveModule.sol`
- `contracts/modules/trade/FairLaunchTradeModule.sol`
- `contracts/modules/data/FairLaunchCustomDataModule.sol`
- `contracts/modules/migrate/FairLaunchMigrateModule.sol`
- `contracts/validators/FairLaunchPresetValidator.sol`

FairLaunch mechanics:

- Fixed-price launch.
- Buy has min/max amount per transaction.
- Sell can be optionally enabled, with a penalty applied to sells.
- Trade module can limit per-buy amount, cumulative buys, sell amount, and extra fees.
- Custom data module records cumulative buys/sells for the trade module to read.
- Migrate module allows migration when sold out, soft cap is reached, or the launch expires.
- Migration can execute external DEX liquidity creation through an adapter, or skip on-chain liquidity actions.

## 6. Developing a New Preset

When developing a new Preset, do not copy every module first. Start by identifying which responsibility actually changes.

Only pricing changes:

- Write a new CurveModule.
- Reuse the standard token, vault, trade, and migrate modules.

Only trading rules or fees change:

- Write a new TradeModule.
- If the rules need historical state, also write a CustomDataModule.

Post-trade state is needed:

- Write a CustomDataModule.
- TradeModule should only read custom data, not write state.

Only the migration target changes:

- Write a new MigrateModule or migration adapter.
- Keep curve/trade/vault unchanged.

Asset custody or accounting changes:

- Write a new VaultModule.
- This is a high-risk module and needs focused auditing.

Token body changes:

- Write a token implementation that inherits `OpenFourToken`.
- Write the corresponding TokenModule to initialize it.

## 7. CurveModule Development Rules

CurveModule must implement `IOpenFourCurveModule`.

Core functions:

- `init(...)`
- `evaluate(CurveContext)`
- `evaluateReverse(...)`
- `getInitialPrice()`
- `getLastPrice(...)`
- `getLiquiditySnapshot(...)`
- `getInitParams()`
- `descriptor()`

Implementation requirements:

- `evaluate()` must check token binding.
- Do not read or write trader history state.
- Do not depend on msg.sender to identify the trader; use `ctx.trader`.
- Quote math should avoid overflow; prefer `Math.mulDiv`.
- If the trade is partially filled, return `adjustedAmount`.
- If the trade is fully rejected, return `executable = false` and reason.

`evaluateReverse()` is used for "buy by budget" UX. If unsupported, it may return `(0, 0)`, but if the frontend needs to support buyByBudget, it should be implemented.

## 8. TradeModule Development Rules

TradeModule must implement `IOpenFourTradeModule`.

Core functions:

- `init(address token, address fourCore, bytes params, string moduleVersion)`
- `evaluate(TradeContext)`
- `getInitParams()`
- `descriptor()`

`evaluate()` returns:

- `allowed`
- `minAmount`
- `maxAmount`
- `FeeTier[] fees`
- `reason`

Implementation requirements:

- The current interface is view-only; do not write state.
- If cumulative purchases, cooldowns, whitelist usage counts, or similar state are needed, put that state in CustomDataModule.
- It can read view state from token, vault, or customData to assist decisions.
- FeeTier `bps` should have an upper bound, and fee recipients should be validated as non-zero.
- When a rule is exceeded, return `allowed = false`; do not use revert for ordinary business rejection.

## 9. CustomDataModule Development Rules

CustomDataModule is optional. It is needed only in these cases:

- Recording each trader's cumulative purchases, cumulative sells, or last trade time.
- Recording snapshots or results after migration.
- Providing shared state to trade/curve/migrate modules.
- Using Core `afterHook()` / `onMigrate()` as launch extension points.

It must implement `IOpenFourCustomDataModule`:

```solidity
function init(address token, address fourCore, bytes calldata params, string calldata moduleVersion) external;
function afterHook(OpenFourTypes.TradeHookContext calldata ctx) external;
function onMigrate(OpenFourTypes.MigrateHookContext calldata ctx) external;
```

Implementation requirements:

- Only Core can call hook write functions.
- Hooks must check `ctx.token`.
- Hooks should record facts after execution; they should not decide whether a trade is valid.
- Data that other modules need to read should be exposed through clear view getters.
- If there is no state requirement, do not implement a custom data module; set customDataId to 0 in the Preset.

## 10. MigrateModule Development Rules

MigrateModule must implement `IOpenFourMigrateModule`.

Core functions:

- `init(address token, address fourCore, address feeRouter, bytes params, string moduleVersion)`
- `evaluate(MigrateContext)`
- `executeMigration(MigrateHookContext, bytes hookData)`
- `getInitParams()`
- `descriptor()`

Implementation requirements:

- `evaluate()` should only decide whether migration is possible; it must not mutate state.
- `MigrateContext.soldOut` is a snapshot of `IOpenFourVault.isSoldOut()`. Use it when the launch mechanic requires sale inventory exhaustion, but do not assume every migration path must require it. Fair-launch, time-based, soft-cap, or operator-triggered mechanics may return `canMigrate = true` while `soldOut == false`.
- `executeMigration()` must only allow Core to call it.
- `executeMigration()` must recheck migration conditions.
- Do not trust `hookData`.
- Reapply caps to quote/token usage.
- External DEX logic should be placed in an adapter or library; public examples should prefer adapter interfaces.
- Return `migratedDataVersion` and `encodedMigratedData` so indexers can decode the external pool.

## 11. VaultModule Development Rules

VaultModule must implement `IOpenFourVault`.

Vault is the core of fund safety and is responsible for:

- quote custody.
- token sale inventory.
- `phase`.
- `totalRaised`.
- `remainingForSale`.
- `isSoldOut()`, a vault-defined sale-closed predicate passed to MigrateModule as `MigrateContext.soldOut`.
- accounting after buy/sell.
- migration transfer.

Implementation requirements:

- Only Core can call trade accounting functions.
- Only MigrateModule can call migration transfer functions.
- Use `SafeERC20` for ERC20.
- Clearly define native/wrapped native boundaries.
- Do not implement pricing or user eligibility checks inside the vault.

Unless the launch mechanic truly changes custody or accounting, prefer reusing the standard Vault.

## 12. TokenModule and Token Development Rules

TokenModule must implement `IOpenFourTokenModule`.

TokenModule is responsible for:

- Initializing the token implementation.
- Injecting vault, curve, trade, migrate, customData, tokenModule, and other module addresses.
- Writing name, symbol, maxSupply, and metadata URI.
- Handling custom token configuration in tokenParams.

Token implementation can use `OpenFourToken` directly.

If extending the token:

- The custom token must inherit `OpenFourToken`.
- Preserve standard module getters.
- Preserve `descriptor()`.
- Preserve permission and phase semantics that Core/modules depend on.
- Do not break base ERC20 behavior.

Token extensions are suitable for:

- Transfer tax.
- Holder dividends.
- Creator rewards.
- On-chain metadata / NFT-like rendering.
- Special restrictions after external market migration.

### 12.1 UniToken Renderer

`contracts/interfaces/IUniTokenRenderer.sol` defines the renderer interface used by Uni-style token mechanics.

The renderer is an external contract that receives a badge/token id and the stored seed for that badge, then returns a complete `tokenURI` string:

```solidity
function tokenURI(uint256 tokenId, uint256 seed) external view returns (string memory);
```

Typical usage:

- A UniToken-compatible token stores or derives a deterministic `seed` for each badge/token id.
- When metadata is requested, the token delegates rendering to a renderer contract.
- The renderer returns a full metadata URI, usually `data:application/json;base64,...`.
- The JSON `image` field can contain an on-chain SVG, base64 image, or another supported media URI.

Custom renderers used at token creation must implement ERC-165 and return `true` for `type(IUniTokenRenderer).interfaceId`. The preset default renderer is trusted by the protocol and may skip this external renderer interface check.

Use a custom renderer when the token mechanic needs on-chain art, dynamic metadata, generative badge visuals, or a project-specific display layer without changing the core token/module interfaces.

## 13. Module Schema

Modules with user configuration parameters are recommended to implement `IOpenFourModuleSchema`:

```solidity
function moduleEncodeSchema() external pure returns (ModuleEncodeSchema memory);
```

`ModuleEncodeSchema` contains:

- `kind`: `token`, `vault`, `curve`, `trade`, `migrate`, `customData`.
- `version`: schema version.
- `params`: field descriptor array.

`ParamDescriptor` describes:

- `name`
- `abiType`
- `decimals`
- `optional`
- `title`
- `defaultValue`
- `hint`
- `minValue`
- `maxValue`

Encoding rules:

- Frontends read values in `params` order.
- Encode as one single Solidity tuple, for example `abi.encode((field1, field2, ...))` / `AbiCoder.encode(["(uint256,bool,address)"], [[v1, v2, v3]])`.
- Do not encode module params as multiple root ABI values, for example `AbiCoder.encode(["uint256","bool","address"], [v1, v2, v3])`. That layout is different from a struct tuple when dynamic fields such as `bytes` or `string` exist, and the module's `abi.decode(rawParams, (Params))` may decode garbage or revert.
- On-chain `init` decodes with `abi.decode(rawParams, (Params))`.
- Modules without params return `"0x"`.

Schema is only UI and encoding assistance. Full parameter validation must still happen on-chain.

## 14. Descriptor and tag Rules

All tokens and modules should have stable tags:

- Token: `token.<name>`, for example `token.standard`.
- Token module: `module.token.<name>`.
- Vault: `module.vault.<name>`.
- Curve: `module.curve.<name>`.
- Trade: `module.trade.<name>`.
- Migrate: `module.migrate.<name>`.
- Custom data: `module.data.<name>`.

`tagId` calculation:

```solidity
bytes8 tagId = bytes8(keccak256(bytes(tag)));
```

tag is used for:

- `descriptor()`.
- Registry tag dictionary.
- `TokenCreated.encodedTags`.
- Frontend launch recognition.
- Zero-RPC classification by indexers.

Do not mix token tags and module tags.

## 15. Module key, metadata, and version

The module key in Registry is the full `bytes32` identifier used when officially registering a module. The `tagId` returned by `descriptor()` is a short identifier for token recognition and indexing. They serve different purposes and should not be mixed.

Recommended naming:

```solidity
bytes32 moduleKey = keccak256(bytes("module.curve.fair_launch"));
bytes8 tagId = bytes8(keccak256(bytes("module.curve.fair_launch")));
```

In other words, module key and tag can use the same stable string as the source, but one is the full `bytes32` and the other is a truncated `bytes8`. During final official registration, key naming may be adjusted according to governance rules. When third-party developers submit materials, they should clearly provide the proposed key source string, descriptor tag, and version.

Recommended `ModuleMetadata`:

```solidity
OpenFourTypes.ModuleMetadata({
    moduleId: keccak256(bytes("module.curve.fair_launch")),
    version: "1.0.0",
    name: "FairLaunchCurveModule",
    description: "Fixed-price fair launch curve",
    author: developer,
    feeShareBps: 0
});
```

Version rules:

- If a bug is fixed without changing interfaces, storage layout, ABI params, or semantics, the same module key can be reused and the official implementation can be upgraded.
- If interfaces, storage layout, ABI params, or core semantics change, use a new module key.
- `descriptor().version` is the Registry-injected version snapshot at token creation time. It is used for indexing and traceability and should not be assembled arbitrarily inside a module.

## 16. FairLaunch Preset Composition Example

The FairLaunch preset is composed of the standard token/vault plus fair-launch strategy modules:

```solidity
OpenFourTypes.Preset({
    id: 1001,
    name: "FairLaunch",
    description: "Fixed-price launch with optional sell support and migration",
    version: "1.0.0",
    active: true,
    createEnabled: true,
    validator: fairLaunchValidator,
    tokenModuleId: keccak256(bytes("module.token.standard")),
    vaultModuleId: keccak256(bytes("module.vault.standard")),
    curveModuleId: keccak256(bytes("module.curve.fair_launch")),
    tradeModuleId: keccak256(bytes("module.trade.fair_launch")),
    migrateModuleId: keccak256(bytes("module.migrate.fair_launch")),
    tokenImplId: keccak256(bytes("token.standard")),
    customDataId: keccak256(bytes("module.data.fair_launch")),
    author: developer
});
```

If the launch mechanic does not need post-trade state, `customDataId` can be `bytes32(0)`. In the FairLaunch example, however, when `FairLaunchTradeModule.maxPerAddress > 0`, TradeModule needs to read cumulative purchases, so the Preset must configure `FairLaunchCustomDataModule`.

Creation parameters need to be encoded according to each module schema:

```solidity
OpenFourTypes.TokenInitParams({
    name: "Example Token",
    symbol: "EXM",
    tokenUri: "ipfs://...",
    maxSupply: 1_000_000 ether,
    saleAmount: 800_000 ether,
    raiseAmount: 80 ether,
    quoteAsset: quoteAsset,
    tokenSalt: bytes32(0),
    tokenParams: "",
    vaultParams: "",
    curveParams: abi.encode(FairLaunchCurveParams({
        fixedPrice: 0.0001 ether,
        sellPenaltyBps: 500,
        enableSell: true,
        minPurchase: 1 ether,
        maxPurchase: 10_000 ether
    })),
    tradeParams: abi.encode(FairLaunchTradeConfig({
        maxBuyAmount: 10_000 ether,
        maxPerAddress: 20_000 ether,
        maxSellAmount: 5_000 ether,
        buyFeeBps: 0,
        sellFeeBps: 0,
        feeRecipient: address(0)
    })),
    migrateParams: abi.encode(FairLaunchMigrateInput({
        softCap: 40 ether,
        duration: 7 days,
        migrationAdapter: address(0),
        lpRecipient: address(0),
        tokenLiquidityAmount: 0,
        maxQuoteToUse: 0
    })),
    customDataParams: ""
});
```

`FairLaunchCurveParams`, `FairLaunchTradeConfig`, and `FairLaunchMigrateInput` above are pseudo type names. During actual encoding, field order must exactly match `Params` / `TradeConfig` / `InputParams` in the example contracts. Frontends and scripts should prefer reading `OpenFourTools.getPresetEncodeSchemas()` and generating ABI tuples according to schema order.

## 17. Registering Modules

Module registration is performed by OpenFour officials/governance. It is not a public entry point for third-party developers to call directly. Third-party developers need to submit contract code and related description on the official website for later review, including audit/test materials, module purpose, schema, tag, version, author information, and expected composition. After approval, the official party registers the module in Registry.

Registry registration requires module type, implementation identifier, implementation address or beacon, metadata, version, author, and related information. Exact fields should follow the official registration template or governance interfaces in `OpenFourRegistry`; third-party integration interfaces do not expose owner/operator write methods.

Registration principles:

- Use a new module key when a new module goes live for the first time.
- If a bug fix is compatible with storage and interfaces, it can use implementation upgrade.
- If interfaces, storage layout, or semantics change materially, register a new module key.
- tag and version should clearly express the module family and implementation version.

Module metadata should describe:

- name
- description
- version
- author
- feeShareBps or related revenue configuration

## 18. Registering Presets

Preset registration is also performed by OpenFour officials/governance. Third-party developers can propose a new Preset, including module composition, launch mechanic description, parameter constraints, validator rules, migration target, risk notes, and frontend display information. After approval, the Preset is written into Registry.

A Preset is a composition of modules and token implementation. A Preset usually contains:

- token implementation id
- token module id
- vault module id
- curve module id
- trade module id
- migrate module id
- custom data module id, which can be 0
- validator
- author
- active
- createEnabled
- name / description / version

After a Preset is registered, Core resolves these modules according to `presetId` when creating a token.

Preset state semantics:

- `active = false`: this Preset is unavailable as a whole, and trading/migration of existing tokens may also be blocked.
- `createEnabled = false`: creating new tokens with this Preset is disabled, but existing tokens can continue running.
- `validator = address(0)`: creation should generally not be allowed because creation parameters cannot be validated.

## 19. Preset Validator

Validator checks cross-module parameter relationships during creation.

`contracts/` provides two validator reference files:

- `contracts/interfaces/IOpenFourPresetValidator.sol`
- `contracts/validators/FairLaunchPresetValidator.sol`

A single module's `init` can only validate its own params. Validator can validate the whole composition, for example:

- `saleAmount <= maxSupply`
- `raiseAmount > 0`
- whether curve params match token supply
- whether trade limits are reasonable
- whether migrate soft cap does not exceed raise target
- whether custom data exists when cumulative state is required
- whether the token type matches the vault/trade/migrate composition

It is recommended to put "cross-module invariants" in the validator instead of scattering them across modules.

Validator can only validate creation parameters themselves. Whether the Preset is actually bound to a custom data module, whether a module key is registered, and whether modules are active are still guaranteed by Registry/Preset configuration and the official review process.

## 20. Suggested End-to-End Development Process

1. Write a launch mechanic description and clarify pricing, trading, migration, and state requirements.
2. Decide which modules need to be replaced.
3. Define the params struct for each module.
4. Implement `init`, `descriptor`, and `getInitParams`.
5. Implement `moduleEncodeSchema()`.
6. Implement the core interface functions.
7. Write a validator to check cross-module parameters.
8. Submit contract code and related description on the official website for later review.

For example, to turn FairLaunch into a "step-price launch":

1. Reuse `OpenFourToken`, `StandardTokenModule`, and `StandardVault`.
2. Write a new `StepCurveModule` and only replace the pricing logic.
3. If trading rules are unchanged, reuse `FairLaunchTradeModule`; if whitelist or cooldown is needed, add CustomDataModule and let TradeModule read it.
4. Reuse or replace `FairLaunchMigrateModule`, depending on whether graduation conditions and external liquidity targets change.
5. Write `StepLaunchPresetValidator` to validate relationships among the step-price array, saleAmount, raiseAmount, softCap, and trading limits.
6. Prepare `descriptor()` tag, schema, metadata, tests, and audit materials for the new curve module.
7. Submit contract code and related description on the official website for later review.

## 21. Security Checklist

General module checks:

- Initialization can only run once.
- `fourCore` is non-zero.
- `token` is non-zero.
- Context token must equal the bound token.
- State-writing functions can only be called by Core or the specified module.
- Raw init params and module version are saved.
- `descriptor()` is stable.
- schema matches `Params` ABI order.

Curve:

- Quote math has no overflow.
- Zero amount behavior is clear.
- Supply boundaries are clear.
- Reverse quote and forward quote use consistent semantics.

Trade:

- Ordinary rejection returns `allowed = false`.
- fee bps has an upper bound.
- fee recipient is non-zero.
- view-only and does not write state.

Custom data:

- hooks are onlyCore.
- hooks check token.
- records post-execution facts and does not perform pre-approval.
- getters used by other modules are clear and stable.

Migrate:

- evaluate does not write state.
- execute revalidates conditions.
- does not trust hookData.
- quote/token usage has caps.
- external call return values are checked.
- migrated data version is clear.

Vault:

- uses SafeERC20.
- permission boundaries are clear.
- phase transitions are clear.
- custody and accounting cannot be bypassed.

Token:

- custom token inherits OpenFourToken.
- standard getters are preserved.
- base ERC20 behavior is not broken.
- post-migration pool permissions and transfer rules are clear.

## 22. How to Adapt FairLaunch as a Template

Common adaptation paths:

- Fixed price to step price: replace `FairLaunchCurveModule`.
- Add whitelist phase: add/extend `FairLaunchCustomDataModule` to store whitelist or purchase records, and let TradeModule read it.
- Add cooldown: CustomData records `lastTradeTime`, and TradeModule reads and enforces it.
- Change migration target: replace `FairLaunchMigrateModule` or adapter.
- Add taxes/fees: extend TradeModule to return FeeTier, or extend Token implementation for external-market transfer tax.
- Add post-launch metadata: inherit `OpenFourToken` and extend tokenURI/renderer.

Prefer replacing only one responsibility module. Combine multiple new modules only when the launch mechanic truly changes across responsibilities.

## 23. Existing Module Reference

OpenFour already has a set of reusable modules created by official and partner development. When developing a new launch mechanic, first check whether existing modules can be reused and only replace the slots that truly need to change. For which modules are externally available, how they can be composed, and whether official registration or review is required, contact OpenFour officials for confirmation.

Token module:

- `StandardTokenModule` / `module.token.standard`: initializes standard `OpenFourToken`, suitable for ordinary ERC20 launch mechanics.
- `TaxTokenModule` / `module.token.tax`: initializes TaxToken with transfer tax, dividends, tax distribution, and related capabilities.
- `CreatorRewardsTokenModule` / `module.token.creator_rewards`: initializes creator reward tokens, suitable for mechanics that associate external pool fees or revenue with a creator.
- `UniTokenModule` / `module.token.uni`: initializes Uni-style tokens, suitable for mechanics where balances are bound to on-chain Art, renderer, or special hooks.

Vault module:

- `StandardVault` / `module.vault.standard`: standard internal-market custody and sale accounting, suitable for most ordinary bonding/fair-launch mechanics.
- `TaxBondingVault` / `module.vault.tax_bonding`: vault for TaxToken internal markets, supporting extra accounting and distribution paths needed by tax-token mechanics.

Curve module:

- `BondingCurveModule` / `module.curve.bonding`: standard bonding curve pricing module, suitable for classic internal markets where price changes as purchases progress.

Trade module:

- `SimpleTradeModule` / `module.trade.simple`: minimal trading policy module with no extra limits or fees, suitable for reuse in ordinary mechanics.
- `TaxBondingTradeModule` / `module.trade.tax_bonding`: TaxToken internal-market trading module that returns extra fee tiers according to TaxToken configuration.

Migrate module:

- `PancakeSwapV2MigrateModule` / `module.migrate.pcs_v2`: PCS V2 migration base class, encapsulating common behavior for migration to PancakeSwap V2.
- `BondingPcsV2MigrateModule`: standard bonding implementation for migration to PancakeSwap V2, inheriting PCS V2 migration capability.
- `BondingTaxPcsV2MigrateModule`: Tax bonding implementation for migration to PancakeSwap V2, extending post-migration handling for tax tokens.
- `PancakeSwapV4MigrateModule` / `module.migrate.pcs_v4`: PCS V4 migration base class, encapsulating common behavior for migration to PancakeSwap V4.
- `BondingPcsV4MigrateModule` / `module.migrate.bonding_pcs_v4`: standard bonding implementation for migration to PancakeSwap V4.
- `BondingLikwidV2MigrateModule` / `module.migrate.bonding_likwid`: bonding implementation for migration to Likwid V2.

Custom data module:

- `StandardCustomData` / `module.data.standard`: empty custom data module implementation that provides no-op `afterHook` / `onMigrate`, usable as a starting point for custom state modules.

Reuse recommendations:

- If only the price curve changes, prefer reusing existing token/vault/trade/migrate and only develop a new CurveModule.
- If only trading fees or limits are added, prefer reusing token/vault/curve/migrate and only develop a new TradeModule.
- If historical state or shared cross-module state is needed, add CustomDataModule and do not write state into the view-only TradeModule.
- If only the migration target changes, prefer reusing token/vault/curve/trade and only develop a new MigrateModule or adapter.
- Consider developing VaultModule only when custody, phase, totalRaised, or remainingForSale semantics change.
- Consider developing a new token implementation inheriting `OpenFourToken` and the corresponding TokenModule only when ERC20 body behavior changes.

## 24. Documentation and Integration Materials

When launching a custom Preset, it is recommended to provide:

- Preset name, description, and version.
- Module composition description.
- descriptor tag for each module.
- Creation parameter schema description.
- Trading limit description.
- Fee description.
- Migration target and migrated data decoding method.
- Event indexing suggestions.
- Known error codes and reasons.
- Security audit status.

Third-party integrators rely on this information for UI, indexing, trade routing, and risk warnings.
