// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IWrappedNative
/// @notice Minimal interface for wrapped-native tokens such as WBNB.
interface IWrappedNative {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}
