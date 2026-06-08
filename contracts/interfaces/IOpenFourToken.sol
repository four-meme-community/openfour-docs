// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ITagDescriptor} from "./ITagDescriptor.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";

interface IOpenFourToken is ITagDescriptor {
    function vault() external view returns (address);
    function maxSupply() external view returns (uint256);
    function curveModule() external view returns (address);
    function tradeModule() external view returns (address);
    function migrateModule() external view returns (address);
    function tokenModule() external view returns (address);
    function migratedPools(address pool) external view returns (bool);
    function tokenPhase() external view returns (OpenFourTypes.Phase);
    function tokenURI() external view returns (string memory);
    function customData() external view returns (address);
    function setMigratedPool(address pool, bool enabled) external;
    function setMigratedPools(address[] calldata pools, bool enabled) external;
    function setPhase(OpenFourTypes.Phase newPhase) external;
}
