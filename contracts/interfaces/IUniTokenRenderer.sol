// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IUniTokenRenderer
/// @notice External renderer contract interface.
///         Accepts a badge ID and its encoded seed, returns a full tokenURI string.
///         The returned value is typically a data:application/json;base64,... URI
///         whose "image" field contains an on-chain SVG.
///
///         Custom renderers used at token creation MUST implement ERC-165 and return
///         true from `supportsInterface(type(IUniTokenRenderer).interfaceId)`.
///         The preset `defaultRenderer` is trusted and skips this check.
interface IUniTokenRenderer {
    /// @param tokenId  The badge ID (monotonically increasing from 1).
    /// @param seed     The encoded uint256 seed stored for this badge.
    /// @return         A valid tokenURI string; MUST be non-empty for any non-zero seed.
    function tokenURI(uint256 tokenId, uint256 seed) external view returns (string memory);
}
