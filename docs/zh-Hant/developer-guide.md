# OpenFour 開發指南

[English](../developer-guide.md) | [繁體中文](./developer-guide.md)

本文面向希望基於 OpenFour 創作新玩法、新 Preset、新模組或新 token 類型的開發者。OpenFour 是 Four.Meme 推出的模組化 launch 引擎。它說明 OpenFour 的模組架構、模組關係、必需介面、開發邊界、schema 設計、Preset 註冊點，以及如何用本目錄裡的 FairLaunch 範例作為起點實現一套自訂玩法。

範例合約僅用於 demo 和開發參考，未經審計，不應用於其他正式生產用途。

## 1. 架構原則

OpenFour 把一套發幣玩法拆成多個獨立模組，由 `OpenFourCore` 編排執行。Core 不關心具體玩法細節，只透過標準介面呼叫模組。

每個 token 在建立時綁定一組模組實例：

- Token implementation：ERC20 本體。
- Token module：初始化 token。
- Vault module：資產保管和 sale accounting。
- Curve module：定價。
- Trade module：交易策略和費用。
- Migrate module：畢業/遷移條件和遷移動作。
- Custom data module：可選，用於儲存自訂玩法狀態和跨模組共享資料。

這種架構的目標是讓玩法可組合、可替換、可索引，並且讓第三方前端可以透過鏈上 schema 自動渲染建立表單。

## 2. 模組職責

| 種類 | Registry `ModuleKind` | 介面 | 必需性 | 職責 |
| --- | --- | --- | --- | --- |
| Token | 0 | `IOpenFourTokenModule` | 必需 | 初始化 token 實作，注入模組引用，並按 preset 規則完成初始鑄造。 |
| Vault | 1 | `IOpenFourVault` | 必需 | 保管 quote 資產，記錄 `totalRaised` / `remainingForSale` / phase，並處理遷移資產轉移。 |
| Curve | 2 | `IOpenFourCurveModule` | 必需 | 定價邏輯：正向報價（`amount -> quote`）與反向報價（`quote -> amount`）。 |
| Trade | 3 | `IOpenFourTradeModule` | 必需 | 交易策略與費用計算：限額、可交易校驗與費率分層決策。 |
| Migrate | 4 | `IOpenFourMigrateModule` | 必需 | 遷移策略與執行：判斷何時遷移並執行遷移動作。 |
| CustomData | 5 | `IOpenFourCustomDataModule` | 可選 | 每個 token 的自訂狀態、Core hooks（`afterHook` / `onMigrate`）與跨模組共享資料。 |

`OpenFourCore` 是執行協調器。它負責建立 token、路由 buy/sell、呼叫 curve/trade 模組做決策、呼叫 vault 更新資產狀態、呼叫 custom data hook、呼叫 migrate 模組完成遷移。

Token module 負責初始化 token。它不應該處理交易、定價或遷移。

Vault module 負責資金保管和會計狀態。它記錄 quote、remainingForSale、totalRaised、phase，並提供遷移時轉移資產的介面。它不應該決定價格或使用者是否可交易。

Curve module 負責定價。它接收 Core 傳入的 `CurveContext`，返回 quote amount 和可執行性。它應該保持 view-only，不記錄交易歷史。

Trade module 負責交易策略。它接收 `TradeContext`，返回是否允許、min/max amount 和 FeeTier。目前 trade 介面是 view-only，不應在其中寫 per-address 計數等狀態。

Migrate module 負責判斷什麼時候結束內盤，以及遷移時執行什麼動作。它可以把 DEX 細節委託給 adapter。

Custom data module 是可選狀態模組。只有當玩法需要儲存額外資料、接收 Core hook、或在模組之間共享資料時才需要實現。

## 3. 必需介面

每類模組必須實現對應協議介面。

必需模組：

- Token module 必須實現 `IOpenFourTokenModule`。
- Vault module 必須實現 `IOpenFourVault`。
- Curve module 必須實現 `IOpenFourCurveModule`。
- Trade module 必須實現 `IOpenFourTradeModule`。
- Migrate module 必須實現 `IOpenFourMigrateModule`。

可選模組：

- Custom data module 只有需要狀態儲存、hook 或跨模組共享資料時才實現 `IOpenFourCustomDataModule`。

Schema：

- 有建立參數或 UI 配置的模組建議實現 `IOpenFourModuleSchema`。
- `moduleEncodeSchema()` 只幫助前端編碼參數，不替代鏈上 `init` 校驗。

Token implementation：

- 可以直接使用 `OpenFourToken`。
- 如果需要擴展 token 行為，自訂 token 必須繼承 `OpenFourToken`，以保證 Core、模組、工具和索引器可以依賴標準 getter 和模組引用。

Descriptor：

- token 和模組都應實現或繼承 `ITagDescriptor`。
- `tag` 應使用穩定命名，例如 `token.standard`、`module.curve.fair_launch`。
- `tagId = bytes8(keccak256(bytes(tag)))`。
- `version` 應來自 Registry 在建立時傳入的版本快照。

## 4. 生命週期呼叫順序

### 4.1 建立 token

建立時的典型順序：

1. Core 讀取 Preset。
2. Core 解析 Preset 綁定的 token/vault/curve/trade/migrate/customData 模組實現。
3. Core 部署或克隆 token。
4. Core 部署或克隆各模組實例。
5. Core 呼叫 token module 初始化 token。
6. Core 呼叫 vault/curve/trade/migrate/customData 的 `init`。
7. Core 記錄 runtime config。
8. Core 發出 `TokenCreated`，包含模組地址和 `encodedTags`。

