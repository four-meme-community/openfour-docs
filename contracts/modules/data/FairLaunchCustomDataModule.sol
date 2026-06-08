// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IOpenFourCustomDataModule} from "../../interfaces/IOpenFourCustomDataModule.sol";
import {IOpenFourModuleSchema} from "../../interfaces/IOpenFourModuleSchema.sol";
import {OpenFourTypes, ParamDescriptor, ModuleEncodeSchema} from "../../libraries/OpenFourTypes.sol";

/// @title FairLaunchCustomDataModule
/// @notice Reference custom-data module for FairLaunch post-trade and post-migration state.
/// @dev Custom-data modules are the stateful extension point in the current OpenFour architecture.
///      Core calls `afterHook` after a buy/sell has been executed and `onMigrate` after migration.
contract FairLaunchCustomDataModule is Initializable, IOpenFourCustomDataModule, IOpenFourModuleSchema {
    /// @notice Aggregated per-trader launch statistics.
    /// @param totalPurchased Total token amount bought through OpenFourCore.
    /// @param totalSold Total token amount sold through OpenFourCore.
    /// @param lastTradeTime Timestamp of the latest recorded trade.
    /// @param lastTradeBlock Block number of the latest recorded trade.
    struct TraderStats {
        uint256 totalPurchased;
        uint256 totalSold;
        uint256 lastTradeTime;
        uint256 lastTradeBlock;
    }

    address public token;
    address public fourCore;
    bool public migrated;
    uint256 public migratedAt;
    uint256 public migrationTotalRaised;
    uint256 public migrationRemainingForSale;
    mapping(address => TraderStats) public traderStats;
    bytes private _initParams;
    string private _moduleVersion;

    /// @dev OpenFourCore is the only caller allowed to write hook state.
    modifier onlyFourCore() {
        require(msg.sender == fourCore, "FairData: only fourCore");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes this module clone for one OpenFour token.
    /// @dev This example accepts no params, but still stores raw params for consistency with other modules.
    function init(address token_, address fourCore_, bytes calldata rawParams, string calldata moduleVersion_)
        external
        override
        initializer
    {
        require(token_ != address(0) && fourCore_ != address(0), "FairData: zero address");
        require(rawParams.length == 0, "FairData: params not empty");
        token = token_;
        fourCore = fourCore_;
        _initParams = rawParams;
        _moduleVersion = moduleVersion_;
    }

    /// @notice Returns the stable registry tag and the version captured at initialization.
    function descriptor() external view override returns (bytes8 tagId, string memory tag, string memory version) {
        tag = "module.data.fair_launch";
        return (bytes8(keccak256(bytes(tag))), tag, _moduleVersion);
    }

    /// @notice Records a completed trade after Core has already executed vault accounting.
    /// @dev This hook must not enforce trade validity; enforcement happens before execution in curve/trade modules.
    function afterHook(OpenFourTypes.TradeHookContext calldata ctx) external override onlyFourCore {
        require(ctx.token == token, "FairData: wrong token");
        if (ctx.executedAmount == 0) return;

        TraderStats storage stats = traderStats[ctx.trader];
        if (ctx.isBuy) {
            stats.totalPurchased += ctx.executedAmount;
        } else {
            stats.totalSold += ctx.executedAmount;
        }
        stats.lastTradeTime = ctx.timestamp;
        stats.lastTradeBlock = ctx.blockNumber;
    }

    /// @notice Records the final launch snapshot after Core executes migration.
    function onMigrate(OpenFourTypes.MigrateHookContext calldata ctx) external override onlyFourCore {
        require(ctx.token == token, "FairData: wrong token");
        migrated = true;
        migratedAt = ctx.timestamp;
        migrationTotalRaised = ctx.totalRaised;
        migrationRemainingForSale = ctx.remainingForSale;
    }

    /// @notice Describes the ABI layout expected by `init`.
    /// @dev This module has no params; it is deployed for its hook storage behavior.
    function moduleEncodeSchema() external pure override returns (ModuleEncodeSchema memory) {
        return ModuleEncodeSchema("customData", 1, new ParamDescriptor[](0));
    }

    /// @notice Returns the raw ABI-encoded params used to initialize this module clone.
    function getInitParams() external view returns (bytes memory) {
        return _initParams;
    }

    /// @notice Convenience getter used by `FairLaunchTradeModule` to enforce cumulative buy caps.
    function totalPurchased(address trader) external view returns (uint256) {
        return traderStats[trader].totalPurchased;
    }

    /// @notice Convenience getter for explorers and off-chain tools.
    function totalSold(address trader) external view returns (uint256) {
        return traderStats[trader].totalSold;
    }
}
