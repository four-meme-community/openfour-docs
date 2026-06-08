// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ModuleEncodeSchema} from "../libraries/OpenFourTypes.sol";

interface IOpenFourModuleSchema {
    function moduleEncodeSchema() external pure returns (ModuleEncodeSchema memory);
}