模組的 `init` 必須：

- 綁定 token 地址。
- 綁定 fourCore 地址。
- 解碼並校驗 raw params。
- 保存 raw init params。
- 保存 module version。
- 防止重複初始化。

### 4.2 買入

買入時的典型順序：

1. Core 檢查 token 存在、未暫停、Preset active、vault phase 為 Trading。
2. Core 呼叫 CurveModule `evaluate()` 獲取價格。
3. Core 呼叫 TradeModule `evaluate()` 獲取交易策略和費用。
4. Core 處理使用者支付和費用。
5. Core 呼叫 Vault `onBuy()` 更新 accounting。
6. Core 呼叫 CustomData `afterHook()`，如果存在。
7. 如果 `vault.isSoldOut()` 為 true，Core 可能將 phase 從 `Trading` 切到 `SoldOut`。
8. Core 呼叫 MigrateModule `evaluate()` 檢查是否自動遷移。

`SoldOut` 是 vault 定義的關盤狀態，不是所有遷移的前置條件。Bonding preset 通常在發售庫存耗盡後進入 `SoldOut`。其他玩法可以保持在 `Trading`，直到自己的遷移條件滿足。

### 4.3 賣出

賣出時的典型順序：

1. Core 檢查狀態。
2. Core 呼叫 CurveModule `evaluate()` 獲取賣出 quote。
3. Core 呼叫 TradeModule `evaluate()` 獲取策略和費用。
4. Core 轉入使用者 token。
5. Core 呼叫 Vault `onSell()` 更新 accounting。
6. Core 支付 quote 給使用者。
7. Core 呼叫 CustomData `afterHook()`，如果存在。

### 4.4 遷移

遷移時的典型順序：

1. Core 呼叫 MigrateModule `evaluate()`。
2. 如果 `canMigrate == false`，不執行遷移。
3. Core 將 phase 切到 MigratePending。前一個 phase 可以是 `Trading` 或 `SoldOut`。
4. Core 呼叫 MigrateModule `executeMigration()`。
5. Core 呼叫 CustomData `onMigrate()`，如果存在。
6. Core 將 phase 切到 Migrated。
7. Core 發出 `MigrateExecuted`。

`evaluate()` 返回的 hook data 只能作為提示。`executeMigration()` 必須重新校驗條件、token、caller 和金額上限。

## 5. FairLaunch 範例結構

本目錄提供一套 FairLaunch demo：

- `contracts/modules/token/StandardTokenModule.sol`
- `contracts/token/OpenFourToken.sol`
- `contracts/modules/vault/StandardVault.sol`
- `contracts/modules/curve/FairLaunchCurveModule.sol`
- `contracts/modules/trade/FairLaunchTradeModule.sol`
- `contracts/modules/data/FairLaunchCustomDataModule.sol`
- `contracts/modules/migrate/FairLaunchMigrateModule.sol`
- `contracts/validators/FairLaunchPresetValidator.sol`

FairLaunch 的玩法是：

- 固定價格發行。
- 買入有最小/最大單筆限制。
- 可選啟用賣出，並對賣出應用 penalty。
- Trade module 可以限制單筆買入、累計買入、賣出上限和額外費用。
- Custom data module 記錄累計買入/賣出，供 trade module 讀取。
- Migrate module 在售罄、達到 soft cap 或到期時允許遷移。
- 遷移可以透過 adapter 執行外部 DEX 加池，也可以不執行鏈上流動性動作。

## 6. 開發一個新 Preset

開發新 Preset 時，不要先複製所有模組。先判斷玩法真正改變了哪個職責。

只改定價：

- 寫新的 CurveModule。
- 複用標準 token、vault、trade、migrate。

只改交易規則或費用：

- 寫新的 TradeModule。
- 如果規則需要歷史狀態，再寫 CustomDataModule。

需要交易後狀態：

- 寫 CustomDataModule。
- TradeModule 只讀 custom data，不寫狀態。

只改遷移目標：

- 寫新的 MigrateModule 或遷移 adapter。
- 保持 curve/trade/vault 不變。

改資產 custody 或 accounting：

- 寫新的 VaultModule。
- 這是高風險模組，需要重點審計。

改 token 本體：

- 寫繼承 `OpenFourToken` 的 token implementation。
- 寫對應 TokenModule 初始化它。

## 7. CurveModule 開發規則

CurveModule 必須實現 `IOpenFourCurveModule`。

核心函式：

- `init(...)`
- `evaluate(CurveContext)`
- `evaluateReverse(...)`
- `getInitialPrice()`
- `getLastPrice(...)`
- `getLiquiditySnapshot(...)`
- `getInitParams()`
- `descriptor()`

實現要求：

- `evaluate()` 必須檢查 token 綁定。
- 不要讀寫 trader 歷史狀態。
- 不要依賴 msg.sender 判斷 trader；使用 `ctx.trader`。
- 報價數學要避免溢出，優先使用 `Math.mulDiv`。
- 如果部分成交，返回 `adjustedAmount`。
- 如果完全拒絕，返回 `executable = false` 和 reason。

`evaluateReverse()` 用於「按預算買入」UX。不能支援時可以返回 `(0, 0)`，但如果前端要支援 buyByBudget，應實現它。

## 8. TradeModule 開發規則

TradeModule 必須實現 `IOpenFourTradeModule`。

核心函式：

