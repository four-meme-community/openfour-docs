# OpenFour 文檔

語言：[English](../../README.md) | 繁體中文

OpenFour 是 Four.Meme 推出的全新模組化 launch 引擎，為開發者提供合約層級的模組化創意開發與發射平台。開發者可以圍繞 token、vault、curve、trade、migrate、custom data 等模組組合新的玩法，並透過 OpenFour 生態共享收益、共建社群生態。

本目錄提供 OpenFour 第三方接入、模組開發，以及公開的 token / 介面參考。FairLaunch 範例在 [`developer/startup/`](../../developer/startup/)。示例程式碼僅用於 demo 和開發參考，未經審計，不應用於其他正式生產用途。

## 文件

- [接入文件 0.0.6](./integration-guide.md)：面向錢包、交易 UI、索引器、資料後端、發射平台和聚合器，覆蓋建立、預估、交易、事件監聽、token 識別、模組識別、錯誤處理和事件解讀。
- [TaxToken 稅費與分配機制](./mechanisms/tax-token.md)：說明 bonding 與遷移後稅費收取、四類分配、holder reward 手動注資、keeper 流程及 gas 行為。
- [未驗證版稅（`ForwardVault`）](./mechanisms/unverified-royalty.md)：說明平台 ForwardVault 如何包裝開發者 TaxVault 模板（6%/94% 分成）、如何實作合規模板，以及如何部署並建立代幣。
- [Lista V2 質押稅費機制](./mechanisms/lista-v2-stake.md)：說明 StrategyTaxToken 識別、Lista V2 pool 路由、tax dispatch、Lista vault share 分配和 keeper 接入。
- [4Stock → bStock](./mechanisms/4stock-to-bstock-SIH.md)：說明 `module.migrate.pcs_v4_sih`、4Stock → bStock 池切換，以及聚合器如何用事件切換流動性路由。
- [TapeFour](./mechanisms/tape-four.md)：基於 Tapeout 協議的 meme 挖礦模式（平價 NAND 募資 → PCS V2 → 挖 token）；本 preset 特有的識別、NFT 事件與交易注意點。
- [Binance Agent ID Exclusive](./mechanisms/binance-agent-id-exclusive.md)：需 Binance Agentic Wallet with Agent ID 的 Tax bonding（1% 持倉上限、內盤轉帳鎖、允許 0 稅）；本 preset 特有的識別與交易注意點。
- [開發文件 0.0.2](./developer-guide.md)：面向希望基於 OpenFour 開發自訂模組、Preset、validator 或 token 擴充的開發者，覆蓋架構原則、模組關係、介面要求、schema、validator 和官網提交流程。FairLaunch 起步工程在 [`developer/startup/`](../../developer/startup/)。

## 公開合約

`contracts/` 目錄公開介面和 token 參考。FairLaunch 模組只放在 `developer/startup/`。

- `contracts/interfaces/`：自訂模組需要實作或引用的協議介面。
- `contracts/libraries/OpenFourTypes.sol`：Core、模組、工具和 UI 共用的資料結構。
- `contracts/token/`：`OpenFourToken`、`TaxToken`、`StrategyTaxToken` 等 token implementation 的公開參考源碼。
- `contracts/modules/`：預設 Bonding / Bonding Tax 模組參考——`vault/`（`StandardVault`、`TaxBondingVault`）、`trade/`（`SimpleTradeModule`、`TaxBondingTradeModule`）、`data/`（`StandardCustomData`）。
- `contracts/taxstrategy/ITaxStrategy.sol`：每 token strategy-tax 接入使用的公開介面。
- `contracts/taxvault/`：供自訂版稅模板使用的公開 TaxVault 介面、`BaseTaxVault` 基礎合約，以及平台 `ForwardVault` 包裝器。
- `scripts/`：用於 create 參數編碼、schema 解析、鏈上提交、ABI 同步和 encoded tag 解析的 JavaScript helper 與示例。
- `developer/`：獨立開發工具，包含 FairLaunch Hardhat 起步工程、BSC Testnet implementation-fork 流程，以及本地開發工作台。

這些合約不是 OpenFour 生產部署源碼，也不包含完整 Core、Registry、Deployer 或官網審核系統。
