# OpenFour Fork Deploy

Creates a developer-owned OpenFour proxy set on BSC Testnet from the bundled address list. It does not compile or contain the OpenFour Core, Registry, FeeRouter, Deployer, or Tools implementation source.

## What you get after `npm run fork`

Two example presets are copied onto **your** Registry by default:

| Key in `fork.json` | Preset id | Token | Vault / Trade (reference) | Role |
| --- | --- | --- | --- | --- |
| `presets.bondingV1` | `1778027615722` | [`OpenFourToken.sol`](../../contracts/token/OpenFourToken.sol) | [`StandardVault`](../../contracts/modules/vault/StandardVault.sol) · [`SimpleTradeModule`](../../contracts/modules/trade/SimpleTradeModule.sol) | Standard bonding create / buy / sell / migrate |
| `presets.bondingTaxV1` | `1778027615723` | [`TaxToken.sol`](../../contracts/token/TaxToken.sol) | [`TaxBondingVault`](../../contracts/modules/vault/TaxBondingVault.sol) · [`TaxBondingTradeModule`](../../contracts/modules/trade/TaxBondingTradeModule.sol) | TaxToken bonding + Royalty path for unverified `ForwardVault` templates |

Shared blank custom-data slot (when used): [`StandardCustomData.sol`](../../contracts/modules/data/StandardCustomData.sol).

Modules copied when present on the source Registry:

- Standard: `TOKEN_STANDARD`, `VAULT_BASIC`, `CURVE_BONDING`, `TRADE_SIMPLE`, `MIGRATE_BONDING`
- Royalty / Bonding Tax: `TOKEN_TAX`, `VAULT_TAX_BONDING`, `TRADE_TAX_BONDING`, `MIGRATE_BONDING_TAX`

Tax creates also wire `taxVaultRegistry` so `SafuSkill.ForwardVault.v1` is available. Template contracts for Royalty live under `contracts/taxvault/` (`BaseTaxVault`, `ForwardVault`). Mechanism detail: [Unverified Royalty](../../docs/mechanisms/unverified-royalty.md).

## Source

`source/bsctestnet.json` is the default address list. `npm run fork` reads it, reuses on-chain implementations, and deploys a new proxy set you own.

Register modules only on the Registry you forked (the one in your `fork.json`).

## Requirements

- Node.js 18+
- A BSC Testnet RPC, or a local Anvil/Hardhat fork of BSC Testnet
- Test BNB when broadcasting to BSC Testnet

## Usage

```bash
cd developer/fork-deploy
npm install
cp .env.example .env
# Set DEPLOYER_PRIVATE_KEY. RPC defaults to https://bsc-testnet.publicnode.com
npm run fork:dry
npm run fork
```

`fork:dry` reads the current on-chain implementations and configuration without sending transactions. `fork` deploys a new proxy set owned by `DEPLOYER_PRIVATE_KEY` and writes its public addresses to `out/fork-deployment.json`.

Copy that file to `developer/workbench/data/fork.json` for the Workbench / startup scripts.

Never commit `.env`, private keys, or files under `out/`.

## Create with the two built-in presets

After `fork.json` is imported, both presets are create-ready (no extra `register.js` for these two).

1. Start Workbench: `cd developer && npm run workbench`
2. Open **Create**, pick a preset from the fork list:
   - **Bonding V1** — [`OpenFourToken`](../../contracts/token/OpenFourToken.sol) + [`StandardVault`](../../contracts/modules/vault/StandardVault.sol) + [`SimpleTradeModule`](../../contracts/modules/trade/SimpleTradeModule.sol)
   - **Bonding Tax V1** — [`TaxToken`](../../contracts/token/TaxToken.sol) + [`TaxBondingVault`](../../contracts/modules/vault/TaxBondingVault.sol) + [`TaxBondingTradeModule`](../../contracts/modules/trade/TaxBondingTradeModule.sol); use for Royalty / ForwardVault
3. Fill schema fields from `OpenFourTools.getPresetEncodeSchemas(presetId)`, sign as `Core.signer` (fork deployer by default), then create.
4. Use **Tokens** for buy / sell / migrate checks. Records append to `workbench/data/tokens.json`.

Preset ids are also in `fork.json` → `presets.bondingV1` / `presets.bondingTaxV1`.

FairLaunch and other custom presets still go through `developer/startup` (`PRESET=…` → `register.js` → `create-and-trade.js`); that path is separate from these two bundled examples.

## Develop and test ForwardVault on the Royalty preset

Use this when building an **unverified TaxVault template** (6% / 94% royalty split).

1. **Fork** as above so your Registry has Bonding Tax V1 + `taxVaultRegistry` / ForwardVault.
2. **Implement** a clone-compatible template: inherit `contracts/taxvault/BaseTaxVault.sol`, implement `_customInit`, `authorWallet()`, `moduleEncodeSchema()`, and payable `receive()`. Follow [Unverified Royalty](../../docs/mechanisms/unverified-royalty.md).
3. **Deploy** the template implementation to BSC Testnet (same deployer key as the fork is fine).
4. **Create** with **Bonding Tax V1** in Workbench (or an equivalent signed `createToken`):
   - Set vault type to ForwardVault: `taxVaultTypeId = keccak256("SafuSkill.ForwardVault.v1")`
   - Pass outer vault params as `abi.encode(template, initData)` where `template` is your deployed implementation and `initData` matches your schema
   - Configure buy/sell tax rates so trades actually pay tax into the founder vault
5. **Verify** after create:
   - Token is a TaxToken path; `founder` is a ForwardVault clone
   - ForwardVault `clonedVault()` is your template instance; `authorWallet()` matches the template
6. **Trade** (buy) so tax is delivered; confirm ~6% to `authorWallet()` and ~94% to the cloned template (native or ERC20 per quote rules).

For audit submit of a new Royalty template, include contract source, schema notes, and create/trade evidence. If the template needs extra product UI, build a temporary page with `developer/frontend-style/` as reference; OpenFour ports approved flows into the website after review.

## Scope

The bundled source JSON lists public proxy addresses, module ids, Bonding V1 / Bonding Tax V1 preset ids, and `taxVaultRegistry` / ForwardVault pointers. Implementations and module metadata are read from chain at runtime.