- `init(address token, address fourCore, bytes params, string moduleVersion)`
- `evaluate(TradeContext)`
- `getInitParams()`
- `descriptor()`

`evaluate()` 返回：

- `allowed`
- `minAmount`
- `maxAmount`
- `FeeTier[] fees`
- `reason`

實現要求：

- 目前介面是 view-only，不要寫狀態。
- 如果需要累計購買、冷卻時間、白名單使用次數等狀態，把狀態放到 CustomDataModule。
- 可以讀取 token、vault 或 customData 的 view 狀態輔助決策。
- FeeTier 的 `bps` 應有上限，收款地址應校驗非零。
- 超出規則時返回 `allowed = false`，不要用 revert 做普通業務拒絕。

## 9. CustomDataModule 開發規則

CustomDataModule 是可選模組。只有在以下場景需要：

- 需要記錄每個 trader 的累計購買、累計賣出、最後交易時間。
- 需要在遷移後記錄快照或結果。
- 需要為 trade/curve/migrate 模組提供共享狀態。
- 需要把 Core 的 `afterHook()` / `onMigrate()` 作為玩法擴展點。

必須實現 `IOpenFourCustomDataModule`：

```solidity
function init(address token, address fourCore, bytes calldata params, string calldata moduleVersion) external;
function afterHook(OpenFourTypes.TradeHookContext calldata ctx) external;
function onMigrate(OpenFourTypes.MigrateHookContext calldata ctx) external;
```

實現要求：

- 只有 Core 可以呼叫 hook 寫函式。
- hook 內必須檢查 `ctx.token`。
- hook 應記錄執行後的事實，不應該反過來決定交易是否有效。
- 需要給其它模組讀取的資料，應提供明確 view getter。
- 如果沒有任何狀態需求，不要實現 custom data module，Preset 中 customDataId 設為 0。

## 10. MigrateModule 開發規則

MigrateModule 必須實現 `IOpenFourMigrateModule`。

核心函式：

- `init(address token, address fourCore, address feeRouter, bytes params, string moduleVersion)`
- `evaluate(MigrateContext)`
- `executeMigration(MigrateHookContext, bytes hookData)`
- `getInitParams()`
- `descriptor()`

實現要求：

- `evaluate()` 應只判斷是否可以遷移，不執行狀態變化。
- `MigrateContext.soldOut` 是 `IOpenFourVault.isSoldOut()` 的快照。玩法要求發售庫存耗盡時可以使用它，但不要假設每條遷移路徑都必須要求它。Fair-launch、時間型、soft-cap 或 operator 觸發型玩法，都可能在 `soldOut == false` 時返回 `canMigrate = true`。
- `executeMigration()` 必須只允許 Core 呼叫。
- `executeMigration()` 必須重新檢查遷移條件。
- 不要信任 `hookData`。
- 對 quote/token 用量重新做 cap。
- 外部 DEX 邏輯建議放到 adapter 或 library，公開範例中優先用 adapter 介面表達。
- 返回 `migratedDataVersion` 和 `encodedMigratedData`，讓索引器能解碼外部 pool。

## 11. VaultModule 開發規則

VaultModule 必須實現 `IOpenFourVault`。

Vault 是資金安全核心，負責：

- quote custody。
- token sale inventory。
- `phase`。
- `totalRaised`。
- `remainingForSale`。
- `isSoldOut()`，由 vault 定義的關盤判斷，會以 `MigrateContext.soldOut` 傳給 MigrateModule。
- buy/sell 後的 accounting。
- migration transfer。

實現要求：

- 只允許 Core 呼叫交易 accounting 函式。
- 只允許 MigrateModule 呼叫 migration transfer 函式。
- 用 `SafeERC20` 處理 ERC20。
- 明確 native/wrapped native 的邊界。
- 不要在 vault 內實現定價和使用者資格判斷。

除非玩法確實改變 custody 或 accounting，否則優先複用標準 Vault。

## 12. TokenModule 和 Token 開發規則

TokenModule 必須實現 `IOpenFourTokenModule`。

TokenModule 負責：

- 初始化 token implementation。
- 注入 vault、curve、trade、migrate、customData、tokenModule 等模組地址。
- 寫入 name、symbol、maxSupply、metadata URI。
- 處理 tokenParams 中的自訂 token 配置。

Token implementation 可以直接使用 `OpenFourToken`。

如果擴展 token：

- 自訂 token 必須繼承 `OpenFourToken`。
- 保留標準模組 getter。
- 保留 `descriptor()`。
- 保留 Core/模組依賴的權限和 phase 語義。
- 不要破壞 ERC20 基礎行為。

Token 擴展適合：

- 轉帳稅。
- 持幣分紅。
- 創作者獎勵。
- 鏈上 metadata / NFT-like 渲染。
- 外盤遷移後特殊限制。

### 12.1 UniToken Renderer

`contracts/interfaces/IUniTokenRenderer.sol` 定義 Uni 類 token 玩法使用的 renderer 介面。

renderer 是外部合約，接收 badge/token id 以及該 badge 儲存的 seed，並返回完整的 `tokenURI` 字串：

```solidity
function tokenURI(uint256 tokenId, uint256 seed) external view returns (string memory);
```

典型使用方式：

- UniToken 相容 token 為每個 badge/token id 儲存或推導一個確定性的 `seed`。
- 查詢 metadata 時，token 將渲染工作委託給 renderer 合約。
- renderer 返回完整 metadata URI，通常是 `data:application/json;base64,...`。
- JSON 的 `image` 欄位可以包含鏈上 SVG、base64 image 或其他支援的 media URI。

