# OpenFour Documentation

Language: English | [繁體中文](./zh-Hant/README.md)

OpenFour is a new modular launch engine introduced by Four.Meme. It provides developers with a contract-level modular creative development and launch platform, enabling new gameplay modules, shared revenue, and a community-built ecosystem.

This directory contains OpenFour documentation for third-party integration, module development, and the FairLaunch sample contracts. The sample code is unaudited and provided only for demo/reference use; it must not be used for any other formal production purpose.

## Documents

- [Integration Guide 0.0.1](./integration-guide.md): for wallets, trading UIs, indexers, data backends, launch platforms, and aggregators integrating creation, estimation, trading, event listening, token recognition, module recognition, error handling, and event interpretation.
- [Developer Guide 0.0.1](./developer-guide.md): for developers building custom OpenFour modules, Presets, validators, or token extensions. It covers architecture principles, module relationships, interface requirements, schemas, validators, and the official website submission flow.
- [FairLaunch Sample](./sample.md): explains the FairLaunch demo contract structure, module responsibilities, and sample gameplay flow under `contracts/`.

## Sample Contracts

The `contracts/` directory contains a FairLaunch reference implementation:

- `contracts/interfaces/`: protocol interfaces used or implemented by custom modules.
- `contracts/libraries/OpenFourTypes.sol`: shared data structures used by Core, modules, tools, and UIs.
- `contracts/token/OpenFourToken.sol`: standard token implementation example.
- `contracts/modules/`: Token, Vault, Curve, Trade, CustomData, and Migrate module examples.
- `contracts/validators/FairLaunchPresetValidator.sol`: FairLaunch cross-module parameter validator example.
- `scripts/`: JavaScript helpers and examples for create-argument encoding, schema resolution, on-chain submission, ABI sync, and encoded tag parsing.

These contracts show how to author OpenFour modules and organize a custom gameplay preset. They are not OpenFour production deployment source code and do not include the full Core, Registry, Deployer, or official review system.
