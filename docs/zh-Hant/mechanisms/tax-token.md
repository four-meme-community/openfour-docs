# TaxToken 稅費與分配機制

[English](../../mechanisms/tax-token.md) | [繁體中文](./tax-token.md)

本文說明 OpenFour `TaxToken` 如何收取、轉換及分配稅費，並介紹 holder reward 手動注資、keeper 入口和 gas 行為。

## 1. 身份與配置

`TaxToken` 使用 `token.tax` descriptor 識別。使用者參數包括：

- `founder`：founder tax 收款人；零地址時預設為 token 建立者。
- `buyFeeRate`：遷移後買入稅，單位 bps，範圍為 `0` 至 `1000`。
- `sellFeeRate`：遷移後賣出稅，單位 bps，範圍為 `100` 至 `1000`。
- `rateFounder`、`rateHolder`、`rateBurn`、`rateLiquidity`：分配權重，總和必須為 `100`。
- `minDispatch`：遷移後 token tax threshold。
- `minDispatchQuote`：quote tax 分配 threshold，必須非零。
- `minShare`：納入 holder 分配的最低餘額。
- `taxVaultTypeId` 和 `taxVaultInitParams`：可選 founder TaxVault 配置。

四個分配值是權重而不是 bps。每次 dispatch 會使用當前有效目的地的權重總和重新正規化。

## 2. 稅費收取

### 2.1 Bonding 階段

在 `Trading` 階段，TradeModule 返回 tax fee，FeeRouter 把 quote 計價稅費直接轉給 `TaxToken`，bonding vault 隨後呼叫：

```solidity
onBondingTrade(uint256 taxQuote, bool isBuy)
```

此 hook 不負責轉帳，只把金額記入 `feeAccumulated` 和 `totalTaxCollected`。Quote tax 達到 `minDispatchQuote` 時，token 發出：

```solidity
DispatchReady(1, pendingQuoteAmount);
```

### 2.2 遷移後轉帳

Transfer tax 只在 `Migrated` phase 啟用：

```text
buy  = migratedPools[from] && to != vault
sell = migratedPools[to]   && from != vault
```

Token 會按買入或賣出稅率扣除 token，並以 `tokenAccumulated` 保留在 `TaxToken`。餘額變為大於 `minDispatch` 時，token 發出：

```solidity
DispatchReady(0, pendingTokenAmount);
```

Pool 可以在遷移前預先註冊，但 phase 進入 `Migrated` 前不會收取 pool transfer tax。普通 wallet-to-wallet 轉帳不會被判定為買入或賣出。

## 3. Dispatch 順序

任何人都可以呼叫：

```solidity
function canDispatchTax() external view returns (bool);
function dispatchTax() external;
```

`canDispatchTax()` 是 keeper 的執行前檢查。返回 `true` 只表示存在可處理工作，不保證所有下游 swap、支付或流動性操作都會成功。

Dispatch 按以下順序處理：

1. 遷移後重試 deferred burn/liquidity 工作。
2. 重試 deferred native founder 支付。
3. 已遷移且 `tokenAccumulated > minDispatch` 時，把累計 tax token swap 為 quote。
4. `feeAccumulated >= minDispatchQuote` 時，按有效目的地分配 quote。
5. 再次嘗試本次新產生的 deferred burn/liquidity 工作。

Token 轉帳也會自動觸發 dispatch：

- `Trading` 階段每次 token 轉帳都會在餘額轉移前嘗試 quote tax dispatch。
- `Migrated` 階段賣出會在收取本次 transfer tax 前先嘗試 dispatch。
- 遷移後的 wallet-to-wallet 轉帳會嘗試 dispatch，然後代 sender 領取 holder reward。

Keeper 主動呼叫 `dispatchTax()`，可以把高 gas 的 swap/liquidity 工作從下一筆使用者轉帳中移走。

## 4. 分配目的地

### 4.1 Founder

Quote 為 ERC20 時，token 把 quote 轉給 `founder`。若 founder 是已配置的 TaxVault 合約，會以 best-effort 方式呼叫 `onERC20TaxReceived()`。

Quote 為 wrapped native 時，token 先解包，再使用 `TokenHelper.getGasLimit()` 返回的 per-token gas limit 發送 native。發送失敗的金額會記入 `feeToFounder`，等待後續重試。

### 4.2 Holders

Holder reward 保持為 quote 單位。分配只更新 `feePerShare`，不會遍歷全部 holder；每個 holder 根據已記錄 share 延遲累計。

以下地址不會納入 holder share：

- 已註冊 migrated pool；
- bonding vault；
- TaxToken 合約；
- 零地址和 dead address；
- 餘額低於 `minShare` 的地址。

黑名單 sender 無法轉帳；黑名單帳戶在 claim 時也會被跳過。

### 4.3 Burn

遷移前，burn allocation 記入 `feeToBurn`。遷移後，TokenHelper 把 quote swap 為專案 token 並發送至 dead address；失敗工作會保持 deferred。

### 4.4 Liquidity

遷移前，liquidity allocation 記入 `feeToLiquidity`。遷移後，TokenHelper 使用 quote 增加流動性；失敗工作會保留至後續 dispatch。

## 5. 手動注入 Holder Reward

`TaxToken` 公開：

```solidity
function manualFundHolderRewards(uint256 amountQuote) external payable;
```

任何人都可以注入 holder reward。全部金額只進入 holder bucket，不會在 founder、burn 或 liquidity 之間分配，也不會進入 `feeAccumulated`。

Native 注資：

```solidity
taxToken.manualFundHolderRewards{value: amountNative}(0);
```

