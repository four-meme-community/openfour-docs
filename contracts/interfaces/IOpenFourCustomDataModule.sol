// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ITagDescriptor} from "./ITagDescriptor.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";

interface IOpenFourCustomDataModule is ITagDescriptor {
    function init(address token, address fourCore, bytes calldata params, string calldata moduleVersion) external;
    function afterHook(OpenFourTypes.TradeHookContext calldata ctx) external;
    function onMigrate(OpenFourTypes.MigrateHookContext calldata ctx) external;
}
