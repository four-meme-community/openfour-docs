// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Aggregator-facing ABI for `CLSharedInventoryHookMonitor` cold-start pool registry.

interface ICLSharedInventoryHookMonitor {
    event PoolRegistered(bytes32 indexed id, address indexed currency0, address indexed currency1);

    function poolCount() external view returns (uint256);
    function getPools() external view returns (bytes32[] memory);
    function poolsOfToken(address token) external view returns (bytes32[] memory);
}
