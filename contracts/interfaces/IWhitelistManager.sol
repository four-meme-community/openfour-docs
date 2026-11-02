// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Trading whitelist reads (preset-scoped gray release).
/// @dev When preset whitelist is disabled, `isPresetWhitelisted` returns true for all accounts.
interface IWhitelistManager {
    function isPresetWhitelisted(uint256 presetId, address account) external view returns (bool);
}