建立 token 時使用的自訂 renderer 必須實作 ERC-165，並對 `type(IUniTokenRenderer).interfaceId` 返回 `true`。Preset 的 default renderer 被協議信任，可以跳過這個外部 renderer 介面檢查。

當 token 玩法需要鏈上藝術、動態 metadata、生成式 badge 視覺，或在不改變核心 token/module 介面的前提下提供專案特定展示層時，可以使用自訂 renderer。

## 13. Module Schema

有使用者配置參數的模組建議實現 `IOpenFourModuleSchema`：

```solidity
function moduleEncodeSchema() external pure returns (ModuleEncodeSchema memory);
```

`ModuleEncodeSchema` 包含：

- `kind`：`token`、`vault`、`curve`、`trade`、`migrate`、`customData`。
- `version`：schema 版本。
- `params`：欄位描述陣列。

`ParamDescriptor` 描述：

- `name`
- `abiType`
- `decimals`
- `optional`
- `title`
- `defaultValue`
- `hint`
- `minValue`
- `maxValue`

編碼規則：

- 前端按 `params` 順序取值。
- 編碼為單個 Solidity tuple，例如 `abi.encode((field1, field2, ...))` / `AbiCoder.encode(["(uint256,bool,address)"], [[v1, v2, v3]])`。
- 不要把模組 params 編碼成多個 root ABI value，例如 `AbiCoder.encode(["uint256","bool","address"], [v1, v2, v3])`。當存在 `bytes` 或 `string` 這類動態欄位時，這種 layout 與 struct tuple 不同，模組中的 `abi.decode(rawParams, (Params))` 可能解碼出錯或 revert。
- 鏈上 `init` 用 `abi.decode(rawParams, (Params))` 解碼。
- 空參數模組返回 `"0x"`。

Schema 只是 UI 和編碼輔助。鏈上仍必須做完整參數校驗。

## 14. Descriptor 和 tag 規則

所有 token 和模組都應有穩定 tag：

- Token：`token.<name>`，例如 `token.standard`。
- Token module：`module.token.<name>`。
- Vault：`module.vault.<name>`。
- Curve：`module.curve.<name>`。
- Trade：`module.trade.<name>`。
- Migrate：`module.migrate.<name>`。
- Custom data：`module.data.<name>`。

`tagId` 計算：

```solidity
bytes8 tagId = bytes8(keccak256(bytes(tag)));
```

tag 用於：

- `descriptor()`。
- Registry tag 字典。
- `TokenCreated.encodedTags`。
- 前端識別玩法。
- 索引器零 RPC 分類。

不要把 token tag 和 module tag 混用。

## 15. Module key、metadata 和版本

Registry 中的 module key 是官方註冊模組時使用的完整 `bytes32` 標識；`descriptor()` 返回的 `tagId` 是面向 token 識別和索引的短標識。兩者用途不同，不要混用。

推薦命名方式：

```solidity
bytes32 moduleKey = keccak256(bytes("module.curve.fair_launch"));
bytes8 tagId = bytes8(keccak256(bytes("module.curve.fair_launch")));
```

也就是說，module key 可以和 tag 使用同一個穩定字串作為來源，但一個是完整 `bytes32`，一個是截斷後的 `bytes8`。官方最終註冊時可能根據治理規範調整 key 命名；第三方開發者提交材料時，應明確寫出建議的 key 來源字串、descriptor tag 和版本。

`ModuleMetadata` 建議填寫：

```solidity
OpenFourTypes.ModuleMetadata({
    moduleId: keccak256(bytes("module.curve.fair_launch")),
    version: "1.0.0",
    name: "FairLaunchCurveModule",
    description: "Fixed-price fair launch curve",
    author: developer,
    feeShareBps: 0
});
```

版本規則：

- 修復 bug 且不改變介面、儲存佈局、ABI params 和語義時，可以沿用同一 module key，由官方升級實現。
- 改變介面、儲存佈局、ABI params 或核心語義時，使用新的 module key。
- `descriptor().version` 是建立 token 時 Registry 注入的版本快照，用於索引和追溯，不應該在模組內部隨意拼接。

## 16. FairLaunch Preset 組合範例

FairLaunch preset 由標準 token/vault 加上 fair-launch 策略模組組合而成：

```solidity
OpenFourTypes.Preset({
    id: 1001,
    name: "FairLaunch",
    description: "Fixed-price launch with optional sell support and migration",
    version: "1.0.0",
    active: true,
    createEnabled: true,
    validator: fairLaunchValidator,
    tokenModuleId: keccak256(bytes("module.token.standard")),
    vaultModuleId: keccak256(bytes("module.vault.standard")),
    curveModuleId: keccak256(bytes("module.curve.fair_launch")),
    tradeModuleId: keccak256(bytes("module.trade.fair_launch")),
    migrateModuleId: keccak256(bytes("module.migrate.fair_launch")),
    tokenImplId: keccak256(bytes("token.standard")),
    customDataId: keccak256(bytes("module.data.fair_launch")),
    author: developer
});
```

如果玩法不需要 post-trade 狀態，`customDataId` 可以為 `bytes32(0)`。但 FairLaunch 範例中 `FairLaunchTradeModule.maxPerAddress > 0` 時，TradeModule 需要讀取累計購買量，因此 Preset 必須配置 `FairLaunchCustomDataModule`。

建立參數需要按各模組 schema 編碼：

