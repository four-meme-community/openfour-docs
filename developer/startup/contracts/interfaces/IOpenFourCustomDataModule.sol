// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ITagDescriptor} from "./ITagDescriptor.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";

/// @title IOpenFourCustomDataModule
/// @notice Standard interface for per-token shared state contracts (BeaconProxy instances).
/// @dev One instance is deployed per token when the preset specifies a non-zero `customDataId`.
///      Write access is restricted to OpenFourCore (onlyCore). Read access is unrestricted — any module
///      or external caller may call view functions defined on concrete implementations.
///
///      Implementations SHOULD also implement `IOpenFourModuleSchema` so that
///      `OpenFourTools.getPresetEncodeSchemas()` can return the ABI schema for `customDataParams`,
///      enabling frontends to encode init params without hard-coding the layout.
///      If an implementation accepts no params it may return an empty ModuleEncodeSchema.
interface IOpenFourCustomDataModule is ITagDescriptor {
    /// @notice Called once by OpenFourDeployer immediately after the BeaconProxy is deployed (same lifecycle as other module `init`).
    /// @param token     The ERC20 token address this instance is bound to.
    /// @param fourCore  OpenFourCore address (stored as the authorised writer).
    /// @param params    Preset-specific initialisation bytes from TokenInitParams.customDataParams.
    /// @param moduleVersion Registry `ModuleMetadata.version` at create time (snapshot).
    function init(address token, address fourCore, bytes calldata params, string calldata moduleVersion) external;

    /// @notice Called by OpenFourCore after every successful buy or sell.
    /// @dev Implementations should guard with `require(msg.sender == core)`.
    function afterHook(OpenFourTypes.TradeHookContext calldata ctx) external;

    /// @notice Called by OpenFourCore after a successful migration.
    /// @dev Implementations should guard with `require(msg.sender == core)`.
    function onMigrate(OpenFourTypes.MigrateHookContext calldata ctx) external;
}
