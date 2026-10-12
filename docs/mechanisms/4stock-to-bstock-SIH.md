# 4Stock SIH Quote Cutover (4Stock → bStock)

[English](./4stock-to-bstock-SIH.md) | [繁體中文](../zh-Hant/mechanisms/4stock-to-bstock-SIH.md)

This document explains how OpenFour 4Stock SIH tokens graduate into PancakeSwap Infinity Shared Inventory Hook (SIH) pools, and how third parties should listen so liquidity queries and routes always target the single active pool.

On top of PancakeSwap Infinity Shared Inventory Hook (SIH), we built a shared-pool manager for the 4Stock stack so the same meme inventory can pair against either 4Stock or bStock.

With this path enabled, a graduating meme’s primary market is first meme / 4Stock. After bStock is live, already-graduated memes can migrate primary liquidity smoothly to meme / bStock. Memes that have not yet graduated usually open meme / bStock directly at graduation. Treat the event data below as the source of truth.

## 1. Rules

1. Each meme has **one** routable SIH pool at a time: `activePool[meme]`.
2. Only tokens whose `MigrateExecuted.migrateTagId` matches `module.migrate.pcs_v4_sih` (`0x4d9a569156253e90`) graduated into SIH; other migrate tags are out of scope for this document.
3. **Listen primarily to** `Stock4SihManager.MemePoolCreated`: it gives meme, **quote**, and `poolId` to set / flip `activePool`.
4. A 4Stock → bStock cutover does **not** emit another OpenFour `MigrateExecuted`; keep listening to `MemePoolCreated`.
5. If you integrate the **PancakeSwap Aggregator**, it can discover and aggregate V4 SIH hook liquidity for you. When the trade is not against the meme’s quote (e.g. buy with BNB / sell to BNB), you can hand the path off to the Aggregator for automatic routing instead of building multi-hops yourself.

Indexer state example:

```text
pools[poolId]    = { meme, quote, poolKey }
activePool[meme] = poolId   // route / quote only this
```

## 2. Event listening flow

**Primary: `MemePoolCreated(meme, quote, poolId)`**

```text
          On MemePoolCreated(meme, quote, poolId)
                             │
                             ▼
          Does this meme already have activePool?
                             │
             ┌───────────────┴───────────────┐
             ▼                               ▼
             no                    yes, and ≠ new poolId
             │                               │
             ▼                               ▼
┌──────────────────────────┐   ┌──────────────────────────┐
│ [Graduation]             │   │ [Cutover]                │
│ same-tx MigrateExecuted  │   │ no MigrateExecuted       │
│ activePool = poolId      │   │ activePool = new poolId  │
│ store quote              │   │ quote = event quote      │
│                          │   │ disable old pool         │
└──────────────────────────┘   └──────────────────────────┘
```

`MigrateExecuted` checks (graduation, same tx):

- `migrateTagId == 0x4d9a569156253e90`
- `decode(encodedMigratedData) == poolId` (**poolId only — no quote**)

Same state update in both cases:

```text
pools[poolId] = { meme, quote, … }
activePool[meme] = poolId
external quote = event quote   // no hardcoded bStock list needed
```

Cutover has **no** second `MigrateExecuted` — do not wait for one.

## 3. Identity constants

| Signal | Value |
| --- | --- |
| Migrate tag | `module.migrate.pcs_v4_sih` |
| `migrateTagId` | `0x4d9a569156253e90` |
| Graduation payload | `abi.encode(bytes32 poolId)` (**poolId only**) |

Do **not** use `vault.quoteAsset()` / a transitional `meme.quote()` as the external quote: bonding still raises 4Stock, but graduation may open meme/bStock directly.

Related Solidity interfaces: [`contracts/interfaces/`](../../contracts/interfaces/) — `IStock4Sih.sol`, `ICLSharedInventoryHook.sol`, `ICLSharedInventoryHookMonitor.sol`.

---

Sections below are **not** the cutover main flow — reference guidance for quoting, execution, and cold start.

## 4. Reference: event details

### 4.1 Graduation (typical same-tx logs)

After bonding sells out, the OpenFour migrate tx usually also emits (besides `MemePoolCreated` / `MigrateExecuted`):

| Contract | Event | Purpose |
| --- | --- | --- |
| SIH hook | `PoolTaxTokenSet(id, taxToken)` | Taxed memes only: pool taxed by `taxToken` (= meme) |
| SIH hook | `PoolConfigured(id, cfg)` | `cfg = (enabled, tickLower, tickUpper, liquidity)` |
| CLPoolManager | `Initialize(id, currency0, currency1, hooks, fee, parameters, sqrtPriceX96, tick)` | **Full PoolKey** |
| SIH Monitor | `PoolRegistered(id, currency0, currency1)` | Pool registry |

Filter: `Initialize.hooks == SIH hook`, and confirm with `MemePoolCreated`.  
`encodedMigratedData = abi.encode(bytes32 poolId)` — join with `MemePoolCreated.poolId` / `Initialize.id`.

### 4.2 Runtime (optional)

| Contract | Event | Action |
| --- | --- | --- |
| SIH hook | `PoolConfigured(id, cfg)` | Update `enabled` / `liquidity`; disable when `enabled == false` |
| SIH hook | `JitPausedSet(true)` | No JIT injection — stop routing |
| SIH hook | `SwapPausedUntilSet(until)` | Swaps revert while `block.timestamp < until` |
| CLPoolManager | `Swap(...)` | Post-trade price; `fee` is total fee |
| SIH hook | `SwapTaxed` / `FeesEarned` | Tax / LP fee (informational) |

## 5. Reference: quoting and execution

### 5.1 JIT and on-chain quoting (recommended)

