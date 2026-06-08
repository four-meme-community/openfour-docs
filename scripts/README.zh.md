# OpenFour JavaScript 腳本

OpenFour 第三方接入 JavaScript helper，用於錢包、交易 UI、發射平台、索引器與後端服務整合 OpenFour 協議。它覆蓋常見鏈上集成流程，而不僅限於發幣：

- **Schema / Preset**：從 Registry / Tools 讀取 preset 與模組 schema，生成 UI 無關的表單布局
- **建立代幣**：組裝後端請求、解析 `createArg`、提交 `createToken`
- **內盤交易**：呼叫 OpenFourTools 預估、計算滑點、處理 ERC20 授權、提交 buy / sell
- **Token / 模組識別**：解析 `TokenCreated.encodedTags`，識別 token 與模組 tag
- **Uni V4 hookSalt**：為 Uni token preset 預挖 CREATE2 `hookSalt`，滿足 Pancake Infinity hook flag
- **合約 ABI**：隨包提供 Core / Tools / Registry / 介面 / token 合約 ABI

更完整的協議說明見 [`integration-guide.md`](../integration-guide.md)。

## 適用場景

| 場景 | 主要 helper | 示例 |
| --- | --- | --- |
| 讀取 preset 與建立 schema | `resolvePresetCreateSchema`、`buildCreateFormPlan` | `examples/04-list-preset-create-schemas.example.mjs` |
| 組裝後端建立請求 | `buildCreateTaxTokenRequest`、`encodeModuleParams` | `examples/01-build-backend-payload.example.mjs` |
| 提交 `createToken` | `prepareCreateTokenOnChain`、`submitCreateTokenOnChain` | `examples/02-submit-onchain.example.mjs` |
| 後端 API + 上鏈 | `createTokenWithBackendAndChain` | `examples/03-create-tax-token-with-backend.example.mjs` |
| 交易預估與提交 | `estimateBuyExactAmount`、`buildBuyExactAmountTx`、`submitTradeTx` | `examples/06-trade-with-slippage.example.mjs` |
| 解析 `encodedTags` | `parseCreationEncodedTags` | `examples/05-parse-encoded-tags.example.mjs` |
| 挖掘 Uni V4 `hookSalt` | `mineUniHookCloneSalt`、`ensureHookSaltAvailable` | `examples/07-mine-uni-hook-salt.example.mjs` |

## 目錄

```
abi/                          # 隨包提供的合約 ABI（JSON）
examples/                     # 獨立示例（.mjs）
scripts/
  verify-create-args.mjs      # 校驗 createArg 編解碼（可選）
createTaxTokenRequest.js        # 組裝後端 POST body
createTokenOnChain.js           # 鏈上 createToken
createTokenWithBackend.js       # 後端 API + 上鏈（通用）
createTaxTokenWithBackend.js    # 稅費 preset 便捷流程
createArgCodec.js               # 解碼 / 規範化 backend createArg
encodeFromSchema.js             # schema 編解碼
schemaLayout.js                 # schema 欄位布局與預設值 helper
tradeFlow.js                    # 預估、滑點、授權與交易 helper
loadPresetSchemas.js            # 鏈上讀 Tools / Registry
resolvePresetCreateSchemas.js   # 按 preset 解析建立 schema
encodedTags.js                  # 解析 TokenCreated.encodedTags
mineUniHookCloneSalt.js         # 挖掘 Uni V4 hook CREATE2 salt
index.js                        # 對外匯出
```

## 安裝

執行示例前，先在本目錄安裝依賴：

```bash
npm install
```

## 快速開始

示例均在**本目錄**下執行（包含 `index.js` 的目錄）。

### A. Schema 與 Preset

見 `examples/04-list-preset-create-schemas.example.mjs`

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
// one.preset.tokenModuleTag  — 鏈上 module descriptor().tag（本質依據）
// one.mode                   — SDK 推導的標籤（見下文「CREATE_MODE 與鏈上」）
// one.flags.needsVaultSelection / needsHookSalt — 由 tag + schema 欄位推導
```

也可以把解析結果轉換為 UI 無關的欄位模型：

```js
import { buildCreateFormPlan } from './index.js'

const plan = buildCreateFormPlan({
  baseSchema: one.baseSchema,
  schemas: one.schemas,
  activeParams: one.activeParams,
  quoteAsset: '0x...',
})

