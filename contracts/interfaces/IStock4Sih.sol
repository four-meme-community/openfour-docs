// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Aggregator-facing ABI for Stock4 SIH manager / tax token views and events.
/// @dev Field layout matches PancakeSwap Infinity `PoolKey` (currency0/1, hooks, poolManager, fee, parameters).

struct SihPoolKey {
    address currency0;
    address currency1;
    address hooks;
    address poolManager;
    uint24 fee;
    bytes32 parameters;
}

struct SihSet {
    address hookOwner;
    address monitor;
    address bStock;
    address converter;
}

/// @dev `Stock4SihManager` — discovery / routing views + cutover signals.
interface IStock4SihManager {
    event MemePoolCreated(
        address indexed token,
        address indexed quote,
        bytes32 poolId,
        uint160 sqrtPriceX96,
        uint128 liquidity
    );
    event MigrationStep(
        address indexed token,
        uint128 liquidityStock4,
        uint128 liquidityBStock,
        uint256 converted
    );
    event QuoteCutover(address indexed token, address indexed bStock);
    event SihSetConfigured(address indexed stock4, SihSet set);

    function quoteOf(address token) external view returns (address quote, SihPoolKey memory key);
    function poolKeyOf(address token, address quote) external view returns (SihPoolKey memory);
    function stockOfToken(address token) external view returns (address);
    function untaxed(address token) external view returns (bool);
    function hookOf(address quote) external view returns (address);
}

/// @dev Taxed meme views used for off-chain quote reconstruction.
interface IStock4SihTaxToken {
    function sihTaxRates(address counterAsset) external view returns (uint16 buyBps, uint16 sellBps);
    function quote() external view returns (address);
}
