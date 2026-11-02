// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ITagDescriptor} from "./ITagDescriptor.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";

interface IOpenFourCurveModule is ITagDescriptor {
    /// @param moduleVersion Registry `ModuleMetadata.version` at create time (snapshot).
    function init(
        address token,
        address fourCore,
        OpenFourTypes.TokenCreateParams calldata tokenParams,
        bytes calldata params,
        string calldata moduleVersion
    ) external;

    function evaluate(OpenFourTypes.CurveContext calldata ctx)
        external
        view
        returns (OpenFourTypes.CurveResult memory);

    /// @notice Reverse evaluation: given a quote budget, return how many tokens can be bought.
    function evaluateReverse(
        address token,
        bool isBuy,
        uint256 quoteBudget,
        uint256 remainingForSale,
        uint256 totalRaised,
        uint256 timestamp
    ) external view returns (uint256 tokenAmount, uint256 curveQuote);

    /// @notice Returns initial buy price in quote per 1 token (1e18 token unit).
    function getInitialPrice() external view returns (uint256);

    /// @notice Returns current last price in quote per 1 token (1e18 token unit),
    ///         derived from post-trade runtime state.
    function getLastPrice(address token, uint256 remainingForSale, uint256 totalRaised) external view returns (uint256);

    /// @notice Returns curve-module-computed liquidity snapshot for off-chain replay.
    function getLiquiditySnapshot(address token, uint256 remainingForSale, uint256 totalRaised)
        external
        view
        returns (OpenFourTypes.CurveLiquiditySnapshot memory snapshot);

    function getInitParams() external view returns (bytes memory);
}
