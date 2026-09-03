// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ITagDescriptor} from "../interfaces/ITagDescriptor.sol";

/// @title ITaxStrategy
/// @notice Per-token tax strategy controlled by StrategyTaxToken.
interface ITaxStrategy is ITagDescriptor {
    event DispatchReady(uint8 indexed reason, uint256 pendingAmount);

    function initialize(
        address token,
        address quote,
        address owner,
        address[] calldata roles,
        bytes calldata initParams
    ) external;

    function receiveTokenTax(uint256 amountToken) external;
    function receiveQuoteTax(uint256 amountQuote) external;
    function dispatchTax() external;
    function canDispatchTax(uint256 pendingTokenTax, uint8 phase) external view returns (bool);
    function minDispatch() external view returns (uint256);
    function forceDispatchTax() external;
    function updateShare(address account, uint256 share) external;
    function feeAssets() external view returns (address[] memory assets);
}
