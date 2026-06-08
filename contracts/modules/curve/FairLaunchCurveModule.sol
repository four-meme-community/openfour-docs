// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IOpenFourCurveModule} from "../../interfaces/IOpenFourCurveModule.sol";
import {IOpenFourModuleSchema} from "../../interfaces/IOpenFourModuleSchema.sol";
import {OpenFourTypes, ParamDescriptor, ModuleEncodeSchema} from "../../libraries/OpenFourTypes.sol";

/// @title FairLaunchCurveModule
/// @notice Reference fixed-price curve module for the OpenFour FairLaunch preset.
/// @dev Curve modules are stateless with respect to trades: OpenFourCore passes all live sale
///      accounting through `CurveContext`, and this module only returns price and execution bounds.
contract FairLaunchCurveModule is Initializable, IOpenFourCurveModule, IOpenFourModuleSchema {
    /// @dev OpenFour token amounts are expected to be 18-decimal token units in this skeleton.
    uint256 private constant TOKEN_UNIT = 1e18;
    /// @dev Keep the example penalty bounded so sell quotes cannot be accidentally configured to zero.
    uint16 private constant MAX_PENALTY_BPS = 5000;
    uint16 private constant BPS_DENOMINATOR = 10_000;

    /// @notice ABI-encoded curve configuration supplied through token creation params.
    /// @param fixedPrice Quote amount paid per 1 token unit.
    /// @param sellPenaltyBps Discount applied to sells, in basis points.
    /// @param enableSell Whether users may sell back into the fair-launch curve.
    /// @param minPurchase Minimum token amount accepted for a buy.
    /// @param maxPurchase Maximum token amount accepted for a buy.
    struct Params {
        uint256 fixedPrice;
        uint16 sellPenaltyBps;
        bool enableSell;
        uint256 minPurchase;
        uint256 maxPurchase;
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

    /// @notice Initializes this module clone for one OpenFour token.
    /// @dev The latest OpenFour module pattern stores the raw init params and module version so
    ///      indexers and UIs can reconstruct the exact module configuration.
    function init(
        address token,
        address fourCore_,
        OpenFourTypes.TokenCreateParams calldata tokenParams,
        bytes calldata rawParams,
        string calldata moduleVersion_
    ) external override initializer {
        require(fourCore_ != address(0), "FairCurve: zero fourCore");
        Params memory p = abi.decode(rawParams, (Params));
        require(p.fixedPrice > 0, "FairCurve: invalid fixedPrice");
        require(tokenParams.saleAmount > 0, "FairCurve: invalid saleAmount");
        require(p.sellPenaltyBps <= MAX_PENALTY_BPS, "FairCurve: penalty too high");
        require(p.minPurchase > 0 && p.maxPurchase >= p.minPurchase, "FairCurve: invalid purchase range");

        boundToken = token;
        fourCore = fourCore_;
        params = p;
        _initParams = rawParams;
        _moduleVersion = moduleVersion_;
    }

    /// @notice Returns the stable registry tag and the version captured at initialization.
    function descriptor() external view override returns (bytes8 tagId, string memory tag, string memory version) {
        tag = "module.curve.fair_launch";
        return (bytes8(keccak256(bytes(tag))), tag, _moduleVersion);
    }

    /// @notice Prices a requested buy or sell using a fixed unit price.
    /// @dev `adjustedAmount` is always zero here because this example either accepts the full
    ///      requested amount or rejects it. Curves that partially fill should return the adjusted amount.
    function evaluate(OpenFourTypes.CurveContext calldata ctx)
        external
        view
        override
        returns (OpenFourTypes.CurveResult memory)
    {
        require(fourCore != address(0), "FairCurve: not initialized");
        require(ctx.token == boundToken, "FairCurve: wrong token");
        if (ctx.amount == 0) {
            return OpenFourTypes.CurveResult(false, 0, 0, "amount is zero");
        }

        if (ctx.isBuy) {
            if (ctx.remainingForSale < ctx.amount) {
                return OpenFourTypes.CurveResult(false, 0, 0, "Insufficient supply for sale");
            }
            if (ctx.amount < params.minPurchase) {
                return OpenFourTypes.CurveResult(false, 0, 0, "Below min purchase");
            }
            if (ctx.amount > params.maxPurchase) {
                return OpenFourTypes.CurveResult(false, 0, 0, "Exceeds max purchase");
            }
            return OpenFourTypes.CurveResult(true, _quoteAtPrice(ctx.amount, params.fixedPrice), 0, "");
        }

        if (!params.enableSell) {
            return OpenFourTypes.CurveResult(false, 0, 0, "Sell not enabled");
        }
        return OpenFourTypes.CurveResult(true, _quoteAtPrice(ctx.amount, _sellPrice()), 0, "");
    }

    /// @notice Converts a quote budget into the largest buy amount accepted by this fixed-price curve.
    /// @dev Reverse quotes are optional for UI convenience. Sells return zero because the common UI path
    ///      is "buy with this quote budget" rather than "sell for this quote budget".
    function evaluateReverse(
        address token,
        bool isBuy,
        uint256 quoteBudget,
        uint256 remainingForSale,
        uint256,
        uint256
    ) external view override returns (uint256 tokenAmount, uint256 curveQuote) {
        require(fourCore != address(0), "FairCurve: not initialized");
        require(token == boundToken, "FairCurve: wrong token");
        if (!isBuy || quoteBudget == 0 || remainingForSale == 0) {
            return (0, 0);
        }

        tokenAmount = Math.mulDiv(quoteBudget, TOKEN_UNIT, params.fixedPrice);
        if (tokenAmount > remainingForSale) tokenAmount = remainingForSale;
        if (tokenAmount > params.maxPurchase) tokenAmount = params.maxPurchase;
        if (tokenAmount < params.minPurchase) return (0, 0);
        curveQuote = _quoteAtPrice(tokenAmount, params.fixedPrice);
    }

    /// @notice Describes the ABI layout expected by `init`.
    /// @dev Off-chain builders can use this schema to render forms and encode `Params`.
    function moduleEncodeSchema() external pure override returns (ModuleEncodeSchema memory) {
        ParamDescriptor[] memory p = new ParamDescriptor[](5);
        p[0] = ParamDescriptor({
            name: "fixedPrice",
            abiType: "uint256",
            decimals: 18,
            optional: false,
            title: "Fixed price (quote/token)",
            defaultValue: "0.0001",
            hint: "",
            minValue: "0",
            maxValue: ""
        });
        p[1] = ParamDescriptor({
            name: "sellPenaltyBps",
            abiType: "uint16",
            decimals: 0,
            optional: true,
            title: "Sell penalty (bps)",
            defaultValue: "500",
            hint: "0-5000 bps",
            minValue: "0",
            maxValue: "5000"
        });
        p[2] = ParamDescriptor({
            name: "enableSell",
            abiType: "bool",
            decimals: 0,
            optional: false,
            title: "Enable sells",
            defaultValue: "true",
            hint: "",
            minValue: "",
            maxValue: ""
        });
        p[3] = ParamDescriptor({
            name: "minPurchase",
            abiType: "uint256",
            decimals: 0,
            optional: false,
            title: "Minimum purchase (token units)",
            defaultValue: "0.1",
            hint: "",
            minValue: "0",
            maxValue: ""
        });
        p[4] = ParamDescriptor({
            name: "maxPurchase",
            abiType: "uint256",
            decimals: 0,
            optional: false,
            title: "Maximum purchase (token units)",
            defaultValue: "100",
            hint: "",
            minValue: "0",
            maxValue: ""
        });
        return ModuleEncodeSchema("curve", 1, p);
    }

    /// @notice Returns the raw ABI-encoded params used to initialize this module clone.
    function getInitParams() external view returns (bytes memory) {
        return _initParams;
    }

    /// @notice Returns the launch price for one token unit.
    function getInitialPrice() external view override returns (uint256) {
        require(fourCore != address(0), "FairCurve: not initialized");
        return params.fixedPrice;
    }

    /// @notice Returns the current display price.
    /// @dev A fixed-price curve has no price movement, so last price equals initial price.
    function getLastPrice(address token, uint256, uint256) external view override returns (uint256) {
        require(fourCore != address(0), "FairCurve: not initialized");
        require(token == boundToken, "FairCurve: wrong token");
        return params.fixedPrice;
    }

    /// @notice Returns a lightweight liquidity snapshot for UIs.
    /// @dev There is no virtual liquidity in this fixed-price example, so only sale state and price are populated.
    function getLiquiditySnapshot(address token, uint256 remainingForSale, uint256 totalRaised)
        external
        view
        override
        returns (OpenFourTypes.CurveLiquiditySnapshot memory snapshot)
    {
        require(fourCore != address(0), "FairCurve: not initialized");
        require(token == boundToken, "FairCurve: wrong token");
        snapshot.available = true;
        snapshot.remainingForSale = remainingForSale;
        snapshot.totalRaised = totalRaised;
        snapshot.lastPrice = params.fixedPrice;
    }

    /// @dev Applies the configured sell discount to the fixed buy price.
    function _sellPrice() internal view returns (uint256) {
        return (params.fixedPrice * (BPS_DENOMINATOR - params.sellPenaltyBps)) / BPS_DENOMINATOR;
    }

    /// @dev Multiplies before dividing using full precision to avoid overflow on large token amounts.
    function _quoteAtPrice(uint256 tokenAmount, uint256 unitPrice) internal pure returns (uint256) {
        return Math.mulDiv(tokenAmount, unitPrice, TOKEN_UNIT);
    }
}
