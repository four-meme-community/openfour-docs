# OpenFour Integration Guide

[English](./integration-guide.md) | [繁體中文](./zh-Hant/integration-guide.md)

This guide is for third-party integrators such as wallets, trading frontends, market pages, DEX aggregators, indexers, data backends, and token launch platforms. It explains how to integrate OpenFour creation, estimates, trading, monitoring, token identification, module identification, error identification, and event handling.

This guide only covers integration with deployed OpenFour protocols and registered Presets. It does not cover custom module development, module registration, protocol upgrades, or permission management. For custom gameplay development, read `developer-guide.md`.

## 1. Integration Targets

The main write entry point of OpenFour is `OpenFourCore`. Third-party integrations usually work with five categories of contracts:

- `OpenFourCore`: token creation, buy, buy by budget, sell, migration, and token runtime configuration reads.
- `OpenFourTools`: trade estimates, liquidity snapshots, and creation form schemas.
- `OpenFourRegistry`: Preset, module, and tag dictionary queries.
- `OpenFourFeeRouter`: fee configuration, fee events, developer fee queries, and claims.
- `ZapRouter`: public configured-route quotes and swaps across V2- and V3-compatible DEX routers, including fee-on-transfer token routes.

Each OpenFour token is itself an ERC20 and is also bound to a set of module instances:

- `tokenModule`: initializes the token at creation time.
- `vault`: custody for quote/token assets and records `phase`, `totalRaised`, and `remainingForSale`.
- `curveModule`: internal market pricing.
- `tradeModule`: trading rules, limits, and additional fees.
- `migrateModule`: decides when to migrate and which external liquidity target to migrate to.
- `customData`: optional module for custom gameplay state and Core hooks.

Integrations should distinguish between two identity layers:

- Token type: `token.standard`, `token.tax`, `token.creator_rewards`, `token.uni`, and similar tags describe the ERC20 itself.
- Module type: `module.curve.*`, `module.trade.*`, `module.migrate.*`, and similar tags describe the module logic bound to the token.

## 2. Address Discovery

Use `OpenFourRegistry` as the recommended network-level entry address. Third parties only need to configure the Registry address for each chain, then read the current Core and Tools addresses from the Registry on-chain; read FeeRouter and wrapped native from Core.

Known Registry addresses:

- BNB Smart Chain mainnet: `0x912CEf0C3aE9Ab6eB3Ec87cab69371cFb317Ab94`

```typescript
const registry = new Contract(registryAddress, OpenFourRegistryAbi, provider);

const coreAddress = await registry.openFourCore();
const toolsAddress = await registry.openFourTool();

const core = new Contract(coreAddress, OpenFourCoreAbi, provider);
const feeRouterAddress = await core.feeRouter();
const wrappedNative = await core.wrappedNative();
```

With this approach, integrators do not need to hardcode multiple protocol addresses in the frontend or backend. When Core or Tools is updated by governance, the integration only needs to refresh on-chain reads as long as the Registry address remains unchanged.

## 3. Identifying OpenFour Tokens

Given an ERC20 address, there are three ways to identify whether it belongs to OpenFour.

### 3.1 Through Core Runtime Configuration

```typescript
const cfg = await core.tokens(tokenAddress);
if (!cfg.exists) {
  // Not an OpenFour token managed by the current Core
}
```

This is the most direct identification method for trading frontends and indexers.

### 3.2 Through the Token Descriptor

OpenFour tokens implement `ITagDescriptor`:

```solidity
function descriptor() external view returns (bytes8 tagId, string memory tag, string memory version);
```

Common `tag` values:

- `token.standard`: standard ERC20.
- `token.tax`: token with transfer tax, dividends, or tax distribution logic.
- `token.strategy_tax`: token that delegates tax conversion, staking, and distribution to a per-token strategy.
- `token.creator_rewards`: creator rewards token.
- `token.uni`: token for balance-bound on-chain art or collectibles.

If calling `descriptor()` directly reverts, it can usually be treated as not being an OpenFour standard token.

### 3.3 Through Module Getters on the Token

```solidity
IOpenFourToken(token).vault();
IOpenFourToken(token).curveModule();
IOpenFourToken(token).tradeModule();
IOpenFourToken(token).migrateModule();
IOpenFourToken(token).tokenModule();
IOpenFourToken(token).customData(); // May be address(0)
```

When wallets and frontends only have a token address, they can query the bound modules from the token.

### 3.4 Reference Token Source Code

The `contracts/token/` directory includes reference source code for common OpenFour token implementations:

- `OpenFourToken.sol`
- `TaxToken.sol`
- `StrategyTaxToken.sol`
- `CreatorRewardsToken.sol`
- `UniToken.sol`

For generic integration, the standard runtime config and `IOpenFourToken` getters are usually enough. If an indexer, analytics backend, or advanced UI needs to parse token-specific data, such as tax token state, creator rewards state, migrated pool rules, UniToken renderer/art data, or token-specific events, use these source files together with the bundled token ABIs in `scripts/abi/`.

### 3.5 Distinguishing TaxToken and StrategyTaxToken

Both implementations use `migratedPools` to identify post-migration buys and sells, but their distribution models differ:

- `token.tax`: distribution buckets and accounting are implemented directly by `TaxToken`.
- `token.strategy_tax`: conversion and distribution are delegated to `taxStrategy()`. Call `strategyTag()` to identify the attached strategy.

`strategyTag()` is not part of `TokenCreated.encodedTags`. For a Lista V2 stake-tax token, it returns `tax_strategy.lista_v2_stake`. See [Lista V2 Stake-Tax Mechanism](./mechanisms/lista-v2-stake.md).

## 4. Querying Token Runtime Configuration

`core.tokens(token)` returns the OpenFour runtime config. Fields commonly used by third parties:

- `creator`: creator.
- `presetId`: Preset used at creation time.
- `name` / `symbol`: token metadata.
- `maxSupply` / `saleAmount` / `raiseAmount`: supply and fundraising parameters, usually using 18 decimals.
- `quoteAsset`: quote asset ERC20 address.
- `vault`: fund custody and phase state module.
- `curveModule` / `tradeModule` / `migrateModule` / `tokenModule` / `customData`: module instance addresses.
- `createBlock`: creation block.
- `exists`: whether it is managed by Core.
- `paused`: token-level pause flag.
- `antiSniperEnabled`: whether anti-sniper fees are enabled.

Live Vault state:

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

`phase` is the key field for trading routes:

- `Created (0)`: creation in progress; usually not visible for long.
- `Trading (1)`: internal market is tradable.
- `MigratePending (2)`: migration is executing; buy/sell are unavailable.
- `Migrated (3)`: migrated to an external DEX; OpenFour internal market is closed.
- `Terminal (4)`: reserved or trade-terminated token state, for example test tokens or abandoned launches. Integrations should exclude these tokens from tradable token lists and trading routes.
- `SoldOut (5)`: optional vault-defined sale-closed phase. Internal buy/sell are unavailable. Some bonding presets enter this phase when `vault.isSoldOut()` is true, then migrate from `SoldOut` to `MigratePending`.

`SoldOut` is not a universal migration prerequisite. Custom launch modes may migrate directly from `Trading` to `MigratePending` when their own `MigrateModule.evaluate()` logic allows it, even if `vault.isSoldOut()` is false.

## 5. Trade Estimates

Trading frontends should prefer the current `OpenFourTools` trade-estimation interfaces and should not reimplement curve, fee, or anti-sniper logic themselves.

Current interface names:

- `estimateBuy(token, trader, amount, options, proof)`: estimate a buy by exact token amount.
- `estimateSell(token, trader, amount, options, proof)`: estimate a sell by exact token amount.
- `estimateBuyByBudget(token, trader, maxQuotePayAmount, options, proof)`: estimate how many tokens can be bought with a quote budget.

These interfaces are non-`view` because a ZapRouter estimate may call a V3 quoter whose interface is not read-only. Off-chain ethers v6 code must use `method.staticCall(...)` (ethers v5: `contract.callStatic.method(...)`) so the request is executed through `eth_call` instead of being sent as a transaction. Use this form even when `options == 0`.

### 5.1 TradeEstimate

Core fields returned by `OpenFourTools` estimates:

- `curveQuote`: quote amount on the curve side.
- `totalFee`: aggregated fees including protocol fee, tax fee, developer fee, anti-sniper, and others.
- `userPays`: quote actually paid by the user on buy.
- `userReceives`: quote actually received by the user on sell.
- `tokenAmount`: actual executable token amount.
- `executionPrice`: execution price.

If `tokenAmount == 0`, the token is currently not tradable or the estimate failed, and the UI should disable submission.

### 5.2 Estimate Buy by Token Amount

```typescript
const est = await tools.estimateBuy.staticCall(token, trader, amount, 0, "0x");
if (est.tokenAmount === 0n) return;

const maxQuotePay = est.userPays * 101n / 100n; // 1% slippage buffer
```

### 5.3 Estimate Sell by Token Amount

```typescript
const est = await tools.estimateSell.staticCall(token, trader, amount, 0, "0x");
if (est.tokenAmount === 0n) return;

const minQuoteReceive = est.userReceives * 99n / 100n;
```

### 5.4 Estimate Buy by Quote Budget

```typescript
const est = await tools.estimateBuyByBudget.staticCall(token, trader, budget, 0, "0x");
if (est.tokenAmount === 0n) return;

// Native payment example when quoteAsset == wrappedNative; for ERC20 quote, approve first and pass no value.
await core.buyByBudget(token, budget, est.tokenAmount, 0, "0x", { value: budget });
```

This API fits the UX where "the user enters the maximum amount of quote to spend". It relies on the CurveModule correctly implementing `evaluateReverse()`.

## 6. Creating Tokens

The key integration point for token creation is schema-driven forms. Frontends should not hardcode module parameters for every Preset. Instead, read schemas from the chain.

**Naming note:** Business APIs use **template** / **templateId**. OpenFour contracts, on-chain reads, and JavaScript scripts use **preset** / **presetId**. They refer to the same gameplay package:

```text
template == preset
templateId == presetId
```

When this guide mentions `templateId` in API fields, use the same numeric id as on-chain `presetId` in `getPresetEncodeSchemas(presetId)`, `core.tokens(token).presetId`, and `TokenCreated.presetId`.

### 6.1 Creation Flow

1. List available templates from the business API and let the user choose one.
2. Read the selected template's default quote / supply config from the business API.
3. Read the base field schema and Preset module schemas from `OpenFourTools`.
4. Render the form according to the schemas.
5. ABI-encode parameters separately for each module.
6. Assemble `initParams` for the business API create request.
7. Build the backend creation request payload.
8. Submit the payload to the OpenFour creation API. The API validates the request and returns the encoded `createArg` plus `signature`.
9. Call `core.createToken(createArg, signature)` with the API response.
10. Listen for `TokenCreated` to get the token address and module addresses.

### 6.2 Reading Schemas

```solidity
ParamDescriptor[] memory baseSchema = tools.getTokenBaseSchema();

(
    ModuleEncodeSchema memory tokenSchema,
    ModuleEncodeSchema memory vaultSchema,
    ModuleEncodeSchema memory curveSchema,
    ModuleEncodeSchema memory tradeSchema,
    ModuleEncodeSchema memory migrateSchema,
    ModuleEncodeSchema memory customDataSchema
) = tools.getPresetEncodeSchemas(presetId); // presetId == templateId from the business API
```

Base fields usually include:

- `name`
- `symbol`
- `maxSupply`
- `saleAmount`
- `raiseAmount`
- `antiSniperEnabled`
- `quoteAsset`
- `tokenUri`

Module schema fields are returned by each module's own `moduleEncodeSchema()`.

### 6.3 Encoding Module Parameters

Module parameters must be encoded as a Solidity tuple to match the on-chain `abi.decode(raw, (Struct))`:

```typescript
function encodeModuleParams(schema, form) {
  if (schema.params.length === 0) return "0x";

  const types = schema.params.map((p) => p.abiType);
  const values = schema.params.map((p) => resolveParam(p, form));
  const tupleType = `(${types.join(",")})`;

  return AbiCoder.defaultAbiCoder().encode([tupleType], [values]);
}
```

Do not encode with multiple root types:

```typescript
// Do not do this
AbiCoder.defaultAbiCoder().encode(types, values);
```

When fields include dynamic types such as `bytes` or `string`, the ABI layout for multiple root types differs from a single tuple. On-chain decoding will fail or return incorrect data.

### 6.4 Assembling initParams

