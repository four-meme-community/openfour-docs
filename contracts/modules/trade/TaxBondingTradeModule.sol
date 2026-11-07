// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IOpenFourTradeModule} from "../../interfaces/IOpenFourTradeModule.sol";
import {IOpenFourModuleSchema} from "../../interfaces/IOpenFourModuleSchema.sol";
import {OpenFourTypes, ParamDescriptor, ModuleEncodeSchema} from "../../libraries/OpenFourTypes.sol";

/// @dev Reads fee bps from the per-token TaxToken clone (same `buyFeeRate` / `sellFeeRate` as DEX phase).
interface ITaxTokenFeeRates {
    function buyFeeRate() external view returns (uint256);
    function sellFeeRate() external view returns (uint256);
}

/// @title TaxBondingTradeModule
/// @notice Bonding trade module that charges quote tax on curve trades via OpenFourFeeRouter.
/// @dev Returns a single `FeeTier` with `recipient = token` and bps from TaxToken storage.
///      Core sends tax quote to FeeRouter, which transfers to TaxToken; allocation happens in TaxToken
///      (`onBondingTrade(taxFee)` credit + vault→buyer transfer dispatch). Protocol/dev fees are unchanged (FeeRouter config).
///      Pair with `TaxBondingVault` + `TaxToken`; does not replace `SimpleTradeModule` on non-tax presets.
contract TaxBondingTradeModule is Initializable, IOpenFourTradeModule, IOpenFourModuleSchema {
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
        require(fourCore_ != address(0), "TaxBondingTrade: zero fourCore");
        require(params.length == 0, "TaxBondingTrade: params not empty");
        _initParams = params;
        _moduleVersion = moduleVersion_;
        boundToken = token;
        fourCore = fourCore_;
    }

    function descriptor() external view override returns (bytes8 tagId, string memory tag, string memory version) {
        tag = "module.trade.tax_bonding";
        return (bytes8(keccak256(bytes(tag))), tag, _moduleVersion);
    }

    /// @inheritdoc IOpenFourTradeModule
    function evaluate(OpenFourTypes.TradeContext calldata ctx)
        external
        view
        override
        returns (OpenFourTypes.TradeResult memory)
    {
        require(fourCore != address(0), "TaxBondingTrade: not initialized");
        require(ctx.token == boundToken, "TaxBondingTrade: wrong token");

        uint256 bps = ctx.isBuy
            ? ITaxTokenFeeRates(ctx.token).buyFeeRate()
            : ITaxTokenFeeRates(ctx.token).sellFeeRate();

        OpenFourTypes.FeeTier[] memory fees;
        if (bps > 0) {
            fees = new OpenFourTypes.FeeTier[](1);
            fees[0] = OpenFourTypes.FeeTier({recipient: ctx.token, bps: uint16(bps)});
        } else {
            fees = new OpenFourTypes.FeeTier[](0);
        }

        return OpenFourTypes.TradeResult({
            allowed: true,
            minAmount: 0,
            maxAmount: type(uint256).max,
            fees: fees,
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