SIH uses **JIT liquidity**: between swaps, CLPoolManager L is usually 0 (or a pending removal). The hook injects at swap start — do not price from residual CL L.

- PCS CL Quoter: `quoteExactInputSingle` / `quoteExactOutputSingle` (PoolKey from `Initialize`, empty `hookData`), or `eth_call` the real path.
- Quotes already include tax, LP fee, and PCS protocol fee.
- On cutover `MemePoolCreated`, atomically flip `activePool` before accepting new routes.

### 5.2 Optional: offline reconstruction

| Item | Rule |
| --- | --- |
| Price | Latest `Swap` / `Initialize` `sqrtPriceX96` (or `getSlot0`) |
| Liquidity | Full-range CL; `L` from latest `PoolConfigured(id).cfg.liquidity` |
| Fees | Total fee `protocolFee + lpFee − protocolFee × lpFee / 1e6` (`Swap.fee`) |
| Tax | Taxed pools: `meme.sihTaxRates(counterAsset)` → `(buyBps, sellBps)`, cap 1000. **Do not** pass `meme.quote()` (may still be 4Stock pre-cutover → 0) |
| Buy exact-in | tax = `amountIn × buyBps / 1e4`, then curve |
| Buy exact-out | tax = quote paid × `buyBps / 1e4` |
| Sell exact-in | tax = quote from curve × `sellBps / 1e4`, deducted from quote out |
| Sell exact-out | tax = `amountOut × sellBps / (1e4 − sellBps)` |

Do not route when: `JitPausedSet(true)`, `SwapPausedUntilSet` active, `enabled == false` / `liquidity == 0`, `TaxedPartialFill`, or hook inventory shortfall. **Simulate on-chain before sending.**

### 5.3 Execution

- Standard PCS Infinity: Universal Router `INFI_SWAP` (e.g. `CL_SWAP_EXACT_IN_SINGLE` / `CL_SWAP_EXACT_OUT_SINGLE` + settle/take), or your own `vault.lock` → `CLPoolManager.swap` → settle / take.
- Empty `hookData`.
- Multi-hop: e.g. `USDT → 4Stock (PCS V3) → meme (SIH)`; after cutover `USDT → bStock (PCS V3) → meme (SIH)`. Multiple SIH pools may appear in one tx (do not nest one SIH swap inside another).
- Gas: each swap injects and removes JIT liquidity; ~500–800k per hop — estimate via simulation.

### 5.4 Meme transfer behavior

| Case | Note |
| --- | --- |
| Post-graduation transfer tax | **None**. Tax is withheld in quote by the hook on swap; meme is not fee-on-transfer |
| Other DEX pools for taxed memes | Transfers via other registered V2/V3 pools revert after graduation — SIH only |
| Executor holdings | Taxed memes treat PCS Vault and SIH hook as route allowlist; temporary holdings on an aggregator executor may count as a holder (dividend settlement, higher gas, dust) |

## 6. Reference: contract read methods

For cold-start sync or verification beyond events:

| Contract | Method | Return / use |
| --- | --- | --- |
| Monitor | `getPools()` / `poolsOfToken(token)` / `poolCount()` | All / per-token SIH pool ids |
| manager | `quoteOf(meme)` | `(quote, PoolKey)` live quote and pool |
| manager | `poolKeyOf(meme, quote)` | PoolKey for quote (`hooks == 0` = none) |
| manager | `stockOfToken(meme)` | non-zero = graduated via this manager |
| manager | `untaxed(meme)` | `true` = zero-tax meme |
| manager | `hookOf(quote)` | SIH hook for that quote |
| hook | `getPoolConfig(poolId)` | `(enabled, tickLower, tickUpper, liquidity)` |
| hook | `poolTaxToken(poolId)` | tax token; 0 = untaxed |
| hook | `jitPaused()` / `swapPausedUntil()` | pause state |
| CLPoolManager | `getSlot0(poolId)` | `(sqrtPriceX96, tick, protocolFee, lpFee)` |
| CLPoolManager | `poolIdToPoolKey(poolId)` | PoolKey |
| meme (taxed) | `sihTaxRates(counterAsset)` | `(buyBps, sellBps)`; counter = other side in PoolKey |
| meme (taxed) | `quote()` | internal tax/dividend quote; **not for routing** |

## 7. BSC contract anchors

| Contract | Address |
| --- | --- |
| SIH hook | `0x7eFDd5Aed2fE1f9193A72DB0e1928dc1D91Cc9DA` |
| Stock4SihManager | `0xE1cE0c4f28B2793940200D57e6C488735F47ADaF` |
| SIH Monitor | `0xB10715a584F2AEcF7A6222e41200c1f34401614c` |
| OpenFourCore | `0xebe7b6C1089D9F72aD07f34E36d898e44E5e27f3` |
| PCS Infinity CLPoolManager | `0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b` |
| PCS Infinity Vault | `0x238a358808379702088667322f80aC48bAd5e6c4` |
| PCS CL Quoter | `0xd0737C9762912dD34c3271197E362Aa736Df0926` |
| PCS Universal Router | `0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB` |

Pool params (reference): `fee` 2500 (+ PCS protocol fee), tickSpacing 50, hook bitmap `0x0cfd`.  
Example quotes (not exhaustive): 4Stock/BNC4, bStock/BNCB. Live quote from `MemePoolCreated.quote` or `quoteOf`.

## 8. Checklist

- **Primary**: `MemePoolCreated` → write quote + `activePool`.
- Graduation (no prior `activePool`): join same-tx `MigrateExecuted` (SIH tag / `poolId`; **no quote**).
- Cutover: do not wait for a second `MigrateExecuted`.
- One `activePool` per meme.
- Prefer on-chain Infinity quoter / simulation (JIT); simulate before send.
- PoolKey / pause / cold-start reads: see §§4–6.
