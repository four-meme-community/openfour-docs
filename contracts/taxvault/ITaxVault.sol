// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IOpenFourModuleSchema} from "../interfaces/IOpenFourModuleSchema.sol";

/// @title ITaxVault
/// @notice Interface for TaxVault implementations used as TaxToken founder recipients.
interface ITaxVault is IOpenFourModuleSchema {
    function initialize(
        address token,
        address quote,
        address owner,
        address[] calldata roles,
        bytes calldata initParams
    ) external;

    function taxVaultToken() external view returns (address);
    function taxVaultQuote() external view returns (address);
    function taxVaultTypeId() external view returns (bytes32);
    function authorWallet() external view returns (address);
    function onERC20TaxReceived(address asset, uint256 amount) external;
    function updateShares(
        address from,
        address to,
        uint256 fromShare,
        uint256 toShare
    ) external;
}
