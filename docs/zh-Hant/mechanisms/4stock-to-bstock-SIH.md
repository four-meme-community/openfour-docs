# 4Stock SIH Quote Cutover（4Stock → bStock）

[English](../../mechanisms/4stock-to-bstock-SIH.md) | [繁體中文](./4stock-to-bstock-SIH.md)

本文件說明 OpenFour 4Stock SIH token 如何畢業到 PancakeSwap Infinity Shared Inventory Hook（SIH）池，以及第三方應如何正確監聽事件，把流動性查詢與路由始終切到當前唯一可交易池。

基於 PancakeSwap Infinity Shared Inventory Hook（SIH），我們為 4Stock 體系定制了共享底池管理機制，使同一 meme 庫存可配對 4Stock 與 bStock。

啟用該機制後，meme 畢業時主交易對首先建立在 meme / 4Stock；待 bStock 上線後，已經畢業的 meme 主流動性可平滑遷移至 meme / bStock，而未畢業的 meme 在畢業時一般也會直接建立 meme / bStock。具體以下文事件數據為準。

## 1. 規則

1. 每個 meme **任一時刻只有一個**可交易 SIH 池：`activePool[meme]`。
2. 只有 `MigrateExecuted.migrateTagId` 匹配 `module.migrate.pcs_v4_sih`（`0x4d9a569156253e90`）的 token，才是畢業進 SIH 的 meme；其他 migrate tag 不走本文件路徑。
3. **核心只聽** `Stock4SihManager.MemePoolCreated`：它同時給出 meme、**quote**、`poolId`，用來寫 / 切 `activePool`。
4. 4Stock → bStock cutover **不會**再發 OpenFour `MigrateExecuted`；繼續聽 `MemePoolCreated` 即可。
5. 若已接入 **PancakeSwap Aggregator**，可由其自動查詢並聚合 V4 SIH hook 流動性。交易不以 quote 為對手幣時（例如 buy with BNB / sell to BNB），可直接交給 Aggregator 自動路由，無需自行拼多跳。

索引狀態示例：

```text
pools[poolId]    = { meme, quote, poolKey }
activePool[meme] = poolId   // 路由 / 報價只認這個
```

## 2. 事件監聽流程

**主監聽：**`MemePoolCreated(meme, quote, poolId)`

```text
         收到 MemePoolCreated(meme, quote, poolId)
                             │
                             ▼
             這個 meme 以前有沒有 activePool？
                             │
             ┌───────────────┴───────────────┐
             ▼                               ▼
            沒有                     有，且 ≠ 新 poolId
             │                               │
             ▼                               ▼
┌──────────────────────────┐   ┌──────────────────────────┐
│ 【畢業建池】               │   │ 【Cutover 切池】          │
│ 同筆有 MigrateExecuted    │   │ 無 MigrateExecuted       │
│ activePool = poolId      │   │ activePool = 新 poolId   │
│ quote = 事件裡的地址       │   │ quote = 事件裡的新地址     │
│                          │   │ 舊池停用                  │
└──────────────────────────┘   └──────────────────────────┘
```

`MigrateExecuted` 校驗（畢業同筆）：

- `migrateTagId == 0x4d9a569156253e90`
- `decode(encodedMigratedData) == poolId`（**只有 poolId，沒有 quote**）

狀態更新（兩種情況同一套）：

```text
pools[poolId] = { meme, quote, … }
activePool[meme] = poolId
外盤計價幣 = 事件裡的 quote   // 不必硬編碼什麼是 bStock
```

Cutover **沒有**第二次 `MigrateExecuted`，不要等。

## 3. 識別常量

| 信號 | 值 |
| --- | --- |
| Migrate tag | `module.migrate.pcs_v4_sih` |
| `migrateTagId` | `0x4d9a569156253e90` |
| 畢業 payload | `abi.encode(bytes32 poolId)`（**只有 poolId**） |

**不要**用 `vault.quoteAsset()` / 過渡期 `meme.quote()` 當外盤計價幣：內盤募集仍是 4Stock，但畢業時可能直接開 meme/bStock。

相關 Solidity 接口見倉庫 [`contracts/interfaces/`](../../../contracts/interfaces/)：`IStock4Sih.sol`、`ICLSharedInventoryHook.sol`、`ICLSharedInventoryHookMonitor.sol`。

---

以下章節**不是**切池主流程，僅作聚合器報價 / 執行 / 冷啟動的參考建議。

