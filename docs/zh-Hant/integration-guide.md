# OpenFour 接入指南

[English](../integration-guide.md) | [繁體中文](./integration-guide.md)

本文面向錢包、交易前端、行情頁、DEX 聚合器、索引器、資料後端、發幣平台等第三方接入方，說明如何接入 OpenFour 的建立、預估、交易、監聽、代幣識別、模組識別、錯誤識別和事件處理。

本文只覆蓋接入 OpenFour 已部署協議和已註冊 Preset 的流程，不覆蓋自訂模組開發、模組註冊、協議升級和權限管理。自訂玩法開發請閱讀 `developer-guide.md`。

## 1. 接入對象

OpenFour 的核心寫入口是 `OpenFourCore`。第三方接入通常圍繞五類合約：

- `OpenFourCore`：建立代幣、買入、按預算買入、賣出、遷移、讀取 token 執行期配置。
- `OpenFourTools`：交易預估、流動性快照、建立表單 schema。
- `OpenFourRegistry`：Preset、模組、tag 字典查詢。
- `OpenFourFeeRouter`：費用配置、費用事件、開發者費查詢和領取。
- `ZapRouter`：透過已配置路由在 V2/V3 相容 DEX 上提供公開報價與 swap，並支援 fee-on-transfer token 路徑。

每個 OpenFour 代幣本身是一個 ERC20，同時綁定一組模組實例：

- `tokenModule`：建立時初始化 token。
- `vault`：保管 quote/token 資產，記錄 phase、totalRaised、remainingForSale。
- `curveModule`：內盤定價。
- `tradeModule`：交易規則、限額、附加費用。
- `migrateModule`：判斷何時遷移，以及遷移到什麼外部流動性。
- `customData`：可選模組，用於玩法自訂狀態和 Core hook。

接入時要區分兩層身份：

- Token 類型：`token.standard`、`token.tax`、`token.creator_rewards`、`token.uni` 等，描述 ERC20 本體。
- Module 類型：`module.curve.*`、`module.trade.*`、`module.migrate.*` 等，描述該 token 綁定的模組邏輯。

## 2. 地址發現

推薦把 `OpenFourRegistry` 作為網路級入口地址。第三方只需要為每條鏈配置 Registry 地址，然後從 Registry 鏈上讀取目前 Core 和 Tools 地址；再從 Core 讀取 FeeRouter 和 wrapped native。

已知 Registry 地址：

- BNB Smart Chain mainnet：`0x912CEf0C3aE9Ab6eB3Ec87cab69371cFb317Ab94`

```typescript
const registry = new Contract(registryAddress, OpenFourRegistryAbi, provider);

const coreAddress = await registry.openFourCore();
const toolsAddress = await registry.openFourTool();

const core = new Contract(coreAddress, OpenFourCoreAbi, provider);
const feeRouterAddress = await core.feeRouter();
const wrappedNative = await core.wrappedNative();
```

這樣接入方不需要在前端或後端硬編碼多個協議地址。Core 或 Tools 發生治理更新時，只要 Registry 地址不變，接入方重新整理鏈上讀取結果即可。

## 3. 識別 OpenFour 代幣

給定一個 ERC20 地址，可以用三種方式識別它是否屬於 OpenFour。

### 3.1 透過 Core 執行期配置

```typescript
const cfg = await core.tokens(tokenAddress);
if (!cfg.exists) {
  // 不是目前 Core 管理的 OpenFour token
}
```

這是交易前端和索引器最直接的識別方式。

### 3.2 透過 token descriptor

OpenFour token 實作 `ITagDescriptor`：

```solidity
function descriptor() external view returns (bytes8 tagId, string memory tag, string memory version);
```

常見 `tag`：

- `token.standard`：標準 ERC20。
- `token.tax`：帶轉帳稅、分紅或稅金分配邏輯。
- `token.strategy_tax`：將稅費兌換、質押和分配委託給每個 token 專屬策略的 token。
- `token.creator_rewards`：創作者獎勵類 token。
- `token.uni`：餘額綁定鏈上藝術/收藏品類 token。

如果呼叫 `descriptor()` 直接 revert，通常可以認為它不是 OpenFour 標準 token。

### 3.3 透過 token 上的模組 getter

```solidity
IOpenFourToken(token).vault();
IOpenFourToken(token).curveModule();
IOpenFourToken(token).tradeModule();
IOpenFourToken(token).migrateModule();
IOpenFourToken(token).tokenModule();
IOpenFourToken(token).customData(); // 可能為 address(0)
```

錢包和前端只拿到 token 地址時，可以從 token 反查綁定模組。

### 3.4 參考 token 源碼

`contracts/token/` 目錄包含常見 OpenFour token implementation 的參考源碼：

- `OpenFourToken.sol`
- `TaxToken.sol`
- `StrategyTaxToken.sol`
- `CreatorRewardsToken.sol`
- `UniToken.sol`

對於通用接入，runtime config 和 `IOpenFourToken` 標準 getter 通常已經足夠。如果索引器、資料後端或進階 UI 需要解析 token 特有資料，例如稅費 token 狀態、creator rewards 狀態、migrated pool 規則、UniToken renderer/art 資料，或 token 特有事件，可以結合這些源碼和 `scripts/abi/` 中隨包提供的 token ABI 進行解析。

### 3.5 區分 TaxToken 和 StrategyTaxToken

兩種 implementation 都使用 `migratedPools` 識別遷移後的買入和賣出，但分配模型不同：

- `token.tax`：分配 bucket 和 accounting 直接由 `TaxToken` 實作。
- `token.strategy_tax`：兌換和分配委託給 `taxStrategy()`；呼叫 `strategyTag()` 識別所綁定的策略。

`strategyTag()` 不包含在 `TokenCreated.encodedTags` 中。Lista V2 質押稅費 token 會返回 `tax_strategy.lista_v2_stake`。詳見 [Lista V2 質押稅費機制](./mechanisms/lista-v2-stake.md)。

## 4. 查詢 token 執行期配置

`core.tokens(token)` 返回 OpenFour 的 runtime config。第三方常用欄位：

- `creator`：建立者。
- `presetId`：建立時使用的 Preset。
- `name` / `symbol`：token 元資訊。
- `maxSupply` / `saleAmount` / `raiseAmount`：供應和募資參數，通常為 18 decimals。
- `quoteAsset`：計價資產 ERC20 地址。
- `vault`：資金和階段狀態模組。
- `curveModule` / `tradeModule` / `migrateModule` / `tokenModule` / `customData`：模組實例地址。
- `createBlock`：建立區塊。
- `exists`：是否由 Core 管理。
- `paused`：token 級暫停。
- `antiSniperEnabled`：是否啟用反狙擊費用。

Vault 即時狀態：

```solidity
IOpenFourVault(vault).phase();
IOpenFourVault(vault).quoteAsset();
IOpenFourVault(vault).remainingForSale();
IOpenFourVault(vault).totalRaised();
IOpenFourVault(vault).antiSniperQuoteAccrued();
IOpenFourVault(vault).initialSaleAmount();
IOpenFourVault(vault).isSoldOut();
IOpenFourVault(vault).soldAmount();
```

`phase` 是交易路由的關鍵欄位：

- `Created (0)`：建立中，通常不會長期可見。
- `Trading (1)`：內盤可交易。
- `MigratePending (2)`：遷移執行中，buy/sell 不可用。
- `Migrated (3)`：已遷移到外部 DEX，OpenFour 內盤關閉。
- `Terminal (4)`：保留或終止交易的 token 狀態，例如測試 token 或已放棄的發行。接入方應將這類 token 從可交易 token 清單和交易路由中排除。
- `SoldOut (5)`：可選的 vault 定義關盤狀態。內盤 buy/sell 不可用。部分 bonding preset 會在 `vault.isSoldOut()` 為 true 時進入此狀態，再從 `SoldOut` 遷移到 `MigratePending`。

`SoldOut` 不是所有遷移的前置條件。自訂玩法可以在自己的 `MigrateModule.evaluate()` 允許時，直接從 `Trading` 進入 `MigratePending`，即使 `vault.isSoldOut()` 為 false。

## 5. 交易預估

交易前端應優先使用目前 `OpenFourTools` 的交易預估介面，不要自己重新實作曲線、費用和 anti-sniper 邏輯。

目前介面名稱：

- `estimateBuy(token, trader, amount, options, proof)`：按精確 token 數量預估買入。
- `estimateSell(token, trader, amount, options, proof)`：按精確 token 數量預估賣出。
- `estimateBuyByBudget(token, trader, maxQuotePayAmount, options, proof)`：按 quote 預算預估可買 token 數量。

