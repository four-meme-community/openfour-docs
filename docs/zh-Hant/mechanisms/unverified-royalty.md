# 未驗證版稅（`ForwardVault`）

[English](../../mechanisms/unverified-royalty.md) | [繁體中文](./unverified-royalty.md)

OpenFour **未驗證版稅（Unverified Royalty）** 允許你自行部署 TaxVault 模板並對外分享；任何 meme 採用後，稅費約 **6%** 會轉至模板的 `authorWallet()`。平台以 `ForwardVault` 包裝你的模板；產品 UI 標為 **Unaudited / 未審計**。使用此路徑**不代表** OpenFour 已審核、審計、註冊或認可該模板。

相關合約：[`ForwardVault.sol`](../../../contracts/taxvault/vaults/ForwardVault.sol)、[`ITaxVault.sol`](../../../contracts/taxvault/ITaxVault.sol)、[`BaseTaxVault.sol`](../../../contracts/taxvault/BaseTaxVault.sol)。

| 鏈 | `ForwardVault` implementation |
| --- | --- |
| BSC | [`0xD3917AA849ec5122a4C0D48e054fa3B5514C47e4`](https://bscscan.com/address/0xD3917AA849ec5122a4C0D48e054fa3B5514C47e4#code) |
| Robinhood | [`0x65B41F0A5EB7d4e1847066352f46808FF6a49D3C`](https://robin.etherscan.io/address/0x65B41F0A5EB7d4e1847066352f46808FF6a49D3C) |

## 1. 概覽

與 `TaxVaultRegistry` 內固定的已審計金庫不同，建立者可指向**任意可 clone 的 TaxVault**。建立時 registry clone 已註冊的 `ForwardVault` 作為 TaxToken `founder`；包裝器再 EIP-1167 clone 提交的 `template`，並對每筆稅費分成：

```text
TaxToken（founder 稅）
        │
        ▼
   ForwardVault  （TYPE_ID = SafuSkill.ForwardVault.v1）
        │
        ├─ ~6%  → authorWallet()   （若稅以 ETH 到帳則 wrap 成 WBNB / wrapped native）
        └─ ~94% → clonedVault      （你的模板實例）
```

## 2. 作用機制

### 2.1 建立時接線

當 `taxVaultTypeId = keccak256("SafuSkill.ForwardVault.v1")`：

1. `TaxVaultRegistry.cloneVault` 部署 `ForwardVault` BeaconProxy 作為 `founder`。
2. 外層初始化：

```solidity
struct InitParams {
    address template; // 已部署的 TaxVault implementation
    bytes initData;   // 給 clone 的 ABI 編碼參數
}
```

3. `_customInit` 執行 `Clones.clone(template)`，再 `clone.initialize(token, quote, owner=建立者, roles=[], initData)`。
4. 校驗 `taxVaultToken()` / `taxVaultQuote()` 一致後，快取 `authorWallet()`。

`roles` 恆為空——模板初始化不得依賴 registry roles。

### 2.2 每筆稅費分成

| 情況 | 行為 |
| --- | --- |
| 正常 | `royalty = amount * 600 / 10_000`（向下取整）；餘額 → clone |
| 極小額 | 小於 17 個最小單位 → `royalty = 0` |
| 放棄作者分成 | `authorWallet()` 為 `0`、`0xdEaD` 或 ForwardVault 本身 → **100%** 給 clone |

**Native 稅**（quote 為 wrapped native；TaxToken 以 ETH 打入）：作者份額 wrap 成 WBNB / 對應鏈 wrapped native 後轉出；clone 份額以 ETH 打到 `clonedVault`（`receive()`）。

**ERC20 稅**：兩份均為 quote ERC20。ForwardVault 按**當前餘額**分成（非 callback 名義 amount）。轉完 clone 份額後 best-effort 呼叫 `onERC20TaxReceived`。

首次成功收款鎖成 `Native` 或 `ERC20`；之後混用會 `RevenueAssetMismatch`。

**不**轉發 `updateShares()`——持倉份額 / 分紅型金庫不相容，僅適用收款型模板。

### 2.3 Wrapped native

| 鏈 | chainId | Wrapped native |
| --- | --- | --- |
| BSC | 56 | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` |
| Robinhood | 4663 | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |

其他鏈在初始化 / native 版稅 wrap 時 `UnsupportedChain`。

## 3. 合規模板

### 3.1 介面

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

繼承 [`BaseTaxVault`](../../../contracts/taxvault/BaseTaxVault.sol)；實作 `_customInit`、`authorWallet`、`moduleEncodeSchema`，並 override payable `receive()`——ForwardVault 以 `call{value}` 轉發約 94% native（缺則 `NativeForwardFailed`）。

規則：

- `initialize` 後，getter 必須等於 ForwardVault 傳入的 token/quote。
- `authorWallet()` 返回穩定、合法的 address（模板開發者版稅地址——不是代幣建立者，也不一定是 vault `owner`）。
- implementation 構造函數 `_disableInitializers()`；每 clone 狀態寫在 `_customInit`。
- fee-on-transfer 優先用 `SafeERC20` / 餘額差值。
- 不要依賴非空 `roles` 或 `updateShares`。

### 3.2 最小示例

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
        // 對約 94% native 份額記帳 / 分配
    }

    function onERC20TaxReceived(
        address asset,
        uint256 amount
    ) public override {
        super.onERC20TaxReceived(asset, amount);
        // 對約 94% ERC20 份額記帳 / 分配
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

### 3.3 Schema → four.meme 建立頁

`moduleEncodeSchema()` 是合約對外的欄位宣告，必須與 `Params` 的**順序與 ABI 類型**一致。

**four.meme 建立頁：**

1. 從貼上的 `template` 地址讀取 `moduleEncodeSchema()`。
2. 依每個 `ParamDescriptor` 渲染表單欄位（`title` / `hint` / 預設值 / 上下限）。
3. 提交時把使用者輸入編碼為內層 `initData`，再包成 ForwardVault 的 `taxVaultInitParams = abi.encode(template, initData)` 一併上鏈——UI 路徑**不必**手動 encode。

請寫清楚 `title` / `hint`（建立者實際看到的文案）。schema 與 `_customInit` 解碼必須同步，否則建立會失敗或參數錯綁。

### 3.4 手動編碼（僅腳本）

腳本 / SDK（非 UI）需先編碼**內層**模板參數，再編碼**外層** ForwardVault tuple——不要展平：

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

一併傳入 `taxVaultTypeId = keccak256("SafuSkill.ForwardVault.v1")`、買賣稅率與權重。稅費生命週期見 [TaxToken 稅費機制](./tax-token.md)。

## 4. 部署與建立

### 4.1 部署

1. 部署 implementation（構造函數 `_disableInitializers`）。
2. 盡可能在瀏覽器驗證源碼。
3. 在 clone 上模擬 `initialize`，確認 getter 與 `authorWallet()`。

分享前：位元組碼正確；`initialize` 不可二次執行；目標 quote 的 native/ERC20 路徑可用；schema 與 `_customInit` 一致；提款路徑有授權。

### 4.2 在開發者 fork 上建立（建議先在此測試）

用 `developer/fork-deploy` 建立的環境預設帶有 **Bonding Tax V1** 與 **Stock4 Tax V1**，且 `taxVaultRegistry` 已註冊 `SafuSkill.ForwardVault.v1`。用任一稅費 preset 開發與測試模板（建立 + 內盤稅 → ForwardVault）。Stock4 fork 還會為本 Core 部署 SIH Manager（復用共享 hook），以便 migrate 畢業：

1. `cd developer/fork-deploy && npm run fork`，並把 `out/fork-deployment.json` 複製到 `developer/workbench/data/fork.json`。
2. 在同一測試網部署你的 template implementation。
3. 在 Workbench **Create** 選擇 **Bonding Tax V1**（`presets.bondingTaxV1`）或 **Stock4 Tax V1**（`presets.stock4TaxV1`；quote 須為允許的 Stock4）。
4. 設定 `taxVaultTypeId = keccak256("SafuSkill.ForwardVault.v1")`，外層 vault 參數為 `abi.encode(template, initData)`（與 §3.3–3.4 相同形狀；Workbench / schema UI 會編碼）。
5. 建立後買入以產生稅費；檢查 ForwardVault 的 `clonedVault()` / `authorWallet()` 以及約 6% / 94% 分成。

同一 fork 也帶有 **Bonding V1**，可用於非稅費的建立冒煙測試。完整說明見 [`developer/fork-deploy/README.md`](../../../developer/fork-deploy/README.md)。

### 4.3 在 four.meme 建立

1. TaxToken（或相容）建立 → 版稅選 **未驗證版稅 / Unverified Royalty**。
2. 貼上已部署的 `template`——頁面讀取 schema 並展示模板欄位（§3.3）。
3. 填寫這些欄位；前端自動 encode 進 vault 參數。
4. 完成稅率 / bonding / migrate 等其餘參數。

建立後：`token.founder()` = ForwardVault；`clonedVault()` = 模板 clone；`authorWallet()` = 6% 收款方。`template` / `initData` **不可更換**——有缺陷的模板可能永久錯路由稅費。

## 5. 延伸閱讀

- Token 實作：[`contracts/token/TaxToken.sol`](../../../contracts/token/TaxToken.sol)
- [TaxToken 稅費機制](./tax-token.md)
- [開發文件 §25](../developer-guide.md#25-開發未驗證版稅-taxvault-模板)
- [Fork deploy（Bonding / Bonding Tax / Stock4 Tax + BNC4 說明）](../../../developer/fork-deploy/README.md)
- [4Stock → bStock（SIH）](./4stock-to-bstock-SIH.md)