```solidity
OpenFourTypes.TokenInitParams({
    name: "Example Token",
    symbol: "EXM",
    tokenUri: "ipfs://...",
    maxSupply: 1_000_000 ether,
    saleAmount: 800_000 ether,
    raiseAmount: 80 ether,
    quoteAsset: quoteAsset,
    tokenSalt: bytes32(0),
    tokenParams: "",
    vaultParams: "",
    curveParams: abi.encode(FairLaunchCurveParams({
        fixedPrice: 0.0001 ether,
        sellPenaltyBps: 500,
        enableSell: true,
        minPurchase: 1 ether,
        maxPurchase: 10_000 ether
    })),
    tradeParams: abi.encode(FairLaunchTradeConfig({
        maxBuyAmount: 10_000 ether,
        maxPerAddress: 20_000 ether,
        maxSellAmount: 5_000 ether,
        buyFeeBps: 0,
        sellFeeBps: 0,
        feeRecipient: address(0)
    })),
    migrateParams: abi.encode(FairLaunchMigrateInput({
        softCap: 40 ether,
        duration: 7 days,
        migrationAdapter: address(0),
        lpRecipient: address(0),
        tokenLiquidityAmount: 0,
        maxQuoteToUse: 0
    })),
    customDataParams: ""
});
```

上面的 `FairLaunchCurveParams`、`FairLaunchTradeConfig`、`FairLaunchMigrateInput` 是偽類型名稱，實際編碼時欄位順序必須與範例合約中的 `Params` / `TradeConfig` / `InputParams` 完全一致。前端和腳本應優先讀取 `OpenFourTools.getPresetEncodeSchemas()`，按 schema 順序生成 ABI tuple。

## 17. 註冊模組

模組註冊由 OpenFour 官方/治理方執行，不是第三方開發者自行直接操作的公共入口。第三方開發者需要在官網提交合約程式碼和相關描述資訊，等待後續審核，並提交審計/測試材料、模組用途說明、schema、tag、version、作者資訊和期望組合方式；官方審核通過後，再由官方將模組登記到 Registry。

Registry 註冊時需要提供模組類型、實現標識、實現地址或 beacon、metadata、版本、作者等資訊。具體欄位以官方註冊模板或 `OpenFourRegistry` 實現中的治理介面為準；第三方接入介面不暴露 owner/operator 寫方法。

註冊原則：

- 新模組第一次上線時使用新的 module key。
- 修 bug 且相容儲存和介面時，可以走實現升級。
- 介面、儲存佈局、語義發生重大變化時，註冊新的 module key。
- tag 和 version 應清楚表達模組族和實現版本。

模組元資料應說明：

- name
- description
- version
- author
- feeShareBps 或相關收益配置

## 18. 註冊 Preset

Preset 註冊同樣由 OpenFour 官方/治理方執行。第三方開發者可以提出新 Preset 方案，包括模組組合、玩法說明、參數約束、validator 規則、遷移目標、風險說明和前端展示資訊；官方審核通過後，再將 Preset 寫入 Registry。

Preset 是一組模組和 token implementation 的組合。一個 Preset 通常包含：

- token implementation id
- token module id
- vault module id
- curve module id
- trade module id
- migrate module id
- custom data module id，可為 0
- validator
- author
- active
- createEnabled
- name / description / version

註冊 Preset 後，Core 建立 token 時會根據 `presetId` 解析這些模組。

Preset 狀態語義：

- `active = false`：該 Preset 整體不可用，已存在 token 的交易/遷移也可能被阻止。
- `createEnabled = false`：禁止用該 Preset 建立新 token，但已存在 token 可繼續運行。
- `validator = address(0)`：通常不應允許建立，因為無法校驗建立參數。

## 19. Preset Validator

Validator 用於在建立階段校驗跨模組參數關係。

`contracts/` 提供了兩個 validator 參考檔案：

- `contracts/interfaces/IOpenFourPresetValidator.sol`
- `contracts/validators/FairLaunchPresetValidator.sol`

單個模組的 `init` 只能校驗自己的 params；Validator 可以校驗整體組合，例如：

- `saleAmount <= maxSupply`
- `raiseAmount > 0`
- curve params 與 token supply 是否一致
- trade 限額是否合理
- migrate soft cap 是否不超過 raise target
- custom data 是否在需要累計狀態時存在
- token 類型是否與 vault/trade/migrate 組合匹配

推薦把「跨模組不變量」放到 validator，而不是分散到多個模組中。

Validator 只能校驗建立參數本身。Preset 是否真的綁定了某個 custom data module、module key 是否註冊、模組是否 active，仍由 Registry/Preset 配置和官方審核流程保證。

## 20. 端到端開發流程建議

1. 寫玩法說明，明確價格、交易、遷移和狀態需求。
2. 判斷需要替換哪些模組。
3. 定義每個模組的 params struct。
4. 實現 `init`、`descriptor`、`getInitParams`。
5. 實現 `moduleEncodeSchema()`。
6. 實現核心介面函式。
7. 寫 validator 校驗跨模組參數。
8. 在官網提交合約程式碼和相關描述資訊，等待後續審核。

例如把 FairLaunch 改造成「階梯價格玩法」：

