# Develop

OpenFourCore only dispatches standard interfaces. A new preset usually replaces the slot that actually changes. Interfaces and types are defined in `contracts/interfaces/` and `contracts/libraries/OpenFourTypes.sol`.

## Token implementation

- Standard preset uses `OpenFourToken`, initialized and minted by the Token module.
- Prefer existing sources in `contracts/token/` for tax, rewards, or external-market behavior: `TaxToken`, `StrategyTaxToken`, `CreatorRewardsToken`, `UniToken`, `Stock4TaxToken`, `TapeoutOpenFourToken`.
- If extension is required, inherit `OpenFourToken`, call `__OpenFourToken_init`, and keep standard getters and module references.
- Put external-market preset on the token (post-migrate tax, migrated pool, external fees). Internal-market pricing and fills still go through Curve / Trade.
- Register with `tokenImplId`, separate from the Token module `module.token.*`.

## Five slots + optional CustomData

| kind | Interface | Responsibility | Notes |
| --- | --- | --- | --- |
| 0 Token | `IOpenFourTokenModule` | Initialize ERC20, inject modules, mint | No trading / pricing / migration |
| 1 Vault | `IOpenFourVault` | Custody quote; track remainingForSale / totalRaised / phase | High risk; prefer StandardVault |
| 2 Curve | `IOpenFourCurveModule` | Pricing, view | Use `ctx.trader`; do not store history |
| 3 Trade | `IOpenFourTradeModule` | Policy and fees, view | Ordinary rejection returns `allowed=false`; do not revert |
| 4 Migrate | `IOpenFourMigrateModule` | Graduation and migration actions | `evaluate` is read-only; `execute` re-checks |
| 5 CustomData | `IOpenFourCustomDataModule` | Optional shared state and hooks | Only Core may write hooks |

Every new module must have:

- `init` once, binding `fourCore` / `token` (Migrate also binds `feeRouter`)
- Decode and validate raw params; store raw init params and module version
- Stable `descriptor()` tag and `getInitParams()`
- `moduleEncodeSchema()` matching `Params` ABI order
- Core interface functions plus Hardhat tests

## Implementation notes

**Curve** — `evaluate` / `evaluateReverse` / `getInitialPrice` / `getLastPrice` / `getLiquiditySnapshot`. Check token binding. Prevent quote overflow; prefer `Math.mulDiv`. Partial fills use `adjustedAmount`; full rejection uses `executable=false`. `buyByBudget` requires reverse quotes.

**Trade** — `evaluate` returns `allowed, minAmount, maxAmount, fees, revertData`. View-only. Put cumulative / cooldown / whitelist state in CustomData; Trade only reads. Cap fee bps; recipient must be non-zero. Ordinary rejection is `allowed=false` plus `revertData` encoded as `error Xxx(...)` via `abi.encodeWithSelector`, not a revert. Core later calls `OpenFourTypes.revertIfDisallowed`.

**CustomData** — Implement only for cumulative, cooldown, whitelist, or migration snapshots. `afterHook` / `onMigrate` record post-execution facts and do not approve trades.

**Migrate** — `evaluate` decides only. `executeMigration` is onlyCore, does not trust `hookData`, and re-checks conditions and amount caps. FairLaunch inlines the official PCS V2 path: empty pair, vault transfers, `pair.mint`, LP to `0xdead` when recipient is empty. Return `migratedDataVersion` + `encodedMigratedData`. `soldOut` is not a graduation prerequisite for every preset.

**Vault** — onlyCore accounting; only Migrate pulls migration assets. Use `SafeERC20`. Do not price or decide eligibility.

**Token module** — Initialize the implementation, inject module addresses, write name/symbol/maxSupply/uri.

## Schema

Implement `IOpenFourModuleSchema.moduleEncodeSchema()`. Modules with no params return `"0x"`.

Encode as a **single tuple**:

```js
AbiCoder.encode(["(uint256,bool,address)"], [[v1, v2, v3]])
```

Do not `encode(["uint256","bool","address"], [v1, v2, v3])`. On-chain decode is `abi.decode(rawParams, (Params))`. Schema is UI help only; full validation stays in `init` + validator.

## Descriptor and key

Stable strings:

- Token: `token.<name>`
- Module: `module.<slot>.<name>` (token / vault / curve / trade / migrate / data)

```solidity
bytes32 moduleKey = keccak256(bytes("module.curve.my_play"));
bytes8 tagId = bytes8(keccak256(bytes("module.curve.my_play")));
```

Compatible fixes (interface, storage, ABI, and semantics unchanged) may reuse the same moduleKey and upgrade the implementation. Otherwise use a new key.

## Validator

Put cross-module invariants in `IOpenFourPresetValidator`. See `developer/startup/contracts/validators/FairLaunchPresetValidator.sol`. Examples: `saleAmount < maxSupply`, raise/softCap, curve vs supply, CustomData required when cumulative caps are on. A module `init` validates only itself.

A Preset with `validator = address(0)` generally should not be `createEnabled`.

## Minimum tests

For each new module:

1. `init` succeeds; a second `init` reverts.
2. Non-Core writers revert.
3. Wrong-token context is rejected.
4. Schema encode ↔ `abi.decode` round-trip.
5. Core paths: pricing / allow vs deny / can migrate vs cannot.
6. If a validator exists: valid params pass, out-of-range params fail.

Compile with `npx hardhat compile`. Test with `npx hardhat test`.
