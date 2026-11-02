# OpenFour Developer Toolkit

Developer-facing sandbox tools for building and testing OpenFour modules and presets.

Read the official docs first:

- [Developer Guide](../docs/developer-guide.md) ([繁體中文](../docs/zh-Hant/developer-guide.md)): module roles, interfaces, schema, `revertData`, registration, and official submit. It points at [`startup/`](./startup/) for the FairLaunch example.

## Contents

- [`startup/`](./startup/): FairLaunch Hardhat starter (solc 0.8.24). Gameplay is `startup/presets/*.json`. Generic `register.js` / `create-and-trade.js` / `pack-submit.js`. No OpenFour Core source.
- [`fork-deploy/`](./fork-deploy/): creates a developer-owned proxy set from the shared developer hub on BSC Testnet.
- [`workbench/`](./workbench/): local 7-step developer workbench. Fork addresses and created tokens live in `workbench/data/*.json`; the token list is read from that file, not from chain logs.
- [`frontend-style/`](./frontend-style/): official-website style tokens for **temporary** Preset UI. Extra pages are submitted with the audit pack as reference; OpenFour ports approved flows into the official site.
- [`skills/`](./skills/): agent skills for the same development workflow — environment, module development, fork registration, create/trade/migrate verification, AI security audit, and official submit materials.

From this directory: `npm run setup`, then `npm run fork`, `npm run register`, `npm run create-trade`, `npm run workbench`.

These tools are for development and testing on a developer-owned fork. Inclusion in this directory does not imply that a module or preset is approved for production.