1. 複用 `OpenFourToken`、`StandardTokenModule`、`StandardVault`。
2. 新寫 `StepCurveModule`，只替換定價邏輯。
3. 如果交易規則不變，複用 `FairLaunchTradeModule`；如果需要白名單或冷卻時間，再增加 CustomDataModule 並讓 TradeModule 讀取它。
4. 複用或替換 `FairLaunchMigrateModule`，取決於畢業條件和外部流動性目標是否變化。
5. 寫 `StepLaunchPresetValidator`，校驗階梯價格陣列、saleAmount、raiseAmount、softCap、交易限制之間的關係。
6. 給新 curve module 準備 `descriptor()` tag、schema、metadata、測試和審計材料。
7. 在官網提交合約程式碼和相關描述資訊，等待後續審核。

## 21. 安全檢查清單

模組通用：

- 初始化只允許執行一次。
- `fourCore` 非零。
- `token` 非零。
- 上下文 token 必須等於 bound token。
- 狀態寫函式只允許 Core 或指定模組呼叫。
- 保存 raw init params 和 module version。
- `descriptor()` 穩定。
- schema 與 `Params` ABI 順序一致。

Curve：

- 報價數學無溢出。
- 零 amount 行為明確。
- supply 邊界明確。
- reverse quote 與正向 quote 口徑一致。

Trade：

- 普通拒絕返回 `allowed = false`。
- fee bps 有上限。
- fee recipient 非零。
- view-only，不寫狀態。

Custom data：

- hook onlyCore。
- hook 檢查 token。
- 記錄執行後事實，不做前置審批。
- 給其它模組讀取的 getter 清晰穩定。

Migrate：

- evaluate 不寫狀態。
- execute 重新校驗條件。
- 不信任 hookData。
- quote/token 用量有上限。
- 外部呼叫返回值校驗。
- migrated data version 明確。

Vault：

- 使用 SafeERC20。
- 權限邊界清楚。
- phase 轉換清楚。
- custody 與 accounting 不可被繞過。

Token：

- 自訂 token 繼承 OpenFourToken。
- 保留標準 getter。
- 不破壞 ERC20 基礎行為。
- 遷移後 pool 權限和轉帳規則清晰。

## 22. FairLaunch 作為模板如何改造

常見改造路徑：

- 固定價格改階梯價格：替換 `FairLaunchCurveModule`。
- 增加白名單期：新增/擴展 `FairLaunchCustomDataModule` 儲存白名單或購買記錄，TradeModule 讀取它。
- 增加冷卻時間：CustomData 記錄 `lastTradeTime`，TradeModule 讀取並限制。
- 改遷移目標：替換 `FairLaunchMigrateModule` 或 adapter。
- 增加稅費：擴展 TradeModule 返回 FeeTier，或擴展 Token 實現做外盤轉帳稅。
- 增加發行後 metadata：繼承 `OpenFourToken` 並擴展 tokenURI/renderer。

優先只替換一個職責模組。只有當玩法確實跨職責變化時，再組合多個新模組。

## 23. 已開發模組參考

OpenFour 目前已經有一批可複用模組，來自官方和合作方開發建立。開發新玩法時，優先判斷能否複用已有模組，只替換真正需要變化的槽位。具體哪些模組可對外使用、如何組合、是否需要官方註冊或審核，請聯絡 OpenFour 官方確認。

Token module：

- `StandardTokenModule` / `module.token.standard`：初始化標準 `OpenFourToken`，適合普通 ERC20 發行玩法。
- `TaxTokenModule` / `module.token.tax`：初始化帶轉帳稅、分紅、稅費分配等能力的 TaxToken。
- `CreatorRewardsTokenModule` / `module.token.creator_rewards`：初始化創作者獎勵類 token，適合將外部池子手續費或收益與 creator 關聯的玩法。
- `UniTokenModule` / `module.token.uni`：初始化 Uni 風格 token，適合餘額與鏈上 Art、renderer 或特殊 hook 綁定的玩法。

Vault module：

- `StandardVault` / `module.vault.standard`：標準內盤資金保管和 sale accounting，適合大多數普通 bonding/fair-launch 玩法。
- `TaxBondingVault` / `module.vault.tax_bonding`：面向 TaxToken 內盤的 vault，支援稅幣玩法需要的額外 accounting 和分發路徑。

Curve module：

- `BondingCurveModule` / `module.curve.bonding`：標準 bonding curve 定價模組，適合經典內盤價格隨購買推進變化的玩法。

Trade module：

- `SimpleTradeModule` / `module.trade.simple`：最小交易策略模組，不增加額外限制或費用，適合普通玩法複用。
- `TaxBondingTradeModule` / `module.trade.tax_bonding`：TaxToken 內盤交易模組，根據 TaxToken 配置返回額外稅費層。

Migrate module：

- `PancakeSwapV2MigrateModule` / `module.migrate.pcs_v2`：PCS V2 遷移基類，封裝遷移到 PancakeSwap V2 的通用行為。
- `BondingPcsV2MigrateModule`：標準 bonding 遷移到 PancakeSwap V2 的實現，繼承 PCS V2 遷移能力。
- `BondingTaxPcsV2MigrateModule`：Tax bonding 遷移到 PancakeSwap V2 的實現，擴展稅幣遷移後的處理。
- `PancakeSwapV4MigrateModule` / `module.migrate.pcs_v4`：PCS V4 遷移基類，封裝遷移到 PancakeSwap V4 的通用行為。
- `BondingPcsV4MigrateModule` / `module.migrate.bonding_pcs_v4`：標準 bonding 遷移到 PancakeSwap V4 的實現。
- `BondingLikwidV2MigrateModule` / `module.migrate.bonding_likwid`：遷移到 Likwid V2 的 bonding 實現。

