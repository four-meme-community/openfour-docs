// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ITagDescriptor} from "./ITagDescriptor.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";

/// @dev `descriptor`: per-token **module** BeaconProxy — `module.token.*` tag + `ModuleMetadata.version` snapshot (ERC20 clone uses `token.*` + `TokenImplRecord.version`).
interface IOpenFourTokenModule is ITagDescriptor {
    /// @param tokenImplVersion Registry `TokenImplRecord.version` snapshot on the cloned token (`IOpenFourToken.descriptor().version`).
    /// @param tokenModuleVersion Registry `ModuleMetadata.version` snapshot on this module proxy (`IOpenFourTokenModule.descriptor().version`).
    function createToken(
        address creator,
        address token,
        address vault,
        address curveModule,
        address tradeModule,
        address migrateModule,
        address customDataModule,
        OpenFourTypes.TokenCreateParams calldata tokenParams,
        string calldata tokenImplVersion,
        string calldata tokenModuleVersion
    ) external returns (uint256 maxSupply, string memory name, string memory symbol);

    function getInitParams() external view returns (bytes memory);
}
