// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";
import {IOpenFourRegistry} from "./IOpenFourRegistry.sol";
import {IOpenFourFeeRouter} from "./IOpenFourFeeRouter.sol";

interface IOpenFourCore {
    event TokenCreated(
        uint256 requestId,
        uint256 indexed presetId,
        address indexed creator,
        address indexed token,
        string name,
        string symbol,
        uint256 maxSupply,
        uint256 saleAmount,
        uint256 raiseAmount,
        uint256 initialPrice,
        address quoteAsset,
        address vault,
        address curveModule,
        address tradeModule,
        address migrateModule,
        address customData,
        address tokenModule,
        string tokenMetaUri,
        uint256 flags,
        bytes encodedTags
    );

    event TradeExecuted(
        address indexed token,
        address indexed trader,
        uint256 indexed presetId,
        bool isBuy,
        address quoteAsset,
        address vault,
        uint256 requestedTokenAmount,
        uint256 tokenAmount,
        uint256 curveQuoteAmount,
        uint256 traderQuoteAmount,
        uint256 lastPrice,
        uint256 slippageLimit,
        uint256 protocolFee,
        uint256 taxFee,
        uint256 devFee,
        uint256 antiSniperFee,
        uint256 totalRaised,
        uint256 remainingForSale
    );

    event MigrateExecuted(
        uint256 indexed presetId,
        address indexed caller,
        address indexed token,
        address vault,
        address migrateModule,
        bytes8 migrateTagId,
        uint256 totalRaised,
        uint256 remainingForSale,
        bytes32 hookDataHash,
        uint8 migratedDataVersion,
        bytes encodedMigratedData
    );

    event PhaseTransition(address indexed token, OpenFourTypes.Phase from, OpenFourTypes.Phase to, address operator);
    event TokenPaused(address indexed token, bool paused);

    function createToken(bytes memory createArgs, bytes memory signature) external payable returns (address token);
    function buy(address token, uint256 amount, uint256 maxQuoteAmount, uint256 options, bytes calldata proof) external payable;
    function buyByBudget(address token, uint256 maxQuotePayAmount, uint256 minAmountOut, uint256 options, bytes calldata proof) external payable;
    function sell(address token, uint256 amount, uint256 minQuoteReceive, uint256 options, bytes calldata proof) external;
    function wrappedNative() external view returns (address);
    function feeRouter() external view returns (IOpenFourFeeRouter);
    function registry() external view returns (IOpenFourRegistry);
    function tokens(address token_)
        external
        view
        returns (
            uint32 version,
            address creator,
            uint256 presetId,
            address token,
            string memory name,
            string memory symbol,
            uint256 maxSupply,
            uint256 saleAmount,
            uint256 raiseAmount,
            address quoteAsset,
            address vault,
            address curveModule,
            address tradeModule,
            address migrateModule,
            address tokenModule,
            address customData,
            uint256 createBlock,
            bool exists,
            bool paused,
            bool antiSniperEnabled
        );
}
