// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ITagDescriptor
/// @notice Stable **tag** (implementation / product line) + frozen **version** (e.g. Registry `ModuleMetadata.version` at init / create)
///         + precomputed **tagId** (`bytes8(keccak256(bytes(tag)))`).
/// @dev Off-chain can staticcall any contract through this interface to read `(tag, version, tagId)` without coupling to a specific module/token type.
interface ITagDescriptor {
    function descriptor() external view returns (bytes8 tagId, string memory tag, string memory version);
}
