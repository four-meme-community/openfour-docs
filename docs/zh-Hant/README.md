# OpenFour 文檔

語言：[English](../../README.md) | 繁體中文

OpenFour 是 Four.Meme 推出的全新模組化 launch 引擎，為開發者提供合約層級的模組化創意開發與發射平台。開發者可以圍繞 token、vault、curve、trade、migrate、custom data 等模組組合新的玩法，並透過 OpenFour 生態共享收益、共建社群生態。

本目錄提供 OpenFour 第三方接入、模組開發和 FairLaunch 示例合約文件。示例程式碼僅用於 demo 和開發參考，未經審計，不應用於其他正式生產用途。

## 文件

- [接入文件 0.0.4](./integration-guide.md)：面向錢包、交易 UI、索引器、資料後端、發射平台和聚合器，覆蓋建立、預估、交易、事件監聽、token 識別、模組識別、錯誤處理和事件解讀。
- [TaxToken 稅費與分配機制](./mechanisms/tax-token.md)：說明 bonding 與遷移後稅費收取、四類分配、holder reward 手動注資、keeper 流程及 gas 行為。
- [Lista V2 質押稅費機制](./mechanisms/lista-v2-stake.md)：說明 StrategyTaxToken 識別、Lista V2 pool 路由、tax dispatch、Lista vault share 分配和 keeper 接入。
- [開發文件 0.0.2](./developer-guide.md)：面向希望基於 OpenFour 開發自訂模組、Preset、validator 或 token 擴充的開發者，覆蓋架構原則、模組關係、介面要求、schema、validator 和官網提交流程。
- [FairLaunch 示例說明](./sample.md)：說明 `contracts/` 中的 FairLaunch demo 合約結構、模組職責和示例玩法流程。

## 示例合約

`contracts/` 目錄包含一套 FairLaunch 參考實作：

- `contracts/interfaces/`：自訂模組需要實作或引用的協議介面。
- `contracts/libraries/OpenFourTypes.sol`：Core、模組、工具和 UI 共用的資料結構。
- `contracts/token/`：`OpenFourToken`、`TaxToken`、`StrategyTaxToken` 等 token implementation 的公開參考源碼。
- `contracts/taxstrategy/ITaxStrategy.sol`：每 token strategy-tax 接入使用的公開介面。
- `contracts/taxvault/`：供自訂版稅模板使用的公開 TaxVault 介面與 `BaseTaxVault` 基礎合約。
- `contracts/modules/`：Token、Vault、Curve、Trade、CustomData、Migrate 模組示例。
- `contracts/validators/FairLaunchPresetValidator.sol`：FairLaunch 跨模組參數校驗示例。
- `scripts/`：用於 create 參數編碼、schema 解析、鏈上提交、ABI 同步和 encoded tag 解析的 JavaScript helper 與示例。

這些合約用於展示如何編寫 OpenFour 模組和組織一套自訂玩法，不是 OpenFour 生產部署源碼，也不包含完整 Core、Registry、Deployer 或官網審核系統。
