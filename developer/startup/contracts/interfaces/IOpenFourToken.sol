// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ITagDescriptor} from "./ITagDescriptor.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";

/// @title IOpenFourToken
/// @notice Minimal runtime interface used by core/vault/migrate modules.
interface IOpenFourToken is ITagDescriptor {
    // ── State getters ──────────────────────────────────────────────
    /// @notice Bound vault address.
    function vault() external view returns (address);
    /// @notice Token max supply (0 means unlimited by implementation policy).
    function maxSupply() external view returns (uint256);
    /// @notice Bound curve module instance.
    function curveModule() external view returns (address);
    /// @notice Bound trade module instance.
    function tradeModule() external view returns (address);
    /// @notice Bound migrate module instance.
    function migrateModule() external view returns (address);
    /// @notice Bound token module instance.
    function tokenModule() external view returns (address);
    /// @notice Whether an address is marked as migrated liquidity pool.
    function migratedPools(address pool) external view returns (bool);
    /// @notice Token-side phase mirror used by transfer hooks.
    function tokenPhase() external view returns (OpenFourTypes.Phase);
    /// @notice ERC-1046 metadata URI.
    function tokenURI() external view returns (string memory);
    /// @notice Per-token customData BeaconProxy address (zero when preset has no customDataId).
    function customData() external view returns (address);

    // ── Vault or migrate module ─────────────────────────────────────
    /// @notice Mark/unmark a migrated pool address.
    function setMigratedPool(address pool, bool enabled) external;
    /// @notice Batch mark/unmark migrated pool addresses (single CALL + one event).
    function setMigratedPools(address[] calldata pools, bool enabled) external;
    /// @notice Update token-side phase.
    function setPhase(OpenFourTypes.Phase newPhase) external;
}
