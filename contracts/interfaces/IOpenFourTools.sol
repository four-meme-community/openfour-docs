// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OpenFourTypes, ParamDescriptor, ModuleEncodeSchema} from "../libraries/OpenFourTypes.sol";

struct TradeEstimate {
    uint256 curveQuote;
    uint256 totalFee;
    uint256 userPays;
    uint256 userReceives;
    uint256 tokenAmount;
    uint256 executionPrice;
}

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

    function estimateBuy(address token, address trader, uint256 amount, uint256 options, bytes calldata proof)
        external
        view
        returns (TradeEstimate memory);
    function estimateSell(address token, address trader, uint256 amount, uint256 options, bytes calldata proof)
        external
        view
        returns (TradeEstimate memory);
    function estimateBuyByBudget(address token, address trader, uint256 maxQuotePayAmount, uint256 options, bytes calldata proof)
        external
        view
        returns (TradeEstimate memory estimate);
    function getCurveLiquiditySnapshot(address token)
        external
        view
        returns (OpenFourTypes.CurveLiquiditySnapshot memory snapshot);
    function getTokenBaseSchema() external pure returns (ParamDescriptor[] memory);
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
    function encodePresetTags(uint256 presetId) external view returns (bytes memory encodedTags);
}
