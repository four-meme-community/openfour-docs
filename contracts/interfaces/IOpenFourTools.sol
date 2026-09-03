// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OpenFourTypes, ParamDescriptor, ModuleEncodeSchema} from "../libraries/OpenFourTypes.sol";

struct TradeEstimate {
    uint256 curveQuote;     // curve quote (what vault receives/pays)
    uint256 totalFee;       // buy: protocol+tax+developer+antiSniper | sell: protocol+tax+developer (no anti)
    uint256 userPays;       // buy: quote cost; with zap option: required native input | sell: 0
    uint256 userReceives;   // buy: 0 | sell: net quote; with zap option: expected native output
    uint256 tokenAmount;    // effective token amount evaluated by curve/trade modules
    uint256 executionPrice; // unit price (curveQuote * 1e18 / amount)
}

/// @notice Public helpers for token creation schemas, tags, liquidity snapshots, and trade estimates.
/// @dev Trade-estimate functions are intentionally non-view because native zap estimates may call
///      a V3 quoter whose interface is non-view. Off-chain ethers v6 clients must invoke them with
///      `method.staticCall(...)` (ethers v5: `contract.callStatic.method(...)`).
interface IOpenFourTools {
    function getCreateTokenSigningPayload(
        address caller,
        uint256 requestId,
        uint256 presetId,
        uint256 validTimestamp,
        uint256 createFee,
        uint256 presaleQuote,
        bool antiSniperEnabled,
        OpenFourTypes.TokenInitParams calldata initParams
    ) external view returns (bytes memory);

    /// @param options bit1 converts quote-denominated `userPays` into the native input required by exact-output.
    /// @dev With bit1, `curveQuote` and `totalFee` remain quote-denominated while `userPays` is
    ///      native-denominated. Use an off-chain static call even when bit1 is not set.
    function estimateBuy(address token, address trader, uint256 amount, uint256 options, bytes calldata proof)
        external returns (TradeEstimate memory);

    /// @param options bit1 converts non-WBNB quote through ZapRouter; bit0+bit1 keeps WBNB,
    ///        while bit1 alone unwraps to BNB. Both have the same numeric `userReceives`.
    /// @dev Non-view because a configured V3 Quoter may be non-view. Off-chain clients must use
    ///      a static call even when bit1 is not set.
    function estimateSell(address token, address trader, uint256 amount, uint256 options, bytes calldata proof)
        external returns (TradeEstimate memory);

    /// @notice Given a spend budget—or a native BNB budget when options bit1 is set—return how many tokens can be bought.
    /// @dev With bit1, the input and `userPays` are native-denominated; `curveQuote` and `totalFee`
    ///      remain quote-denominated. For the current Core native-zap execution, pass native value
    ///      through `msg.value` and use `curveQuote + totalFee` as Core's quote-denominated
    ///      `buyByBudget.maxPayAmount`.
    ///      This function is non-view because a configured V3 Quoter may be non-view; off-chain
    ///      clients must use a static call even when bit1 is not set.
    /// @param maxPayAmount Spend budget. Unit follows `options` (vault quote, or native when bit1 zap).
    function estimateBuyByBudget(
        address token,
        address trader,
        uint256 maxPayAmount,
        uint256 options,
        bytes calldata proof
    )
        external
        returns (TradeEstimate memory estimate);

    /// @notice Returns on-chain liquidity snapshot for off-chain pricing/replay.
    /// @dev Curve-specific values are calculated by `curveModule` directly.
    function getCurveLiquiditySnapshot(address token)
        external
        view
        returns (OpenFourTypes.CurveLiquiditySnapshot memory snapshot);

    /// @notice Returns fixed base fields for token-create forms.
    function getTokenBaseSchema() external pure returns (ParamDescriptor[] memory);

    /// @notice Returns module encode schemas for a preset (token/vault/curve/trade/migrate/customData).
    function getPresetEncodeSchemas(uint256 presetId)
        external
        view
        returns (
            ModuleEncodeSchema memory tokenSchema,
            ModuleEncodeSchema memory vaultSchema,
            ModuleEncodeSchema memory curveSchema,
            ModuleEncodeSchema memory tradeSchema,
            ModuleEncodeSchema memory migrateSchema,
            ModuleEncodeSchema memory customDataSchema
        );

    /// @notice Returns `IOpenFourCore.TokenCreated.encodedTags` for a preset (57 bytes).
    /// @dev Mirrors `OpenFourCoreLib._encodeCreationTags` using registry implementations:
    ///      token impl + module impl `ITagDescriptor.descriptor().tagId` slots (customData zero when unset).
    function encodePresetTags(uint256 presetId) external view returns (bytes memory encodedTags);
}
