# OpenFour Fork Deploy

Creates a developer-owned OpenFour proxy set on BSC Testnet from the bundled address list. It does not compile or contain the OpenFour Core, Registry, FeeRouter, Deployer, or Tools implementation source.

## What you get after `npm run fork`

Three example presets are copied onto **your** Registry by default:

| Key in `fork.json` | Preset id | Token | Vault / Trade (reference) | What you can test |
| --- | --- | --- | --- | --- |
| `presets.bondingV1` | `1778027615722` | [`OpenFourToken.sol`](../../contracts/token/OpenFourToken.sol) | [`StandardVault`](../../contracts/modules/vault/StandardVault.sol) · [`SimpleTradeModule`](../../contracts/modules/trade/SimpleTradeModule.sol) | Standard bonding create / buy / sell / PCS-style migrate smoke |
| `presets.bondingTaxV1` | `1778027615723` | [`TaxToken.sol`](../../contracts/token/TaxToken.sol) | [`TaxBondingVault`](../../contracts/modules/vault/TaxBondingVault.sol) · [`TaxBondingTradeModule`](../../contracts/modules/trade/TaxBondingTradeModule.sol) | TaxToken bonding tax + **Unverified Royalty / ForwardVault** (WBNB quote OK) |
| `presets.stock4TaxV1` | `1778027615733` | [`Stock4TaxToken.sol`](../../contracts/token/Stock4TaxToken.sol) | same TaxBonding vault / trade as Bonding Tax | **Stock4 tax token** (BNC4 quote): bonding tax → ForwardVault; **migrate into Pancake Infinity SIH** |

Shared blank custom-data slot (when used): [`StandardCustomData.sol`](../../contracts/modules/data/StandardCustomData.sol).

Modules copied when present on the source Registry:

- Standard: `TOKEN_STANDARD`, `VAULT_BASIC`, `CURVE_BONDING`, `TRADE_SIMPLE`, `MIGRATE_BONDING`
- Royalty / Bonding Tax: `TOKEN_TAX`, `VAULT_TAX_BONDING`, `TRADE_TAX_BONDING`, `MIGRATE_BONDING_TAX`
- Stock4 Tax: `TOKEN_TAX_STOCK`, `MIGRATE_BONDING_TAX_PCS_SIH` (plus shared tax vault / trade / curve)

Tax creates also wire `taxVaultRegistry` so `SafuSkill.ForwardVault.v1` is available. Template contracts for Royalty live under `contracts/taxvault/` (`BaseTaxVault`, `ForwardVault`). Mechanism detail: [Unverified Royalty](../../docs/mechanisms/unverified-royalty.md). Stock4 / SIH cutover background: [4Stock → bStock](../../docs/mechanisms/4stock-to-bstock-SIH.md).

### Stock4 Tax V1 (SIH + Stock4 tax token)

Use this preset when you need:

- **`Stock4TaxToken`** create / buy / sell on a **Stock4 quote** (default **BNC4**)
- Bonding **quote tax** into **ForwardVault** (same Unverified Royalty path as Bonding Tax V1)
- **Graduation into a PancakeSwap Infinity Shared Inventory Hook (SIH)** pool (meme / Stock4)

On `npm run fork`, the toolkit deploys a **per-fork `Stock4SihManager` bound to your Core** and reuses the **shared SIH hook** (no hook clone), then points `MIGRATE_BONDING_TAX_PCS_SIH` at a migrate module wired to that Manager. Quote must be listed under `source.stock4Sih.quotes` (default: BNC4). If your deployer is not the hookOwner admin, fork still writes the new manager address — an admin must grant CREATOR / CONFIG / WITHDRAW and `monitor.setOperator` before migrate works.

### Get BNC4 on BSC Testnet

Stock4 Tax creates need a whitelist Stock4 as `quoteAsset`. Default quote:

| | |
| --- | --- |
| Symbol | **BNC4** |
| Address | `0xB179cBFdE44a9960Dd6C88bC3D163d36C65ae7C9` |

Ways to obtain test BNC4:

