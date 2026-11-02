// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IWrappedNative
/// @notice Minimal interface for wrapped-native tokens (WBNB, WETH, etc.).
interface IWrappedNative {
    /// @notice Wrap native token sent as msg.value.
    function deposit() external payable;

    /// @notice Unwrap and send native token to the caller.
    function withdraw(uint256 amount) external;
}
