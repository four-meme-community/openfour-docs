# Unverified Royalty (`ForwardVault`)

[English](./unverified-royalty.md) | [繁體中文](../zh-Hant/mechanisms/unverified-royalty.md)

OpenFour **Unverified Royalty** lets you deploy a TaxVault template, share it, and earn ~**6%** of tax revenue via `authorWallet()` whenever a meme adopts it. The platform wraps your template in `ForwardVault`; the product UI marks this path **Unaudited**. Using it does **not** mean OpenFour has reviewed, audited, registered, or endorsed the template.

Related contracts: [`ForwardVault.sol`](../../contracts/taxvault/vaults/ForwardVault.sol), [`ITaxVault.sol`](../../contracts/taxvault/ITaxVault.sol), [`BaseTaxVault.sol`](../../contracts/taxvault/BaseTaxVault.sol).

| Chain | `ForwardVault` implementation |
| --- | --- |
| BSC | [`0xD3917AA849ec5122a4C0D48e054fa3B5514C47e4`](https://bscscan.com/address/0xD3917AA849ec5122a4C0D48e054fa3B5514C47e4#code) |
| Robinhood | [`0x65B41F0A5EB7d4e1847066352f46808FF6a49D3C`](https://robin.etherscan.io/address/0x65B41F0A5EB7d4e1847066352f46808FF6a49D3C) |

## 1. Overview

Unlike audited vault types fixed in `TaxVaultRegistry`, creators point at **any clone-compatible TaxVault** they trust. On create, the registry clones registered `ForwardVault` as TaxToken `founder`; that wrapper EIP-1167-clones the submitted `template` and splits each receipt:

```text
TaxToken (founder tax)
        │
        ▼
   ForwardVault  (TYPE_ID = SafuSkill.ForwardVault.v1)
        │
        ├─ ~6%  → authorWallet()   (wrap to WBNB / wrapped native if tax arrived as ETH)
        └─ ~94% → clonedVault      (your template instance)
```

## 2. Mechanism

### 2.1 Create-time wiring

When `taxVaultTypeId = keccak256("SafuSkill.ForwardVault.v1")`:

1. `TaxVaultRegistry.cloneVault` deploys a `ForwardVault` BeaconProxy as `founder`.
2. Outer init:

```solidity
struct InitParams {
    address template; // deployed TaxVault implementation
    bytes initData;   // ABI-encoded params for the clone
}
```

3. `_customInit` runs `Clones.clone(template)`, then `clone.initialize(token, quote, owner=creator, roles=[], initData)`.
4. Asserts `taxVaultToken()` / `taxVaultQuote()` match, then caches `authorWallet()`.

`roles` is always empty — templates must not require registry roles at init.

### 2.2 Per-receipt split

| Case | Behavior |
| --- | --- |
| Normal | `royalty = amount * 600 / 10_000` (floor); remainder → clone |
| Dust | Amounts &lt; 17 wei → `royalty = 0` |
| Waived author | `authorWallet()` is `0`, `0xdEaD`, or ForwardVault itself → **100%** to clone |

**Native tax** (quote is wrapped native; TaxToken pays ETH): royalty wraps to WBNB / chain wrapped native → author; clone share sent as ETH to `clonedVault` (`receive()`).

**ERC20 tax**: both shares stay as quote ERC20. ForwardVault splits its **current balance** (not the nominal callback amount). After the clone transfer, it best-effort calls `onERC20TaxReceived`.

First successful receipt locks mode to `Native` or `ERC20`; mixing later reverts `RevenueAssetMismatch`.

`updateShares()` is **not** forwarded — holder-share / dividend vaults are incompatible; use receipt-based templates only.

### 2.3 Wrapped native

| Chain | chainId | Wrapped native |
| --- | --- | --- |
| BSC | 56 | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` |
| Robinhood | 4663 | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |

Other chains revert `UnsupportedChain` at init / native royalty wrap.

## 3. Compliant template

### 3.1 Interface

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

Inherit [`BaseTaxVault`](../../contracts/taxvault/BaseTaxVault.sol); implement `_customInit`, `authorWallet`, `moduleEncodeSchema`, and override payable `receive()` — ForwardVault forwards ~94% native via `call{value}` (`NativeForwardFailed` if missing).

Rules:

- After `initialize`, getters must match the token/quote ForwardVault passed in.
- `authorWallet()` returns a stable ABI-valid address (template developer royalty — not the token creator, not necessarily vault `owner`).
- `_disableInitializers()` in the implementation constructor; per-clone state in `_customInit`.
- Prefer `SafeERC20` / balance deltas for fee-on-transfer quotes.
- Do not depend on non-empty `roles` or `updateShares`.

### 3.2 Minimal example

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

    receive() external payable override {
        // Account / distribute the ~94% native share.
    }

    function onERC20TaxReceived(
        address asset,
        uint256 amount
    ) public override {
        super.onERC20TaxReceived(asset, amount);
        // Account / distribute the ~94% ERC20 share.
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

### 3.3 Schema → four.meme create UI

`moduleEncodeSchema()` is the contract’s field declaration. It must match `Params` **order and ABI types**.

**four.meme create page:**

1. Reads `moduleEncodeSchema()` from the pasted `template` address.
2. Renders each `ParamDescriptor` as a form field (`title` / `hint` / defaults / min–max).
3. On submit, encodes user input into inner `initData`, then wraps it as ForwardVault `taxVaultInitParams = abi.encode(template, initData)` and sends it on create — you do **not** hand-encode in the UI path.

Write clear `title` / `hint` values; they are what creators see. Keep schema and `_customInit` decode in sync, or create will fail or mis-bind params.

### 3.4 Manual encode (scripts only)

For scripts / SDK (not the UI), encode **inner** template params, then the **outer** ForwardVault tuple — do not flatten:

```typescript
const initData = AbiCoder.defaultAbiCoder().encode(
  ["(address,uint16)"],
  [[recipient, recipientBps]],
);

const taxVaultInitParams = AbiCoder.defaultAbiCoder().encode(
  ["(address,bytes)"],
  [[templateAddress, initData]],
);
```

Pass with `taxVaultTypeId = keccak256("SafuSkill.ForwardVault.v1")`, buy/sell rates, and weights. Tax lifecycle: [TaxToken tax mechanism](./tax-token.md).

## 4. Deploy and create

### 4.1 Deploy

1. Deploy the implementation (`_disableInitializers` in constructor).
2. Verify on the explorer when possible.
3. Simulate `initialize` on a clone; confirm getters and `authorWallet()`.

Before sharing: bytecode is correct; `initialize` is one-shot; native/ERC20 paths work for target quotes; schema matches `_customInit`; withdrawals are authorized.

### 4.2 Create on a developer fork (recommended for testing)

Every environment created with `developer/fork-deploy` ships **Bonding Tax V1** plus `taxVaultRegistry` with `SafuSkill.ForwardVault.v1` already registered. Use that path to develop and test a template before any production submit:

1. `cd developer/fork-deploy && npm run fork`, then copy `out/fork-deployment.json` → `developer/workbench/data/fork.json`.
2. Deploy your template implementation to the same testnet.
3. In Workbench **Create**, select **Bonding Tax V1** (`presets.bondingTaxV1`).
4. Set `taxVaultTypeId = keccak256("SafuSkill.ForwardVault.v1")` and outer vault params `abi.encode(template, initData)` (Workbench / schema UI encodes the same shape as §3.3–3.4).
5. Create, then buy so tax is paid; check ForwardVault `clonedVault()` / `authorWallet()` and the 6% / 94% split.

The same fork also includes **Bonding V1** for a non-tax create smoke test. Full fork notes: [`developer/fork-deploy/README.md`](../../developer/fork-deploy/README.md).

### 4.3 Create on four.meme

1. TaxToken (or compatible) create → royalty **Unverified Royalty**.
2. Paste the deployed `template` address — the page loads schema and shows the template fields (§3.3).
3. Fill those fields; the frontend encodes them into the vault params automatically.
4. Finish fees / bonding / migrate as usual.

After create: `token.founder()` = ForwardVault; `clonedVault()` = template clone; `authorWallet()` = 6% recipient. `template` / `initData` are **immutable** — a buggy template can permanently misroute tax.

## 5. Further reading

- Token implementation: [`contracts/token/TaxToken.sol`](../../contracts/token/TaxToken.sol)
- [TaxToken tax mechanism](./tax-token.md)
- [Developer Guide §25](../developer-guide.md#25-developing-an-unverified-royalty-taxvault-template)
- [Fork deploy (bundled Bonding + Bonding Tax presets)](../../developer/fork-deploy/README.md)
