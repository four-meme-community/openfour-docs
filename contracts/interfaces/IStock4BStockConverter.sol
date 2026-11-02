// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice 1:1 Stock4 → bStock conversion used when a meme's main pool moves from Stock4 to bStock. One converter
///         serves every registered Stock4 / bStock pair on the Stock4 SIH.
interface IStock4BStockConverter {
    /// @notice The Stock4 SIH that receives the bStock of the manager's migration conversions.
    function hook() external view returns (address);

    /// @notice bStock paired with `stock4` (zero when not registered).
    function bStockOf(address stock4) external view returns (address);

    /// @notice Pulls `amount` of `stock4` from the caller and sends the same raw amount of its bStock to the hook
    ///         (caller = manager) or back to the caller (caller = a meme graduated against `stock4`).
    function convert(address stock4, uint256 amount) external;
}
