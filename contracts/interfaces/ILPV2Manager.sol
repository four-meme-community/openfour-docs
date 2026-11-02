// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal interface used by V2 migration modules.
interface ILPV2Manager {
    function recordLP(address token, address quoteAsset, address pair, address router) external;
}
