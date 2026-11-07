# OpenFour Documentation

Language: English | [繁體中文](./docs/zh-Hant/README.md)

OpenFour is a new modular launch engine introduced by Four.Meme. It provides developers with a contract-level modular creative development and launch platform, enabling new gameplay modules, shared revenue, and a community-built ecosystem.

This directory contains OpenFour documentation for third-party integration, module development, and public token / interface references. The FairLaunch example lives in [`developer/startup/`](./developer/startup/). The sample code is unaudited and provided only for demo/reference use; it must not be used for any other formal production purpose.

## Update Highlights — 2026-10-11

- Documented `module.migrate.pcs_v4_sih` graduation and 4Stock → bStock SIH quote cutover for aggregator liquidity switching.
- Documented token `partner` registration on create, FeeRouter protocol-fee partner shares, claim APIs, and `PartnerFeeClaimed` / `kind == 7` accounting.
- Clarified rebate-then-partner-then-treasury protocol-fee split and that partner/developer fees remain pull/claim.
- Synced public `IOpenFourFeeRouter`, `IOpenFourTools`, `CreateTokenArgs`, createArg codec, and ABIs with the partner-aware interfaces.
- Added `TaxToken` and `StrategyTaxToken` identification, tax lifecycle, distribution, manual holder rewards, keeper operations, and gas considerations.
- Documented Core's built-in ZapRouter flow for `BNB -> quoteAsset -> meme token`, including estimation, exact-amount buys, budget buys, refunds, and taxed-token routes.
- Clarified that non-view `OpenFourTools` estimates and ZapRouter quotes require off-chain `staticCall`, with updated public interfaces and ABIs.
- Added Lista V2 migration, pool validation, strategy-tax routing, Lista vault staking, share claiming/redemption, and keeper workflows.
- Expanded tag, module type, token type, migrated-pool discovery, and routing judgment rules.
- Added unverified OpenFour Royalty template development through `ForwardVault`, including royalty splitting, `BaseTaxVault`, and schema requirements.
- Published the relevant token implementations, protocol interfaces, TaxStrategy interfaces, TaxVault base contracts, and synchronized ABIs under `contracts/`.

## Documents

- [Integration Guide 0.0.6](./docs/integration-guide.md): for wallets, trading UIs, indexers, data backends, launch platforms, and aggregators integrating creation, estimation, trading, event listening, token recognition, module recognition, error handling, and event interpretation.
- [TaxToken Tax and Distribution Mechanism](./docs/mechanisms/tax-token.md): explains bonding and migrated tax collection, four-way distribution, manual holder-reward funding, keeper workflows, and gas behavior.
- [Unverified Royalty (`ForwardVault`)](./docs/mechanisms/unverified-royalty.md): how the platform ForwardVault wraps a developer TaxVault template (6%/94% split), how to implement a compliant template, and how to deploy + create a token.
- [Lista V2 Stake-Tax Mechanism](./docs/mechanisms/lista-v2-stake.md): explains StrategyTaxToken identification, Lista V2 pool routing, tax dispatch, Lista vault share distribution, and keeper integration.
- [4Stock → bStock](./docs/mechanisms/4stock-to-bstock-SIH.md): explains `module.migrate.pcs_v4_sih`, 4Stock → bStock pool cutover, and event-driven liquidity-route switching for aggregators.
- [TapeFour](./docs/mechanisms/tape-four.md): Tapeout-protocol meme mining mode (flat NAND fundraising → PCS V2 → mine token); preset-specific detection, NFT events, and trading caveats.
- [Binance Agent ID Exclusive](./docs/mechanisms/binance-agent-id-exclusive.md): Binance Agentic Wallet (with Agent ID)–gated tax bonding (1% hold cap, inner-market transfer lock, 0-tax allowed); preset-specific detection and trading caveats.
- [Developer Guide 0.0.2](./docs/developer-guide.md): for developers building custom OpenFour modules, Presets, validators, or token extensions. It covers architecture principles, module relationships, interface requirements, schemas, validators, and the official website submission flow. The FairLaunch starter is [`developer/startup/`](./developer/startup/).

## Public Contracts

The `contracts/` directory publishes interfaces and token references. FairLaunch modules live only in `developer/startup/`.

- `contracts/interfaces/`: protocol interfaces used or implemented by custom modules.
- `contracts/libraries/OpenFourTypes.sol`: shared data structures used by Core, modules, tools, and UIs.
- `contracts/token/`: public reference source for `OpenFourToken`, `TaxToken`, `StrategyTaxToken`, and other token implementations.
- `contracts/modules/`: public module references for the bundled Bonding / Bonding Tax presets — `vault/` (`StandardVault`, `TaxBondingVault`), `trade/` (`SimpleTradeModule`, `TaxBondingTradeModule`), `data/` (`StandardCustomData`).
- `contracts/taxstrategy/ITaxStrategy.sol`: public interface for per-token strategy-tax integrations.
- `contracts/taxvault/`: public TaxVault interface, `BaseTaxVault` base contract, and platform `ForwardVault` wrapper for custom royalty templates.
- `scripts/`: JavaScript helpers and examples for create-argument encoding, schema resolution, on-chain submission, ABI sync, and encoded tag parsing.
- `developer/`: standalone developer tools, including the FairLaunch Hardhat starter, a BSC Testnet implementation-fork workflow, and the local developer workbench.

These contracts are not OpenFour production deployment source code and do not include the full Core, Registry, Deployer, or official review system.