// plan.fields        — 可直接用於渲染的欄位元資訊
// plan.defaults      — 帶 schema 預設值的初始表單資料
// plan.sections      — 按 base/token/curve/trade/migrate/customData 分組
```

#### CREATE_MODE 與鏈上（非合約列舉）

`CREATE_MODE` 僅在本 SDK 內定義，合約側沒有該列舉。鏈上實際是 **模組 tag** + **各模組 encode schema 欄位**。

| SDK `one.mode` | 推導規則 | 對應的鏈上依據 |
| --- | --- | --- |
| `uni_v4` | 優先：Uni 代幣模組 | `one.preset.tokenModuleTag === 'module.token.uni'` |
| `tax` | 否則：稅費代幣模組 | `one.preset.tokenModuleTag === 'module.token.tax'` |
| `generic` | 其餘 | 如 `tokenModuleTag === 'module.token.standard'` |

優先順序：`uni_v4` → `tax` → `generic`。業務分支建議以 `preset.tokenModuleTag` 和 `flags` 為準，不要只依賴 `mode`。

```bash
REGISTRY_ADDRESS=0xYourRegistry RPC_URL=https://bsc-testnet.publicnode.com \
  node examples/04-list-preset-create-schemas.example.mjs
```

### B. 建立代幣

#### B1) 僅組裝後端請求

見 `examples/01-build-backend-payload.example.mjs`

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

#### B2) 僅上鏈（已有 backend 返回）

見 `examples/02-submit-onchain.example.mjs`

```js
import { prepareCreateTokenOnChain, submitCreateTokenOnChain } from './index.js'

const { createArg, signature, txValue } = prepareCreateTokenOnChain({
  rawCreateArg: data.createArg,
  signature: data.signature,
  wrappedNative: '0x...', // 該鏈 WBNB / WETH
})

await submitCreateTokenOnChain({ signer, coreAddress, createArg, signature, txValue })
```

#### B3) 後端 + 上鏈

見 `examples/03-create-tax-token-with-backend.example.mjs`

```js
import { createTaxTokenWithBackendAndChain } from './createTaxTokenWithBackend.js'

await createTaxTokenWithBackendAndChain({
  buildRequest: { /* buildCreateTaxTokenRequest 入參 */ },
  postCreate,
  signer,
  coreAddress,
  wrappedNative: '0x...',
})

// 通用（任意 POST body）:
import { createTokenWithBackendAndChain } from './createTokenWithBackend.js'
await createTokenWithBackendAndChain({ buildPayload: payload, postCreate, signer, coreAddress })
```

### C. 內盤交易

見 `examples/06-trade-with-slippage.example.mjs`

```bash
TRADE_ACTION=buyExact \
REGISTRY_ADDRESS=0x... TOKEN_ADDRESS=0x... PRIVATE_KEY=0x... \
AMOUNT=100 SLIPPAGE_BPS=500 RPC_URL=https://... \
node examples/06-trade-with-slippage.example.mjs
```

支援 `buyExact`、`buyByBudget`、`sellExact` 三種動作。典型流程：

1. 從 Registry 讀取 Core / Tools 地址
2. 讀取 token runtime config
3. 呼叫 `estimateBuy*` / `estimateSell*` 取得預估
4. 依滑點計算 `maxQuotePayAmount` / `minAmountOut` / `minQuoteReceiveAmount`
5. ERC20 quote 路徑先 `approve(core, amount)`，再提交交易

滑點規則與前端保持一致：

- 固定數量買入：對 `estimate.userPays` 向上加滑點，作為 `maxQuotePayAmount`
- 按預算買入：使用者預算保持為 `maxQuotePayAmount`，對 `estimate.tokenAmount` 向下扣滑點，作為 `minAmountOut`
- 固定數量賣出：對 `estimate.userReceives` 向下扣滑點，作為 `minQuoteReceiveAmount`
- 原生 quote 路徑發送 `msg.value`；ERC20 quote 路徑需要先 `approve(core, amount)`

### D. 解析 encodedTags

見 `examples/05-parse-encoded-tags.example.mjs`

```js
import { parseCreationEncodedTags } from './index.js'

const decoded = parseCreationEncodedTags(tokenCreatedEvent.encodedTags)
// decoded.tagIds.token / tokenModule / vault / curve / trade / migrate / customData
```

常用於索引器、行情頁或交易 UI，在收到 `TokenCreated` 後快速識別 token 類型與綁定模組 tag。

### E. 挖掘 Uni V4 hookSalt

見 `examples/07-mine-uni-hook-salt.example.mjs`

Uni token preset 需要非零 `hookSalt`。CREATE2 deployer 為 `OpenFourDeployer`，implementation 為 Registry 的 `uniTokenV4HookImpl`。挖出的 clone 地址低 14 位須滿足 Pancake Infinity hook flag，且該地址尚未部署合約。

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

提交建立交易前，可用 `ensureHookSaltAvailable` 再次確認 slot 未被占用；若已被占用則自動重新挖礦。

```bash
REGISTRY_ADDRESS=0xYourRegistry RPC_URL=https://bsc-testnet.publicnode.com \
  node examples/07-mine-uni-hook-salt.example.mjs