Custom data module：

- `StandardCustomData` / `module.data.standard`：空實現的 custom data 模組，提供 `afterHook` / `onMigrate` no-op，可作為自訂狀態模組的繼承起點。

複用建議：

- 如果只是換價格曲線，優先複用現有 token/vault/trade/migrate，只開發新的 CurveModule。
- 如果只是加交易費或限制，優先複用 token/vault/curve/migrate，只開發新的 TradeModule。
- 如果需要歷史狀態或跨模組共享狀態，增加 CustomDataModule，不要把狀態寫進 view-only 的 TradeModule。
- 如果只是換遷移目標，優先複用 token/vault/curve/trade，只開發新的 MigrateModule 或 adapter。
- 如果涉及資金 custody、phase、totalRaised、remainingForSale 的語義變化，才考慮開發 VaultModule。
- 如果涉及 ERC20 本體行為變化，才考慮開發繼承 `OpenFourToken` 的新 token implementation 和對應 TokenModule。

## 24. 文檔和接入配套

上線自訂 Preset 時，建議同步提供：

- Preset 名稱、描述、版本。
- 模組組合說明。
- 每個模組的 descriptor tag。
- 建立參數 schema 說明。
- 交易限制說明。
- 費用說明。
- 遷移目標和 migrated data 解碼方式。
- 事件索引建議。
- 已知錯誤碼和 reason。
- 安全審計狀態。

第三方接入方會依賴這些資訊做 UI、索引、交易路由和風險提示。

## 25. 開發未驗證版稅 TaxVault 模板

OpenFour Royalty 模式允許建立者透過平台 `ForwardVault` 包裝器使用未驗證的 TaxVault implementation。參考包裝器已部署於 [`0xD3917AA849ec5122a4C0D48e054fa3B5514C47e4`](https://bscscan.com/address/0xD3917AA849ec5122a4C0D48e054fa3B5514C47e4#code)。使用此模式不代表 OpenFour 已審核、審計、註冊或認可所提交的模板。

### 25.1 運行結構與版稅分配

建立時需要 ABI 編碼：

```solidity
ForwardVault.InitParams({
    template: unverifiedTemplateImplementation,
    initData: abi.encode(MyTemplate.Params({ /* ... */ }))
})
```

`ForwardVault` 使用 EIP-1167 `Clones.clone()` 複製 `template`，然後以 OpenFour token、quote 資產、作為 owner 的 token 建立者、空 `roles` 陣列及 `initData` 初始化 clone。

每次收到稅費時：

- 最多約 `6%` 為版稅份額（`ROYALTY_BPS = 600`），支付至 clone 模板的 `authorWallet()`；Solidity 整數除法會向下取整。
- 其餘約 `94%` 轉發至 clone 模板。金額小於 17 個資產最小單位時，取整後的版稅為零。
- 若 `authorWallet()` 返回 `address(0)`、`address(0xdEaD)` 或 `ForwardVault` 本身，則視為作者放棄版稅，全部金額轉發至 clone。
- native 稅費的版稅部分會先包裝為 wrapped native 再支付給作者，clone 收到 native 幣。
- ERC20 稅費的兩部分均保持為 quote ERC20。包裝器會忽略 callback 傳入的名義 amount，並分配當前全部餘額，因此預先轉入或意外捐贈的餘額也會被納入。轉帳名義 clone 份額後，`ForwardVault` 會以 best-effort 方式呼叫 `onERC20TaxReceived()`；fee-on-transfer clone 的實際到帳可能少於 callback amount。

第一次收款會將包裝器鎖定為 `Native` 或 `ERC20` 收益模式；之後若收到另一模式的資產，`ForwardVault` 呼叫會以 `RevenueAssetMismatch` revert。這不一定代表整個系統回滾：ERC20 路徑中，`TaxToken` 會先轉帳再呼叫 callback，並捕獲 callback revert，因此資金可能留在包裝器；native 路徑則由 `TaxToken` 記錄失敗交付並等待後續重試。

目前的參考包裝器只在 BSC mainnet（`chainId 56`）及 BSC testnet（`chainId 97`）解析 wrapped native；在其他鏈上初始化會以 `UnsupportedChain` revert。

### 25.2 模板必需介面

提交的地址必須是已部署且可被 clone 的 implementation，並公開：

```solidity
interface IForwardVaultTemplate {
    function initialize(
        address token,
        address quote,
        address owner,
        address[] calldata roles,
        bytes calldata initParams
    ) external;

    function taxVaultToken() external view returns (address);
    function taxVaultQuote() external view returns (address);
    function authorWallet() external view returns (address);
    function onERC20TaxReceived(address asset, uint256 amount) external;
}
```

初始化後，`taxVaultToken()` 和 `taxVaultQuote()` 必須與 `ForwardVault` 傳入的值完全一致，否則建立會以 `InvalidClonedVault` revert。`authorWallet()` 必須返回有效 ABI address 資料，且應保持穩定，以確保版稅計算可預期。

quote 地址必須是非零合約。模板地址也必須是已部署合約；EOA 或沒有 code 的地址會被拒絕。

implementation 應繼承 `BaseTaxVault`，或完整重現其初始化及 caller 校驗。由於包裝器傳入空 `roles` 陣列，未驗證模板不得依賴 Registry 在初始化時提供 role。

`ForwardVault` 不會把 `updateShares()` 轉發至 clone 模板。來自 `TaxToken` 的呼叫會落到外層 vault 的 no-op 實現，因此依賴 holder share 同步、分紅或 holder accounting 的模板與目前包裝器不相容。除非未來包裝器明確增加該轉發 hook，Royalty 模式只應使用收款型模板。

### 25.3 Clone-safe 實現方式

作為 `template` 使用的 implementation 應：

- 在 implementation constructor 中停用初始化，並將每個 clone 的狀態初始化全部放入 `_customInit()`。
- 定義唯一 `TYPE_ID`；storage layout 或初始化 ABI 發生變更時使用新的 type/version。
- 在鏈上校驗所有解碼後的地址、bps、陣列邊界及跨欄位約束。
- quote 可能是 wrapped native 時，必須能接收 native 轉帳。
- 支援 fee-on-transfer 資產時使用 `SafeERC20` 和實際餘額差額。
- 明確限制提款及配置寫入權限；僅有 ownership 並不能讓任意外部呼叫變得安全。
- 不得依賴 constructor 寫入的可變 storage、僅 proxy 可用的行為或非空 `roles` 陣列。

最小實現模式：

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BaseTaxVault} from "../contracts/taxvault/BaseTaxVault.sol";
import {
    ModuleEncodeSchema,
    ParamDescriptor
} from "../contracts/libraries/OpenFourTypes.sol";

