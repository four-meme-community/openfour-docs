// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IOpenFourCustomDataModule} from "../../interfaces/IOpenFourCustomDataModule.sol";
import {IOpenFourModuleSchema} from "../../interfaces/IOpenFourModuleSchema.sol";
import {OpenFourTypes, ParamDescriptor, ModuleEncodeSchema} from "../../libraries/OpenFourTypes.sol";

/// @dev Generated skeleton. Only Core may write hooks.
contract {{CONTRACT}} is Initializable, IOpenFourCustomDataModule, IOpenFourModuleSchema {
    address public token;
    address public fourCore;
    mapping(address => uint256) public totalPurchased;
    bytes private _initParams;
    string private _moduleVersion;

    modifier onlyFourCore() {
        require(msg.sender == fourCore, "Data: only fourCore");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function init(address token_, address fourCore_, bytes calldata rawParams, string calldata moduleVersion_)
        external
        override
        initializer
    {
        require(fourCore_ != address(0), "Data: zero fourCore");
        token = token_;
        fourCore = fourCore_;
        _initParams = rawParams;
        _moduleVersion = moduleVersion_;
    }

    function descriptor() external view override returns (bytes8 tagId, string memory tag, string memory version) {
        tag = "{{TAG}}";
        return (bytes8(keccak256(bytes(tag))), tag, _moduleVersion);
    }

    function afterHook(OpenFourTypes.TradeHookContext calldata ctx) external override onlyFourCore {
        if (ctx.isBuy) totalPurchased[ctx.trader] += ctx.executedAmount;
    }

    function onMigrate(OpenFourTypes.MigrateHookContext calldata) external override onlyFourCore {}

    function moduleEncodeSchema() external pure override returns (ModuleEncodeSchema memory) {
        return ModuleEncodeSchema("customData", 1, new ParamDescriptor[](0));
    }
}
