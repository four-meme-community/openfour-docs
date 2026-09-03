# OpenFour Documentation

Language: English | [繁體中文](./docs/zh-Hant/README.md)

OpenFour is a new modular launch engine introduced by Four.Meme. It provides developers with a contract-level modular creative development and launch platform, enabling new gameplay modules, shared revenue, and a community-built ecosystem.

This directory contains OpenFour documentation for third-party integration, module development, and the FairLaunch sample contracts. The sample code is unaudited and provided only for demo/reference use; it must not be used for any other formal production purpose.

## Update Highlights — 2026-09-03

- Added `TaxToken` and `StrategyTaxToken` identification, tax lifecycle, distribution, manual holder rewards, keeper operations, and gas considerations.
- Documented Core's built-in ZapRouter flow for `BNB -> quoteAsset -> meme token`, including estimation, exact-amount buys, budget buys, refunds, and taxed-token routes.
- Clarified that non-view `OpenFourTools` estimates and ZapRouter quotes require off-chain `staticCall`, with updated public interfaces and ABIs.
- Added `OpenFourFeeRouter.rebate` configuration, events, calculation boundaries, and integration guidance.
- Added Lista V2 migration, pool validation, strategy-tax routing, Lista vault staking, share claiming/redemption, and keeper workflows.
- Expanded tag, module type, token type, migrated-pool discovery, and routing judgment rules.
- Added unverified OpenFour Royalty template development through `ForwardVault`, including royalty splitting, `BaseTaxVault`, and schema requirements.
- Published the relevant token implementations, protocol interfaces, TaxStrategy interfaces, TaxVault base contracts, and synchronized ABIs under `contracts/`.

## Documents

- [Integration Guide 0.0.4](./docs/integration-guide.md): for wallets, trading UIs, indexers, data backends, launch platforms, and aggregators integrating creation, estimation, trading, event listening, token recognition, module recognition, error handling, and event interpretation.
- [TaxToken Tax and Distribution Mechanism](./docs/mechanisms/tax-token.md): explains bonding and migrated tax collection, four-way distribution, manual holder-reward funding, keeper workflows, and gas behavior.
- [Lista V2 Stake-Tax Mechanism](./docs/mechanisms/lista-v2-stake.md): explains StrategyTaxToken identification, Lista V2 pool routing, tax dispatch, Lista vault share distribution, and keeper integration.
- [Developer Guide 0.0.2](./docs/developer-guide.md): for developers building custom OpenFour modules, Presets, validators, or token extensions. It covers architecture principles, module relationships, interface requirements, schemas, validators, and the official website submission flow.
- [FairLaunch Sample](./docs/sample.md): explains the FairLaunch demo contract structure, module responsibilities, and sample gameplay flow under `contracts/`.

## Sample Contracts

The `contracts/` directory contains a FairLaunch reference implementation:

- `contracts/interfaces/`: protocol interfaces used or implemented by custom modules.
- `contracts/libraries/OpenFourTypes.sol`: shared data structures used by Core, modules, tools, and UIs.
- `contracts/token/`: public reference source for `OpenFourToken`, `TaxToken`, `StrategyTaxToken`, and other token implementations.
- `contracts/taxstrategy/ITaxStrategy.sol`: public interface for per-token strategy-tax integrations.
- `contracts/taxvault/`: public TaxVault interface and `BaseTaxVault` base contract for custom royalty templates.
- `contracts/modules/`: Token, Vault, Curve, Trade, CustomData, and Migrate module examples.
- `contracts/validators/FairLaunchPresetValidator.sol`: FairLaunch cross-module parameter validator example.
- `scripts/`: JavaScript helpers and examples for create-argument encoding, schema resolution, on-chain submission, ABI sync, and encoded tag parsing.

These contracts show how to author OpenFour modules and organize a custom gameplay preset. They are not OpenFour production deployment source code and do not include the full Core, Registry, Deployer, or official review system.