1. **PancakeSwap V3** (lowest fee **100**): pair **WBNB / BNC4** pool `0xA2f75f1D74220A3A57aD89CB7823A5FeDA446700` — swap tBNB → BNC4.
2. **PancakeSwap V3** MockU / BNC4 (fee **500**): pool `0x73A96a5a3C550321AFA65661F97BD1982062ac5E` — if you hold MockU (`0xEE05e8Dc16A1ff7bd79C0a4C38Fe31c973Dc6ab3`), swap MockU → BNC4.
3. **Stock4Exchange** (`0xF6027a20D44cc95872762a25a597E6E4Ab2Df762`): buy BNC4 with the exchange quote token (same MockU). Needs a filled buy order on testnet.

You also need enough **test BNB** for gas, wrapping WBNB, and (for Stock4 create / buy) BNC4 balance + ERC-20 approvals.

If you only want ForwardVault / tax-split testing and do **not** need SIH or Stock4 semantics, use **Bonding Tax V1** with **WBNB** instead — no BNC4 required.

## Source

`source/bsctestnet.json` is the default address list. `npm run fork` reads it, reuses on-chain implementations, and deploys a new proxy set you own.

Register modules only on the Registry you forked (the one in your `fork.json`).

## Requirements

- Node.js 18+
- A BSC Testnet RPC, or a local Anvil/Hardhat fork of BSC Testnet
- Test BNB when broadcasting to BSC Testnet
- For Stock4 Tax V1: test **BNC4** (see above)

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

## Create with the three built-in presets

After `fork.json` is imported, the bundled presets are create-ready (no extra `register.js` for these).

1. Start Workbench: `cd developer && npm run workbench`
2. Open **Create**, pick a preset from the fork list:
   - **Bonding V1** — standard OpenFourToken bonding
   - **Bonding Tax V1** — TaxToken + ForwardVault Royalty (WBNB quote OK)
   - **Stock4 Tax V1** — Stock4TaxToken + ForwardVault; set `quoteAsset` = **BNC4**; after bonding, migrate to exercise **SIH**
3. Fill schema fields from `OpenFourTools.getPresetEncodeSchemas(presetId)`, sign as `Core.signer` (fork deployer by default), then create.
4. Use **Tokens** for buy / sell / migrate checks. Records append to `workbench/data/tokens.json`.

Preset ids are also in `fork.json` → `presets.bondingV1` / `presets.bondingTaxV1` / `presets.stock4TaxV1`.

FairLaunch and other custom presets still go through `developer/startup` (`PRESET=…` → `register.js` → `create-and-trade.js`); that path is separate from these bundled examples.

## Develop and test ForwardVault on a tax preset

Use this when building an **unverified TaxVault template** (6% / 94% royalty split).

1. **Fork** as above so your Registry has Bonding Tax V1 and/or Stock4 Tax V1 + `taxVaultRegistry` / ForwardVault.
2. **Implement** a clone-compatible template: inherit `contracts/taxvault/BaseTaxVault.sol`, implement `_customInit`, `authorWallet()`, `moduleEncodeSchema()`, and payable `receive()`. Follow [Unverified Royalty](../../docs/mechanisms/unverified-royalty.md).
3. **Deploy** the template implementation to BSC Testnet (same deployer key as the fork is fine).
4. **Create** with **Bonding Tax V1** or **Stock4 Tax V1**:
   - `taxVaultTypeId = keccak256("SafuSkill.ForwardVault.v1")`
   - Outer vault params `abi.encode(template, initData)`
   - Configure buy/sell tax so trades pay into the founder vault
   - Stock4 Tax: `quoteAsset` = BNC4 (or another allowlisted Stock4)
5. **Verify** after create: TaxToken / Stock4TaxToken path; `founder` is ForwardVault; `clonedVault()` / `authorWallet()` look right.
6. **Trade** (buy) so tax is delivered; confirm ~6% / ~94% split.
7. **(Stock4 only)** Migrate when ready to open the meme on the **shared SIH hook** (Infinity inventory pool). Post-migrate tax is withheld by the hook into quote and still dispatches to ForwardVault.

For audit submit of a new Royalty template, include contract source, schema notes, and create/trade evidence. If the template needs extra product UI, build a temporary page with `developer/frontend-style/` as reference; OpenFour ports approved flows into the website after review.

## Scope

The bundled source JSON lists public proxy addresses, module ids, the three preset ids, `taxVaultRegistry` / ForwardVault pointers, and `stock4Sih` shared-hook references used when forking Stock4. Implementations and module metadata are read from chain at runtime.
