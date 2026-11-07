// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IOpenFourVault} from "../../interfaces/IOpenFourVault.sol";
import {ITaxTokenBonding} from "../../interfaces/ITaxTokenBonding.sol";
import {OpenFourTypes} from "../../libraries/OpenFourTypes.sol";
import {OpenFourToken} from "../../token/OpenFourToken.sol";

interface IOpenFourCoreView {
    function wrappedNative() external view returns (address);
}

/// @title TaxBondingVault
/// @notice Bonding vault for TaxToken presets. Mirrors `StandardVault` inventory accounting; adds tax sync hooks.
/// @dev Differs from `StandardVault` only at the end of `onBuy` / `onSell` (`ITaxTokenBonding.onBondingTrade(taxFee, …)`).
///      Preset wiring: `VAULT_TAX_BONDING` + `TRADE_TAX_BONDING` + `TOKEN_TAX` + `MIGRATE_BONDING_TAX`.
///
/// Core transaction order (buy; sell is analogous):
///   1. OpenFourCoreLib.processBuyPayment — trader pays curveQuote + fees; FeeRouter transfers quote tax to TaxToken
///   2. vault.onBuy (this contract) — curve inventory + token delivery + tax ledger sync
///   3. TaxToken transfer vault → buyer — `_maybeDispatchBondingFee` may run (not triggered here)
contract TaxBondingVault is Initializable, IOpenFourVault {
    using SafeERC20 for IERC20;

    address private constant DEAD = address(0xdEaD);

    // ── Bound token / quote (set once in init) ───────────────────────────────────
    address public override tokenAddress;
    address public fourCore;
    address public override token;
    address public override quoteAsset;
    address public migrateModule;
    address public creator;
    address public wrappedNative;

    // ── Bonding curve state (curve module reads these for pricing) ─────────────
    OpenFourTypes.Phase public override phase;
    uint256 public override totalRaised;           // quote credited to the curve (excludes anti-sniper slice)
    uint256 public override antiSniperQuoteAccrued; // quote kept in vault for anti-sniper; not in totalRaised
    uint256 public override initialSaleAmount;
    uint256 public override remainingForSale;       // tokens still sellable from vault inventory

    bytes private _initParams;
    string private _moduleVersion;

    modifier onlyFourCore() {
        require(msg.sender == fourCore, "TaxBondingVault: only fourCore");
        _;
    }

    modifier onlyMigrationModule() {
        require(msg.sender == migrateModule, "TaxBondingVault: only migration module");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function init(
        address token_,
        address fourCore_,
        address creator_,
        address migrateModule_,
        OpenFourTypes.TokenCreateParams calldata tokenParams,
        bytes calldata vaultParams,
        string calldata moduleVersion_
    ) external override initializer {
        require(fourCore_ != address(0) && token_ != address(0), "TaxBondingVault: zero address");

        _initParams = vaultParams;
        _moduleVersion = moduleVersion_;
        require(tokenParams.saleAmount > 0, "TaxBondingVault: bad initial sale");
        // Tax bonding preset requires an ERC-20 quote; native-only quote is not supported here.
        require(tokenParams.quoteAsset != address(0), "TaxBondingVault: quote must be ERC20");

        tokenAddress = token_;
        fourCore = fourCore_;
        token = token_;
        quoteAsset = tokenParams.quoteAsset;
        wrappedNative = IOpenFourCoreView(fourCore_).wrappedNative();
        initialSaleAmount = tokenParams.saleAmount;
        remainingForSale = tokenParams.saleAmount;
        migrateModule = migrateModule_;
        phase = OpenFourTypes.Phase.Created;
        creator = creator_;
    }

    function descriptor() external view override returns (bytes8 tagId, string memory tag, string memory version) {
        tag = "module.vault.tax_bonding";
        return (bytes8(keccak256(bytes(tag))), tag, _moduleVersion);
    }

    /// @inheritdoc IOpenFourVault
    function onBuy(OpenFourTypes.VaultTradeParams calldata p)
        external
        override
        onlyFourCore
        returns (uint256 newTotalRaised, uint256 newRemainingForSale)
    {
        require(phase == OpenFourTypes.Phase.Trading, "TaxBondingVault: bad phase");
        require(p.trader != address(0), "TaxBondingVault: zero buyer");
        require(p.tokenAmount > 0 && p.curveQuote > 0, "TaxBondingVault: bad amount");
        require(remainingForSale >= p.tokenAmount, "TaxBondingVault: insufficient sale");

        remainingForSale -= p.tokenAmount;
        totalRaised += p.curveQuote;
        antiSniperQuoteAccrued += p.antiSniperQuote;

        SafeERC20.safeTransfer(IERC20(token), p.trader, p.tokenAmount);

        ITaxTokenBonding(token).onBondingTrade(p.taxFee, true);

        return (totalRaised, remainingForSale);
    }

    /// @inheritdoc IOpenFourVault
    function onSell(OpenFourTypes.VaultTradeParams calldata p)
        external
        override
        onlyFourCore
        returns (uint256 newTotalRaised, uint256 newRemainingForSale)
    {
        require(phase == OpenFourTypes.Phase.Trading, "TaxBondingVault: bad phase");
        require(p.trader != address(0), "TaxBondingVault: zero seller");
        require(p.tokenAmount > 0 && p.curveQuote > 0, "TaxBondingVault: bad amount");
        require(p.curveQuote >= p.antiSniperQuote, "TaxBondingVault: bad anti sniper");

        uint256 bondingQuote = p.curveQuote - p.antiSniperQuote;
        remainingForSale += p.tokenAmount;
        require(totalRaised >= bondingQuote, "TaxBondingVault: raised underflow");
        totalRaised -= bondingQuote;
        antiSniperQuoteAccrued += p.antiSniperQuote;

        ITaxTokenBonding(token).onBondingTrade(p.taxFee, false);

        return (totalRaised, remainingForSale);
    }

    function setPhase(OpenFourTypes.Phase newPhase) external override onlyFourCore {
        phase = newPhase;
        OpenFourToken(token).setPhase(newPhase);
    }

    function sellViaVault() external pure override returns (bool) {
        return false;
    }

    function collectSellAsset(address, uint256, bytes calldata) external pure override {
        revert("TaxBondingVault: sellViaVault disabled");
    }

    /// @dev Core pulls protocol/tax/dev fees and pays curve quote into this vault during trades.
    function transferQuote(address to, uint256 amount) external override onlyFourCore {
        SafeERC20.safeTransfer(IERC20(quoteAsset), to, amount);
    }

    function transferQuoteForMigration(address to, uint256 amount) external override onlyMigrationModule {
        require(to != address(0), "TaxBondingVault: zero recipient");
        SafeERC20.safeTransfer(IERC20(quoteAsset), to, amount);
    }

    function transferTokenForMigration(address to, uint256 amount) external override onlyMigrationModule {
        require(to != address(0), "TaxBondingVault: zero recipient");
        SafeERC20.safeTransfer(IERC20(token), to, amount);
    }

    function burnToken(uint256 amount) external override onlyMigrationModule {
        SafeERC20.safeTransfer(IERC20(token), DEAD, amount);
    }

    function isSoldOut() external view override returns (bool) {
        return remainingForSale <= 1e18;
    }

    function soldAmount() external view returns (uint256) {
        return initialSaleAmount - remainingForSale;
    }

    function getInitParams() external view returns (bytes memory) {
        return _initParams;
    }

    receive() external payable {}
}
