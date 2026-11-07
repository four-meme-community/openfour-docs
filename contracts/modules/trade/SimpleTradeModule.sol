// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IOpenFourTradeModule} from "../../interfaces/IOpenFourTradeModule.sol";
import {IOpenFourModuleSchema} from "../../interfaces/IOpenFourModuleSchema.sol";
import {OpenFourTypes, ParamDescriptor, ModuleEncodeSchema} from "../../libraries/OpenFourTypes.sol";

contract SimpleTradeModule is Initializable, IOpenFourTradeModule, IOpenFourModuleSchema {
    address public boundToken;
    address public fourCore;
    bytes private _initParams;
    string private _moduleVersion;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function init(address token, address fourCore_, bytes calldata params, string calldata moduleVersion_)
        external
        override
        initializer
    {
        require(fourCore_ != address(0), "Trade: zero fourCore");
        require(params.length == 0, "Trade: params not empty");
        _initParams = params;
        _moduleVersion = moduleVersion_;
        boundToken = token;
        fourCore = fourCore_;
    }

    /// @notice Stable trade tag + version snapshot from `init` (ITagDescriptor).
    function descriptor() external view override returns (bytes8 tagId, string memory tag, string memory version) {
        tag = "module.trade.simple";
        return (bytes8(keccak256(bytes(tag))), tag, _moduleVersion);
    }

    function evaluate(OpenFourTypes.TradeContext calldata ctx)
        external
        view
        override
        returns (OpenFourTypes.TradeResult memory)
    {
        require(fourCore != address(0), "Trade: not initialized");
        require(ctx.token == boundToken, "Trade: wrong token");
        return OpenFourTypes.TradeResult({
            allowed: true,
            minAmount: 0,
            maxAmount: type(uint256).max,
            fees: new OpenFourTypes.FeeTier[](0),
            revertData: ""
        });
    }

    function moduleEncodeSchema() external pure override returns (ModuleEncodeSchema memory) {
        return ModuleEncodeSchema("trade", 1, new ParamDescriptor[](0));
    }

    function getInitParams() external view returns (bytes memory) {
        return _initParams;
    }
}
