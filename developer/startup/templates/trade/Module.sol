// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IOpenFourTradeModule} from "../../interfaces/IOpenFourTradeModule.sol";
import {IOpenFourModuleSchema} from "../../interfaces/IOpenFourModuleSchema.sol";
import {OpenFourTypes, ParamDescriptor, ModuleEncodeSchema} from "../../libraries/OpenFourTypes.sol";

error {{CONTRACT}}Rejected(address token, address trader, uint256 amount);

/// @dev Generated skeleton. Ordinary rejection must return allowed=false + revertData.
contract {{CONTRACT}} is Initializable, IOpenFourTradeModule, IOpenFourModuleSchema {
    struct Params {
        uint256 maxBuyAmount;
    }

    address public boundToken;
    address public fourCore;
    Params public params;
    bytes private _initParams;
    string private _moduleVersion;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function init(address token, address fourCore_, bytes calldata rawParams, string calldata moduleVersion_)
        external
        override
        initializer
    {
        require(fourCore_ != address(0), "Trade: zero fourCore");
        Params memory p = abi.decode(rawParams, (Params));
        require(p.maxBuyAmount > 0, "Trade: invalid maxBuyAmount");
        boundToken = token;
        fourCore = fourCore_;
        params = p;
        _initParams = rawParams;
        _moduleVersion = moduleVersion_;
    }

    function descriptor() external view override returns (bytes8 tagId, string memory tag, string memory version) {
        tag = "{{TAG}}";
        return (bytes8(keccak256(bytes(tag))), tag, _moduleVersion);
    }

    function evaluate(OpenFourTypes.TradeContext calldata ctx)
        external
        view
        override
        returns (OpenFourTypes.TradeResult memory)
    {
        require(ctx.token == boundToken, "Trade: token mismatch");
        if (ctx.isBuy && ctx.amount > params.maxBuyAmount) {
            return OpenFourTypes.TradeResult({
                allowed: false,
                minAmount: 0,
                maxAmount: 0,
                fees: new OpenFourTypes.FeeTier[](0),
                revertData: abi.encodeWithSelector({{CONTRACT}}Rejected.selector, ctx.token, ctx.trader, ctx.amount)
            });
        }
        return OpenFourTypes.TradeResult({
            allowed: true,
            minAmount: 0,
            maxAmount: ctx.isBuy ? params.maxBuyAmount : type(uint256).max,
            fees: new OpenFourTypes.FeeTier[](0),
            revertData: ""
        });
    }

    function getInitParams() external view override returns (bytes memory) {
        return _initParams;
    }

    function moduleEncodeSchema() external pure override returns (ModuleEncodeSchema memory) {
        ParamDescriptor[] memory p = new ParamDescriptor[](1);
        p[0] = ParamDescriptor("maxBuyAmount", "uint256", 0, false, "Max buy", "1000000000000000000000", "", "1", "");
        return ModuleEncodeSchema("trade", 1, p);
    }
}