這些介面不是 `view`，因為 ZapRouter 預估可能呼叫介面並非唯讀的 V3 quoter。鏈下 ethers v6 程式碼必須使用 `method.staticCall(...)`（ethers v5：`contract.callStatic.method(...)`），讓請求透過 `eth_call` 執行，而不是發送交易。即使 `options == 0` 也應使用此形式。

### 5.1 TradeEstimate

`OpenFourTools` 預估返回的核心欄位：

- `curveQuote`：曲線側 quote 金額。
- `totalFee`：協議費、稅費、開發者費、anti-sniper 等聚合費用。
- `userPays`：買入時使用者實際支付 quote。
- `userReceives`：賣出時使用者實際收到 quote。
- `tokenAmount`：實際可成交 token 數量。
- `executionPrice`：成交執行價。

如果 `tokenAmount == 0`，說明目前不可交易或預估失敗，UI 應停用提交。

### 5.2 按 token 數量預估買入

```typescript
const est = await tools.estimateBuy.staticCall(token, trader, amount, 0, "0x");
if (est.tokenAmount === 0n) return;

const maxQuotePay = est.userPays * 101n / 100n; // 1% slippage buffer
```

### 5.3 按 token 數量預估賣出

```typescript
const est = await tools.estimateSell.staticCall(token, trader, amount, 0, "0x");
if (est.tokenAmount === 0n) return;

const minQuoteReceive = est.userReceives * 99n / 100n;
```

### 5.4 按 quote 預算預估買入

```typescript
const est = await tools.estimateBuyByBudget.staticCall(token, trader, budget, 0, "0x");
if (est.tokenAmount === 0n) return;

// quoteAsset == wrappedNative 的 native 支付範例；ERC20 quote 需先 approve，再不傳 value。
await core.buyByBudget(token, budget, est.tokenAmount, 0, "0x", { value: budget });
```

該介面適合「使用者輸入最多花多少 quote」的 UX。它依賴 CurveModule 正確實作 `evaluateReverse()`。

## 6. 建立 token

建立 token 的接入重點是 schema 驅動表單。前端不應硬編碼每個 Preset 的模組參數，而應從鏈上讀取 schema。

**命名說明：** 業務 API 使用 **template** / **templateId**；OpenFour 合約、鏈上讀取與 JavaScript scripts 使用 **preset** / **presetId**。兩者指同一套玩法套餐：

```text
template == preset
templateId == presetId
```

本文在 API 欄位中寫 `templateId` 時，與鏈上 `getPresetEncodeSchemas(presetId)`、`core.tokens(token).presetId`、`TokenCreated.presetId` 使用的是同一個數值 id。

### 6.1 建立流程

1. 從業務 API 取得可用 template 列表，供使用者選擇。
2. 讀取所選 template 的 quote / 供應量預設配置。
3. 從 `OpenFourTools` 讀取基礎欄位 schema 和 Preset 模組 schema。
4. 按 schema 渲染表單。
5. 按每個模組分別 ABI 編碼參數。
6. 組裝業務 API 建立請求使用的 `initParams`。
7. 組裝後端建立請求 payload。
8. 將 payload 提交給 OpenFour 建立 API。API 會校驗請求，並返回已編碼的 `createArg` 和 `signature`。
9. 使用 API 返回值呼叫 `core.createToken(createArg, signature)`。
10. 監聽 `TokenCreated` 取得 token 地址和模組地址。

### 6.2 讀取 schema

```solidity
ParamDescriptor[] memory baseSchema = tools.getTokenBaseSchema();

(
    ModuleEncodeSchema memory tokenSchema,
    ModuleEncodeSchema memory vaultSchema,
    ModuleEncodeSchema memory curveSchema,
    ModuleEncodeSchema memory tradeSchema,
    ModuleEncodeSchema memory migrateSchema,
    ModuleEncodeSchema memory customDataSchema
) = tools.getPresetEncodeSchemas(presetId); // presetId == 業務 API 的 templateId
```

基礎欄位通常包括：

- `name`
- `symbol`
- `maxSupply`
- `saleAmount`
- `raiseAmount`
- `antiSniperEnabled`
- `quoteAsset`
- `tokenUri`

模組 schema 欄位由模組自己的 `moduleEncodeSchema()` 返回。

### 6.3 編碼模組參數

模組參數必須編碼為一個 Solidity tuple，以匹配鏈上 `abi.decode(raw, (Struct))`：

```typescript
function encodeModuleParams(schema, form) {
  if (schema.params.length === 0) return "0x";

  const types = schema.params.map((p) => p.abiType);
  const values = schema.params.map((p) => resolveParam(p, form));
  const tupleType = `(${types.join(",")})`;

  return AbiCoder.defaultAbiCoder().encode([tupleType], [values]);
}
```

不要用多根類型編碼：

```typescript
// 不要這樣做
AbiCoder.defaultAbiCoder().encode(types, values);
```

當欄位包含 `bytes` 或 `string` 等動態類型時，多根類型和單 tuple 的 ABI 佈局不同，鏈上會解碼失敗或得到錯誤資料。

### 6.4 組裝 initParams

