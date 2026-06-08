// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IOpenFourVault} from "../../interfaces/IOpenFourVault.sol";
import {OpenFourTypes} from "../../libraries/OpenFourTypes.sol";
import {OpenFourToken} from "../../token/OpenFourToken.sol";

interface IOpenFourCoreView {
    function wrappedNative() external view returns (address);
}

contract StandardVault is Initializable, IOpenFourVault {
    address private constant DEAD = address(0xdEaD);
    address public override tokenAddress;
    address public fourCore;
    address public override token;
    address public override quoteAsset;
    address public migrateModule;
    address public creator;
    address public override wrappedNative;
    OpenFourTypes.Phase public override phase;
    uint256 public override totalRaised;
    uint256 public override antiSniperQuoteAccrued;
    uint256 public override initialSaleAmount;
    uint256 public override remainingForSale;
    bytes private _initParams;
    string private _moduleVersion;

    modifier onlyFourCore() {
        require(msg.sender == fourCore, "Vault: only fourCore");
        _;
    }

    modifier onlyMigrationModule() {
        require(msg.sender == migrateModule, "Vault: only migration module");
        _;
    }

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
        require(fourCore_ != address(0) && token_ != address(0), "Vault: zero address");
        _initParams = vaultParams;
        _moduleVersion = moduleVersion_;
        require(tokenParams.saleAmount > 0, "Vault: bad initial sale");
        require(tokenParams.quoteAsset != address(0), "Vault: quote must be ERC20");

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
        tag = "module.vault.standard";
        return (bytes8(keccak256(bytes(tag))), tag, _moduleVersion);
    }

    function onBuy(OpenFourTypes.VaultTradeParams calldata p)
        external
        override
        onlyFourCore
        returns (uint256 newTotalRaised, uint256 newRemainingForSale)
    {
        require(phase == OpenFourTypes.Phase.Trading, "Vault: bad phase");
        require(p.trader != address(0), "Vault: zero buyer");
        require(p.tokenAmount > 0 && p.curveQuote > 0, "Vault: bad amount");
        require(remainingForSale >= p.tokenAmount, "Vault: insufficient sale");

        remainingForSale -= p.tokenAmount;
        totalRaised += p.curveQuote;
        antiSniperQuoteAccrued += p.antiSniperQuote;
        SafeERC20.safeTransfer(IERC20(token), p.trader, p.tokenAmount);
        return (totalRaised, remainingForSale);
    }

    function onSell(OpenFourTypes.VaultTradeParams calldata p)
        external
        override
        onlyFourCore
        returns (uint256 newTotalRaised, uint256 newRemainingForSale)
    {
        require(phase == OpenFourTypes.Phase.Trading, "Vault: bad phase");
        require(p.trader != address(0), "Vault: zero seller");
        require(p.tokenAmount > 0 && p.curveQuote > 0, "Vault: bad amount");

        uint256 bondingQuote = p.curveQuote - p.antiSniperQuote;
        remainingForSale += p.tokenAmount;
        require(totalRaised >= bondingQuote, "Vault: raised underflow");
        totalRaised -= bondingQuote;
        antiSniperQuoteAccrued += p.antiSniperQuote;
        return (totalRaised, remainingForSale);
    }

    function setPhase(OpenFourTypes.Phase newPhase) external override onlyFourCore {
        phase = newPhase;
        OpenFourToken(token).setPhase(newPhase);
    }

    function transferQuote(address to, uint256 amount) external override onlyFourCore {
        SafeERC20.safeTransfer(IERC20(quoteAsset), to, amount);
    }

    function transferQuoteForMigration(address to, uint256 amount) external override onlyMigrationModule {
        require(to != address(0), "Vault: zero recipient");
        SafeERC20.safeTransfer(IERC20(quoteAsset), to, amount);
    }

    function transferTokenForMigration(address to, uint256 amount) external override onlyMigrationModule {
        require(to != address(0), "Vault: zero recipient");
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
