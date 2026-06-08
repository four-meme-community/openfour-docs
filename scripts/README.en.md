# OpenFour JavaScript Scripts

JavaScript helpers for third-party OpenFour integrations: wallets, trading UIs, launch platforms, indexers, and backend services. They cover common on-chain integration flows, not just token creation:

- **Schema / Preset**: read preset and module schemas from Registry / Tools, and build UI-agnostic form layouts
- **Token creation**: assemble backend requests, normalize `createArg`, and submit `createToken`
- **Internal-market trading**: call OpenFourTools estimates, apply slippage, handle ERC20 approvals, and submit buy / sell
- **Token / module identification**: parse `TokenCreated.encodedTags` and resolve token/module tags
- **Contract ABIs**: bundled Core / Tools / Registry / interface / token ABIs
- **Uni V4 hookSalt**: pre-mine CREATE2 `hookSalt` for Uni token presets with valid Pancake Infinity hook flags

For full protocol details, see [`integration-guide.md`](../integration-guide.md).

## Use cases

| Scenario | Main helpers | Example |
| --- | --- | --- |
| Read preset and create schemas | `resolvePresetCreateSchema`, `buildCreateFormPlan` | `examples/04-list-preset-create-schemas.example.mjs` |
| Build backend create request | `buildCreateTaxTokenRequest`, `encodeModuleParams` | `examples/01-build-backend-payload.example.mjs` |
| Submit `createToken` | `prepareCreateTokenOnChain`, `submitCreateTokenOnChain` | `examples/02-submit-onchain.example.mjs` |
| Four.meme API + on-chain | `createFourMemeApiClient`, `createTokenWithBackendAndChain` | `examples/03-create-tax-token-with-backend.example.mjs` |
| Trade estimate and submit | `estimateBuyExactAmount`, `buildBuyExactAmountTx`, `submitTradeTx` | `examples/06-trade-with-slippage.example.mjs` |
| Parse `encodedTags` | `parseCreationEncodedTags` | `examples/05-parse-encoded-tags.example.mjs` |
| Mine Uni V4 `hookSalt` | `mineUniHookCloneSalt`, `ensureHookSaltAvailable` | `examples/07-mine-uni-hook-salt.example.mjs` |

## Layout

```
abi/                          # Bundled contract ABIs (JSON)
examples/                     # Standalone examples (.mjs)
scripts/
  verify-create-args.mjs      # Verify createArg encode/decode (optional)
api/
  fourMemeClient.js           # Four.meme login/upload/create API adapter
create/
  buildCreatePayload.js       # Build backend POST body
  createArgCodec.js           # Decode/normalize backend createArg
  createFlow.js               # Backend API + on-chain (generic)
  createOnChain.js            # On-chain createToken
  createResponse.js           # Normalized create API response validation
  createTaxTokenFlow.js       # Tax preset convenience flow
schema/
  encodeFromSchema.js         # Schema encode/decode
  loadPresetSchemas.js        # Read Tools/Registry on-chain
  resolvePresetCreateSchemas.js # Resolve create schema per preset
  schemaLayout.js             # Schema field layout/default helpers
tags/
  encodedTags.js              # Parse TokenCreated.encodedTags
  moduleTags.js               # Token module tag helpers
trade/
  tradeFlow.js                # Estimate, slippage, approval, and trade helpers
uni/
  mineUniHookCloneSalt.js     # Mine Uni V4 hook CREATE2 salt
index.js                        # Public exports
```

## Install

Install dependencies from this directory before running examples:

```bash
npm install
```

## Quick start

Run examples from this directory (`cd` into the folder that contains `index.js`).

### A. Schema and Preset

See `examples/04-list-preset-create-schemas.example.mjs`

