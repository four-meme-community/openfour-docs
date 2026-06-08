// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ITagDescriptor} from "./ITagDescriptor.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";

interface IOpenFourCurveModule is ITagDescriptor {
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

    function evaluateReverse(
        address token,
        bool isBuy,
        uint256 quoteBudget,
        uint256 remainingForSale,
        uint256 totalRaised,
        uint256 timestamp
    ) external view returns (uint256 tokenAmount, uint256 curveQuote);

    function getInitialPrice() external view returns (uint256);
    function getLastPrice(address token, uint256 remainingForSale, uint256 totalRaised) external view returns (uint256);
    function getLiquiditySnapshot(address token, uint256 remainingForSale, uint256 totalRaised)
        external
        view
        returns (OpenFourTypes.CurveLiquiditySnapshot memory snapshot);
    function getInitParams() external view returns (bytes memory);
}