contract MyRoyaltyVault is BaseTaxVault {
    struct Params {
        address recipient;
        uint16 recipientBps;
    }

    bytes32 public constant TYPE_ID =
        keccak256("MyProject.MyRoyaltyVault.v1");

    address public recipient;
    uint16 public recipientBps;

    constructor() {
        _disableInitializers();
    }

    function authorWallet() public pure override returns (address) {
        return 0x1234567890123456789012345678901234567890;
    }

    function _customInit(
        address[] calldata,
        bytes calldata initParams
    ) internal override {
        _setTypeId(TYPE_ID);
        Params memory p = abi.decode(initParams, (Params));
        require(p.recipient != address(0), "zero recipient");
        require(p.recipientBps <= 10_000, "invalid bps");
        recipient = p.recipient;
        recipientBps = p.recipientBps;
    }

    function onERC20TaxReceived(
        address asset,
        uint256 amount
    ) public override {
        super.onERC20TaxReceived(asset, amount);
        // 執行模板特定的 accounting 或分配。
    }

    function moduleEncodeSchema()
        external
        pure
        override
        returns (ModuleEncodeSchema memory)
    {
        ParamDescriptor[] memory p = new ParamDescriptor[](2);
        p[0] = ParamDescriptor({
            name: "recipient",
            abiType: "address",
            decimals: 0,
            optional: false,
            title: "Recipient",
            defaultValue: "",
            hint: "Template payout recipient",
            minValue: "",
            maxValue: ""
        });
        p[1] = ParamDescriptor({
            name: "recipientBps",
            abiType: "uint16",
            decimals: 0,
            optional: false,
            title: "Recipient Share (bps)",
            defaultValue: "10000",
            hint: "Share out of 10000",
            minValue: "0",
            maxValue: "10000"
        });
        return ModuleEncodeSchema("taxvault", 1, p);
    }
}
```

`authorWallet()` 返回的是模板開發者的版稅收款地址，不是 token 建立者，也不一定是 vault owner。

### 25.4 必須定義 Schema

上面的完整示例已實現 `moduleEncodeSchema()`，用於描述內層 `initData`。欄位順序及 ABI 類型必須與模板的 `Params` struct 完全一致。

`ForwardVault` 在 clone 初始化時不會呼叫內層 schema；其鏈上運行時只解碼固定的外層 `(template, initData)` tuple。但繼承抽象 `BaseTaxVault` 時仍必須實現該函式，模板作者也必須公開 schema，讓 Royalty 前端直接從所提交的 implementation 查詢並編碼 `initData`。

前端首先將模板欄位編碼為單一 tuple：

```typescript
const initData = AbiCoder.defaultAbiCoder().encode(
  ["(address,uint16)"],
  [[recipient, recipientBps]],
);
```

然後再編碼固定的外層 `ForwardVault` schema：

```text
kind: SafuSkill.ForwardVault
version: 1
fields:
  template address
  initData bytes
```

```typescript
const forwardVaultParams = AbiCoder.defaultAbiCoder().encode(
  ["(address,bytes)"],
  [[templateAddress, initData]],
);
```

不得將內外層欄位展平成同一個 ABI tuple。`initData` 屬於 clone 模板，而 `(template, initData)` 屬於 `ForwardVault`。

### 25.5 提交與安全檢查

填入未驗證模板地址前：

- 確認部署 bytecode 屬於預期的直接 implementation。
- 確認 clone 的 `initialize()` 無法被呼叫兩次。
- 模擬初始化並確認 token/quote getter 完全匹配。
- 確認 `authorWallet()` 返回預期的 immutable 或治理控制地址。
- 測試所選 quote 支援的 native 與 ERC20 收款路徑。
- 測試 fee-on-transfer 行為，使用實際收款餘額而不是 callback 的名義 amount。
- 測試 callback revert、native 轉帳失敗、重入、提款權限及零額/dust。
- 確認 schema 產生的 `initData` 能精確解碼為預期 `Params`。
- 在可行時公開 source、compiler settings、測試及審計報告。

`ForwardVault` clone 建立後，模板及初始化配置不可替換。合約缺陷可能永久鎖定或錯誤路由稅費，因此只有在建立者能獨立理解並信任所提交合約時才應繼續使用此模式。
