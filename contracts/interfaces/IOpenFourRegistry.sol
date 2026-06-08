// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";

interface IOpenFourRegistry {
    enum ModuleKind {
        Token,
        Vault,
        Curve,
        Trade,
        Migrate,
        CustomData
    }

    struct ModuleRecord {
        address beacon;
        ModuleKind kind;
        OpenFourTypes.ModuleMetadata metadata;
        bool active;
    }

    struct TokenImplRecord {
        address implementation;
        string version;
    }

    function openFourCore() external view returns (address);
    function openFourTool() external view returns (address);
    function createDeployer() external view returns (address);
    function taxVaultRegistry() external view returns (address);
    function uniTokenV4HookImpl() external view returns (address);

    function getPreset(uint256 presetId) external view returns (OpenFourTypes.Preset memory);
    function resolvePresetImplementations(uint256 presetId)
        external
        view
        returns (
            OpenFourTypes.Preset memory preset,
            address tokenModule,
            address vaultModule,
            address curveModule,
            address tradeModule,
            address migrateModule,
            address customDataModule
        );
    function getPresetTokenImpl(uint256 presetId) external view returns (address);
    function getTokenImpl(bytes32 tokenImplId) external view returns (TokenImplRecord memory);
    function getModule(bytes32 moduleKey) external view returns (ModuleRecord memory);
    function getModuleBeacon(bytes32 moduleKey) external view returns (address);
    function getModuleImplementation(bytes32 moduleKey) external view returns (address);
    function getPresetIdsCount() external view returns (uint256);
    function getPresetIdsByBatch(uint256 index, uint256 count) external view returns (uint256[] memory);
    function getPresetIds() external view returns (uint256[] memory);
    function isPresetActive(uint256 presetId) external view returns (bool);
    function isPresetCreateEnabled(uint256 presetId) external view returns (bool);
    function tagOf(bytes8 tagId) external view returns (string memory);
}
