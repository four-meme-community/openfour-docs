// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IOpenFourCustomDataModule} from "../../interfaces/IOpenFourCustomDataModule.sol";
import {IOpenFourModuleSchema} from "../../interfaces/IOpenFourModuleSchema.sol";
import {OpenFourTypes, ParamDescriptor, ModuleEncodeSchema} from "../../libraries/OpenFourTypes.sol";

/// @title StandardCustomData
/// @notice Blank per-token shared state contract deployed as a BeaconProxy.
/// @dev Extend this contract to add custom storage and hook logic.
///      Core is the only authorised writer; all other callers are read-only.
///      This base implementation accepts no init params and is a no-op for all hooks.
contract StandardCustomData is Initializable, IOpenFourCustomDataModule, IOpenFourModuleSchema {

    address public token;
    address public core;
    string private _moduleVersion;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    modifier onlyCore() {
        require(msg.sender == core, "CustomData: only core");
        _;
    }

    // ─── IOpenFourCustomDataModule ─────────────────────────────────────────────

    /// @inheritdoc IOpenFourCustomDataModule
    function init(address token_, address core_, bytes calldata /*params*/, string calldata moduleVersion_) external override initializer {
        require(token_ != address(0) && core_ != address(0), "CustomData: zero address");
        token = token_;
        core  = core_;
        _moduleVersion = moduleVersion_;
    }

    /// @notice Stable custom-data tag + version snapshot from `init` (ITagDescriptor).
    function descriptor() external view override returns (bytes8 tagId, string memory tag, string memory version) {
        tag = "module.data.standard";
        return (bytes8(keccak256(bytes(tag))), tag, _moduleVersion);
    }

    /// @inheritdoc IOpenFourCustomDataModule
    /// @dev No-op in the base implementation. Override to add custom post-trade logic.
    function afterHook(OpenFourTypes.TradeHookContext calldata /*ctx*/) external override onlyCore {
        // no-op
    }

    /// @inheritdoc IOpenFourCustomDataModule
    /// @dev No-op in the base implementation. Override to add custom post-migration logic.
    function onMigrate(OpenFourTypes.MigrateHookContext calldata /*ctx*/) external override onlyCore {
        // no-op
    }

    // ─── IOpenFourModuleSchema ───────────────────────────────────────────

    /// @inheritdoc IOpenFourModuleSchema
    /// @dev Returns an empty schema — this base implementation takes no init params.
    function moduleEncodeSchema() external pure override returns (ModuleEncodeSchema memory) {
        return ModuleEncodeSchema("customData", 1, new ParamDescriptor[](0));
    }
}
