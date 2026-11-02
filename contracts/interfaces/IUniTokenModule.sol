// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IOpenFourTokenModule} from "./IOpenFourTokenModule.sol";

/// @title IUniTokenModule
/// @notice Extended token-module interface for UniToken presets.
///         Exposes V4 infrastructure addresses and the auto-deployed hook address
///         so that the accompanying V4 MigrateModule can read them during init().
interface IUniTokenModule is IOpenFourTokenModule {
    /// @notice The UniTokenV4Hook instance deployed for this specific token.
    ///         Set during createToken(); address(0) before that.
    function deployedHook() external view returns (address);

    /// @notice The V4 PoolManager address used by this token's pool.
    function poolManager() external view returns (address);

    /// @notice The V4 PositionManager address used for liquidity operations.
    function positionManager() external view returns (address);

    /// @notice The renderer contract actually in use (custom or DefaultUniRenderer).
    function activeRenderer() external view returns (address);
}
