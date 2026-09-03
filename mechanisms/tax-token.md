# TaxToken Tax and Distribution Mechanism

[English](./tax-token.md) | [繁體中文](../docs/zh-Hant/mechanisms/tax-token.md)

This document explains how OpenFour `TaxToken` collects, converts, distributes, and exposes tax revenue. It also describes manual holder-reward funding, keeper entry points, and gas behavior.

## 1. Identity and Configuration

`TaxToken` is identified by the `token.tax` descriptor. Its user parameters include:

- `founder`: founder-tax recipient; zero defaults to the token creator.
- `buyFeeRate`: post-migration buy tax in bps, from `0` to `1000`.
- `sellFeeRate`: post-migration sell tax in bps, from `100` to `1000`.
- `rateFounder`, `rateHolder`, `rateBurn`, `rateLiquidity`: distribution weights that must sum to `100`.
- `minDispatch`: token-tax threshold used after migration.
- `minDispatchQuote`: quote-tax distribution threshold; must be nonzero.
- `minShare`: minimum eligible holder balance.
- `taxVaultTypeId` and `taxVaultInitParams`: optional founder TaxVault configuration.

The four distribution values are weights, not bps. Active destinations are normalized against the sum of currently active weights during each dispatch.

## 2. Tax Collection

### 2.1 Bonding Phase

During `Trading`, TradeModule returns the tax fee and FeeRouter transfers the quote-denominated tax directly to `TaxToken`. The bonding vault then calls:

```solidity
onBondingTrade(uint256 taxQuote, bool isBuy)
```

The hook does not transfer funds. It credits `feeAccumulated` and `totalTaxCollected`. When quote tax reaches `minDispatchQuote`, the token emits:

```solidity
DispatchReady(1, pendingQuoteAmount);
```

### 2.2 Post-Migration Transfers

Transfer tax is active only in the `Migrated` phase:

```text
buy  = migratedPools[from] && to != vault
sell = migratedPools[to]   && from != vault
```

The selected buy or sell rate is deducted in token units and held by `TaxToken` as `tokenAccumulated`. When the balance becomes greater than `minDispatch`, the token emits:

```solidity
DispatchReady(0, pendingTokenAmount);
```

Pool registration may happen before migration, but no pool transfer tax is charged before the phase is `Migrated`. Ordinary wallet-to-wallet transfers are not classified as buys or sells.

## 3. Dispatch Order

Anyone may call:

```solidity
function canDispatchTax() external view returns (bool);
function dispatchTax() external;
```

`canDispatchTax()` is a keeper pre-check. A `true` result means there is eligible work, not that every downstream swap, payout, or liquidity operation is guaranteed to succeed.

Dispatch processes work in this order:

1. Retry deferred burn/liquidity work after migration.
2. Retry a deferred native founder payout.
3. If migrated and `tokenAccumulated > minDispatch`, swap accumulated tax tokens into quote.
4. If `feeAccumulated >= minDispatchQuote`, split quote among active destinations.
5. Retry newly deferred burn/liquidity work.

Transfers also trigger dispatch automatically:

- During `Trading`, every token transfer attempts quote-tax dispatch before the balance transfer.
- During `Migrated`, a sell attempts dispatch before collecting the current transfer tax.
- A migrated wallet-to-wallet transfer attempts dispatch and then claims the sender's holder reward.

Calling `dispatchTax()` proactively lets a keeper move expensive swap/liquidity work out of the next user's transfer.

## 4. Distribution Destinations

### 4.1 Founder

For an ERC20 quote, the token transfers quote to `founder`. If the founder is a configured TaxVault contract, `onERC20TaxReceived()` is called on a best-effort basis.

For a wrapped-native quote, the token unwraps it and sends native currency with the per-token gas limit returned by `TokenHelper.getGasLimit()`. A failed native send is stored in `feeToFounder` and retried later.

### 4.2 Holders

Holder rewards remain in quote units. Distribution updates `feePerShare`; it does not loop over every holder. Each holder accrues lazily according to their recorded share.

The following addresses are excluded from holder shares:

- registered migrated pools;
- the bonding vault;
- the TaxToken contract;
- zero address and the dead address;
- balances below `minShare`.

A blacklisted sender cannot transfer. A blacklisted account is also skipped when claiming.

### 4.3 Burn

Before migration, the burn allocation is stored in `feeToBurn`. After migration, TokenHelper swaps quote into the project token and sends the output to the dead address. Failed work remains deferred.

### 4.4 Liquidity

Before migration, the liquidity allocation is stored in `feeToLiquidity`. After migration, TokenHelper adds quote-funded liquidity. Failed work remains deferred for a later dispatch.

## 5. Manual Holder-Reward Funding

`TaxToken` exposes:

```solidity
function manualFundHolderRewards(uint256 amountQuote) external payable;
```

Anyone may fund holder rewards. The full amount goes to the holder bucket; it is not split among founder, burn, or liquidity and does not enter `feeAccumulated`.

Native funding:

```solidity
taxToken.manualFundHolderRewards{value: amountNative}(0);
```

