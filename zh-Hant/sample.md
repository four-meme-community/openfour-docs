# OpenFour FairLaunch 模組示例

語言：[English](../sample.md) | 繁體中文

本文件說明 `contracts/` 中的 FairLaunch 公開示例合約骨架。FairLaunch 是一個固定價格發射玩法，支援可選賣出、單筆與單地址買入限制、交易後 custom data 狀態，以及在售罄、達到 soft cap 或到期後進入遷移流程。

本目錄僅作為模組開發參考，不是 OpenFour 生產部署源碼。示例合約未經審計，只能用於 demo 和開發參考，不應用於其他正式生產用途。

## 文件

- `integration-guide.md`：面向錢包、交易 UI、索引器、資料後端、發射平台和聚合器，覆蓋建立、預估、交易、事件監聽、token/module 識別與錯誤處理。
- `developer-guide.md`：面向開發自訂 OpenFour 模組、Preset、token 擴充和 validator 的開發者。

## 模組架構

`OpenFourCore` 是執行協調器。它負責建立 token、路由 buy/sell、向 curve/trade 模組請求價格和策略決策、更新 vault accounting、呼叫 custom-data hook，並在 migrate 模組判定完成時觸發遷移。

每個模組只負責一個職責：

- `StandardTokenModule` 和 `OpenFourToken`：負責 token 身分和模組地址 wiring。
- `StandardVault`：負責發射期間的資產託管、sale inventory、`totalRaised`、`remainingForSale` 和 phase。
- `FairLaunchCurveModule`：負責固定價格定價。
- `FairLaunchTradeModule`：負責交易限制和可選費用；需要累計買入限制時讀取 custom data，但不寫狀態。
- `FairLaunchCustomDataModule`：負責交易後和遷移後的自訂狀態。
- `FairLaunchMigrateModule`：負責發射完成條件和可選外部流動性遷移。

## 目錄內容

- `contracts/interfaces/*.sol`：自訂模組需要實作或引用的協議介面。
- `contracts/libraries/OpenFourTypes.sol`：Core、模組、工具和 UI 共用的資料結構。
- `contracts/token/OpenFourToken.sol`：標準 token implementation 示例。
- `contracts/modules/token/StandardTokenModule.sol`：token 初始化模組。
- `contracts/modules/vault/StandardVault.sol`：sale accounting 和資產託管模組。
- `contracts/modules/curve/FairLaunchCurveModule.sol`：固定價格曲線模組。
- `contracts/modules/trade/FairLaunchTradeModule.sol`：交易策略與費用模組。
- `contracts/modules/data/FairLaunchCustomDataModule.sol`：交易後與遷移後狀態模組。
- `contracts/modules/migrate/FairLaunchMigrateModule.sol`：發射完成與流動性遷移模組。
- `contracts/interfaces/IOpenFourPresetValidator.sol`：Preset 層級 validator 介面。
- `contracts/validators/FairLaunchPresetValidator.sol`：FairLaunch 跨模組參數 validator 示例。

本骨架刻意不包含 `OpenFourCore`、`OpenFourRegistry`、`OpenFourDeployer`、管理合約或底層 DEX 遷移 library。公開示例需要 DEX 行為時，應透過小型 interface 或 adapter 表達。

## FairLaunch 流程

1. token 透過 `StandardTokenModule` 建立，並初始化 `OpenFourToken` 的模組地址。
2. `StandardVault` 保存初始 sale inventory，並追蹤 `totalRaised`、`remainingForSale` 和 phase。
3. 買入時，Core 向 `FairLaunchCurveModule` 請求固定價格 quote。
4. 同一筆買入再向 `FairLaunchTradeModule` 查詢是否允許交易及是否有額外 fee tier。
5. Core 處理支付和費用，並呼叫 `StandardVault.onBuy()` 更新託管和 accounting。
6. Core 呼叫 `FairLaunchCustomDataModule.afterHook()`，記錄 trader 累計統計。
7. Core 呼叫 `FairLaunchMigrateModule.evaluate()` 判斷是否應進入遷移。
8. 遷移時，`FairLaunchMigrateModule.executeMigration()` 可執行 adapter 呼叫，Core 再呼叫 `FairLaunchCustomDataModule.onMigrate()`。

核心設計規則是：模組不要互相搶職責。定價屬於 curve，交易限制屬於 trade，資產託管屬於 vault，歷史狀態屬於 custom data。

## 模組合約規則

OpenFour 模組是每個 token 一組的 clone。每個模組應在 `init` 綁定唯一 token，保存 `fourCore` 地址，並拒絕任何其他 token 的 context。

每個模組都應暴露穩定的 `descriptor()`。`tag` 用於識別模組族，例如 `module.curve.fair_launch`；`version` 是建立時注入的實作版本快照。

接受 encoded params 的模組應暴露 `moduleEncodeSchema()`。schema 用於 builder 渲染表單和 ABI 編碼，但不是驗證；模組仍必須在 `init` 解碼並校驗 params。

如果介面要求，模組應保存 raw initialization bytes 並暴露 `getInitParams()`，方便索引器、UI 和 Registry 還原 token 配置。

`hookData` 不是權限邊界。如果 `evaluate()` 返回資料後又傳入 `executeMigration()`，執行函式仍必須重新檢查 caller、token 綁定、遷移條件和金額上限。

## 必需介面

每類模組必須實作對應協議介面。接受使用者配置參數的模組也建議實作 `IOpenFourModuleSchema`。

必需模組：

- Token module：必須實作 `IOpenFourTokenModule`。
- Vault module：必須實作 `IOpenFourVault`。
- Curve module：必須實作 `IOpenFourCurveModule`。
- Trade module：必須實作 `IOpenFourTradeModule`。
- Migrate module：必須實作 `IOpenFourMigrateModule`。

可選模組：

- Custom data module：只有 Preset 需要持久自訂狀態、Core hook 或跨模組共享資料時才實作 `IOpenFourCustomDataModule`。

Token implementation 可以直接使用 `OpenFourToken`。如果玩法需要擴充 token 行為，自訂 token implementation 必須繼承 `OpenFourToken`，讓 Core、模組和 off-chain 工具能依賴標準 token 介面和模組引用。

## 建立自訂 Preset

從真正改變職責的模組開始：

- 只改價格：替換 curve module。
- 只改交易資格或額外費用：替換 trade module。
- 需要交易後歷史狀態：新增或替換 custom data module。
- 改發射完成條件或流動性路由：替換 migrate module。
- 改資產託管或 accounting：替換 vault module。
- 改 token 初始化或 token 本體：替換 token module 或繼承 `OpenFourToken`。

新增模組時至少檢查：

- 在 `init` 校驗 decoded params。
- 綁定唯一 token 和 Core 地址。
- 返回穩定 `descriptor()` tag。
- 暴露與 ABI params 匹配的 schema。
- view 模組保持 view-only。
- state-changing 函式重新檢查執行不變式。
- 外部整合放在小型 interface 或 adapter 後面。

本文件是自訂玩法模組的實作參考，不是完整協議部署包。