`name`、`symbol`、`maxSupply`、`saleAmount`、`raiseAmount`、`quoteAsset`、`tokenUri` 等基礎欄位，應作為業務 API 建立請求的**頂層欄位**提交（見 [§6.7](#67-從-api-取得簽名並傳送-createtoken)），不放在 `initParams` 內。

`initParams` 只包含 [§6.3](#63-編碼模組參數) 生成的各模組 ABI 編碼 bytes：

```typescript
const initParams = {
  tokenParams: encodeModuleParams(tokenSchema, form),
  vaultParams: encodeModuleParams(vaultSchema, form),
  curveParams: encodeModuleParams(curveSchema, form),
  tradeParams: encodeModuleParams(tradeSchema, form),
  migrateParams: encodeModuleParams(migrateSchema, form),
  customDataParams: encodeModuleParams(customDataSchema, form),
};
```

沒有使用者可配置參數的模組返回 `"0x"`。業務 API 會將這些 bytes 交給簽名服務，最終組裝成鏈上 `createArg`。

### 6.5 業務 API — 取得 Template 列表

渲染建立表單前，可先透過此公開 API 取得可用 template 列表。在 OpenFour 術語中，每個 template 即為一個 **preset**。

```text
POST /meme-api/v1/public/token_template/search
Content-Type: application/json
```

請求 body：

| 欄位 | 類型 | 必填 | 說明 |
| --- | --- | --- | --- |
| `sort` | `STRING` | 是 | 排序規則。示例：`LAST`。 |

請求示例：

```json
{
  "sort": "LAST"
}
```

回應欄位：

| 欄位 | 類型 | 說明 |
| --- | --- | --- |
| `code` | `NUMBER` | API 狀態碼，`0` 表示成功。 |
| `msg` | `STRING` | API 狀態訊息。 |
| `data` | `ARRAY` | template 列表。 |
| `data[].id` | `LONG` | template id，與鏈上 `presetId` 為同一數值。後續建立請求中的 `templateId` 即使用此值。 |
| `data[].name` | `STRING` | template 名稱。 |
| `data[].tag` | `STRING` | UI 展示的分類 tag。 |
| `data[].userAddress` | `STRING` | template 作者地址。 |
| `data[].userImg` | `STRING` | 作者頭像 URL。 |
| `data[].codeType` | `STRING` | template 代碼類型，例如 `SOLIDITY`。 |
| `data[].amount` | `STRING` | 業務 API 展示的建立費用。 |
| `data[].descr` | `STRING` | template 描述。 |
| `data[].status` | `STRING` | 發布狀態，例如 `PUBLISHED`。 |
| `data[].deploys` | `NUMBER` | 使用該 template 的部署次數。 |
| `data[].comments` | `NUMBER` | 評論數。 |
| `data[].likes` | `NUMBER` | 點讚數。 |
| `data[].attentions` | `NUMBER` | 關注數。 |
| `data[].bads` | `NUMBER` | 踩數。 |
| `data[].time` | `LONG` | template 發布或更新時間，毫秒時間戳。 |
| `data[].imgUrl` | `STRING` | template 封面圖 URL。 |

回應示例：

```json
{
  "code": 0,
  "msg": "success",
  "data": [
    {
      "id": 1778027615722,
      "name": "OPEN_FOUR_TOKEN",
      "tag": "DeFi Meme",
      "userAddress": "0x...",
      "userImg": "",
      "codeType": "SOLIDITY",
      "amount": "5000",
      "descr": "test template description",
      "status": "PUBLISHED",
      "deploys": 42,
      "comments": 6,
      "likes": 7,
      "attentions": 4,
      "bads": 2,
      "time": 1776098053000,
      "imgUrl": "https://..."
    }
  ]
}
```

### 6.6 業務 API — 取得 Template 配置

使用者選定 template 後，可透過此 API 取得該 template 支援的 quote 選項，以及預設的供應量 / 出售量 / 募資量配置。

```text
GET /meme-api/v1/public/token_template/config?templateId={templateId}
```

Query 參數：

| 欄位 | 類型 | 必填 | 說明 |
| --- | --- | --- | --- |
| `templateId` | `LONG` | 是 | 來自 search API 的 template id，與鏈上 `presetId` 為同一數值。 |

回應欄位：

| 欄位 | 類型 | 說明 |
| --- | --- | --- |
| `code` | `NUMBER` | API 狀態碼，`0` 表示成功。 |
| `msg` | `STRING` | API 狀態訊息。 |
| `data` | `ARRAY` | 所選 template 支援的 quote / 供應量配置列表。 |
| `data[].id` | `NUMBER` | 配置行 id。 |
| `data[].symbolAddress` | `STRING` | quote symbol，例如 `BNB`。 |
| `data[].address` | `STRING` | quote address，例如 `0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c`。 |
| `data[].totalSupply` | `STRING` | 預設 total supply 展示值。 |
| `data[].saleAmount` | `STRING` | 預設 sale amount 展示值。 |
| `data[].createFee` | `STRING` | 创币费用。 |
| `data[].decimals` | `NUMBER` | quote 精度。 |

回應示例：

```json
{
  "code": 0,
  "msg": "success",
  "data": [
    {
      "id": 1,
      "symbol": "BNB",
      "symbolAddress": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
      "fullName": "BNB",
      "totalSupply": "1000000000",
      "saleAmount": "800000000",
      "raisedAmount": "18",
      "createFee": "0",
      "decimals": 18
    }
  ]
}
```

            
此回應可用於預填 `maxSupply`、`saleAmount`、`raiseAmount` 等建立表單預設值；模組專屬欄位仍須從鏈上 schema 讀取，見 [§6.2](#62-讀取-schema)。

### 6.7 從 API 取得簽名並傳送 createToken

生產環境中，前端或接入方後端不應在本地自行簽名 `CreateTokenArgs`。應先組裝建立請求 payload，提交給 OpenFour 建立 API。API 會返回 Core 當前 signer 簽出的標準 `createArg` 和 `signature`：

```text
POST /meme-api/v1/private/token_template/token/create
```

請求欄位：

- `templateId` (`LONG`，必填)：所選 template id，與鏈上 `presetId` 為同一數值。
- `name` (`STRING`，必填)：token 名稱。
- `shortName` (`STRING`，必填)：業務 API 使用的 token 短名稱。
- `symbol` (`STRING`，必填)：token quote symbol / ticker。
- `desc` (`STRING`，必填)：token 描述。
- `imgUrl` (`STRING`，必填)：token 圖片 URL。
- `webUrl` (`STRING`，選填)：專案網站 URL。
- `telegramUrl` (`STRING`，選填)：Telegram URL。
- `twitterUrl` (`STRING`，選填)：Twitter / X URL。
- `presaleQuote` (`DECIMAL`，必填)：建立者的初始 quote 預售買入預算，是否使用取決於所選 template。
- `feePlan` (`BOOLEAN`，必填)：業務 API 使用的 fee plan 選項。
- `initParams`（必填）：由 schema-driven form 生成的 OpenFour 模組初始化參數。見 [§6.4](#64-組裝-initparams)。

`initParams` 包含由 OpenFour JavaScript scripts 生成的各模組參數 bytes：

```typescript
const initParams = {
  tokenParams: "0x",
  vaultParams: "0x",
  curveParams: "0x",
  tradeParams: "0x",
  migrateParams: "0x",
  customDataParams: "0x",
};
```

回應欄位：

- `code`：API 狀態碼，`0` 表示成功。
- `msg`：API 狀態訊息。
- `data`：結果列表。一般建立請求使用第一筆資料。
- `data[].tokenId`：API 返回的鏈下 token id，用於業務關聯。
- `data[].tokenAddress`：token address 佔位欄位。上鏈交易確認前可能為空，不應作為最終 token 地址使用。
- `data[].createArg`：呼叫 `OpenFourCore.createToken` 使用的 encoded create params。
- `data[].signature`：呼叫 `OpenFourCore.createToken` 使用的 signer signature。

Response 結構：

```javascript
{
  code: 0,
  msg: "success",
  data: [
    {
      tokenId: "<off-chain token id>",
      tokenAddress: "",
      createArg: "0x...",
      signature: "0x...",
    },
  ],
}
```

```typescript
const apiRes = await postCreateToken(payload);
if (apiRes.code !== 0) throw new Error(apiRes.msg || "create API failed");

const { createArg, signature, tokenId } = apiRes.data[0];
```

再使用 API 返回值上鏈：

```typescript
await core.createToken(createArg, signature, { value: txValue });
```

最終鏈上 token 地址與各模組地址，應以 `TokenCreated` 事件為準。

`signature` 會按目前 Core 配置的 signer 校驗。不要在生產環境傳任意佔位簽名；只有本地測試或聯調環境明確配置了對應 signer/簽名策略時，才可以使用測試簽名。

參考範例：

- `scripts/examples/01-build-backend-payload.example.mjs`：組裝後端請求 payload。
- `scripts/examples/02-submit-onchain.example.mjs`：API 返回 `createArg + signature` 後提交上鏈。
- `scripts/examples/03-create-tax-token-with-backend.example.mjs`：Tax preset 的 payload → API → 上鏈完整流程。

如果建立時包含 `presaleQuote`：

- `quoteAsset == wrappedNative`：`msg.value = createFee + presaleQuote`。
- 其它 ERC20 quote：先 `quote.approve(core, presaleQuote)`，再 `msg.value = createFee`。

`presaleQuote` 是含費用預算，Core 會自動反解可買數量，多餘部分退回建立者。

## 7. 提交交易

Core 交易函式：

```solidity
function buy(address token, uint256 amount, uint256 maxQuotePayAmount, uint256 options, bytes calldata proof) external payable;
function buyByBudget(address token, uint256 maxQuotePayAmount, uint256 minAmountOut, uint256 options, bytes calldata proof) external payable;
function sell(address token, uint256 amount, uint256 minQuoteRecvAmount, uint256 options, bytes calldata proof) external;
```

### 7.1 買入

Native quote 路徑：

```typescript
const est = await tools.estimateBuy.staticCall(token, user, amount, 0, "0x");
const maxPay = est.userPays * 101n / 100n;

await core.buy(token, amount, maxPay, 0, "0x", { value: maxPay });
```

ERC20 quote 路徑：

```typescript
await quote.approve(coreAddress, maxPay);
await core.buy(token, amount, maxPay, 0, "0x");
```

當 `quoteAsset == wrappedNative` 時，也可以先 approve WBNB，再不傳 `msg.value`。

### 7.2 按預算買入

```typescript
const est = await tools.estimateBuyByBudget.staticCall(token, user, budget, 0, "0x");
await core.buyByBudget(token, budget, est.tokenAmount, 0, "0x", { value: budget });
```

ERC20 quote 時先 approve `budget`，再用 `msg.value = 0`。

### 7.3 賣出

```typescript
await tokenContract.approve(coreAddress, amount);

const est = await tools.estimateSell.staticCall(token, user, amount, 0, "0x");
const minReceive = est.userReceives * 99n / 100n;

await core.sell(token, amount, minReceive, 0, "0x");
```

如果 `quoteAsset == wrappedNative`：

- `options = 0`：預設收到 native。
- `options & 1 == 1`：收到 wrapped native ERC20。

賣出不收 anti-sniper。

### 7.4 交易前檢查

交易前建議檢查：

- `cfg.exists == true`
- `cfg.paused == false`
- `vault.phase() == Trading`
- `registry.isPresetActive(cfg.presetId) == true`
- ERC20 路徑已 approve
- 預估結果 `tokenAmount > 0`
- 滑點上限/下限已設定

### 7.5 ZapRouter 與 Fee-on-Transfer Token

`ZapRouter` 標準介面執行 owner 已配置的路由。每條已配置路由最多三個 hop，每個 hop 透過 `dexId` 選擇 `V2` 或 `V3` 類型的 `DexType`。`address(0)` 會被正規化為 wrapped native，`setRoute()` 會自動儲存反向路由。`ViaBridge` 和 taxed-token 介面則會把已配置 bridge 路由與 caller 指定的首個或最後一個 DEX hop 組合；接入方必須明確校驗並選擇該動態 hop。

#### 遷移後的多跳 DEX 交易

OpenFour token 進入 `Migrated` 後，Core 內盤 `buy` 和 `sell` 不再是交易路徑。錢包或聚合器可以直接呼叫 `ZapRouter`，在受支援的 V2/V3 相容 DEX 之間執行路由：

```text
買入：BNB/WBNB -> 已配置中間 hop -> bridgeToken -> 遷移 DEX pool -> meme token
賣出：meme token -> 遷移 DEX pool -> bridgeToken -> 已配置中間 hop -> WBNB/BNB
```

應根據路由註冊方式選擇入口：

- 完整 token-to-token 或 native-to-token 路由已由 owner 配置時，使用 `quoteExactInput` / `swapExactInput`、`quoteNativeToToken` / `swapNativeToToken`，或對應的 token-to-native 介面。
- 僅配置了可重用 native-to-bridge 路由時，使用 `ViaBridge` 介面。買入時，`finalDexId` 和 `finalFee` 選擇遷移池的最後一個 `bridgeToken -> meme token` hop；賣出時，`firstDexId` 和 `firstFee` 選擇第一個 `meme token -> bridgeToken` hop。
- 已配置 bridge 部分加上 caller 指定的遷移池 hop，總數不得超過三個 hop。
- 報價前必須解析並校驗遷移 pool、bridge token、DEX 類型及 V3 fee tier。不要假設所有遷移 token 都使用相同 DEX 或 pool 類型。

以下是透過動態最後一個 hop 買入非稅費遷移 token 的示例：

```typescript
const [quotedOut] = await zapRouter.quoteNativeToTokenViaBridge.staticCall(
  bridgeToken,
  memeToken,
  finalDexId,
  finalFee, // V2 會忽略
  nativeAmountIn,
);
const minAmountOut = quotedOut * 99n / 100n;

await zapRouter.swapNativeToTokenViaBridge(
  bridgeToken,
  memeToken,
  finalDexId,
  finalFee,
  userAddress,
  minAmountOut,
  Math.floor(Date.now() / 1000) + 300,
  { value: nativeAmountIn },
);
```

反向交易時，先對 `ZapRouter` approve `memeToken`，使用 `quoteTokenToNativeViaBridge` 報價，再執行 `swapTokenToNativeViaBridge`。Router 返回的 `midTokens` 可供接入方展示或記錄實際中間路由。

非稅費資產可使用標準 exact-input/exact-output 介面。Exact-output 不支援 taxed token，因為無法保證 recipient 收稅後的實際餘額增量。

遷移後的稅費 token 應使用僅支援 V2 的 exact-input 入口：

- `swapNativeToTaxToken(...)`：native 換 taxed token；呼叫方指定的最後一個 hop 必須是 V2。
- `swapTaxTokenToNative(...)`：taxed token 換 native；呼叫方指定的第一個 hop 必須是 V2。

這些介面使用 fee-on-transfer 相容的 swap，並透過 balance delta 計算實際輸入/輸出。報價仍只是參考值；接入方必須設定 `minAmountOut`、deadline，並在需要時 approve 名義 token 輸入量。

OpenFour 交易中，`TRADE_OPTION_ZAP_NATIVE = 1 << 1` 的接入語義如下：

- Token quote asset 不是 wrapped native 時，`OpenFourTools` 使用 bit1 返回以 native 計價的 buy/sell 預估。
- Core `buy` 和 `buyByBudget` 目前透過非零 `msg.value` 和非 wrapped-native quote 選擇 zap 支付路徑；buy 執行時不使用其 `options` 參數。`msg.value` 是 native 上限，而目前 Core 實現使用 `maxPayAmount` 作為 quote-asset 上限。
- Core `sell` 使用 bit1 將非 wrapped-native quote 收益換成 native；此時 `minQuoteRecvAmount` 表示最小 native/WBNB 輸出。
- Sell 時可組合 bit1 和 bit0（`TRADE_OPTION_RECEIVE_WRAPPED_NATIVE`），以接收 wrapped native 而非 native。

### 7.6 透過 Core 內建 Zap 使用 BNB 買入 Meme Token

Token 仍處於 OpenFour `Trading` phase，且其 `quoteAsset` 不是 wrapped native 時，`OpenFourCore` 可以原子執行以下路徑：

```text
使用者 BNB
  -> OpenFourCore
  -> Core.zapRouter().swapNativeForExactToken(BNB -> quoteAsset)
  -> quote fee 發送至 FeeRouter + curve quote 發送至 Vault
  -> Vault 把 meme token 發送給使用者
  -> 未使用 BNB 退回使用者
```

使用者呼叫的是 `OpenFourCore`，不是 `ZapRouter`，也不需要 approve quote asset 或 ZapRouter。啟用此支付方式前先檢查：

```typescript
const ZAP_NATIVE = 1n << 1n;
const zapRouter = await core.zapRouter();
const wrappedNative = await core.wrappedNative();
const cfg = await core.tokens(tokenAddress);

if (zapRouter === ZeroAddress) throw new Error("Core ZapRouter is not configured");
if (cfg.quoteAsset.toLowerCase() === wrappedNative.toLowerCase()) {
  // 這是 BNB -> WBNB 直接支付路徑，不需要多資產 zap。
}
```

按固定 meme-token 數量買入時，需要同時取得 quote-asset 和 native 兩份預估。Quote 預估提供 Core 使用的 quote 上限，zap 預估提供 BNB 金額：

```typescript
const quoteEst = await tools.estimateBuy.staticCall(
  tokenAddress,
  userAddress,
  tokenAmount,
  0n,
  "0x",
);
const nativeEst = await tools.estimateBuy.staticCall(
  tokenAddress,
  userAddress,
  tokenAmount,
  ZAP_NATIVE,
  "0x",
);
if (quoteEst.tokenAmount === 0n || nativeEst.tokenAmount === 0n) {
  throw new Error("buy not executable");
}

const maxQuotePay = quoteEst.userPays * 101n / 100n;
const maxNativePay = nativeEst.userPays * 101n / 100n;

await core.buy(
  tokenAddress,
  tokenAmount,
  maxQuotePay, // quote-asset 單位
  ZAP_NATIVE,  // 語義標記；目前 buy 執行由 msg.value 觸發
  "0x",
  { value: maxNativePay }, // BNB wei
);
```

Core 透過 ZapRouter 精確取得交易所需 quote，只消耗必要 BNB，並退回 `msg.value` 的剩餘部分。

對「最多花費指定 BNB」的 UX，使用 native budget 進行預估，再把該交易需要的 quote 金額作為 Core quote 上限：

```typescript
const nativeBudget = parseEther("0.1");
const est = await tools.estimateBuyByBudget.staticCall(
  tokenAddress,
  userAddress,
  nativeBudget,
  ZAP_NATIVE,
  "0x",
);
if (est.tokenAmount === 0n) throw new Error("budget not executable");

const maxQuotePay = est.curveQuote + est.totalFee; // quote-asset 單位
const minTokenOut = est.tokenAmount * 99n / 100n;

await core.buyByBudget(
  tokenAddress,
  maxQuotePay,
  minTokenOut,
  ZAP_NATIVE,
  "0x",
  { value: nativeBudget },
);
```

已配置 ZapRouter 必須存在可用的 native-to-quote 路由。提交前應重新預估，並處理 `CoreErrBadConfig`、`CoreErrBudgetNotExecutable`、`CoreErrSlippage` 和 `CoreErrNativeRefundFailed`。

## 8. 遷移與外盤路由

每次 buy 後，Core 會呼叫 `MigrateModule.evaluate()`。如果返回 `canMigrate = true`，Core 會自動遷移。任何人也可以呼叫：

```solidity
function migrate(address token) external;
```

遷移未達條件時通常不會改變狀態。前端和索引器應監聽：

- `PhaseTransition`
- `MigrateExecuted`
- `OpenFourToken.MigratedPoolUpdated`

遷移完成後，OpenFour 內盤不再處理 buy/sell。交易路由應切到對應外部 DEX。

## 9. 遷移後取得 pool

首選監聽 `MigrateExecuted`：

```solidity
event MigrateExecuted(
    uint256 indexed presetId,
    address indexed caller,
    address indexed token,
    address vault,
    address migrateModule,
    bytes8 migrateTagId,
    uint256 totalRaised,
    uint256 remainingForSale,
    bytes32 hookDataHash,
    uint8 migratedDataVersion,
    bytes encodedMigratedData
);
```

解碼規則由 `migrateTagId` 和 `migratedDataVersion` 決定：

- `module.migrate.pcs_v2`：`encodedMigratedData = abi.encode(address pair)`。
- `module.migrate.bonding_lista_v2`，version `1`：`encodedMigratedData = abi.encode(address pair)`；該 pair 是 Lista V2 的 `token/quoteAsset` launch pair。
- Likwid V2 類型：通常為 `abi.encode(bytes32 poolId)`。
- PancakeSwap V4 類型：通常為 `abi.encode(bytes32 poolId)`。

不要把 `token.migratedPools(pool) == true` 單獨視為 pool 已啟用的證明。pool 地址會被預先註冊，用於在內盤階段阻止外部 pool 轉帳。確認 Lista V2 外盤路由已啟用時，應同時滿足：

- `vault.phase() == Migrated`。
- `MigrateExecuted.migrateTagId` 匹配 `module.migrate.bonding_lista_v2`。
- `migratedDataVersion == 1`。
- 解碼出的 pair 與 factory 的 `getPair(token, quoteAsset)` 一致。

## 10. 事件監聽

索引器和前端最常用事件：

- `OpenFourCore.TokenCreated`：發現新 token，拿到模組地址、quote、初始價、encodedTags。
- `OpenFourCore.TradeExecuted`：成交流、價格、費用、totalRaised、remainingForSale。
- `OpenFourCore.MigrateExecuted`：遷移完成和外部 pool 資料。
- `OpenFourCore.PhaseTransition`：階段變化。
- `OpenFourCore.TokenPaused`：token 級暫停。
- `OpenFourFeeRouter.FeeAssigned`：費用歸屬。
- `OpenFourFeeRouter.DeveloperFeeClaimed`：開發者費領取。
- `OpenFourFeeRouter.RebateUpdated`：protocol fee rebate 收款地址變更。
- `OpenFourToken.MigratedPoolUpdated`：遷移 pool 標記。
- `OpenFourRegistry.TagRegistered`：本地維護 `tagId -> tag` 字典。

### 10.1 TokenCreated

```solidity
event TokenCreated(
    uint256 requestId,
    uint256 indexed presetId,
    address indexed creator,
    address indexed token,
    string name,
    string symbol,
    uint256 maxSupply,
    uint256 saleAmount,
    uint256 raiseAmount,
    uint256 initialPrice,
    address quoteAsset,
    address vault,
    address curveModule,
    address tradeModule,
    address migrateModule,
    address customData,
    address tokenModule,
    string tokenMetaUri,
    uint256 flags,
    bytes encodedTags
);
```

參數說明：

- `requestId`：建立請求的鏈下關聯 id，用於業務冪等、訂單關聯或後台對帳。
- `presetId`：建立時選擇的 Preset id，已 indexed，可按玩法套餐過濾。
- `creator`：建立者地址，已 indexed。
- `token`：新建立的 ERC20 token 地址，已 indexed，也是第三方系統中最重要的專案主鍵。
- `name` / `symbol`：token 名稱和符號。
- `maxSupply`：最大供應量，token wei，通常按 18 decimals 展示。
- `saleAmount`：初始進入內盤出售的 token 數量，token wei。
- `raiseAmount`：募資目標或模組使用的 quote 目標值，quote wei；部分 Preset/Curve 可能不使用。
- `initialPrice`：建立時的初始展示價格，通常為 quote per 1 token，1e18 精度。
- `quoteAsset`：計價資產 ERC20 地址；wrapped native 時為 WBNB 等包裝幣地址。
- `vault`：該 token 的 vault 模組實例地址。
- `curveModule`：該 token 的 curve 模組實例地址。
- `tradeModule`：該 token 的 trade 模組實例地址。
- `migrateModule`：該 token 的 migrate 模組實例地址。
- `customData`：該 token 的 custom data 模組實例地址；沒有 custom data 時為 `address(0)`。
- `tokenModule`：建立 token 時使用的 token module 實例地址。
- `tokenMetaUri`：token metadata URI，通常是 HTTPS JSON 檔案連結。這就是建立表單和 API 中常稱為 `tokenUri` 的建立 metadata 連結。
- `flags`：建立標誌位；目前常用 `bit0 = antiSniperEnabled`。
- `encodedTags`：建立瞬間 token 和各模組的 `tagId` 快照，57 位元組，詳見 [§11](#11-encodedtags-和模組識別)。

`tokenMetaUri` JSON 格式：

```json
{
  "name": "Example Token",
  "symbol": "EXAMPLE",
  "description": "Example token description shown by wallets and market pages.",
  "image": "https://static.example.com/token.png",
  "links": {
    "website": "https://example.com",
    "twitter": "https://x.com/example",
    "telegram": "https://t.me/example"
  },
  "updated_at": 1776048855
}
```

Metadata 欄位說明：

- `name`：token 展示名稱。
- `symbol`：token symbol / ticker。
- `description`：前端展示的 token 描述。
- `image`：HTTPS 圖片 URL。
- `links.website`：官方網站 URL，如有提供。
- `links.twitter`：Twitter / X URL，如有提供。
- `links.telegram`：Telegram URL，如有提供。
- `updated_at`：metadata 更新時間的 Unix timestamp。

使用建議：

- 新 token 入庫。
- 建立 token 到 vault/curve/trade/migrate/customData 的關係。
- 解析 `encodedTags` 做玩法識別。
- 記錄 `requestId` 和建立者。

### 10.2 TradeExecuted

```solidity
event TradeExecuted(
    address indexed token,
    address indexed trader,
    uint256 indexed presetId,
    bool isBuy,
    address quoteAsset,
    address vault,
    uint256 requestedTokenAmount,
    uint256 tokenAmount,
    uint256 curveQuoteAmount,
    uint256 traderQuoteAmount,
    uint256 lastPrice,
    uint256 slippageLimit,
    uint256 protocolFee,
    uint256 taxFee,
    uint256 devFee,
    uint256 antiSniperFee,
    uint256 totalRaised,
    uint256 remainingForSale
);
```

參數說明：

- `token`：發生交易的 OpenFour token，已 indexed。
- `trader`：買入或賣出的使用者，已 indexed。
- `presetId`：token 所屬 Preset id，已 indexed。
- `isBuy`：`true` 表示買入，`false` 表示賣出。
- `quoteAsset`：交易使用的 quote ERC20。
- `vault`：交易更新的 vault 地址。
- `requestedTokenAmount`：使用者請求的 token 數量，token wei。
- `tokenAmount`：實際成交 token 數量，token wei；當 curve 做 partial fill 時可能小於請求量。
- `curveQuoteAmount`：曲線側 quote 金額。買入時是 vault 收到的基礎 quote，賣出時是 vault 支付前的基礎 quote。
- `traderQuoteAmount`：使用者視角實際支付或收到的 quote 金額，已包含或扣除費用。
- `lastPrice`：成交後曲線展示價格，通常為 quote per 1 token，1e18 精度。
- `slippageLimit`：使用者交易參數中的滑點保護值；買入為 `maxQuotePayAmount`，賣出為 `minQuoteRecvAmount`。
- `protocolFee`：協議費。
- `taxFee`：trade module 或 token 玩法產生的稅費/附加費聚合值。
- `devFee`：Preset 作者或開發者費。
- `antiSniperFee`：反狙擊費；只可能在買入時非零，賣出恆為 0。
- `totalRaised`：成交後 vault 的 `totalRaised()`。
- `remainingForSale`：成交後 vault 的 `remainingForSale()`。

金額關係：

```text
buy:  traderQuoteAmount = curveQuoteAmount + protocolFee + taxFee + devFee + antiSniperFee
sell: traderQuoteAmount = curveQuoteAmount - protocolFee - taxFee - devFee
```

使用建議：

- 行情 K 線和成交列表。
- 更新 last price。
- 更新 totalRaised / remainingForSale。
- 聚合費用和成交量。

### 10.3 MigrateExecuted

```solidity
event MigrateExecuted(
    uint256 indexed presetId,
    address indexed caller,
    address indexed token,
    address vault,
    address migrateModule,
    bytes8 migrateTagId,
    uint256 totalRaised,
    uint256 remainingForSale,
    bytes32 hookDataHash,
    uint8 migratedDataVersion,
    bytes encodedMigratedData
);
```

參數說明：

- `presetId`：token 所屬 Preset id，已 indexed。
- `caller`：觸發遷移的地址，已 indexed；可能是普通使用者、機器人或 Core 自動路徑中的呼叫方。
- `token`：遷移完成的 token，已 indexed。
- `vault`：遷移使用的 vault 地址。
- `migrateModule`：執行遷移的模組實例地址。
- `migrateTagId`：`migrateModule.descriptor().tagId`，用於判斷遷移目標和解碼方式。
- `totalRaised`：遷移時 vault 記錄的 quote 募集額。
- `remainingForSale`：遷移時剩餘未售 token 數量。
- `hookDataHash`：`MigrateModule.evaluate()` 返回 hook data 的雜湊，用於索引和對帳；原始 hook data 不直接出現在事件裡。
- `migratedDataVersion`：`encodedMigratedData` 的版本號；先看版本再選擇解碼器。
- `encodedMigratedData`：遷移模組返回的結果資料，例如 PCS V2 pair 地址或 V4/Likwid pool id。

使用建議：

- 根據 `migrateTagId` 和 `migratedDataVersion` 解碼外部 pool。
- 將 token 路由從 OpenFour 內盤切到外部 DEX。
- 和 `PhaseTransition`、`MigratedPoolUpdated` 一起確認遷移狀態。

### 10.4 PhaseTransition

```solidity
event PhaseTransition(
    address indexed token,
    OpenFourTypes.Phase from,
    OpenFourTypes.Phase to,
    address operator
);
```

參數說明：

- `token`：階段變化的 token，已 indexed。
- `from`：舊階段。
- `to`：新階段。
- `operator`：觸發階段切換的地址，通常是 Core 或遷移呼叫方上下文。

用於 UI 從內盤交易切換到遷移中或外盤交易。

常見路徑：

- Bonding 售罄路徑：`Trading -> SoldOut -> MigratePending -> Migrated`。
- 自訂遷移路徑：`Trading -> MigratePending -> Migrated`，不一定進入 `SoldOut`。

階段值：

- `0 Created`
- `1 Trading`
- `2 MigratePending`
- `3 Migrated`
- `4 Terminal`
- `5 SoldOut`

### 10.5 TokenPaused

```solidity
event TokenPaused(address indexed token, bool paused);
```

參數說明：

- `token`：被切換暫停狀態的 token，已 indexed。
- `paused`：`true` 表示暫停，`false` 表示恢復。

監聽該事件後應重新整理 `core.tokens(token).paused`。暫停時該 token 的交易/遷移路徑應停用。

### 10.6 FeeAssigned

```solidity
event FeeAssigned(
    address indexed token,
    address indexed quoteAsset,
    address recipient,
    uint8 indexed kind,
    uint256 amount,
    bool pending
);
```

參數說明：

- `token`：費用來源 token，已 indexed。
- `quoteAsset`：費用資產，已 indexed。
- `recipient`：費用歸屬地址；未 indexed，按收款人篩選需要客戶端解碼後過濾。
- `kind`：費用類型，已 indexed。常見類型包括 protocol、tax、developer、migrate protocol、migrate creator 等，具體枚舉以 FeeRouter 實作為準。
- `kind == 6`：protocol fee rebate（`FEE_TYPE_REBATE`）。
- `amount`：費用金額，quote wei。
- `pending`：`true` 表示記帳為待領取餘額，`false` 表示已即時分發或轉出。

用於收益榜、費用歸屬和開發者費統計。按 `(token, quoteAsset, kind)` 過濾效率最高。

### 10.7 DeveloperFeeClaimed

```solidity
event DeveloperFeeClaimed(
    address indexed quoteAsset,
    address indexed author,
    uint256 amount,
    address indexed to
);
```

參數說明：

- `quoteAsset`：領取的 quote 資產，已 indexed。
- `author`：領取開發者費的 Preset author，已 indexed。
- `amount`：領取金額。
- `to`：實際接收地址，已 indexed。

用於展示開發者收益領取記錄和對帳。

### 10.8 MigratedPoolUpdated

```solidity
event MigratedPoolUpdated(address indexed pool, bool enabled);
event MigratedPoolsUpdated(address[] pools, bool enabled);
```

參數說明：

- `pool`：被標記的外部池子地址，已 indexed。
- `pools`：批次標記的外部池子地址陣列。
- `enabled`：`true` 表示加入 migrated pool 白名單，`false` 表示移除。

該事件由 token 合約發出。索引器可以用它作為 `MigrateExecuted.encodedMigratedData` 的補充來源，尤其適合直接按 pool 地址建反向索引。

### 10.9 TokenTransferred

```solidity
event TokenTransferred(
    address indexed from,
    address indexed to,
    uint256 indexed requestId,
    uint256 amount
);
```

參數說明：

- `from`：轉出地址，已 indexed。
- `to`：轉入地址，已 indexed。
- `requestId`：建立 token 時的鏈下請求 id，已 indexed。
- `amount`：轉帳 token 數量。

該事件是 token 層轉帳輔助事件。需要完整交易語義、價格和費用時，應以 `OpenFourCore.TradeExecuted` 為準。

## 11. encodedTags 和模組識別

`TokenCreated.encodedTags` 是建立時各模組 `tagId` 的緊湊快照，目前長度為 57 位元組：

```text
byte 0      : schema，目前為 1
byte 1..8   : token tagId
byte 9..16  : tokenModule tagId
byte 17..24 : vault tagId
byte 25..32 : curve tagId
byte 33..40 : trade tagId
byte 41..48 : migrate tagId
byte 49..56 : customData tagId, zero means no customData
```

`tagId = bytes8(keccak256(bytes(tag)))`。第三方可以離線預計算常數並直接比對，無需 RPC。

JS 解析範例：

```typescript
import { keccak256, toUtf8Bytes, dataSlice } from "ethers";

function tagIdFromTag(tag: string) {
  return dataSlice(keccak256(toUtf8Bytes(tag)), 0, 8);
}

function parseEncodedTags(hex: string) {
  if (hex.length !== 2 + 57 * 2) throw new Error("invalid encodedTags length");
  const parsed = {
    schema: dataSlice(hex, 0, 1),
    token: dataSlice(hex, 1, 9),
    tokenModule: dataSlice(hex, 9, 17),
    vault: dataSlice(hex, 17, 25),
    curve: dataSlice(hex, 25, 33),
    trade: dataSlice(hex, 33, 41),
    migrate: dataSlice(hex, 41, 49),
    customData: dataSlice(hex, 49, 57),
  };
  if (parsed.schema !== "0x01") throw new Error("unsupported encodedTags schema");
  return parsed;
}
```

遇到未知 `tagId`，呼叫：

```typescript
const tag = await registry.tagOf(tagId);
```

也應監聽 `TagRegistered(bytes8 indexed tagId, string tag)` 更新本地字典。

### 11.1 常見已知 Tags

以下 tags 是目前 OpenFour 實作中常見的標識。這只是前端/索引器快速識別用的便利清單，不是完整或權威的 Registry。請始終保留原始 `tagId`，對未知值查詢 `registry.tagOf(tagId)`，並監聽 `TagRegistered`。

Token implementation tags：

- `token.standard`：標準 OpenFour ERC20。
- `token.tax`：帶轉帳稅和 tax vault 行為的 TaxToken。
- `token.strategy_tax`：將稅費處理委託給每 token 策略的 StrategyTaxToken。
- `token.creator_rewards`：創作者獎勵 token。
- `token.uni`：帶 renderer/art 或 hook 驅動行為的 Uni-style token。

Token module tags：

- `module.token.standard`：初始化標準 `OpenFourToken`。
- `module.token.tax`：初始化 TaxToken 類 token。
- `module.token.strategy_tax`：初始化 StrategyTaxToken 並 clone 已註冊的 tax strategy。
- `module.token.creator_rewards`：初始化 creator rewards token。
- `module.token.uni`：初始化 Uni-style token。

Vault module tags：

- `module.vault.standard`：標準 sale custody/accounting vault。
- `module.vault.tax_bonding`：tax-token bonding vault。

Curve module tags：

- `module.curve.bonding`：標準 bonding curve 定價。

Trade module tags：

- `module.trade.simple`：最小交易策略。
- `module.trade.tax_bonding`：tax-token bonding 玩法的交易策略。

Migrate module tags：

- `module.migrate.pcs_v2`：PancakeSwap V2 遷移。
- `module.migrate.pcs_v4`：PancakeSwap V4 遷移。
- `module.migrate.bonding_pcs_v4`：bonding 遷移到 PancakeSwap V4。
- `module.migrate.bonding_likwid`：bonding 遷移到 Likwid V2。
- `module.migrate.bonding_lista_v2`：bonding 遷移到 Lista V2 pair。

Custom data module tags：

- `module.data.standard`：no-op 標準 custom data module。

Tax strategy tag 不編碼在七個 `encodedTags` slot 中。對 `token.strategy_tax` token，應呼叫 `strategyTag()`：

- `tax_strategy.lista_v2_stake`：使用 Lista V2 相容 swap/liquidity，並分配 Lista 質押 share 的策略。

## 12. Token 識別和模組區分策略

推薦識別策略：

- 判斷是否 OpenFour token：先讀 `core.tokens(token).exists`。
- 判斷 token 類型：解析 `encodedTags` 的 token slot，或呼叫 `token.descriptor()`。
- 判斷完整玩法：解析 `encodedTags` 全部七個 slot。
- 判斷遷移目標：優先看 migrate slot 的 tag。
- 判斷稅幣或特殊玩法：不要只看 migrate slot，應組合 token/vault/trade 等多個 slot。
- 對 `token.strategy_tax` 呼叫 `strategyTag()`，並將返回的 strategy tag 與 token module、migrate tag 組合判斷。
- 將 `migratedPools(address)` 視為 transfer guard / 稅費分類標記；使用 phase 和 `MigrateExecuted` 判斷實際啟用的外盤 pool。
- 遇到未知模組：讀 `registry.tagOf(tagId)`，並保留原始 tagId。

## 13. 費用模型

OpenFourTools 的 `estimateBuy` / `estimateSell` 已經返回使用者視角金額，第三方通常不需要自行計算費用。

買入：

```text
userPays = curveQuote + protocolFee + taxFee + devFee + antiSniperFee
```

賣出：

```text
userReceives = curveQuote - protocolFee - taxFee - devFee
```

Token 層稅費生命週期：

- Bonding 階段，FeeRouter 會把 quote 計價稅費直接轉給 `TaxToken` 或 `StrategyTaxToken`；vault 隨後呼叫 `onBondingTrade()`，通知 token 對該筆轉帳記帳，`StrategyTaxToken` 再把 quote 稅費轉入其 strategy。
- 遷移後，`migratedPools[from] && to != vault` 判斷為買入，`migratedPools[to] && from != vault` 判斷為賣出；進入 `Migrated` phase 前不收 pool transfer tax。
- 遷移後稅費先以 token 單位累計。`DispatchReady(0, amount)` 表示 token 工作已超過 threshold；`DispatchReady(1, amount)` 表示 quote 工作已達 threshold。
- `TaxToken` 直接實作 founder、holder、burn、liquidity accounting；`StrategyTaxToken` 將稅費交給 `taxStrategy()`，並向策略同步有效 holder 餘額。
- `dispatchTax()` 可由任何人呼叫。`DispatchReady` 只是 keeper hint；送出交易前應立即檢查 `canDispatchTax()`。

Dispatch 順序、holder reward 手動注資、keeper 批處理與 gas 行為詳見 [TaxToken 稅費與分配機制](./mechanisms/tax-token.md)。

兩種 implementation 的參數單位不可混用：

- `TaxToken`：`buyFeeRate <= 1000`、`100 <= sellFeeRate <= 1000`，四個 distribution rate 總和為 `100`。
- `StrategyTaxToken`：兩個 fee rate 均為 `0..1000`、`minShare >= 1 ether`，distribution 單位由所選 strategy 定義；`ListaV2StakeTaxStrategy` 使用總和為 `10_000` 的四個 bps bucket。

anti-sniper：

- 只在買入路徑可能出現。
- 只在 token 建立時啟用 `antiSniperEnabled` 時生效。
- 不計入 `vault.totalRaised()`。
- `estimateBuy().totalFee` 已包含它。
- 會累計在 `vault.antiSniperQuoteAccrued()`，遷移模組可用於 buyback/burn 行為。

anti-sniper 依照 `curveQuote` 和區塊偏移計算：

```text
offset = block.number - token.createBlock
target ladder bps = OpenFourAntiSniper.ladderBps(offset, block.chainid)
antiSniperFee = curveQuote * max(target ladder bps - protocolFeeBps, 0) / 10_000
```

也就是說，階梯表代表早期買入在 `curveQuote` 上的目標總附加比例；protocol fee bps 會先扣除，避免同一部分重複收取。

目前 BSC Mainnet 階梯：

| Block offset | Target ladder bps | Target total surcharge |
| --- | ---: | ---: |
| `0` | `10000` | `100%` |
| `1` | `5000` | `50%` |
| `2` | `2500` | `25%` |
| `3` | `1500` | `15%` |
| `4` | `1000` | `10%` |
| `5` | `500` | `5%` |
| `>= 6` | `100` | `1%` |

目前 BSC Testnet 使用較寬的精確區塊偏移 checkpoint 方便測試。`600` 以下未列出的 offset 會回到預設 `10000` bps 目標。

| Block offset | Target ladder bps | Target total surcharge |
| --- | ---: | ---: |
| 預設 `< 600`（除下列 offset 外） | `10000` | `100%` |
| `100` | `5000` | `50%` |
| `200` | `2500` | `25%` |
| `300` | `1500` | `15%` |
| `400` | `1000` | `10%` |
| `500` | `500` | `5%` |
| `>= 600` | `100` | `1%` |

開發者費：

```solidity
feeRouter.devFeePending(quoteAsset, author);
feeRouter.claimDevFee(quoteAsset, to);
feeRouter.claimDevFees(quoteAssets, to);
```

普通交易前端不需要呼叫 claim 介面。

Protocol fee rebate：

- 當 `feeRouter.rebate()` 非零時，protocol fee 的 5% 會立即發送至該地址，其餘 95% 發送至 `treasury`。
- 當 `rebate() == address(0)` 時，全部 protocol fee 都發送至 `treasury`。
- Tax、developer 和 migration fee 不參與 rebate 分流。
- Rebate 分配會發出 `kind == 6`、`pending == false` 的 `FeeAssigned`。
- Rebate 是 `protocolFee` 的內部分流，不是額外向使用者收費，因此 buy/sell 金額公式不變。

## 14. 交易接入範例

下面是一段偏偽程式碼的 TypeScript 範例，覆蓋地址讀取、token 識別、執行期狀態、phase 路由、交易預估、滑點設計、native/ERC20 支付路徑和遷移後外盤路由。實際專案中請替換 ABI、錯誤處理、UI 狀態和簽名器管理。

### 14.1 初始化協議入口

```typescript
import { Contract } from "ethers";


async function loadOpenFour(provider, registryAddress) {
  const registry = new Contract(registryAddress, OpenFourRegistryAbi, provider);

  const coreAddress = await registry.openFourCore();
  const toolsAddress = await registry.openFourTool();

  const core = new Contract(coreAddress, OpenFourCoreAbi, provider);
  const tools = new Contract(toolsAddress, OpenFourToolsAbi, provider);

  const feeRouterAddress = await core.feeRouter();
  const wrappedNative = await core.wrappedNative();

  return {
    registry,
    core,
    tools,
    feeRouter: new Contract(feeRouterAddress, OpenFourFeeRouterAbi, provider),
    wrappedNative,
  };
}
```

### 14.2 讀取 token 執行期並判斷路由

```typescript
const Phase = {
  Created: 0,
  Trading: 1,
  MigratePending: 2,
  Migrated: 3,
  Terminal: 4,
  SoldOut: 5,
};

async function loadTokenRuntime(core, tokenAddress) {
  const cfg = await core.tokens(tokenAddress);
  if (!cfg.exists) throw new Error("not an OpenFour token");
  if (cfg.paused) throw new Error("token paused");

  const vault = new Contract(cfg.vault, OpenFourVaultAbi, core.runner);
  const phase = Number(await vault.phase());

  return { cfg, vault, phase };
}

async function routeToken(core, tokenAddress) {
  const { cfg, phase } = await loadTokenRuntime(core, tokenAddress);

  if (phase === Phase.Trading) {
    return { route: "openfour", cfg };
  }

  if (phase === Phase.Migrated) {
    // 遷移後的 pool 取得見 §9：優先使用 MigrateExecuted / MigratedPoolUpdated 索引結果。
    return { route: "external-dex", cfg };
  }

  if (phase === Phase.SoldOut) {
    // 募集/發售已關盤。不要路由到 OpenFour buy/sell；等待或觸發遷移。
    return { route: "awaiting-migration", cfg };
  }

  return { route: "disabled", cfg };
}
```

### 14.3 買入固定 token 數量

固定數量買入時，先用 `tools.estimateBuy()` 得到無滑點口徑下使用者需要支付的 `est.userPays`，再把 `maxQuotePayAmount` 設定為 `est.userPays` 加上買入滑點。下面範例中 `slippageBps = 100n` 表示允許最多多付 1%。

```typescript
async function buyExactTokenAmount({
  signer,
  registryAddress,
  tokenAddress,
  tokenAmount,
  slippageBps = 100n,
}) {
  const { core, tools, wrappedNative } = await loadOpenFour(signer.provider, registryAddress);
  const coreWithSigner = core.connect(signer);

  const { cfg, phase } = await loadTokenRuntime(core, tokenAddress);
  if (phase !== Phase.Trading) throw new Error("OpenFour trading is not active");

  const trader = await signer.getAddress();
  const est = await tools.estimateBuy.staticCall(tokenAddress, trader, tokenAmount, 0, "0x");
  if (est.tokenAmount === 0n) throw new Error("buy not executable");

  // Buy slippage: est.userPays 是目前預估支付額；maxQuotePay 是使用者願意支付的上限。
  const maxQuotePay = (est.userPays * (10_000n + slippageBps)) / 10_000n;
  const quoteAsset = cfg.quoteAsset;

  if (quoteAsset.toLowerCase() === wrappedNative.toLowerCase()) {
    // Native path: 使用者直接支付原生幣，Core 內部 wrap。
    return coreWithSigner.buy(tokenAddress, tokenAmount, maxQuotePay, 0, "0x", {
      value: maxQuotePay,
    });
  }

  // ERC20 quote path.
  const quote = new Contract(quoteAsset, ERC20Abi, signer);
  const allowance = await quote.allowance(trader, await core.getAddress());
  if (allowance < maxQuotePay) {
    await quote.approve(await core.getAddress(), maxQuotePay);
  }

  return coreWithSigner.buy(tokenAddress, tokenAmount, maxQuotePay, 0, "0x");
}
```

如果使用者希望用 WBNB 而不是 BNB 支付，哪怕 `quoteAsset == wrappedNative`，也可以走 ERC20 路徑：先 approve WBNB，再呼叫 `buy(..., { value: 0 })`。

提交交易前仍可能因為狀態變化而 revert，例如別人先買走庫存、phase 遷移、價格變化或模組規則變化。因此預估和滑點是必要但不是最終保證。

### 14.4 按 quote 預算買入

按預算買入時，使用者輸入的 `budget` 本身就是 quote 支付上限。這裡的滑點保護不再是「允許多付多少」，而是 `minAmountOut`：用預估得到的 `est.tokenAmount` 作為最低可接受 token 數量。需要更寬鬆 UX 時，可以對 `est.tokenAmount` 再減一個 token 滑點。

```typescript
async function buyByBudget({
  signer,
  registryAddress,
  tokenAddress,
  budget,
}) {
  const { core, tools, wrappedNative } = await loadOpenFour(signer.provider, registryAddress);
  const coreWithSigner = core.connect(signer);

  const { cfg, phase } = await loadTokenRuntime(core, tokenAddress);
  if (phase !== Phase.Trading) throw new Error("OpenFour trading is not active");

  const trader = await signer.getAddress();
  const est = await tools.estimateBuyByBudget.staticCall(tokenAddress, trader, budget, 0, "0x");
  if (est.tokenAmount === 0n) throw new Error("budget not executable");

  // Budget buy: budget 是支付上限；minAmountOut 是 token 數量下限。
  const minAmountOut = est.tokenAmount;

  if (cfg.quoteAsset.toLowerCase() === wrappedNative.toLowerCase()) {
    return coreWithSigner.buyByBudget(tokenAddress, budget, minAmountOut, 0, "0x", {
      value: budget,
    });
  }

  const quote = new Contract(cfg.quoteAsset, ERC20Abi, signer);
  const allowance = await quote.allowance(trader, await core.getAddress());
  if (allowance < budget) {
    await quote.approve(await core.getAddress(), budget);
  }

  return coreWithSigner.buyByBudget(tokenAddress, budget, minAmountOut, 0, "0x");
}
```

`buyByBudget` 適合「最多花多少 quote」的輸入方式。預算即支付上限，`minAmountOut` 保護使用者在預算內至少拿到多少 token。

### 14.5 賣出固定 token 數量

固定數量賣出時，先用 `tools.estimateSell()` 得到無滑點口徑下使用者預計收到的 `est.userReceives`，再把 `minQuoteRecvAmount` 設定為 `est.userReceives` 減去賣出滑點。下面範例中 `slippageBps = 100n` 表示最多少收 1%。

```typescript
async function sellExactTokenAmount({
  signer,
  registryAddress,
  tokenAddress,
  tokenAmount,
  receiveWrappedNative = false,
  slippageBps = 100n,
}) {
  const { core, tools, wrappedNative } = await loadOpenFour(signer.provider, registryAddress);
  const coreWithSigner = core.connect(signer);

  const { cfg, phase } = await loadTokenRuntime(core, tokenAddress);
  if (phase !== Phase.Trading) throw new Error("OpenFour trading is not active");

  const trader = await signer.getAddress();
  const est = await tools.estimateSell.staticCall(tokenAddress, trader, tokenAmount, 0, "0x");
  if (est.tokenAmount === 0n) throw new Error("sell not executable");

  // Sell slippage: est.userReceives 是目前預估收款；minQuoteReceive 是使用者可接受下限。
  const minQuoteReceive = (est.userReceives * (10_000n - slippageBps)) / 10_000n;

  const token = new Contract(tokenAddress, ERC20Abi, signer);
  const allowance = await token.allowance(trader, await core.getAddress());
  if (allowance < tokenAmount) {
    await token.approve(await core.getAddress(), tokenAmount);
  }

  // quoteAsset == wrappedNative 時，options bit0 控制收 native 還是 wrapped native。
  // 0: 收 native；1: 收 wrapped native。其它 quote 資產會忽略該 bit。
  const options =
    cfg.quoteAsset.toLowerCase() === wrappedNative.toLowerCase() && receiveWrappedNative
      ? 1
      : 0;

  return coreWithSigner.sell(tokenAddress, tokenAmount, minQuoteReceive, options, "0x");
}
```

提交賣出前仍需要 approve token。賣出不收 anti-sniper，但仍可能因為 phase、庫存、費用或模組規則變化而 revert。

### 14.6 交易後監聽和遷移路由

```typescript
core.on(core.filters.TradeExecuted(tokenAddress), (event) => {
  const {
    token,
    trader,
    isBuy,
    tokenAmount,
    traderQuoteAmount,
    lastPrice,
    totalRaised,
    remainingForSale,
  } = event.args;

  // 更新成交、價格、進度條、使用者歷史等。
});

core.on(core.filters.PhaseTransition(tokenAddress), async (event) => {
  const { to } = event.args;
  if (Number(to) === Phase.Migrated) {
    // 從 MigrateExecuted 或 MigratedPoolUpdated 的索引結果中拿外部 pool。
    // UI / 聚合器應停止呼叫 OpenFour buy/sell，切換到外部 DEX。
  }
});
```

遷移後 pool 的具體解碼方式見 [§9](#9-遷移後取得-pool)。如果索引器尚未處理到 `MigrateExecuted`，前端可以短暫顯示「遷移中」，等待外部 pool 索引完成。

## 15. 錯誤碼識別

接入方最常遇到的 Core 錯誤：

- `CoreErrTokenNotFound`：token 不在目前 Core 管理範圍。
- `CoreErrTokenPaused`：token 被暫停。
- `CoreErrPresetInactive`：Preset 已停用。
- `CoreErrPresetCreateDisabled`：Preset 禁止建立新 token。
- `CoreErrBadPhase`：vault phase 不是可執行階段。
- `CoreErrQuoteMustBeERC20`：quote 配置異常。
- `CoreErrCurveRejected`：CurveModule 拒絕交易。
- `CoreErrTradeRejected`：TradeModule 拒絕交易。
- `CoreErrTradeMax`：超過 TradeModule 返回的 maxAmount。
- `CoreErrTradeMin`：低於 TradeModule 返回的 minAmount。
- `CoreErrSlippage`：滑點保護失敗。
- `CoreErrBudgetNotExecutable`：按預算買入無法得到可執行 token 數量。
- `CoreErrNativeOnlyWrapped`：非 wrapped native quote 卻傳了 msg.value。
- `CoreErrInsufficientNative`：native quote 支付不足。
- `CoreErrNativeRefundFailed`：退款 native 失敗。

錯誤處理建議：

- 預估介面返回 `tokenAmount == 0` 時，不要讓使用者提交交易。
- 交易 revert 後優先解析 custom error selector。
- 無法識別的模組錯誤，展示模組返回的 reason 或通用失敗文案。
- 對 `CoreErrBadPhase`，立即重新整理 vault phase 並切換路由。如果 phase 是 `SoldOut`，停用內盤 buy/sell，顯示等待遷移狀態。

## 16. 常見接入場景

行情前端：

- 監聽 `TokenCreated` 入庫。
- 監聽 `TradeExecuted` 更新價格和成交。
- 使用 `getCurveLiquiditySnapshot`、`estimateBuy` 或 `estimateSell` 展示目前價格。
- `Migrated` 後切換到外盤池。

錢包：

- 用 `core.tokens(token).exists` 識別 OpenFour token。
- 讀取 `OpenFourToken.descriptor()` 展示 token 類型。
- 讀取 vault phase 判斷是否支援內盤交易，並將 `Terminal` token 隱藏或標記為不可交易。

DEX 聚合器：

- `phase == Trading` 時路由到 `OpenFourCore.buy/sell`。
- `phase == SoldOut` 時不要路由到內盤 buy/sell；這是關盤狀態，不是外部 DEX 狀態。
- `phase == Migrated` 時解析 migration pool，路由到外部 DEX。
- 將 `phase == Terminal` 的 token 從可交易 token 清單和所有交易路由中排除。

索引器：

- 以 `TokenCreated` 建立 token 主記錄。
- 以 `encodedTags` 建玩法標籤。
- 以 `TradeExecuted` 建成交表。
- 以 `MigrateExecuted` 和 `MigratedPoolUpdated` 建外盤池映射。
- 將 `Terminal` 作為保留或終止交易狀態追蹤，並從公開可交易 token 索引中過濾。

建立平台：

- 使用 schema 渲染建立表單。
- 按模組分別 tuple 編碼 params。
- 呼叫建立簽名服務或測試環境簽名。
- 監聽 `TokenCreated` 回填建立結果。
