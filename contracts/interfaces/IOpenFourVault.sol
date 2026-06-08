// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ITagDescriptor} from "./ITagDescriptor.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";

interface IOpenFourVault is ITagDescriptor {
    function init(
        address token,
        address fourCore,
        address creator,
        address migrateModule,
        OpenFourTypes.TokenCreateParams calldata tokenParams,
        bytes calldata vaultParams,
        string calldata moduleVersion
    ) external;

    function tokenAddress() external view returns (address);
    function token() external view returns (address);
    function quoteAsset() external view returns (address);
    function wrappedNative() external view returns (address);
    function fourCore() external view returns (address);
    function phase() external view returns (OpenFourTypes.Phase);
    function totalRaised() external view returns (uint256);
    function antiSniperQuoteAccrued() external view returns (uint256);
    function initialSaleAmount() external view returns (uint256);
    function remainingForSale() external view returns (uint256);
    function isSoldOut() external view returns (bool);
    function soldAmount() external view returns (uint256);
    function getInitParams() external view returns (bytes memory);
    function onBuy(OpenFourTypes.VaultTradeParams calldata p) external returns (uint256, uint256);
    function onSell(OpenFourTypes.VaultTradeParams calldata p) external returns (uint256, uint256);
    function setPhase(OpenFourTypes.Phase newPhase) external;
    function transferQuote(address to, uint256 amount) external;
    function transferQuoteForMigration(address to, uint256 amount) external;
    function transferTokenForMigration(address to, uint256 amount) external;
    function burnToken(uint256 amount) external;
}