## 4. 參考：事件詳解

### 4.1 畢業建池（同筆常見日誌）

內盤售罄後，同一筆 OpenFour migrate 裡除 `MemePoolCreated` / `MigrateExecuted` 外，通常還有：

| 合約 | 事件 | 用途 |
| --- | --- | --- |
| SIH hook | `PoolTaxTokenSet(id, taxToken)` | 僅帶稅 meme：該池由 `taxToken`（= meme）收稅 |
| SIH hook | `PoolConfigured(id, cfg)` | `cfg = (enabled, tickLower, tickUpper, liquidity)` |
| CLPoolManager | `Initialize(id, currency0, currency1, hooks, fee, parameters, sqrtPriceX96, tick)` | **完整 PoolKey** |
| SIH Monitor | `PoolRegistered(id, currency0, currency1)` | 池登記 |

過濾：`Initialize.hooks == SIH hook`，並以 `MemePoolCreated` 確認是 four.meme meme。  
`encodedMigratedData = abi.encode(bytes32 poolId)`，與 `MemePoolCreated.poolId` / `Initialize.id` 對齊即可。

### 4.2 運行期（可選訂閱）

| 合約 | 事件 | 處理 |
| --- | --- | --- |
| SIH hook | `PoolConfigured(id, cfg)` | 更新 `enabled` / `liquidity`；`enabled == false` 停用 |
| SIH hook | `JitPausedSet(true)` | 所有 SIH 池不注入 JIT，暫停路由 |
| SIH hook | `SwapPausedUntilSet(until)` | `block.timestamp < until` 期間 swap revert |
| CLPoolManager | `Swap(...)` | 成交後價格；`fee` 為總費率 |
| SIH hook | `SwapTaxed` / `FeesEarned` | 稅額 / LP fee（參考） |

## 5. 參考：報價與執行

### 5.1 JIT 與鏈上報價（推薦）

SIH 是 **JIT 流動性**：兩次 swap 之間 CLPoolManager 中池子的 L 多為 0（或僅剩待撤倉位），swap 開始時 hook 才注入。不要按池子當前殘餘 L 做常規 CL 計算。

- PCS CL Quoter：`quoteExactInputSingle` / `quoteExactOutputSingle`（PoolKey 取自 `Initialize`，`hookData` 為空），或對真實路徑 `eth_call`。
- 報價已包含稅、LP fee 與 PCS 協議費。
- 收到 cutover 的新 `MemePoolCreated` 後，在接受新路由前**原子**切換 `activePool`。

### 5.2 可選：鏈下復刻

| 項 | 規則 |
| --- | --- |
| 價格 | 最近 `Swap` / `Initialize` 的 `sqrtPriceX96`（或 `getSlot0`） |
| 流動性 | 全區間 CL，`L` 取最近 `PoolConfigured(id).cfg.liquidity` |
| 手續費 | 總費率 `protocolFee + lpFee − protocolFee × lpFee / 1e6`（`Swap.fee` 即總費率） |
| 稅率 | 帶稅池讀 `meme.sihTaxRates(PoolKey 中 meme 的對側幣)` → `(buyBps, sellBps)`，上限 1000。**不要**用 `meme.quote()` 作參數（cutover 前可能仍是 4Stock，會得到 0） |
| 買入 exact-in | 稅 = `amountIn × buyBps / 1e4`，先扣，餘額進曲線 |
| 買入 exact-out | 稅 = 實際付出 quote × `buyBps / 1e4` |
| 賣出 exact-in | 稅 = 曲線付出的 quote × `sellBps / 1e4`，從到手 quote 扣 |
| 賣出 exact-out | 稅 = `amountOut × sellBps / (1e4 − sellBps)` |

會 revert / 不應路由：`JitPausedSet(true)`、`SwapPausedUntilSet` 未到期、池 `enabled == false` 或 `liquidity == 0`、指定 quote 數量且曲線未全部成交（`TaxedPartialFill`）、hook 庫存不足（極端）。**下單前須鏈上模擬一次。**

### 5.3 執行

