// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IOpenFourMigrateModule} from "../../interfaces/IOpenFourMigrateModule.sol";
import {IOpenFourModuleSchema} from "../../interfaces/IOpenFourModuleSchema.sol";
import {OpenFourTypes, ParamDescriptor, ModuleEncodeSchema} from "../../libraries/OpenFourTypes.sol";

/// @dev Generated skeleton. evaluate() decides; executeMigration() must re-check.
contract {{CONTRACT}} is Initializable, IOpenFourMigrateModule, IOpenFourModuleSchema {
    struct Params {
        uint256 duration;
    }

    address public boundToken;
    address public fourCore;
    uint256 public endTime;
    bytes private _initParams;
    string private _moduleVersion;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function init(address token, address fourCore_, address, bytes calldata rawParams, string calldata moduleVersion_)
        external
        override
        initializer
    {
        require(fourCore_ != address(0), "Migrate: zero fourCore");
        Params memory p = abi.decode(rawParams, (Params));
        boundToken = token;
        fourCore = fourCore_;
        endTime = block.timestamp + p.duration;
        _initParams = rawParams;
        _moduleVersion = moduleVersion_;
    }

    function descriptor() external view override returns (bytes8 tagId, string memory tag, string memory version) {
        tag = "{{TAG}}";
        return (bytes8(keccak256(bytes(tag))), tag, _moduleVersion);
    }

    function evaluate(OpenFourTypes.MigrateContext calldata ctx)
        external
        view
        override
        returns (OpenFourTypes.MigrateResult memory)
    {
        require(ctx.token == boundToken, "Migrate: token mismatch");
        bool ready = ctx.soldOut || ctx.timestamp >= endTime;
        return OpenFourTypes.MigrateResult({ canMigrate: ready, data: "", reason: ready ? "" : "not ready" });
    }

    function executeMigration(OpenFourTypes.MigrateHookContext calldata ctx, bytes calldata)
        external
        override
        returns (uint8 migratedDataVersion, bytes memory encodedMigratedData)
    {
        require(msg.sender == fourCore, "Migrate: only fourCore");
        require(ctx.token == boundToken, "Migrate: token mismatch");
        require(ctx.soldOut || ctx.timestamp >= endTime, "Migrate: not ready");
        return (1, abi.encode(ctx.token));
    }

    function getInitParams() external view override returns (bytes memory) {
        return _initParams;
    }

    function moduleEncodeSchema() external pure override returns (ModuleEncodeSchema memory) {
        ParamDescriptor[] memory p = new ParamDescriptor[](1);
        p[0] = ParamDescriptor("duration", "uint256", 0, true, "Duration (seconds)", "86400", "", "0", "");
        return ModuleEncodeSchema("migrate", 1, p);
    }
}