```js
import {
  resolveAllPresetCreateSchemas,
  resolvePresetCreateSchema,
  CREATE_MODE,
} from './index.js'

const { summary, items, byId } = await resolveAllPresetCreateSchemas({
  registryAddress: '0x...',
  provider,
})

const one = await resolvePresetCreateSchema({
  registryAddress: '0x...',
  presetId: '1778027615723',
  provider,
})
// one.preset.tokenModuleTag  — on-chain module descriptor().tag (source of truth)
// one.mode                   — SDK label only (see “CREATE_MODE vs on-chain” below)
// one.flags.needsVaultSelection / needsHookSalt — derived from tag + schema fields
```

You can turn the resolved params into UI-agnostic field models:

```js
import { buildCreateFormPlan } from './index.js'

const plan = buildCreateFormPlan({
  baseSchema: one.baseSchema,
  schemas: one.schemas,
  activeParams: one.activeParams,
  quoteAsset: '0x...',      // selected ERC20 quote asset
  templateConfig: {
    symbol: 'BNB',
    totalSupply: '1000000000',
    saleAmount: '800000000',
    raisedAmount: '18',
  },
})

// plan.fields        — display-ready field metadata
// plan.defaults      — schema defaults plus template config defaults
// plan.sections      — fields grouped by base/token/curve/trade/migrate/customData
```

#### CREATE_MODE vs on-chain (not a contract enum)

`CREATE_MODE` is defined by this SDK for convenience. OpenFour contracts use **module tags** and **encode schemas**, not `CREATE_MODE`.

| SDK `one.mode` | How it is inferred | On-chain signal to check |
| --- | --- | --- |
| `uni_v4` | First: Uni token module | `one.preset.tokenModuleTag === 'module.token.uni'` |
| `tax` | Else: tax token module | `one.preset.tokenModuleTag === 'module.token.tax'` |
| `generic` | Else: standard / other | e.g. `tokenModuleTag === 'module.token.standard'` |

Priority: `uni_v4` → `tax` → `generic`. Prefer `preset.tokenModuleTag` and `flags` over `mode` when branching in your app.

```bash
REGISTRY_ADDRESS=0xYourRegistry RPC_URL=https://bsc-testnet.publicnode.com \
  node examples/04-list-preset-create-schemas.example.mjs
```

### B. Token creation

#### B1) Build backend request only

See `examples/01-build-backend-payload.example.mjs`

```js
import { buildCreateTaxTokenRequest, resolvePresetCreateSchema } from './index.js'

const { schemas, activeParams, preset } = await resolvePresetCreateSchema({
  registryAddress,
  presetId,
  provider,
})
const { payload } = buildCreateTaxTokenRequest({
  presetId,
  schemas,
  taxInfo,
  activeParam: activeParams,
  tokenModuleTag: preset.tokenModuleTag,
})
await postCreate(payload)
```

#### B2) Submit on-chain only (backend already returned createArg)

See `examples/02-submit-onchain.example.mjs`

```js
import { prepareCreateTokenOnChain, submitCreateTokenOnChain } from './index.js'

const { createArg, signature, txValue } = prepareCreateTokenOnChain({
  rawCreateArg: data.createArg,
  signature: data.signature,
  wrappedNative: '0x...', // WBNB / WETH on this chain
})

await submitCreateTokenOnChain({ signer, coreAddress, createArg, signature, txValue })
```

#### B3) Backend + on-chain

See `examples/03-create-tax-token-with-backend.example.mjs`. The example performs:

1. `nonce/generate` + wallet `signMessage` + `login/dex`
2. `token/upload` to obtain the final `imgUrl`
3. `token_template/token/create` to obtain `createArg` + `signature`
4. `OpenFourCore.createToken(createArg, signature)`

```js
import {
  createFourMemeApiClient,
  createTaxTokenWithBackendAndChain,
} from './index.js'

const api = createFourMemeApiClient()
const { accessToken } = await api.loginWithSigner({ signer })
const imgUrl = await api.uploadTokenImage({ accessToken, file, filename })
await createTaxTokenWithBackendAndChain({
  buildRequest: { /* buildCreateTaxTokenRequest input, including imgUrl */ },
  postCreate: (payload) => api.postCreate(payload, { accessToken }),
  signer,
  coreAddress,
  wrappedNative: '0x...',
})

// Generic (any POST body):
import { createTokenWithBackendAndChain } from './index.js'
await createTokenWithBackendAndChain({ buildPayload: payload, postCreate, signer, coreAddress })
```