Base fields such as `name`, `symbol`, `maxSupply`, `saleAmount`, `raiseAmount`, `quoteAsset`, and `tokenUri` are submitted as **top-level fields** in the business API create request (see [§6.7](#67-getting-the-api-signature-and-sending-createtoken)). They are not included inside `initParams`.

`initParams` only contains the ABI-encoded module parameter bytes generated in [§6.3](#63-encoding-module-parameters):

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

Modules without user-configurable params return `"0x"`. The business API passes these bytes to the signer service, which assembles the final on-chain `createArg`.

### 6.5 Business API — List Templates

Use this public API to list available templates before rendering the creation form. In OpenFour terminology, each returned template is a **preset**.

```text
POST /meme-api/v1/public/token_template/search
Content-Type: application/json
```

Request body:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `sort` | `STRING` | Yes | Sort rule. Example: `LAST`. |

Request example:

```json
{
  "sort": "LAST"
}
```

Response fields:

| Field | Type | Description |
| --- | --- | --- |
| `code` | `NUMBER` | API status code. `0` means success. |
| `msg` | `STRING` | API status message. |
| `data` | `ARRAY` | Template list. |
| `data[].id` | `LONG` | Template id. Same value as on-chain `presetId`. Use as `templateId` in later create requests. |
| `data[].name` | `STRING` | Template name. |
| `data[].tag` | `STRING` | Template category tag shown in the UI. |
| `data[].userAddress` | `STRING` | Template author address. |
| `data[].userImg` | `STRING` | Template author avatar URL. |
| `data[].codeType` | `STRING` | Template code type, for example `SOLIDITY`. |
| `data[].amount` | `STRING` | Template creation fee amount shown by the business API. |
| `data[].descr` | `STRING` | Template description. |
| `data[].status` | `STRING` | Publication status, for example `PUBLISHED`. |
| `data[].deploys` | `NUMBER` | Number of deployments using this template. |
| `data[].comments` | `NUMBER` | Comment count. |
| `data[].likes` | `NUMBER` | Like count. |
| `data[].attentions` | `NUMBER` | Follow / attention count. |
| `data[].bads` | `NUMBER` | Dislike count. |
| `data[].time` | `LONG` | Template publish or update time in milliseconds. |
| `data[].imgUrl` | `STRING` | Template cover image URL. |

Response example:

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

### 6.6 Business API — Get Template Config

After the user selects a template, call this API to get the supported quote options and default supply / sale / raise values for that template.

```text
GET /meme-api/v1/public/token_template/config?templateId={templateId}
```

Query parameters:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `templateId` | `LONG` | Yes | Template id from the search API. Same value as on-chain `presetId`. |

Response fields:

| Field | Type | Description |
| --- | --- | --- |
| `code` | `NUMBER` | API status code. `0` means success. |
| `msg` | `STRING` | API status message. |
| `data` | `ARRAY` | Supported quote / supply config list for the selected template. |
| `data[].id` | `NUMBER` | Config row id. |
| `data[].symbol` | `STRING` | Quote symbol, for example `BNB`. |
| `data[].symbolAddress` | `STRING` | quote address，ep. `0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c`。 |
| `data[].totalSupply` | `STRING` | Default total supply display value. |
| `data[].saleAmount` | `STRING` | Default sale amount display value. |
| `data[].raisedAmount` | `STRING` | Default raise amount display value. |
| `data[].createFee` | `STRING` | create fee in BNB. |
| `data[].decimals` | `NUMBER` | quote decimals. |

Response example:

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

Use this response to prefill creation form defaults such as `maxSupply`, `saleAmount`, and `raiseAmount`. Module-specific fields still come from on-chain schemas in [§6.2](#62-reading-schemas).

### 6.7 Getting the API Signature and Sending createToken

In production, the frontend or integrator backend does not sign `CreateTokenArgs` locally. It builds the creation request payload and sends it to the OpenFour creation API. The API returns the canonical encoded args and the signature from the signer configured in Core:

```text
POST /meme-api/v1/private/token_template/token/create
```

Request fields:

- `templateId` (`LONG`, required): selected template id. Same value as on-chain `presetId`.
- `name` (`STRING`, required): token name.
- `shortName` (`STRING`, required): token short name used by the business API.
- `symbol` (`STRING`, required): token quote symbol / ticker.
- `desc` (`STRING`, required): token description.
- `imgUrl` (`STRING`, required): token image URL.
- `webUrl` (`STRING`, optional): project website URL.
- `telegramUrl` (`STRING`, optional): Telegram URL.
- `twitterUrl` (`STRING`, optional): Twitter / X URL.
- `presaleQuote` (`DECIMAL`, required): creator's initial quote budget for presale buy, if supported by the selected template.
- `feePlan` (`BOOLEAN`, required): selected fee-plan flag used by the business API.
- `initParams` (required): OpenFour module initialization params generated from the schema-driven form. See [§6.4](#64-assembling-initparams).

`initParams` contains the module parameter bytes generated by the OpenFour JavaScript scripts:

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

Response fields:

- `code`: API status code. `0` means success.
- `msg`: API status message.
- `data`: result list. For a normal creation request, use the first item.
- `data[].tokenId`: off-chain token id returned by the API, used for business correlation.
- `data[].tokenAddress`: token address placeholder. It may be empty before the on-chain transaction is confirmed and should not be used as the final token address.
- `data[].createArg`: encoded create params for calling `OpenFourCore.createToken`.
- `data[].signature`: signer signature for calling `OpenFourCore.createToken`.

Response shape:

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

Then submit the API response on-chain:

```typescript
await core.createToken(createArg, signature, { value: txValue });
```

Use the `TokenCreated` event as the canonical source for the final on-chain token address and module addresses.

`signature` is validated against the signer currently configured in Core. Do not pass arbitrary placeholder signatures in production. Test signatures may only be used when the local test or integration environment has explicitly configured the corresponding signer/signature policy.

Reference examples:

- `scripts/examples/01-build-backend-payload.example.mjs`: build the backend request payload.
- `scripts/examples/02-submit-onchain.example.mjs`: submit on-chain after the API returns `createArg + signature`.
- `scripts/examples/03-create-tax-token-with-backend.example.mjs`: full payload → API → on-chain flow for a tax preset.

If creation includes `presaleQuote`:

- `quoteAsset == wrappedNative`: `msg.value = createFee + presaleQuote`.
- Other ERC20 quote: call `quote.approve(core, presaleQuote)` first, then set `msg.value = createFee`.

`presaleQuote` is a fee-inclusive budget. Core automatically reverse-solves the purchasable amount and refunds any excess to the creator.

## 7. Submitting Trades

Core trading functions:

```solidity
function buy(address token, uint256 amount, uint256 maxQuotePayAmount, uint256 options, bytes calldata proof) external payable;
function buyByBudget(address token, uint256 maxQuotePayAmount, uint256 minAmountOut, uint256 options, bytes calldata proof) external payable;
function sell(address token, uint256 amount, uint256 minQuoteRecvAmount, uint256 options, bytes calldata proof) external;
```

### 7.1 Buy

Native quote path:

```typescript
const est = await tools.estimateBuy.staticCall(token, user, amount, 0, "0x");
const maxPay = est.userPays * 101n / 100n;

await core.buy(token, amount, maxPay, 0, "0x", { value: maxPay });
```

ERC20 quote path:

```typescript
await quote.approve(coreAddress, maxPay);
await core.buy(token, amount, maxPay, 0, "0x");
```

When `quoteAsset == wrappedNative`, users may also approve WBNB first and call without passing `msg.value`.

### 7.2 Buy by Budget

```typescript
const est = await tools.estimateBuyByBudget.staticCall(token, user, budget, 0, "0x");
await core.buyByBudget(token, budget, est.tokenAmount, 0, "0x", { value: budget });
```

For ERC20 quote, approve `budget` first and use `msg.value = 0`.

### 7.3 Sell

```typescript
await tokenContract.approve(coreAddress, amount);

const est = await tools.estimateSell.staticCall(token, user, amount, 0, "0x");
const minReceive = est.userReceives * 99n / 100n;

await core.sell(token, amount, minReceive, 0, "0x");
```

If `quoteAsset == wrappedNative`:

- `options = 0`: receive native by default.
- `options & 1 == 1`: receive wrapped native ERC20.

Sell does not charge anti-sniper.

### 7.4 Pre-Trade Checks

Recommended checks before trading:

- `cfg.exists == true`
- `cfg.paused == false`
- `vault.phase() == Trading`
- `registry.isPresetActive(cfg.presetId) == true`
- ERC20 path has been approved
- Estimate result has `tokenAmount > 0`
- Slippage upper/lower bounds are set

### 7.5 ZapRouter and Fee-on-Transfer Tokens

Standard `ZapRouter` methods execute owner-configured routes. A configured route contains at most three hops, each selecting a `dexId` whose `DexType` is `V2` or `V3`. `address(0)` is normalized to wrapped native, and `setRoute()` automatically stores the reverse route. `ViaBridge` and taxed-token methods combine a configured bridge route with a caller-selected first or final DEX hop; integrations must validate and select that dynamic hop explicitly.

#### Post-Migration Multi-Hop DEX Trading

After an OpenFour token reaches `Migrated`, Core's internal `buy` and `sell` are no longer the trading route. A wallet or aggregator may call `ZapRouter` directly to route across supported V2/V3-compatible DEXs:

```text
buy:  BNB/WBNB -> configured intermediate hops -> bridgeToken -> migrated DEX pool -> meme token
sell: meme token -> migrated DEX pool -> bridgeToken -> configured intermediate hops -> WBNB/BNB
```

Choose the entry point according to how the route is registered:

- If the complete token-to-token or native-to-token route is owner-configured, use `quoteExactInput` / `swapExactInput`, `quoteNativeToToken` / `swapNativeToToken`, or the corresponding token-to-native methods.
- If only the reusable native-to-bridge route is configured, use a `ViaBridge` method. For a buy, `finalDexId` and `finalFee` select the migrated pool's final `bridgeToken -> meme token` hop. For a sell, `firstDexId` and `firstFee` select the first `meme token -> bridgeToken` hop.
- The configured bridge portion plus the caller-selected migrated-pool hop must not exceed three hops in total.
- Resolve and validate the migrated pool, bridge token, DEX type, and V3 fee tier before quoting. Do not assume that every migrated token uses the same DEX or pool type.

Example for buying a non-taxed migrated token through a dynamic final hop:

```typescript
const [quotedOut] = await zapRouter.quoteNativeToTokenViaBridge.staticCall(
  bridgeToken,
  memeToken,
  finalDexId,
  finalFee, // ignored by V2
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

For the reverse trade, approve `ZapRouter` for `memeToken`, quote with `quoteTokenToNativeViaBridge`, and execute `swapTokenToNativeViaBridge`. The router returns `midTokens`, which integrations can display or record as the actual intermediate route.

Use the standard exact-input/exact-output methods for non-taxed assets. Exact-output execution does not support taxed tokens because the recipient's post-tax balance cannot be guaranteed.

For post-migration tax tokens, use the exact-input V2-only entry points:

- `swapNativeToTaxToken(...)`: native to a taxed token; the caller-selected final hop must be V2.
- `swapTaxTokenToNative(...)`: taxed token to native; the caller-selected first hop must be V2.

These methods execute fee-on-transfer-compatible swaps and measure actual input/output by balance delta. Quotes remain indicative: integrations must set `minAmountOut`, a deadline, and approve the nominal token input where required.

For OpenFour trades, `TRADE_OPTION_ZAP_NATIVE = 1 << 1` has the following integration semantics:

- `OpenFourTools` uses bit1 to return native-denominated buy/sell estimates when the token's quote asset is not wrapped native.
- Core `buy` and `buyByBudget` currently select the zap payment path from nonzero `msg.value` with a non-wrapped-native quote; their `options` argument is not used for buy execution. `msg.value` is the native ceiling, while the current Core implementation uses `maxPayAmount` as the quote-asset ceiling.
- Core `sell` uses bit1 to convert non-wrapped-native quote proceeds to native output; `minQuoteRecvAmount` is then the minimum native/WBNB output.
- On sell, combine bit1 with bit0 (`TRADE_OPTION_RECEIVE_WRAPPED_NATIVE`) to receive wrapped native instead of native.

### 7.6 Buying a Meme Token with BNB Through Core's Built-in Zap

When the token is still in the OpenFour `Trading` phase and its `quoteAsset` is not wrapped native, `OpenFourCore` can execute this route atomically:

```text
user BNB
  -> OpenFourCore
  -> Core.zapRouter().swapNativeForExactToken(BNB -> quoteAsset)
  -> quote fees to FeeRouter + curve quote to Vault
  -> meme token from Vault to user
  -> unused BNB refunded to user
```

The user calls `OpenFourCore`, not `ZapRouter`, and does not need to approve either the quote asset or ZapRouter. Before enabling this payment option, verify:

```typescript
const ZAP_NATIVE = 1n << 1n;
const zapRouter = await core.zapRouter();
const wrappedNative = await core.wrappedNative();
const cfg = await core.tokens(tokenAddress);

if (zapRouter === ZeroAddress) throw new Error("Core ZapRouter is not configured");
if (cfg.quoteAsset.toLowerCase() === wrappedNative.toLowerCase()) {
  // This is the direct BNB -> WBNB payment path; no multi-asset zap is needed.
}
```

For an exact meme-token amount, obtain both quote-asset and native estimates. The quote estimate supplies Core's quote ceiling; the zap estimate supplies the BNB value:

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
  maxQuotePay, // quote-asset units
  ZAP_NATIVE,  // semantic marker; current buy execution is triggered by msg.value
  "0x",
  { value: maxNativePay }, // BNB wei
);
```

Core asks ZapRouter for the exact amount of quote required by the trade, spends only the necessary BNB, and refunds the remainder of `msg.value`.

For “spend up to this much BNB” UX, estimate with a native budget, then pass the returned trade's quote requirement as Core's quote ceiling:

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

const maxQuotePay = est.curveQuote + est.totalFee; // quote-asset units
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

The configured ZapRouter must have a usable native-to-quote route. Re-estimate shortly before submission and handle `CoreErrBadConfig`, `CoreErrBudgetNotExecutable`, `CoreErrSlippage`, and `CoreErrNativeRefundFailed`.

## 8. Migration and External Market Routing

After each buy, Core calls `MigrateModule.evaluate()`. If it returns `canMigrate = true`, Core automatically migrates. Anyone can also call:

```solidity
function migrate(address token) external;
```

When migration conditions are not met, this usually does not change state. Frontends and indexers should listen for:

- `PhaseTransition`
- `MigrateExecuted`
- `OpenFourToken.MigratedPoolUpdated`

After migration completes, the OpenFour internal market no longer handles buy/sell. Trading routes should switch to the corresponding external DEX.

## 9. Getting the Pool After Migration

Prefer listening for `MigrateExecuted`:

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

Decoding rules are determined by `migrateTagId` and `migratedDataVersion`:

- `module.migrate.pcs_v2`: `encodedMigratedData = abi.encode(address pair)`.
- `module.migrate.bonding_lista_v2`, version `1`: `encodedMigratedData = abi.encode(address pair)`. The pair is the Lista V2 `token/quoteAsset` launch pair.
- Likwid V2 types: usually `abi.encode(bytes32 poolId)`.
- PancakeSwap V4 types: usually `abi.encode(bytes32 poolId)`.

Do not treat `token.migratedPools(pool) == true` as proof that the pool is already active. Pool addresses are pre-registered to block external pool transfers during the internal-market phase. Confirm an active Lista V2 route with all of the following:

- `vault.phase() == Migrated`.
- `MigrateExecuted.migrateTagId` matches `module.migrate.bonding_lista_v2`.
- `migratedDataVersion == 1`.
- The decoded pair matches the factory's `getPair(token, quoteAsset)`.

## 10. Event Monitoring

Events most commonly used by indexers and frontends:

- `OpenFourCore.TokenCreated`: discover new tokens and get module addresses, quote, initial price, and `encodedTags`.
- `OpenFourCore.TradeExecuted`: trade flow, price, fees, `totalRaised`, and `remainingForSale`.
- `OpenFourCore.MigrateExecuted`: migration completion and external pool data.
- `OpenFourCore.PhaseTransition`: phase changes.
- `OpenFourCore.TokenPaused`: token-level pause.
- `OpenFourFeeRouter.FeeAssigned`: fee ownership.
- `OpenFourFeeRouter.DeveloperFeeClaimed`: developer fee claims.
- `OpenFourFeeRouter.RebateUpdated`: protocol-fee rebate recipient changes.
- `OpenFourToken.MigratedPoolUpdated`: migrated pool markers.
- `OpenFourRegistry.TagRegistered`: maintain a local `tagId -> tag` dictionary.

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

Parameter descriptions:

- `requestId`: off-chain correlation id for the creation request, used for business idempotency, order correlation, or backend reconciliation.
- `presetId`: Preset id selected at creation time; indexed and can be used to filter by gameplay package.
- `creator`: creator address; indexed.
- `token`: newly created ERC20 token address; indexed and the most important project primary key for third-party systems.
- `name` / `symbol`: token name and symbol.
- `maxSupply`: maximum supply, in token wei, usually displayed with 18 decimals.
- `saleAmount`: initial amount of tokens put up for sale in the internal market, in token wei.
- `raiseAmount`: fundraising target or quote target used by the module, in quote wei; some Presets/Curves may not use it.
- `initialPrice`: initial display price at creation time, usually quote per 1 token with 1e18 precision.
- `quoteAsset`: quote asset ERC20 address; for wrapped native, this is the wrapped coin address such as WBNB.
- `vault`: vault module instance address for this token.
- `curveModule`: curve module instance address for this token.
- `tradeModule`: trade module instance address for this token.
- `migrateModule`: migrate module instance address for this token.
- `customData`: custom data module instance address for this token; `address(0)` when there is no custom data.
- `tokenModule`: token module instance address used to create the token.
- `tokenMetaUri`: token metadata URI, usually an HTTPS JSON file URL. This is the creation metadata link commonly referred to as `tokenUri` by creation forms and APIs.
- `flags`: creation flags; currently common usage is `bit0 = antiSniperEnabled`.
- `encodedTags`: snapshot of `tagId` values for the token and modules at creation time, 57 bytes. See [§11](#11-encodedtags-and-module-identification).

`tokenMetaUri` JSON shape:

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

Metadata field descriptions:

- `name`: token display name.
- `symbol`: token symbol / ticker.
- `description`: token description shown by frontends.
- `image`: HTTPS image URL.
- `links.website`: official website URL, if provided.
- `links.twitter`: Twitter / X URL, if provided.
- `links.telegram`: Telegram URL, if provided.
- `updated_at`: Unix timestamp of the metadata update time.

Suggested usage:

- Insert the new token into storage.
- Build relationships from token to vault/curve/trade/migrate/customData.
- Parse `encodedTags` for gameplay identification.
- Record `requestId` and creator.

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

Parameter descriptions:

- `token`: OpenFour token being traded; indexed.
- `trader`: user buying or selling; indexed.
- `presetId`: Preset id of the token; indexed.
- `isBuy`: `true` means buy, `false` means sell.
- `quoteAsset`: quote ERC20 used by the trade.
- `vault`: vault address updated by the trade.
- `requestedTokenAmount`: token amount requested by the user, in token wei.
- `tokenAmount`: actual filled token amount, in token wei; may be lower than the requested amount when the curve performs a partial fill.
- `curveQuoteAmount`: quote amount on the curve side. On buy, this is the base quote received by the vault; on sell, this is the base quote before the vault pays out.
- `traderQuoteAmount`: quote amount actually paid or received from the user's perspective, including or excluding fees as appropriate.
- `lastPrice`: post-trade curve display price, usually quote per 1 token with 1e18 precision.
- `slippageLimit`: slippage protection value from the user's transaction parameters; `maxQuotePayAmount` for buy, `minQuoteRecvAmount` for sell.
- `protocolFee`: protocol fee.
- `taxFee`: aggregated tax/additional fee generated by the trade module or token gameplay.
- `devFee`: Preset author or developer fee.
- `antiSniperFee`: anti-sniper fee; may be non-zero only on buy and is always 0 on sell.
- `totalRaised`: `totalRaised()` of the vault after the trade.
- `remainingForSale`: `remainingForSale()` of the vault after the trade.

Amount relationships:

```text
buy:  traderQuoteAmount = curveQuoteAmount + protocolFee + taxFee + devFee + antiSniperFee
sell: traderQuoteAmount = curveQuoteAmount - protocolFee - taxFee - devFee
```

Suggested usage:

- Market candles and trade lists.
- Update last price.
- Update `totalRaised` / `remainingForSale`.
- Aggregate fees and trading volume.

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

Parameter descriptions:

- `presetId`: Preset id of the token; indexed.
- `caller`: address that triggered migration; indexed. It may be a regular user, a bot, or the caller in Core's automatic path.
- `token`: token whose migration completed; indexed.
- `vault`: vault address used for migration.
- `migrateModule`: module instance address that executed migration.
- `migrateTagId`: `migrateModule.descriptor().tagId`, used to determine the migration target and decoding method.
- `totalRaised`: quote amount raised as recorded by the vault at migration time.
- `remainingForSale`: remaining unsold token amount at migration time.
- `hookDataHash`: hash of hook data returned by `MigrateModule.evaluate()`, used for indexing and reconciliation; raw hook data does not appear directly in the event.
- `migratedDataVersion`: version number of `encodedMigratedData`; inspect the version before selecting a decoder.
- `encodedMigratedData`: result data returned by the migration module, such as a PCS V2 pair address or a V4/Likwid pool id.

Suggested usage:

- Decode the external pool according to `migrateTagId` and `migratedDataVersion`.
- Switch the token route from the OpenFour internal market to the external DEX.
- Confirm migration state together with `PhaseTransition` and `MigratedPoolUpdated`.

### 10.4 PhaseTransition

```solidity
event PhaseTransition(
    address indexed token,
    OpenFourTypes.Phase from,
    OpenFourTypes.Phase to,
    address operator
);
```

Parameter descriptions:

- `token`: token whose phase changed; indexed.
- `from`: previous phase.
- `to`: new phase.
- `operator`: address that triggered the phase transition, usually Core or the migration caller context.

Use this for UI transitions from internal market trading to migration in progress or external market trading.

Common paths:

- Bonding sold-out path: `Trading -> SoldOut -> MigratePending -> Migrated`.
- Custom migration path: `Trading -> MigratePending -> Migrated` without entering `SoldOut`.

Phase values:

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

Parameter descriptions:

- `token`: token whose pause state changed; indexed.
- `paused`: `true` means paused, `false` means resumed.

After listening to this event, refresh `core.tokens(token).paused`. Trading/migration routes for the token should be disabled while paused.

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

Parameter descriptions:

- `token`: source token of the fee; indexed.
- `quoteAsset`: fee asset; indexed.
- `recipient`: fee recipient address; not indexed. Filtering by recipient requires client-side decoding and filtering.
- `kind`: fee type; indexed. Common types include protocol, tax, developer, migrate protocol, migrate creator, and similar categories. Use the FeeRouter implementation as the source of truth for the exact enum.
- `kind == 6`: protocol-fee rebate (`FEE_TYPE_REBATE`).
- `amount`: fee amount, in quote wei.
- `pending`: `true` means recorded as claimable pending balance, `false` means immediately distributed or transferred out.

Use this for revenue rankings, fee ownership, and developer fee statistics. Filtering by `(token, quoteAsset, kind)` is the most efficient.

### 10.7 DeveloperFeeClaimed

```solidity
event DeveloperFeeClaimed(
    address indexed quoteAsset,
    address indexed author,
    uint256 amount,
    address indexed to
);
```

Parameter descriptions:

- `quoteAsset`: quote asset claimed; indexed.
- `author`: Preset author claiming developer fees; indexed.
- `amount`: claimed amount.
- `to`: actual receiving address; indexed.

Use this to display developer revenue claim records and for reconciliation.

### 10.8 MigratedPoolUpdated

```solidity
event MigratedPoolUpdated(address indexed pool, bool enabled);
event MigratedPoolsUpdated(address[] pools, bool enabled);
```

Parameter descriptions:

- `pool`: external pool address being marked; indexed.
- `pools`: array of external pool addresses being marked in batch.
- `enabled`: `true` means added to the migrated pool allowlist, `false` means removed.

This event is emitted by the token contract. Indexers can use it as a supplemental source for `MigrateExecuted.encodedMigratedData`, especially when building reverse indexes by pool address.

### 10.9 TokenTransferred

```solidity
event TokenTransferred(
    address indexed from,
    address indexed to,
    uint256 indexed requestId,
    uint256 amount
);
```

Parameter descriptions:

- `from`: sender address; indexed.
- `to`: receiver address; indexed.
- `requestId`: off-chain request id used when creating the token; indexed.
- `amount`: transferred token amount.

This event is an auxiliary token-layer transfer event. For complete trade semantics, prices, and fees, use `OpenFourCore.TradeExecuted` as the source of truth.

## 11. encodedTags and Module Identification

`TokenCreated.encodedTags` is a compact snapshot of each module's `tagId` at creation time. The current length is 57 bytes:

```text
byte 0      : schema, currently 1
byte 1..8   : token tagId
byte 9..16  : tokenModule tagId
byte 17..24 : vault tagId
byte 25..32 : curve tagId
byte 33..40 : trade tagId
byte 41..48 : migrate tagId
byte 49..56 : customData tagId, zero means no customData
```

`tagId = bytes8(keccak256(bytes(tag)))`. Third parties can precompute constants offline and compare directly without RPC.

JS parsing example:

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

When encountering an unknown `tagId`, call:

```typescript
const tag = await registry.tagOf(tagId);
```

Also listen for `TagRegistered(bytes8 indexed tagId, string tag)` to update the local dictionary.

### 11.1 Common Known Tags

The following tags are commonly used by current OpenFour implementations. This is a convenience list for frontend/indexer fast-path detection; it is not an exhaustive or authoritative registry. Always keep the original `tagId`, query `registry.tagOf(tagId)` for unknown values, and listen to `TagRegistered`.

Token implementation tags:

- `token.standard`: standard OpenFour ERC20.
- `token.tax`: TaxToken with transfer-tax and tax-vault behavior.
- `token.strategy_tax`: StrategyTaxToken with per-token strategy delegation.
- `token.creator_rewards`: creator rewards token.
- `token.uni`: Uni-style token with renderer/art or hook-driven behavior.

Token module tags:

- `module.token.standard`: initializes standard `OpenFourToken`.
- `module.token.tax`: initializes TaxToken-style tokens.
- `module.token.strategy_tax`: initializes StrategyTaxToken and clones its registered tax strategy.
- `module.token.creator_rewards`: initializes creator rewards tokens.
- `module.token.uni`: initializes Uni-style tokens.

Vault module tags:

- `module.vault.standard`: standard sale custody/accounting vault.
- `module.vault.tax_bonding`: tax-token bonding vault.

Curve module tags:

- `module.curve.bonding`: standard bonding curve pricing.

Trade module tags:

- `module.trade.simple`: minimal trade policy.
- `module.trade.tax_bonding`: trade policy for tax-token bonding mechanics.

Migrate module tags:

- `module.migrate.pcs_v2`: PancakeSwap V2 migration.
- `module.migrate.pcs_v4`: PancakeSwap V4 migration.
- `module.migrate.bonding_pcs_v4`: bonding migration to PancakeSwap V4.
- `module.migrate.bonding_likwid`: bonding migration to Likwid V2.
- `module.migrate.bonding_lista_v2`: bonding migration to a Lista V2 pair.

Custom data module tags:

- `module.data.standard`: no-op standard custom data module.

Tax strategy tags are not encoded in the seven `encodedTags` slots. For a `token.strategy_tax` token, call `strategyTag()`:

- `tax_strategy.lista_v2_stake`: Lista V2-compatible swap/liquidity strategy with Lista stake-share distribution.

## 12. Token Identification and Module Distinction Strategy

Recommended identification strategy:

- Determine whether it is an OpenFour token: read `core.tokens(token).exists` first.
- Determine token type: parse the token slot in `encodedTags`, or call `token.descriptor()`.
- Determine full gameplay: parse all seven slots in `encodedTags`.
- Determine migration target: prioritize the tag in the migrate slot.
- Determine tax tokens or special gameplay: do not look only at the migrate slot; combine token/vault/trade and other slots.
- For `token.strategy_tax`, call `strategyTag()` and combine the returned strategy tag with the token-module and migrate tags.
- Treat `migratedPools(address)` as a transfer-guard/tax-classification marker. Use phase plus `MigrateExecuted` to identify the active external pool.
- Unknown modules: read `registry.tagOf(tagId)` and preserve the original tagId.

## 13. Fee Model

`OpenFourTools` `estimateBuy` / `estimateSell` already return user-perspective amounts, so third parties usually do not need to calculate fees themselves.

Buy:

```text
userPays = curveQuote + protocolFee + taxFee + devFee + antiSniperFee
```

Sell:

```text
userReceives = curveQuote - protocolFee - taxFee - devFee
```

Token-level tax lifecycle:

- During bonding, FeeRouter transfers quote-denominated tax directly to `TaxToken` or `StrategyTaxToken`. The vault then calls `onBondingTrade()` to notify the token to account for that transfer; `StrategyTaxToken` subsequently forwards the quote tax to its strategy.
- After migration, a transfer is a buy when `migratedPools[from] && to != vault`, and a sell when `migratedPools[to] && from != vault`. No pool transfer tax is applied before the `Migrated` phase.
- Post-migration tax is first accumulated in token units. `DispatchReady(0, amount)` signals token work above its threshold; `DispatchReady(1, amount)` signals quote work at its threshold.
- `TaxToken` implements founder, holder, burn, and liquidity accounting directly. `StrategyTaxToken` forwards tax to `taxStrategy()` and synchronizes eligible holder balances with that strategy.
- `dispatchTax()` is permissionless. `DispatchReady` is only a keeper hint; check `canDispatchTax()` immediately before submitting.

For dispatch order, manual holder-reward funding, keeper batching, and gas behavior, see [TaxToken Tax and Distribution Mechanism](./mechanisms/tax-token.md).

Do not reuse parameter units between the two implementations:

- `TaxToken`: `buyFeeRate <= 1000`, `100 <= sellFeeRate <= 1000`, and the four distribution rates sum to `100`.
- `StrategyTaxToken`: both fee rates are `0..1000`, `minShare >= 1 ether`, and the selected strategy defines its own distribution units. `ListaV2StakeTaxStrategy` uses four bps buckets summing to `10_000`.

anti-sniper:

- May appear only on the buy path.
- Only takes effect when `antiSniperEnabled` was enabled at token creation.
- Is not included in `vault.totalRaised()`.
- Is already included in `estimateBuy().totalFee`.
- Is accumulated in `vault.antiSniperQuoteAccrued()` and may be used by migration modules for buyback/burn behavior.

Anti-sniper is calculated on `curveQuote` by block offset:

```text
offset = block.number - token.createBlock
target ladder bps = OpenFourAntiSniper.ladderBps(offset, block.chainid)
antiSniperFee = curveQuote * max(target ladder bps - protocolFeeBps, 0) / 10_000
```

This means the ladder represents the target total early-buy surcharge on `curveQuote`; protocol fee bps is deducted first so the same portion is not charged twice.

Current BSC Mainnet ladder:

| Block offset | Target ladder bps | Target total surcharge |
| --- | ---: | ---: |
| `0` | `10000` | `100%` |
| `1` | `5000` | `50%` |
| `2` | `2500` | `25%` |
| `3` | `1500` | `15%` |
| `4` | `1000` | `10%` |
| `5` | `500` | `5%` |
| `>= 6` | `100` | `1%` |

Current BSC Testnet ladder uses wider exact block-offset checkpoints for testing. Offsets below `600` that are not listed fall back to the default `10000` bps target.

| Block offset | Target ladder bps | Target total surcharge |
| --- | ---: | ---: |
| default `< 600` unless listed below | `10000` | `100%` |
| `100` | `5000` | `50%` |
| `200` | `2500` | `25%` |
| `300` | `1500` | `15%` |
| `400` | `1000` | `10%` |
| `500` | `500` | `5%` |
| `>= 600` | `100` | `1%` |

Developer fees:

```solidity
feeRouter.devFeePending(quoteAsset, author);
feeRouter.claimDevFee(quoteAsset, to);
feeRouter.claimDevFees(quoteAssets, to);
```

Regular trading frontends do not need to call claim APIs.

Protocol-fee rebate:

- When `feeRouter.rebate()` is nonzero, 5% of the protocol fee is sent immediately to that address; the remaining 95% goes to `treasury`.
- When `rebate() == address(0)`, the full protocol fee goes to `treasury`.
- Tax, developer, and migration fees are not included in the rebate split.
- Rebate assignments emit `FeeAssigned` with `kind == 6` and `pending == false`.
- The rebate is a split of `protocolFee`, not an additional user fee, so the buy/sell amount formulas do not change.

## 14. Trading Integration Example

The following TypeScript-like pseudocode covers address reads, token identification, runtime state, phase routing, trade estimates, slippage design, native/ERC20 payment paths, and post-migration external market routing. Replace ABIs, error handling, UI state, and signer management in a real project.

### 14.1 Initializing Protocol Entry Points

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

### 14.2 Reading Token Runtime and Selecting Route

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
    // See §9 for getting the migrated pool: prefer indexed MigrateExecuted / MigratedPoolUpdated results.
    return { route: "external-dex", cfg };
  }

  if (phase === Phase.SoldOut) {
    // Sale is closed. Do not route to OpenFour buy/sell; wait for or trigger migration.
    return { route: "awaiting-migration", cfg };
  }

  return { route: "disabled", cfg };
}
```

### 14.3 Buy a Fixed Token Amount

When buying a fixed amount, first use `tools.estimateBuy()` to get the no-slippage user payment amount `est.userPays`, then set `maxQuotePayAmount` to `est.userPays` plus buy slippage. In the example below, `slippageBps = 100n` allows at most 1% overpayment.

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

  // Buy slippage: est.userPays is the current estimated payment; maxQuotePay is the user's payment ceiling.
  const maxQuotePay = (est.userPays * (10_000n + slippageBps)) / 10_000n;
  const quoteAsset = cfg.quoteAsset;

  if (quoteAsset.toLowerCase() === wrappedNative.toLowerCase()) {
    // Native path: the user pays native coin directly and Core wraps it internally.
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

If users want to pay with WBNB instead of BNB, they can still use the ERC20 path even when `quoteAsset == wrappedNative`: approve WBNB first, then call `buy(..., { value: 0 })`.

Submission may still revert after estimation because state can change, such as another user buying inventory first, phase migration, price changes, or module rule changes. Estimates and slippage are necessary, but they are not a final guarantee.

### 14.4 Buy by Quote Budget

For budget buys, the user's input `budget` is itself the quote payment ceiling. Slippage protection is no longer "how much more may be paid"; it is `minAmountOut`: use the estimated `est.tokenAmount` as the minimum acceptable token amount. For a more lenient UX, you can subtract token slippage from `est.tokenAmount`.

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

  // Budget buy: budget is the payment ceiling; minAmountOut is the token amount floor.
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

`buyByBudget` fits an input style of "spend at most this much quote". The budget is the payment ceiling, and `minAmountOut` protects the minimum amount of token the user receives within that budget.

### 14.5 Sell a Fixed Token Amount

When selling a fixed amount, first use `tools.estimateSell()` to get the no-slippage expected user receive amount `est.userReceives`, then set `minQuoteRecvAmount` to `est.userReceives` minus sell slippage. In the example below, `slippageBps = 100n` means receiving at most 1% less.

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

  // Sell slippage: est.userReceives is the current estimated receive amount; minQuoteReceive is the user's acceptable floor.
  const minQuoteReceive = (est.userReceives * (10_000n - slippageBps)) / 10_000n;

  const token = new Contract(tokenAddress, ERC20Abi, signer);
  const allowance = await token.allowance(trader, await core.getAddress());
  if (allowance < tokenAmount) {
    await token.approve(await core.getAddress(), tokenAmount);
  }

  // When quoteAsset == wrappedNative, options bit0 controls whether to receive native or wrapped native.
  // 0: receive native; 1: receive wrapped native. Other quote assets ignore this bit.
  const options =
    cfg.quoteAsset.toLowerCase() === wrappedNative.toLowerCase() && receiveWrappedNative
      ? 1
      : 0;

  return coreWithSigner.sell(tokenAddress, tokenAmount, minQuoteReceive, options, "0x");
}
```

Token approval is still required before submitting a sell. Sell does not charge anti-sniper, but it may still revert because of phase, inventory, fees, or module rule changes.

### 14.6 Post-Trade Monitoring and Migration Routing

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

  // Update trades, price, progress bar, user history, and similar UI/index state.
});

core.on(core.filters.PhaseTransition(tokenAddress), async (event) => {
  const { to } = event.args;
  if (Number(to) === Phase.Migrated) {
    // Get the external pool from indexed MigrateExecuted or MigratedPoolUpdated results.
    // UI / aggregators should stop calling OpenFour buy/sell and switch to the external DEX.
  }
});
```

See [§9](#9-getting-the-pool-after-migration) for the specific decoding method of migrated pools. If the indexer has not processed `MigrateExecuted` yet, the frontend can briefly display "migrating" and wait for external pool indexing to complete.

## 15. Error Code Identification

Core errors integrators most commonly encounter:

- `CoreErrTokenNotFound`: token is not managed by the current Core.
- `CoreErrTokenPaused`: token is paused.
- `CoreErrPresetInactive`: Preset is inactive.
- `CoreErrPresetCreateDisabled`: Preset does not allow creating new tokens.
- `CoreErrBadPhase`: vault phase is not executable.
- `CoreErrQuoteMustBeERC20`: quote configuration is invalid.
- `CoreErrCurveRejected`: CurveModule rejected the trade.
- `CoreErrTradeRejected`: TradeModule rejected the trade.
- `CoreErrTradeMax`: exceeded `maxAmount` returned by TradeModule.
- `CoreErrTradeMin`: below `minAmount` returned by TradeModule.
- `CoreErrSlippage`: slippage protection failed.
- `CoreErrBudgetNotExecutable`: buy by budget cannot produce an executable token amount.
- `CoreErrNativeOnlyWrapped`: `msg.value` was sent for a quote asset that is not wrapped native.
- `CoreErrInsufficientNative`: insufficient native quote payment.
- `CoreErrNativeRefundFailed`: native refund failed.

Error handling recommendations:

- When the estimate API returns `tokenAmount == 0`, do not let users submit the trade.
- After a trade reverts, parse the custom error selector first.
- For unrecognized module errors, display the module returned reason or a generic failure message.
- For `CoreErrBadPhase`, immediately refresh the vault phase and switch routes. If the phase is `SoldOut`, disable internal buy/sell and show a migration-pending/awaiting-migration state.

## 16. Common Integration Scenarios

Market frontend:

- Listen for `TokenCreated` and insert new tokens.
- Listen for `TradeExecuted` to update price and trades.
- Use `getCurveLiquiditySnapshot`, `estimateBuy`, or `estimateSell` to display current pricing.
- Switch to the external pool after `Migrated`.

Wallet:

- Use `core.tokens(token).exists` to identify OpenFour tokens.
- Read `OpenFourToken.descriptor()` to display token type.
- Read vault phase to determine whether internal market trading is supported, and hide or mark `Terminal` tokens as non-tradable.

DEX aggregator:

- Route to `OpenFourCore.buy/sell` when `phase == Trading`.
- Do not route to internal buy/sell when `phase == SoldOut`; this is a sale-closed state, not an external DEX state.
- Parse the migration pool and route to the external DEX when `phase == Migrated`.
- Exclude `phase == Terminal` tokens from tradable token lists and all trading routes.

Indexer:

- Build the primary token record from `TokenCreated`.
- Build gameplay tags from `encodedTags`.
- Build trade tables from `TradeExecuted`.
- Build external pool mappings from `MigrateExecuted` and `MigratedPoolUpdated`.
- Track `Terminal` as a reserved or trade-terminated state and filter it out of public tradable-token indexes.

Launch platform:

- Render the creation form using schemas.
- Tuple-encode params separately by module.
- Call the creation signature service or use a test environment signature.
- Listen for `TokenCreated` and backfill creation results.
