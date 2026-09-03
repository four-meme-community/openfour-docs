// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ITaxTokenBonding
/// @notice Bonding and migration hooks implemented by OpenFour tax tokens.
interface ITaxTokenBonding {
    /// @notice Credits quote-denominated tax after a bonding trade.
    function onBondingTrade(uint256 taxQuote, bool isBuy) external;

    /// @notice Flushes migration-time deferred tax work.
    function onMigrate() external;
}