`createFourMemeApiClient` uses `/private/token_template/token/create`, matching this OpenFour integration guide.

### C. Internal-market trading

See `examples/06-trade-with-slippage.example.mjs`

```bash
TRADE_ACTION=buyExact \
REGISTRY_ADDRESS=0x... TOKEN_ADDRESS=0x... PRIVATE_KEY=0x... \
AMOUNT=100 SLIPPAGE_BPS=500 RPC_URL=https://... \
node examples/06-trade-with-slippage.example.mjs
```

Supports `buyExact`, `buyByBudget`, and `sellExact`. Typical flow:

1. Read Core / Tools addresses from Registry
2. Read token runtime config
3. Call `estimateBuy*` / `estimateSell*` for quotes
4. Apply slippage to derive `maxQuotePayAmount` / `minAmountOut` / `minQuoteReceiveAmount`
5. For ERC20 quote paths, `approve(core, amount)` before submission

Slippage rules mirrored from the frontend:

- Exact-amount buy: apply slippage upward to `estimate.userPays` as `maxQuotePayAmount`
- Budget buy: keep the user budget as `maxQuotePayAmount`; apply slippage downward to `estimate.tokenAmount` as `minAmountOut`
- Exact-amount sell: apply slippage downward to `estimate.userReceives` as `minQuoteReceiveAmount`
- Native quote path sends `msg.value`; ERC20 quote path requires `approve(core, amount)` first

### D. Parse encodedTags

See `examples/05-parse-encoded-tags.example.mjs`

```js
import { parseCreationEncodedTags } from './index.js'

const decoded = parseCreationEncodedTags(tokenCreatedEvent.encodedTags)
// decoded.tagIds.token / tokenModule / vault / curve / trade / migrate / customData
```

Useful for indexers, market pages, and trading UIs to identify token type and bound module tags after `TokenCreated`.

### E. Mine Uni V4 hookSalt

See `examples/07-mine-uni-hook-salt.example.mjs`

Uni token presets require a non-zero `hookSalt`. CREATE2 deployer is `OpenFourDeployer`; implementation comes from Registry `uniTokenV4HookImpl`. The predicted clone address must satisfy Pancake Infinity hook flag bits in the low 14 bits, and the slot must not already contain bytecode.

```js
import { Contract, JsonRpcProvider } from 'ethers'
import { OpenFourRegistryAbi, mineUniHookCloneSalt } from './index.js'

const provider = new JsonRpcProvider(RPC_URL)
const registry = new Contract(registryAddress, OpenFourRegistryAbi, provider)
const [createDeployer, hookImplementation] = await Promise.all([
  registry.createDeployer(),
  registry.uniTokenV4HookImpl(),
])

const mined = await mineUniHookCloneSalt(provider, createDeployer, hookImplementation)
// mined.salt -> tokenParams.hookSalt
// mined.hookAddress -> predicted UniTokenV4Hook clone address
```

Before submitting createToken, call `ensureHookSaltAvailable` to re-check the slot; it re-mines automatically if the address was taken meanwhile.

```bash
REGISTRY_ADDRESS=0xYourRegistry RPC_URL=https://bsc-testnet.publicnode.com \
  node examples/07-mine-uni-hook-salt.example.mjs
```

## Verify encoding (optional)

```bash
REGISTRY_ADDRESS=0xYourRegistry RPC_URL=https://bsc-testnet.publicnode.com \
  node scripts/verify-create-args.mjs
```

## Exported API

### Schema / Preset

