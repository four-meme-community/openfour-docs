// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ITagDescriptor} from "./ITagDescriptor.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";

interface IOpenFourMigrateModule is ITagDescriptor {
    function init(address token, address fourCore, address feeRouter, bytes calldata params, string calldata moduleVersion)
        external;
    function evaluate(OpenFourTypes.MigrateContext calldata ctx)
        external
        view
        returns (OpenFourTypes.MigrateResult memory);
    function executeMigration(OpenFourTypes.MigrateHookContext calldata ctx, bytes calldata hookData)
        external
        returns (uint8 migratedDataVersion, bytes memory encodedMigratedData);
    function getInitParams() external view returns (bytes memory);
}
