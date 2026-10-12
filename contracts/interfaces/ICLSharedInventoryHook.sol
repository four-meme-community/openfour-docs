// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Aggregator-facing ABI for the PancakeSwap Infinity Shared Inventory Hook (SIH).
/// @dev Trimmed to events / views needed for indexing, quoting, and pause checks.

interface ICLSharedInventoryHook {
    struct PoolConfig {
        bool enabled;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
    }

    event PoolConfigured(bytes32 indexed id, PoolConfig cfg);
    event PoolTaxTokenSet(bytes32 indexed id, address indexed taxToken);
    event SwapTaxed(bytes32 indexed id, address indexed currency, uint256 amount, bool isBuy);
    event FeesEarned(bytes32 indexed id, uint256 fee0, uint256 fee1);
    event JitPausedSet(bool paused);
    event SwapPausedUntilSet(uint40 until);

    function getPoolConfig(bytes32 id) external view returns (PoolConfig memory);
    function poolTaxToken(bytes32 id) external view returns (address);
    function jitPaused() external view returns (bool);
    function swapPausedUntil() external view returns (uint40);
}
