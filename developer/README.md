# OpenFour Developer Toolkit

Developer-facing sandbox tools for building and testing OpenFour modules and presets.

Read the official docs first:

- [Developer Guide](../docs/developer-guide.md) ([繁體中文](../docs/zh-Hant/developer-guide.md)): module roles, interfaces, schema, `revertData`, registration, and official submit. It points at [`startup/`](./startup/) for the FairLaunch example.

## Contents

- [`startup/`](./startup/): FairLaunch Hardhat starter (solc 0.8.24). Gameplay is `startup/presets/*.json`. Generic `register.js` / `create-and-trade.js` / `pack-submit.js`. No OpenFour Core source.
- [`fork-deploy/`](./fork-deploy/): developer-owned proxy set on BSC Testnet (Bonding V1 / Bonding Tax / Stock4 Tax). After fork, `npm run create-test-preset` is a **smoke-flow reference** (create / buy / sell / auto-migrate; optional ForwardVault).
- [`workbench/`](./workbench/): local 7-step developer workbench. Fork addresses and created tokens live in `workbench/data/*.json`; the token list is read from that file, not from chain logs.
- [`frontend-style/`](./frontend-style/): official-website style tokens for **temporary** Preset UI. Extra pages are submitted with the audit pack as reference; OpenFour ports approved flows into the official site.
- [`skills/`](./skills/): agent skills for the same development workflow — environment, module development, fork registration, create/trade/migrate verification, AI security audit, and official submit materials.

From this directory:

```bash
npm run setup
npm run fork                          # developer-owned proxy set + 3 built-in presets
PRESET=bondingV1 npm run create-test-preset   # smoke reference; or bondingTaxV1 / stock4TaxV1 / all
# optional: SELL=1 · FORWARD_VAULT=1 TAX_VAULT_TEMPLATE=0x… (Tax presets)
# FairLaunch custom path (separate): npm run register && npm run create-trade
npm run workbench
```

These tools are for development and testing on a developer-owned fork. Inclusion in this directory does not imply that a module or preset is approved for production.