```

## 校驗編碼（可選）

```bash
REGISTRY_ADDRESS=0xYourRegistry RPC_URL=https://bsc-testnet.publicnode.com \
  node scripts/verify-create-args.mjs
```

## 匯出 API

### Schema / Preset

| 函式 | 說明 |
| --- | --- |
| `loadPresetSchemas` | Registry → Tools → schemas |
| `resolvePresetCreateSchema` | 單個 preset：metadata + schemas + activeParams |
| `resolveAllPresetCreateSchemas` | 列表解析所有可建立 preset |
| `buildCombinedParams` / `detectCreateMode` | 合併參數；由 tag/schema 映射為 SDK `CREATE_MODE` |
| `CREATE_MODE` / `UNI_TOKEN_MODULE_TAG` / `TAX_TOKEN_MODULE_TAG` | SDK 常數；鏈上 tag 為 `module.token.uni` / `module.token.tax` |
| `encodeModuleParams` / `decodeModuleParams` | schema 編解碼 |
| `buildCreateFormPlan` / `buildFieldModel` | 將鏈上 schema 轉成 UI 無關表單元資訊 |

### 建立代幣

| 函式 | 說明 |
| --- | --- |
| `buildCreateTaxTokenRequest` | 組裝後端 body + initParams（模組參數由 `taxInfo` 提供） |
| `resolvePresaleQuote` | 將 `presaleQuote` / `preSale` 映射為後端欄位 |
| `prepareCreateTokenOnChain` | 規範化 createArg，計算 txValue（與合約一致） |
| `isPresaleNative` / `computeCreateTokenTxValue` | 預購原生 / ERC20 付款判斷 |
| `submitCreateTokenOnChain` | 呼叫 OpenFourCore.createToken |
| `createTokenWithBackendAndChain` | 通用：POST body + 上鏈 |
| `createTaxTokenWithBackendAndChain` | 稅費：buildCreateTaxTokenRequest + POST + 上鏈 |

### 交易

| 函式 | 說明 |
| --- | --- |
| `estimateBuyExactAmount` / `estimateBuyByBudget` / `estimateSellExactAmount` | OpenFourTools 交易預估 helper |
| `buildBuyExactAmountTx` / `buildBuyByBudgetTx` / `buildSellExactAmountTx` | 帶滑點保護的交易參數 builder |
| `ensureErc20Approval` / `submitTradeTx` | ERC20 授權和 OpenFourCore 交易提交 helper |

### Token / 模組識別

| 函式 | 說明 |
| --- | --- |
| `parseCreationEncodedTags` / `decodeCreationEncodedTags` | 解析 `TokenCreated.encodedTags` |

### Uni V4 hookSalt

| 函式 | 說明 |
| --- | --- |
| `mineUniHookCloneSalt` | 挖掘滿足 Infinity hook flag 且未被占用的 CREATE2 salt |
| `ensureHookSaltAvailable` | 提交前再次確認 slot；必要時重新挖礦 |
| `predictUniHookCloneAddress` | 預測 UniTokenV4Hook clone 地址 |
| `isHookCloneAddressAvailable` | 檢查 CREATE2 slot 是否尚未部署 |
| `isUniTokenPreset` | 判斷 preset 是否為 Uni token 模組 |
| `HOOK_ADDR_MASK` / `HOOK_ADDR_TARGET` | Pancake Infinity hook flag 常量 |

## 依賴

- `ethers` ^6.x

## 說明

### 建立代幣

- Uni V4 preset 的 `hookSalt` 必須非零，且須鏈下預挖；見 `mineUniHookCloneSalt` 與 `examples/07-mine-uni-hook-salt.example.mjs`
- 稅費類 preset **不包含** `hookSalt`
- 各 preset 的模組欄位（`buyFeeRate`、`router`、`founder` 等）須由整合方寫入 `taxInfo`
- 後端預購欄位：`createParams.presaleQuote` 或 `createParams.preSale`（見 `resolvePresaleQuote`）
- `createArg` 的 tuple 解碼布局在 `abi/createTokenArgsCodec.json`（backend 返回的 bytes 結構，非合約 artifact 條目）
- **msg.value**：`createFee` 永遠用原生幣支付；僅當 `quoteAsset == wrappedNative` 且 `presaleQuote > 0` 時，`msg.value` 還需加上 `presaleQuote`；ERC20 預購時 `msg.value` 仍至少為 `createFee`

### 交易

- 交易前建議先讀 `core.tokens(token)`，確認 token 存在、未暫停，且 phase 仍允許內盤交易
- 若 `estimate` 返回 `tokenAmount == 0`，不要讓使用者提交交易
- 詳細錯誤碼、事件與 phase 規則見 [`integration-guide.md`](../integration-guide.md)
