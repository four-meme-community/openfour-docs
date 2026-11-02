# Lifecycle and verification

The wallet / script signer must be `Core.signer()`. After a fork that is the deployer by default. Keep the list in `tokens.json` only. Do not use `getLogs` as a data source.

The example loop is `developer/startup/scripts/create-and-trade.js` after `register.js`, both keyed by `PRESET` / `presets/<id>.json`. Params are encoded from the on-chain schema.

## createToken

1. Read `OpenFourTools.getTokenBaseSchema()` and `getPresetEncodeSchemas(presetId)`.
2. Encode each module tuple in schema `params` order. `saleAmount < maxSupply`.
3. Encode the outer `createArgs` (field order must match Core; see `developer/workbench/src/pages/CreateTokenPage.jsx`):

```
tuple(
  uint256 requestId,
  uint256 presetId,
  uint256 validTimestamp,
  uint256 createFee,
  uint256 presaleQuote,
  bool antiSniperEnabled,
  address partner,
  tuple(
    string name, string symbol, string tokenUri,
    uint256 maxSupply, uint256 saleAmount, uint256 raiseAmount,
    address quoteAsset, bytes32 tokenSalt,
    bytes tokenParams, bytes vaultParams, bytes curveParams,
    bytes tradeParams, bytes migrateParams, bytes customDataParams
  ) initParams
)
```

Modules with no params use `0x`.

4. Sign locally with the current wallet. This is not official co-signing:

```js
payload = solidityPacked(
  ["string", "uint256", "address", "bytes32"],
  ["createOpenFourToken", chainId, caller, keccak256(createArgs)]
)
signature = signer.signMessage(getBytes(keccak256(payload)))
```

5. Pass `createToken.staticCall(createArgs, signature, { value })` before broadcasting.
6. Parse the token address from `TokenCreated`. Do not write JSON if parsing fails.
7. Append to `developer/workbench/data/tokens.json`: `tokenAddress, name, symbol, presetId, creator, txHash, chainId, quoteAsset`.

Prefer `validTimestamp = now + 3600`. `requestId` must not be reused. When quote is wrappedNative, compute `msg.value` as the Workbench does (createFee + presaleQuote).

## Buy / sell / migrate

Send transactions only to the current fork Core. ABI: `developer/workbench/src/eth/fourCore.js` and `tools.js`.

```
estimateBuy(token, trader, amount, options, proof)
estimateBuyByBudget(token, trader, maxQuotePayAmount, options, proof)
estimateSell(token, trader, amount, options, proof)

buy(token, amount, maxQuotePayAmount, options, proof) payable
buyByBudget(token, maxQuotePayAmount, minAmountOut, options, proof) payable
sell(token, amount, minQuoteRecvAmount, options, proof)
migrate(token)
```

Order of operations:

1. Read `Core.tokens(token)` and vault books. Confirm `exists`, not paused, and phase is Trading (or the phase this preset allows).
2. Estimate first, then set `maxQuotePayAmount` / `minAmountOut` / `minQuoteRecvAmount` with slippage.
3. Approve Core first when quote is not native.
4. Buy with `buy` or `buyByBudget`. For native quote, put payable quote in `value`.
5. If sells are enabled: approve the token, then `sell`. `options` bit0 keeps WBNB (`SELL_OPTION_RECEIVE_WBNB`).
6. Graduation: check `Migrate.evaluate` or on-chain conditions, then `migrate(token)`. A revert before conditions are met is expected.

## Verification checklist

After create:

- [ ] `tokens(token).exists == true`
- [ ] `presetId`, name/symbol/maxSupply/saleAmount/quoteAsset match create args
- [ ] `token/vault/curve/trade/migrate/tokenModule/customData` are non-zero (customData per Preset)
- [ ] Each module `descriptor().tag` matches the registered tag
- [ ] Vault starts with `remainingForSale == saleAmount`; `totalRaised` includes presale if any

After buy:

- [ ] `remainingForSale` decreases; `totalRaised` increases
- [ ] Buyer token balance increases; payment is within slippage of estimate `userPays`
- [ ] Trade deny paths return `allowed=false` or Core reverts, and books do not change

After sell (if enabled):

- [ ] Buyer tokens decrease; quote returns
- [ ] Penalty / fees match Trade / Curve

After migrate:

- [ ] phase is Migrated
- [ ] `MigrateExecuted` was emitted
- [ ] Further buy/sell fail according to the preset
- [ ] If migrate added a pool, record the pool address

Failure paths (spot-check at least):

- [ ] Non-signer signature
- [ ] Expired `validTimestamp`
- [ ] Reused `requestId`
- [ ] Schema encoded out of order
- [ ] `migrate` before graduation

## Verification record

Write to `skill-run.json` or the submit pack: token, presetId, tx hashes, vault snapshots before/after trades, migrate result, failure-path results. The Workbench detail page is a human check, not a substitute for script assertions.
