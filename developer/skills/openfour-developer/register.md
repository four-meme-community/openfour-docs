# Register

Register only on a developer-owned Fork Registry (the one in your `fork.json`). Production networks are written by OpenFour after audit.

To walk the FairLaunch example itself, run `developer/startup/scripts/register.js` with `PRESET=fairlaunch` against the current fork. The script reads `developer/startup/presets/fairlaunch.json`.

For a new preset, copy that JSON (for example to `presets/my-play.json`) and change only the JSON. Do not copy the JS scripts. Then `PRESET=my-play` `create-and-trade.js` does one create / buy / sell loop using the on-chain schema.

## Steps

1. Deploy the implementation (and token impl / validator if needed) to the fork chain with the current Hardhat network. Record the addresses.
2. Call `upsertModule`.
3. If there is a custom token: `upsertTokenImpl(tokenImplId, implementation, version)`.
4. Call `upsertPreset` to bind the five slots (plus optional customData / tokenImpl / validator) into one preset.

The caller must be `Registry.owner()`, which is the fork-deploy deployer.

## moduleKey

```js
moduleKey = keccak256(toUtf8Bytes("module.curve.my_play"))
```

`kind`: 0 Token / 1 Vault / 2 Curve / 3 Trade / 4 Migrate. CustomData follows the Registry convention (5 in the Developer Guide).

```js
registry.upsertModule(
  moduleKey,
  implementation,
  kind,
  {
    moduleId: moduleKey,
    version: "1.0.0",
    name: "MyCurveModule",
    description: "...",
    author: deployer,
    feeShareBps: 0
  },
  true // active
)
```

ABI: `developer/workbench/src/eth/moduleRegistry.js`.

## Preset

Unchanged slots reuse `fork.json.moduleIds`:

- Token `TOKEN_STANDARD`
- Vault `VAULT_BASIC`
- Curve `CURVE_BONDING`
- Trade `TRADE_SIMPLE`
- Migrate `MIGRATE_BONDING`

Also reuse the fork bonding preset `tokenImplId` / `validator` when they still apply.

```js
registry.upsertPreset({
  id, // uint256, chosen by you, must not collide
  name,
  description,
  version: "1.0.0",
  active: true,
  createEnabled: true,
  validator, // non-zero recommended
  tokenModuleId,
  vaultModuleId,
  curveModuleId,
  tradeModuleId,
  migrateModuleId,
  tokenImplId,
  customDataId, // bytes32(0) if unused
  author: deployer
})
```

`active=false` disables the whole Preset. `createEnabled=false` only blocks new creates.

## Forbidden

- Upsert a Registry you do not own.
- Register on `chainId` 56 / 4663.
- Point `fork.json` at the shared developer hub and register there unless you are its owner.
- Register an implementation that is uncompiled, untested, or whose schema does not match `Params`.

## Workspace write

After success, update `developer/workbench/data/fork.json`:

```json
{
  "developerModules": [
    { "keySource": "module.curve.my_play", "moduleKey": "0x…", "implementation": "0x…", "kind": 2, "name": "MyCurveModule", "txHash": "0x…" }
  ],
  "developerPresets": [
    { "id": "…", "name": "MyPlay", "txHash": "0x…" }
  ]
}
```

On-chain check: `getModule(moduleKey)`, `getPreset(id)`, `getPresetIds()`.

The Workbench Register page lists on-chain modules and presets the same way Admin Console does: collect known keys from `fork.json` (`moduleIds` / beacons / developer rows) plus Preset slots, then `getModule` + `getModuleImplementation` + `getModuleBeacon` in parallel and keep rows whose beacon is set. Presets use `getPresetIds()` then `getPreset`. Load a row to fill the form; same moduleKey / Preset ID overwrites (beacon upgrade).