此路徑只在 `quote == wrappedNative` 時可用。Token 會包裝 `msg.value` 並按相同金額記帳。

ERC20 注資：

```solidity
quote.approve(address(taxToken), amountQuote);
taxToken.manualFundHolderRewards(amountQuote);
```

此時使用 `msg.value == 0`。Token 會計算實際餘額增量，因此 fee-on-transfer quote 資產按實際收到的金額記帳。

注資要求：

- 當前沒有 swap 或 dispatch 正在執行；
- `rateHolder > 0`；
- `totalShares > 0`；
- 實際收到金額非零。

成功後會更新 `feeHolder`、`feePerShare` 和 `totalManualRewards`，並發出：

```solidity
ManualHolderRewardsFunded(sender, receivedAmount);
```

`supportsManualRewards()` 返回 `true`。`totalManualRewards()` 只統計累計手動注資，與自動收取稅費分開。

## 6. Holder Claim 與 Keeper 批處理

使用者可以查詢和領取：

```solidity
taxToken.claimableFee(account);
taxToken.claimedFee(account);
taxToken.claimFee();
```

Keeper 可以代多個帳戶領取：

```solidity
taxToken.claimFee(accounts);
```

Reward 始終發送給各 account，不會發送給 keeper。批處理可攤薄 transaction base cost，相比每個 account 單獨發送交易更省 gas，但執行 gas 仍會隨陣列長度近似線性增加。

使用 holder 分頁建立 batch：

```solidity
taxToken.userCount();
taxToken.users(index, count, minClaimable);
```

`users()` 對低於 `minClaimable` 的 tracked entry 返回 dead address。提交 batch 前應移除這些 placeholder、重複地址、零 claim 帳戶及黑名單帳戶。

若 token 可用 quote 餘額小於帳戶計算 reward，claim 會以可用餘額為上限，並發出 `FeeInsufficient`。未支付差額不會重新記回該帳戶，因此 keeper 應把這視為例外 accounting 狀態，在 reward balance 足額前不要提交 claim。

## 7. Keeper 工作流程

建議 dispatch 流程：

1. 監聽 `DispatchReady`。
2. 送出交易前立即讀取 `canDispatchTax()`。
3. 為 `dispatchTax()` 估算 gas。
4. 只有在預期價值或降低使用者 gas 的收益足以覆蓋成本時才執行。
5. 監聽 `FeeDispatchDeferred`，待下游條件修復後重試。

建議 claim 流程：

1. 使用非零經濟 threshold 分頁呼叫 `users(index, count, minClaimable)`。
2. 對候選帳戶確認 `claimableFee(account)`。
3. 建立有界 account batch。
4. 估算 gas，縮小 batch 直到相對 block gas limit 有安全餘量。
5. 提交 `claimFee(accounts)`，並索引 `FeeClaimed` / `FeeInsufficient`。

`DispatchReady` 只是 hint，交易上鏈前狀態可能已變化。Keeper 不應只因觀察到事件就直接提交。

## 8. Gas 行為與失敗情況

低成本路徑：

- Share accounting 對每個受影響 account 都是常數時間，不會遍歷全部 holder。
- Threshold 未滿足時，`dispatchTax()` 會提前返回。
- Claim entitlement 為零或 account 被列入黑名單時，不執行轉帳。

可能的高成本路徑：

- 遷移後把 token tax 合併為 quote；
- quote-to-token 回購銷毀；
- 增加流動性；
- 一次 dispatch 重試多個 deferred bucket；
- 含多筆成功 ERC20 轉帳的 batch claim；
- 自動觸發待處理 dispatch 工作的普通 token 轉帳。

Native founder 支付會轉發 TokenHelper 配置的 gas。預設為 `2,000,000` gas，治理方可按 token 配置至最高 `5,000,000`。這是 callee gas allowance，不是整筆交易的 gas limit。若 founder fallback 需要更多 gas 或主動 revert，金額會留在 `feeToFounder`，並發出 `FeeDispatchDeferred(5, ...)`。

目前使用的 deferred kind：

- `0`：token tax 合併為 quote 失敗；
- `3`：liquidity 操作失敗；
- `4`：回購銷毀失敗；
- `5`：native founder 支付失敗。

Swap 或 liquidity 可能因流動性不足、TWAP/slippage 約束、router 失敗或 token 行為而失敗。外部操作返回並被捕獲時，對應 balance 會保留並發出 `FeeDispatchDeferred`。若整筆交易耗盡 gas，全部狀態和事件都會 revert；原有 pending balance 仍留待下一筆交易處理。

Claim batch 沒有協議固定的最大長度。過大的 batch 可能超過 block gas limit，導致整筆交易 revert；其中一次 ERC20 transfer revert 也會使整個 batch revert。Keeper 必須根據即時 gas estimation 選擇 batch size，而不是使用固定的通用數量。

## 9. 監控檢查清單

- 使用 `token.tax` 識別 token。
- 區分 bonding quote tax 與遷移後 token transfer tax。
- 把 `DispatchReady` 視為 hint，並檢查 `canDispatchTax()`。
- 追蹤 `feeAccumulated`、`tokenAccumulated`、`feeToFounder`、`feeToBurn` 和 `feeToLiquidity`。
- 追蹤 `FeeDispatched`、`FeeDispatchDeferred`、`FeeClaimed` 和 `FeeInsufficient`。
- 支援社群手動獎勵時，公開 `manualFundHolderRewards()`、`supportsManualRewards()` 和 `totalManualRewards()`。
- 使用 keeper dispatch，把高成本工作移出使用者轉帳。
- 根據 gas estimation 和 block gas headroom 限制 claim batch。