- 標準 PCS Infinity：Universal Router `INFI_SWAP`（如 `CL_SWAP_EXACT_IN_SINGLE` / `CL_SWAP_EXACT_OUT_SINGLE` + settle/take），或自有合約 `vault.lock` → `CLPoolManager.swap` → settle / take。
- `hookData` 傳空。
- 多跳：例如 `USDT → 4Stock（PCS V3）→ meme（SIH）`；cutover 後改為 `USDT → bStock（PCS V3）→ meme（SIH）`。一筆交易可依次經過多個 SIH 池（不能在一個 SIH swap 內嵌套另一個）。
- Gas：每次 swap 注入並撤出 JIT 倉位，單跳約 50–80 萬；請用模擬估算。

### 5.4 meme 代幣轉帳行為

| 類型 | 說明 |
| --- | --- |
| 畢業後轉帳稅 | **無**。稅由 hook 在 swap 中按 quote 扣；meme 不是 fee-on-transfer |
| 帶稅 meme 的其他池 | 畢業後經該 meme 在其他 DEX（V2 / V3 等）註冊的池轉帳會 revert，只能走 SIH 池 |
| 執行合約持倉 | 帶稅 meme 僅把 PCS Vault、SIH hook 等視作路由白名單；聚合器執行合約臨時持有時可能被計為持幣人，轉帳觸發分紅結算，gas 更高，可能殘留少量分紅 |

## 6. 參考：合約讀方法

事件之外，可用以下方法做冷啟動全量同步或校驗：

| 合約 | 方法 | 返回 / 用途 |
| --- | --- | --- |
| Monitor | `getPools()` / `poolsOfToken(token)` / `poolCount()` | 全部 / 按代幣的 SIH 池 PoolId |
| manager | `quoteOf(meme)` | `(quote, PoolKey)`：當前計價幣與池 |
| manager | `poolKeyOf(meme, quote)` | 指定 quote 的 PoolKey（`hooks == 0` 表示不存在） |
| manager | `stockOfToken(meme)` | 非 0 = 已經本 manager 畢業 |
| manager | `untaxed(meme)` | `true` = 0 稅 meme |
| manager | `hookOf(quote)` | 該 quote 綁定的 SIH hook |
| hook | `getPoolConfig(poolId)` | `(enabled, tickLower, tickUpper, liquidity)` |
| hook | `poolTaxToken(poolId)` | 收稅 token；0 = 不收稅 |
| hook | `jitPaused()` / `swapPausedUntil()` | 暫停狀態 |
| CLPoolManager | `getSlot0(poolId)` | `(sqrtPriceX96, tick, protocolFee, lpFee)` |
| CLPoolManager | `poolIdToPoolKey(poolId)` | PoolKey |
| meme（帶稅） | `sihTaxRates(counterAsset)` | `(buyBps, sellBps)`；`counterAsset` = PoolKey 中 meme 對側幣 |
| meme（帶稅） | `quote()` | 內部計稅 / 分紅 quote；**路由不需要** |

## 7. BSC 合約錨點

| 合約 | 地址 |
| --- | --- |
| SIH hook | `0x7eFDd5Aed2fE1f9193A72DB0e1928dc1D91Cc9DA` |
| Stock4SihManager | `0xE1cE0c4f28B2793940200D57e6C488735F47ADaF` |
| SIH Monitor | `0xB10715a584F2AEcF7A6222e41200c1f34401614c` |
| OpenFourCore | `0xebe7b6C1089D9F72aD07f34E36d898e44E5e27f3` |
| PCS Infinity CLPoolManager | `0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b` |
| PCS Infinity Vault | `0x238a358808379702088667322f80aC48bAd5e6c4` |
| PCS CL Quoter | `0xd0737C9762912dD34c3271197E362Aa736Df0926` |
| PCS Universal Router | `0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB` |

池參數參考：`fee` 2500（另加 PCS 協議費），tickSpacing 50，hook bitmap `0x0cfd`。  
示例 quote（非完整列表）：4Stock/BNC4、bStock/BNCB。實際以 `MemePoolCreated.quote` 或 `quoteOf` 為準。

## 8. 檢查清單

- **主監聽** `MemePoolCreated` → 寫 quote + `activePool`。
- 無 `activePool`（畢業）時，同筆對齊 `MigrateExecuted`（SIH tag / `poolId`；**不讀 quote**）。
- Cutover 不要等第二次 `MigrateExecuted`。
- 每個 meme 只保留一個 `activePool`。
- 報價優先鏈上 Infinity quoter 或模擬（JIT）；下單前模擬。
- PoolKey / 暫停 / 冷啟動讀方法見第 4–6 節參考。