This path is available only when `quote == wrappedNative`. The token wraps `msg.value` and credits that exact amount.

ERC20 funding:

```solidity
quote.approve(address(taxToken), amountQuote);
taxToken.manualFundHolderRewards(amountQuote);
```

Use `msg.value == 0`. The token measures its actual balance increase, so fee-on-transfer quote assets credit the amount actually received.

Funding requires:

- no swap or dispatch currently in progress;
- `rateHolder > 0`;
- `totalShares > 0`;
- a nonzero amount actually received.

Successful funding updates `feeHolder`, `feePerShare`, and `totalManualRewards`, then emits:

```solidity
ManualHolderRewardsFunded(sender, receivedAmount);
```

`supportsManualRewards()` returns `true`. `totalManualRewards()` reports cumulative manual funding only; it is separate from automatically collected tax.

## 6. Holder Claims and Keeper Batching

Users may query and claim:

```solidity
taxToken.claimableFee(account);
taxToken.claimedFee(account);
taxToken.claimFee();
```

A keeper may claim on behalf of multiple accounts:

```solidity
taxToken.claimFee(accounts);
```

Rewards are always transferred to each account, not to the keeper. Batching amortizes transaction base cost and reduces the cost compared with sending one transaction per account, but execution gas still grows approximately linearly with the array length.

Use holder pagination to build batches:

```solidity
taxToken.userCount();
taxToken.users(index, count, minClaimable);
```

`users()` returns the dead address for tracked entries below `minClaimable`. Remove those placeholders, duplicate addresses, zero-claim accounts, and blacklisted accounts before submitting a batch.

If the token's available quote balance is below an account's calculated reward, the claim is capped to the available balance and emits `FeeInsufficient`. The unpaid remainder is not re-credited to that account, so keepers should treat this as an exceptional accounting condition and avoid submitting claims until the reward balance is sufficiently backed.

## 7. Keeper Workflow

Recommended dispatch workflow:

1. Listen for `DispatchReady`.
2. Read `canDispatchTax()` immediately before submission.
3. Estimate gas for `dispatchTax()`.
4. Submit only when the expected value or user-gas reduction justifies execution.
5. Monitor `FeeDispatchDeferred` and retry after the downstream condition is corrected.

Recommended claim workflow:

1. Page through `users(index, count, minClaimable)` using a nonzero economic threshold.
2. Confirm `claimableFee(account)` for candidates.
3. Build a bounded account batch.
4. Estimate gas and reduce batch size until it has safe block-gas headroom.
5. Submit `claimFee(accounts)` and index `FeeClaimed` / `FeeInsufficient`.

`DispatchReady` is a hint and may become stale before inclusion. Keepers should never submit solely because an event was observed.

## 8. Gas Behavior and Failure Cases

Cheap paths:

- Share accounting is constant-time per affected account and never loops over all holders.
- `dispatchTax()` returns early when thresholds are not met.
- Claims with zero entitlement or blacklisted accounts return without transfer.

Potentially expensive paths:

- token-to-quote tax merging after migration;
- quote-to-token buyback and burn;
- adding liquidity;
- retrying several deferred buckets in one dispatch;
- batch claims with many successful ERC20 transfers;
- a transfer that automatically triggers pending dispatch work.

Native founder payout forwards the TokenHelper-configured gas amount. The default is `2,000,000` gas and governance may configure up to `5,000,000` per token. This is a callee gas allowance, not the total transaction gas limit. If the founder fallback requires more gas or reverts, the amount remains in `feeToFounder` and `FeeDispatchDeferred(5, ...)` is emitted.

Used deferred kinds are:

- `0`: token-tax merge into quote failed;
- `3`: liquidity operation failed;
- `4`: buyback-and-burn failed;
- `5`: native founder payout failed.

Swap or liquidity failures can result from missing liquidity, TWAP/slippage constraints, router failure, or token behavior. When an external operation returns a caught failure, the corresponding balance is retained and `FeeDispatchDeferred` is emitted. If the whole transaction runs out of gas, all state and events revert; the original pending balances remain for a later transaction.

A claim batch has no protocol-defined maximum length. An oversized batch can exceed the block gas limit and revert the entire transaction; one reverting ERC20 transfer can also revert the whole batch. Keepers must choose batch size from live gas estimation rather than a fixed universal number.

## 9. Monitoring Checklist

- Identify the token with `token.tax`.
- Distinguish bonding quote tax from migrated token transfer tax.
- Treat `DispatchReady` as a hint and verify `canDispatchTax()`.
- Track `feeAccumulated`, `tokenAccumulated`, `feeToFounder`, `feeToBurn`, and `feeToLiquidity`.
- Track `FeeDispatched`, `FeeDispatchDeferred`, `FeeClaimed`, and `FeeInsufficient`.
- Expose `manualFundHolderRewards()`, `supportsManualRewards()`, and `totalManualRewards()` where manual community rewards are supported.
- Use keeper dispatch to move heavy work away from user transfers.
- Bound claim batches using gas estimation and block-gas headroom.
