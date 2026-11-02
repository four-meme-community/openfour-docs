// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal Pancake / Uniswap Permit2 allowance surface used by Infinity periphery.
interface IPermit2Allowance {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}