| Function | Description |
| --- | --- |
| `loadPresetSchemas` | Registry → Tools → module schemas |
| `resolvePresetCreateSchema` | Single preset: metadata + schemas + activeParams |
| `resolveAllPresetCreateSchemas` | Resolve all creatable presets |
| `buildCombinedParams` / `detectCreateMode` | Merge params; map tag/schema → SDK `CREATE_MODE` |
| `CREATE_MODE` / `UNI_TOKEN_MODULE_TAG` / `TAX_TOKEN_MODULE_TAG` | SDK constants; on-chain tags `module.token.uni` / `module.token.tax` |
| `encodeModuleParams` / `decodeModuleParams` | Schema encode/decode |
| `buildCreateFormPlan` / `buildFieldModel` | Convert on-chain schemas into UI-agnostic form metadata |

### Token creation

| Function | Description |
| --- | --- |
| `buildCreateTaxTokenRequest` | Build backend body + encode `initParams` (module fields via `taxInfo`) |
| `resolvePresaleQuote` | Map `presaleQuote` / `preSale` to backend field |
| `prepareCreateTokenOnChain` | Normalize createArg; compute txValue (aligned with contract) |
| `isPresaleNative` / `computeCreateTokenTxValue` | Presale native vs ERC20 payment helpers |
| `submitCreateTokenOnChain` | Call OpenFourCore.createToken |
| `createFourMemeApiClient` | Four.meme nonce/login, image upload, and normalized create API client |
| `normalizeFourMemeCreateResponse` | Convert Four.meme `data[]` / string code response into the generic create response shape |
| `createTokenWithBackendAndChain` | Generic: POST body + on-chain |
| `createTaxTokenWithBackendAndChain` | Helper: buildCreateTaxTokenRequest + POST + on-chain |

### Trading

| Function | Description |
| --- | --- |
| `estimateBuyExactAmount` / `estimateBuyByBudget` / `estimateSellExactAmount` | OpenFourTools trade estimation helpers |
| `buildBuyExactAmountTx` / `buildBuyByBudgetTx` / `buildSellExactAmountTx` | Slippage-aware tx builders |
| `ensureErc20Approval` / `submitTradeTx` | ERC20 approval and OpenFourCore trade submission helpers |

### Token / module identification

| Function | Description |
| --- | --- |
| `parseCreationEncodedTags` / `decodeCreationEncodedTags` | Parse `TokenCreated.encodedTags` |

### Uni V4 hookSalt

| Function | Description |
| --- | --- |
| `mineUniHookCloneSalt` | Mine a CREATE2 salt with valid Infinity hook flags and a free slot |
| `ensureHookSaltAvailable` | Re-check slot before submit; re-mine if needed |
| `predictUniHookCloneAddress` | Predict UniTokenV4Hook clone address |
| `isHookCloneAddressAvailable` | Check whether CREATE2 slot is still empty |
| `isUniTokenPreset` | Detect Uni token module preset |
| `HOOK_ADDR_MASK` / `HOOK_ADDR_TARGET` | Pancake Infinity hook flag constants |

## Dependencies

- `ethers` ^6.x

## Notes

### Token creation

- Uni V4 presets require a non-zero pre-mined `hookSalt`; see `mineUniHookCloneSalt` and `examples/07-mine-uni-hook-salt.example.mjs`
- Tax presets do **not** inject `hookSalt`
- Template config from `/public/token_template/config` should prefill `maxSupply`, `saleAmount`, and `raiseAmount`; module fields still come from on-chain schemas
- Preset module fields (`buyFeeRate`, `founder`, `taxVaultTypeId`, etc.) must be provided on `taxInfo` by the integrator
- Backend presale: `createParams.presaleQuote` or `createParams.preSale` (see `resolvePresaleQuote`)
- `createArg` tuple layout for decoding is in `abi/createTokenArgsCodec.json` (backend bytes layout, not a contract artifact entry)
- **msg.value**: `createFee` is always native. `presaleQuote` is added to `msg.value` only when `quoteAsset == wrappedNative` and `presaleQuote > 0`; ERC20 presale still requires `msg.value >= createFee`

### Trading

- Before trading, read `core.tokens(token)` to confirm the token exists, is not paused, and the phase still allows internal-market trades
- If an estimate returns `tokenAmount == 0`, do not let users submit the trade
- For error codes, events, and phase rules, see [`integration-guide.md`](../integration-guide.md)
