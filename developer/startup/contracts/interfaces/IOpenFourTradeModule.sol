// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ITagDescriptor} from "./ITagDescriptor.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";

interface IOpenFourTradeModule is ITagDescriptor {
    /// @param moduleVersion Registry `ModuleMetadata.version` at create time (snapshot).
    function init(address token, address fourCore, bytes calldata params, string calldata moduleVersion) external;

    /// @dev Hard rejections return `allowed=false` with ABI-encoded `revertData`.
    ///      Amount constraints that budget resolution may satisfy use `minAmount` / `maxAmount`.
    function evaluate(OpenFourTypes.TradeContext calldata ctx)
        external
        view
        returns (OpenFourTypes.TradeResult memory result);
    function getInitParams() external view returns (bytes memory);
}
