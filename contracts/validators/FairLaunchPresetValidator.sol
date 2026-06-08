// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IOpenFourPresetValidator} from "../interfaces/IOpenFourPresetValidator.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";

/// @title FairLaunchPresetValidator
/// @notice Reference validator for the FairLaunch docs preset.
/// @dev Individual modules validate their own params in `init`; this contract
///      validates relationships across token, curve, trade, migrate, and custom-data
///      params before OpenFourCore creates the token.
contract FairLaunchPresetValidator is IOpenFourPresetValidator {
    uint256 private constant TOKEN_UNIT = 1e18;
    uint16 private constant MAX_BPS = 10_000;
    uint16 private constant MAX_SELL_PENALTY_BPS = 5_000;

    /// @notice Optional immutable deployment-time bounds for this preset.
    /// @param expectedPresetId Non-zero means creation must use this preset id.
    /// @param requiredQuoteAsset Non-zero means creation must use this quote asset.
    /// @param minSaleAmount Minimum allowed sale amount. Zero disables the lower bound.
    /// @param maxSaleAmount Maximum allowed sale amount. Zero disables the upper bound.
    /// @param maxRaiseAmount Maximum allowed raise amount. Zero disables the upper bound.
    struct Bounds {
        uint256 expectedPresetId;
        address requiredQuoteAsset;
        uint256 minSaleAmount;
        uint256 maxSaleAmount;
        uint256 maxRaiseAmount;
    }

    /// @dev Must match `FairLaunchCurveModule.Params`.
    struct CurveParams {
        uint256 fixedPrice;
        uint16 sellPenaltyBps;
        bool enableSell;
        uint256 minPurchase;
        uint256 maxPurchase;
    }

    /// @dev Must match `FairLaunchTradeModule.TradeConfig`.
    struct TradeConfig {
        uint256 maxBuyAmount;
        uint256 maxPerAddress;
        uint256 maxSellAmount;
        uint16 buyFeeBps;
        uint16 sellFeeBps;
        address feeRecipient;
    }

    /// @dev Must match `FairLaunchMigrateModule.InputParams`.
    struct MigrateInputParams {
        uint256 softCap;
        uint256 duration;
        address migrationAdapter;
        address lpRecipient;
        uint256 tokenLiquidityAmount;
        uint256 maxQuoteToUse;
    }

    Bounds public bounds;

    constructor(Bounds memory bounds_) {
        require(
            bounds_.maxSaleAmount == 0 || bounds_.maxSaleAmount >= bounds_.minSaleAmount,
            "FairValidator: bad sale bounds"
        );
        bounds = bounds_;
    }

    /// @notice Validates token creation params before module clones are initialized.
    function validate(
        uint256 presetId,
        OpenFourTypes.TokenInitParams calldata params
    ) external view override {
        Bounds memory b = bounds;
        if (b.expectedPresetId != 0) {
            require(presetId == b.expectedPresetId, "FairValidator: wrong preset");
        }

        _validateBaseTokenParams(params, b);

        CurveParams memory curve = abi.decode(params.curveParams, (CurveParams));
        TradeConfig memory trade = abi.decode(params.tradeParams, (TradeConfig));
        MigrateInputParams memory migrate = abi.decode(params.migrateParams, (MigrateInputParams));

        _validateCurve(params, curve);
        _validateTrade(params, curve, trade);
        _validateMigrate(params, migrate);

        require(params.tokenParams.length == 0, "FairValidator: tokenParams not empty");
        require(params.vaultParams.length == 0, "FairValidator: vaultParams not empty");
        require(params.customDataParams.length == 0, "FairValidator: customDataParams not empty");
    }

    function _validateBaseTokenParams(
        OpenFourTypes.TokenInitParams calldata params,
        Bounds memory b
    ) internal pure {
        require(bytes(params.name).length > 0, "FairValidator: empty name");
        require(bytes(params.symbol).length > 0, "FairValidator: empty symbol");
        require(params.maxSupply > 0, "FairValidator: zero maxSupply");
        require(params.saleAmount > 0, "FairValidator: zero saleAmount");
        require(params.saleAmount <= params.maxSupply, "FairValidator: sale exceeds supply");
        require(params.quoteAsset != address(0), "FairValidator: zero quoteAsset");

        if (b.requiredQuoteAsset != address(0)) {
            require(params.quoteAsset == b.requiredQuoteAsset, "FairValidator: bad quoteAsset");
        }
        if (b.minSaleAmount > 0) {
            require(params.saleAmount >= b.minSaleAmount, "FairValidator: sale below min");
        }
        if (b.maxSaleAmount > 0) {
            require(params.saleAmount <= b.maxSaleAmount, "FairValidator: sale above max");
        }
        if (b.maxRaiseAmount > 0) {
            require(params.raiseAmount <= b.maxRaiseAmount, "FairValidator: raise above max");
        }
    }

    function _validateCurve(
        OpenFourTypes.TokenInitParams calldata params,
        CurveParams memory curve
    ) internal pure {
        require(curve.fixedPrice > 0, "FairValidator: zero fixedPrice");
        require(curve.sellPenaltyBps <= MAX_SELL_PENALTY_BPS, "FairValidator: penalty too high");
        require(curve.minPurchase > 0, "FairValidator: zero minPurchase");
        require(curve.maxPurchase >= curve.minPurchase, "FairValidator: bad purchase range");
        require(curve.maxPurchase <= params.saleAmount, "FairValidator: maxPurchase too large");

        uint256 expectedRaiseAmount = Math.mulDiv(params.saleAmount, curve.fixedPrice, TOKEN_UNIT);
        require(params.raiseAmount == expectedRaiseAmount, "FairValidator: raiseAmount mismatch");
    }

    function _validateTrade(
        OpenFourTypes.TokenInitParams calldata params,
        CurveParams memory curve,
        TradeConfig memory trade
    ) internal pure {
        require(trade.maxBuyAmount > 0, "FairValidator: zero maxBuyAmount");
        require(trade.maxBuyAmount >= curve.minPurchase, "FairValidator: maxBuy below min");
        require(trade.maxBuyAmount <= curve.maxPurchase, "FairValidator: maxBuy above curve cap");
        require(trade.buyFeeBps <= MAX_BPS && trade.sellFeeBps <= MAX_BPS, "FairValidator: fee too high");
        require(
            (trade.buyFeeBps == 0 && trade.sellFeeBps == 0) || trade.feeRecipient != address(0),
            "FairValidator: zero feeRecipient"
        );

        if (trade.maxPerAddress > 0) {
            require(trade.maxPerAddress >= curve.minPurchase, "FairValidator: wallet cap below min");
            require(trade.maxPerAddress <= params.saleAmount, "FairValidator: wallet cap too large");
            // The FairLaunch preset must include FairLaunchCustomDataModule when
            // maxPerAddress is enabled, because TradeModule reads cumulative state from it.
        }
        if (!curve.enableSell) {
            require(trade.maxSellAmount == 0 && trade.sellFeeBps == 0, "FairValidator: sell config disabled");
        }
    }

    function _validateMigrate(
        OpenFourTypes.TokenInitParams calldata params,
        MigrateInputParams memory migrate
    ) internal pure {
        require(migrate.softCap == 0 || migrate.softCap <= params.raiseAmount, "FairValidator: softCap too high");
        require(
            migrate.maxQuoteToUse == 0 || migrate.maxQuoteToUse <= params.raiseAmount,
            "FairValidator: maxQuote too high"
        );
        if (migrate.migrationAdapter != address(0)) {
            require(migrate.lpRecipient != address(0), "FairValidator: zero lpRecipient");
            require(migrate.tokenLiquidityAmount > 0, "FairValidator: zero tokenLiquidity");
            require(migrate.tokenLiquidityAmount <= params.maxSupply - params.saleAmount, "FairValidator: liquidity too high");
        } else {
            require(migrate.tokenLiquidityAmount == 0, "FairValidator: unused tokenLiquidity");
        }
    }
}
