// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IOpenFourCurveModule} from "../../interfaces/IOpenFourCurveModule.sol";
import {IOpenFourModuleSchema} from "../../interfaces/IOpenFourModuleSchema.sol";
import {OpenFourTypes, ParamDescriptor, ModuleEncodeSchema} from "../../libraries/OpenFourTypes.sol";

/// @dev Generated skeleton. Replace Params and evaluate() with the preset pricing.
contract {{CONTRACT}} is Initializable, IOpenFourCurveModule, IOpenFourModuleSchema {
    struct Params {
        uint256 placeholderPrice;
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

    function init(
        address token,
        address fourCore_,
        OpenFourTypes.TokenCreateParams calldata,
        bytes calldata rawParams,
        string calldata moduleVersion_
    ) external override initializer {
        require(fourCore_ != address(0), "Curve: zero fourCore");
        Params memory p = abi.decode(rawParams, (Params));
        require(p.placeholderPrice > 0, "Curve: invalid price");
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

    function evaluate(OpenFourTypes.CurveContext calldata ctx)
        external
        view
        override
        returns (OpenFourTypes.CurveResult memory)
    {
        require(ctx.token == boundToken, "Curve: token mismatch");
        uint256 quoteAmount = Math.mulDiv(ctx.amount, params.placeholderPrice, 1e18);
        return OpenFourTypes.CurveResult({
            executable: ctx.amount > 0,
            quoteAmount: quoteAmount,
            adjustedAmount: 0,
            reason: ""
        });
    }

    function evaluateReverse(address token, bool, uint256 quoteBudget, uint256, uint256, uint256)
        external
        view
        override
        returns (uint256 tokenAmount, uint256 curveQuote)
    {
        require(token == boundToken, "Curve: token mismatch");
        tokenAmount = Math.mulDiv(quoteBudget, 1e18, params.placeholderPrice);
        curveQuote = quoteBudget;
    }

    function getInitialPrice() external view override returns (uint256) {
        return params.placeholderPrice;
    }

    function getLastPrice(address, uint256, uint256) external view override returns (uint256) {
        return params.placeholderPrice;
    }

    function getLiquiditySnapshot(address, uint256 remainingForSale, uint256 totalRaised)
        external
        view
        override
        returns (OpenFourTypes.CurveLiquiditySnapshot memory snapshot)
    {
        snapshot.available = true;
        snapshot.remainingForSale = remainingForSale;
        snapshot.totalRaised = totalRaised;
        snapshot.lastPrice = params.placeholderPrice;
    }

    function getInitParams() external view override returns (bytes memory) {
        return _initParams;
    }

    function moduleEncodeSchema() external pure override returns (ModuleEncodeSchema memory) {
        ParamDescriptor[] memory p = new ParamDescriptor[](1);
        p[0] = ParamDescriptor("placeholderPrice", "uint256", 18, false, "Price", "0.0001", "", "0", "");
        return ModuleEncodeSchema("curve", 1, p);
    }
}
