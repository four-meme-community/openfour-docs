// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IOpenFourTradeModule} from "../../interfaces/IOpenFourTradeModule.sol";
import {IOpenFourModuleSchema} from "../../interfaces/IOpenFourModuleSchema.sol";
import {IOpenFourToken} from "../../interfaces/IOpenFourToken.sol";
import {OpenFourTypes, ParamDescriptor, ModuleEncodeSchema} from "../../libraries/OpenFourTypes.sol";

/// @dev Minimal read interface implemented by `FairLaunchCustomDataModule`.
interface IFairLaunchCustomDataView {
    function totalPurchased(address trader) external view returns (uint256);
}

/// @title FairLaunchTradeModule
/// @notice Reference trade-policy module for the OpenFour FairLaunch preset.
/// @dev The current OpenFour trade interface is deliberately stateless: it returns trade bounds
///      and optional fee tiers for the Core to enforce. This module may read custom-data state,
///      but the state itself is written by `FairLaunchCustomDataModule.afterHook`.
contract FairLaunchTradeModule is Initializable, IOpenFourTradeModule, IOpenFourModuleSchema {
    uint16 private constant MAX_BPS = 10_000;

    /// @notice ABI-encoded trade configuration supplied through token creation params.
    /// @param maxBuyAmount Maximum token amount Core should execute for a single buy.
    /// @param maxPerAddress Optional cumulative buy cap read from the token's custom-data module. Zero disables it.
    /// @param maxSellAmount Maximum token amount Core should execute for a single sell. Zero means unlimited.
    /// @param buyFeeBps Additional buy fee, in basis points, routed by OpenFour fee handling.
    /// @param sellFeeBps Additional sell fee, in basis points, routed by OpenFour fee handling.
    /// @param feeRecipient Recipient for the optional buy/sell fee tiers.
    struct TradeConfig {
        uint256 maxBuyAmount;
        uint256 maxPerAddress;
        uint256 maxSellAmount;
        uint16 buyFeeBps;
        uint16 sellFeeBps;
        address feeRecipient;
    }

    address public boundToken;
    address public fourCore;
    TradeConfig public config;
    bytes private _initParams;
    string private _moduleVersion;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes this module clone for one OpenFour token.
    /// @dev `rawParams` must be `abi.encode(TradeConfig)`. The module version is stored for registry display.
    function init(address token, address fourCore_, bytes calldata rawParams, string calldata moduleVersion_)
        external
        override
        initializer
    {
        require(fourCore_ != address(0), "FairTrade: zero fourCore");
        TradeConfig memory c = abi.decode(rawParams, (TradeConfig));
        require(c.maxBuyAmount > 0, "FairTrade: invalid maxBuyAmount");
        require(c.buyFeeBps <= MAX_BPS && c.sellFeeBps <= MAX_BPS, "FairTrade: fee too high");
        require((c.buyFeeBps == 0 && c.sellFeeBps == 0) || c.feeRecipient != address(0), "FairTrade: zero feeRecipient");

        boundToken = token;
        fourCore = fourCore_;
        config = c;
        _initParams = rawParams;
        _moduleVersion = moduleVersion_;
    }

    /// @notice Returns the stable registry tag and the version captured at initialization.
    function descriptor() external view override returns (bytes8 tagId, string memory tag, string memory version) {
        tag = "module.trade.fair_launch";
        return (bytes8(keccak256(bytes(tag))), tag, _moduleVersion);
    }

    /// @notice Evaluates whether a buy or sell is allowed and returns Core-enforced limits.
    /// @dev `maxAmount` is a per-trade cap. This module intentionally does not try to track
    ///      per-address totals itself because `evaluate` is view-only in the latest architecture.
    function evaluate(OpenFourTypes.TradeContext calldata ctx)
        external
        view
        override
        returns (OpenFourTypes.TradeResult memory)
    {
        require(fourCore != address(0), "FairTrade: not initialized");
        require(ctx.token == boundToken, "FairTrade: wrong token");

        if (ctx.isBuy) {
            return _evaluateBuy(ctx);
        }
        return _evaluateSell();
    }

    /// @notice Describes the ABI layout expected by `init`.
    /// @dev Off-chain builders can use this schema to render forms and encode `TradeConfig`.
    function moduleEncodeSchema() external pure override returns (ModuleEncodeSchema memory) {
        ParamDescriptor[] memory p = new ParamDescriptor[](6);
        p[0] = ParamDescriptor({
            name: "maxBuyAmount",
            abiType: "uint256",
            decimals: 0,
            optional: false,
            title: "Max buy amount (token units)",
            defaultValue: "1000",
            hint: "",
            minValue: "1",
            maxValue: ""
        });
        p[1] = ParamDescriptor({
            name: "maxPerAddress",
            abiType: "uint256",
            decimals: 0,
            optional: true,
            title: "Max cumulative buy per address (token units)",
            defaultValue: "0",
            hint: "0 disables the cumulative cap. Requires FairLaunchCustomDataModule when enabled.",
            minValue: "0",
            maxValue: ""
        });
        p[2] = ParamDescriptor({
            name: "maxSellAmount",
            abiType: "uint256",
            decimals: 0,
            optional: true,
            title: "Max sell amount (token units)",
            defaultValue: "0",
            hint: "0 means unlimited.",
            minValue: "0",
            maxValue: ""
        });
        p[3] = ParamDescriptor({
            name: "buyFeeBps",
            abiType: "uint16",
            decimals: 0,
            optional: true,
            title: "Buy fee (bps)",
            defaultValue: "0",
            hint: "0-10000 bps.",
            minValue: "0",
            maxValue: "10000"
        });
        p[4] = ParamDescriptor({
            name: "sellFeeBps",
            abiType: "uint16",
            decimals: 0,
            optional: true,
            title: "Sell fee (bps)",
            defaultValue: "0",
            hint: "0-10000 bps.",
            minValue: "0",
            maxValue: "10000"
        });
        p[5] = ParamDescriptor({
            name: "feeRecipient",
            abiType: "address",
            decimals: 0,
            optional: true,
            title: "Fee recipient",
            defaultValue: "",
            hint: "Required when buyFeeBps or sellFeeBps is non-zero.",
            minValue: "",
            maxValue: ""
        });
        return ModuleEncodeSchema("trade", 1, p);
    }

    /// @notice Returns the raw ABI-encoded params used to initialize this module clone.
    function getInitParams() external view returns (bytes memory) {
        return _initParams;
    }

    /// @dev Buy path uses the configured per-trade buy cap and optional buy fee.
    function _evaluateBuy(OpenFourTypes.TradeContext calldata ctx) internal view returns (OpenFourTypes.TradeResult memory) {
        uint256 maxAmount = config.maxBuyAmount;
        if (config.maxPerAddress > 0) {
            address customData = IOpenFourToken(ctx.token).customData();
            if (customData == address(0)) {
                return _blocked("Missing custom data");
            }

            uint256 purchased = IFairLaunchCustomDataView(customData).totalPurchased(ctx.trader);
            if (purchased >= config.maxPerAddress) {
                return _blocked("Reached cumulative buy limit");
            }

            uint256 remaining = config.maxPerAddress - purchased;
            if (remaining < maxAmount) maxAmount = remaining;
        }
        return _allowed(maxAmount, config.buyFeeBps);
    }

    /// @dev Sell path treats zero max sell amount as unlimited for simpler preset configuration.
    function _evaluateSell() internal view returns (OpenFourTypes.TradeResult memory) {
        uint256 maxAmount = config.maxSellAmount == 0 ? type(uint256).max : config.maxSellAmount;
        return _allowed(maxAmount, config.sellFeeBps);
    }

    /// @dev Builds a successful trade result with zero or one extra fee tier.
    function _allowed(uint256 maxAmount, uint16 feeBps) internal view returns (OpenFourTypes.TradeResult memory) {
        OpenFourTypes.FeeTier[] memory fees;
        if (feeBps > 0) {
            fees = new OpenFourTypes.FeeTier[](1);
            fees[0] = OpenFourTypes.FeeTier({recipient: config.feeRecipient, bps: feeBps});
        } else {
            fees = new OpenFourTypes.FeeTier[](0);
        }

        return OpenFourTypes.TradeResult({allowed: true, minAmount: 0, maxAmount: maxAmount, fees: fees, reason: ""});
    }

    /// @dev Builds a failed trade result with no fee tiers.
    function _blocked(string memory reason) internal pure returns (OpenFourTypes.TradeResult memory) {
        return OpenFourTypes.TradeResult({
            allowed: false,
            minAmount: 0,
            maxAmount: 0,
            fees: new OpenFourTypes.FeeTier[](0),
            reason: reason
        });
    }
}
