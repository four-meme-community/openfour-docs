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

On `npm run fork`, the toolkit deploys a **per-fork `Stock4SihManager` bound to your Core** and reuses the **shared SIH hook** (no hook clone), then points `MIGRATE_BONDING_TAX_PCS_SIH` at a migrate module wired to that Manager. Deploy bytecode is in [`artifacts/`](./artifacts/). Quote must be listed under `source.stock4Sih.quotes` (default: BNC4). If your deployer is not the hookOwner admin, fork still writes the new manager address — an admin must grant CREATOR / CONFIG / WITHDRAW and `monitor.setOperator` before migrate works.

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

## Create / buy / sell / migrate (built-in presets)

After `npm run fork`, the three presets are create-ready (no `register.js`).

**`create-test-preset.js` is a smoke-flow reference** (fixed demo amounts, minimal tax params). Use it to verify fork → create → trade → auto-migrate. It is not a product SDK; build real UIs / apps against Core + Tools schemas (Workbench or your own client).

```bash
cd developer/fork-deploy   # or: cd developer && npm run create-test-preset
cp out/fork-deployment.json ../workbench/data/fork.json   # if using Workbench

PRESET=bondingV1 npm run create-test-preset
PRESET=bondingTaxV1 npm run create-test-preset
PRESET=stock4TaxV1 npm run create-test-preset   # needs BNC4 — see Get BNC4
PRESET=all npm run create-test-preset

SELL=1 PRESET=bondingV1 npm run create-test-preset          # optional sell leg
FORWARD_VAULT=1 TAX_VAULT_TEMPLATE=0xYourTemplate \
  PRESET=bondingTaxV1 npm run create-test-preset            # optional Royalty
```

| Step | Smoke behavior |
| --- | --- |
| Create | Schema from Tools; sign as `Core.signer`; `createToken` |
| Buy | `buyByBudget` until `isSoldOut` (~`3 × raiseAmount` budget) |
| Sell | If `SELL=1`: partial buy → sell ~90% → buy to sell-out |
| Migrate | Usually **auto** on sell-out buy (`phase = Migrated`); do not call `migrate` again |
| ForwardVault | Optional: `FORWARD_VAULT=1` + template — [below](#forwardvault-optional-tax-presets) |

Writes `out/create-test-preset-result.json` and appends `workbench/data/tokens.json`.

FairLaunch / custom presets: `developer/startup` (`register.js` → `create-and-trade.js`), not this script.

### Create amounts (hub validators)

Use a small `raiseAmount` to save test quote (Tools default `18` is optional). Stock4 must keep `saleAmount ≤ 1e9` (Tools default `8e9` reverts).

| Preset | `maxSupply` | `saleAmount` | `raiseAmount` | Suggested create | Quote |
| --- | --- | --- | --- | --- | --- |
| Bonding V1 / Bonding Tax V1 | **> `saleAmount`** | **1e5 – 1e11** | **≥ 0.1** | `maxSupply=1e10`, `saleAmount=8e9`, `raiseAmount=0.1` | WBNB / any ERC20 |
| Stock4 Tax V1 | **> `saleAmount`** | **1e3 – 1e9** | **≥ 0.1** | `maxSupply=1e9`, `saleAmount=8e8`, `raiseAmount=0.1` | BNC4 only — see [Get BNC4](#get-bnc4-on-bsc-testnet) |

## ForwardVault (optional, Tax presets)

Default `create-test-preset` uses founder = deployer (no Royalty wrapper). To exercise **Unverified Royalty / ForwardVault**:

1. Implement + deploy a template (`BaseTaxVault`) — [Unverified Royalty](../../docs/mechanisms/unverified-royalty.md).
2. Create with Tax preset + ForwardVault flag:

```bash
FORWARD_VAULT=1 TAX_VAULT_TEMPLATE=0xYourTemplate \
  TAX_VAULT_INIT_DATA=0x \   # or abi-encoded inner initData
  PRESET=bondingTaxV1 npm run create-test-preset
# or PRESET=stock4TaxV1 (BNC4)
```

| Env | Required | Meaning |
| --- | --- | --- |
| `FORWARD_VAULT=1` | yes | set `taxVaultTypeId = keccak256("SafuSkill.ForwardVault.v1")` |
| `TAX_VAULT_TEMPLATE` | yes | template implementation address |
| `TAX_VAULT_INIT_DATA` | no | inner `initData` hex; default `0x`. Script wraps `abi.encode(template, initData)` |

After create: `token.founder()` is ForwardVault; buy delivers tax (~6% / ~94%). Stock4 sell-out still auto-migrates to SIH; post-migrate tax stays on the ForwardVault path.

## Scope

The bundled source JSON lists public proxy addresses, module ids, the three preset ids, `taxVaultRegistry` / ForwardVault pointers, and `stock4Sih` shared-hook references used when forking Stock4. Implementations and module metadata are read from chain at runtime.
