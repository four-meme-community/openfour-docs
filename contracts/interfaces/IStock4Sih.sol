// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PoolKey, Currency} from "./iv4/IV4Core.sol";

/// @notice Hardhat-side ABI of the Stock4 Shared Inventory Hook family (sources: contracts/stock4/sih, Foundry).
struct SihPoolConfig {
    bool enabled;
    int24 tickLower;
    int24 tickUpper;
    uint128 liquidity;
}

/// @dev `CLSharedInventoryHookOwner` (role-based owner of the hook) — only the calls OpenFour uses.
interface ISihHookOwner {
    function hook() external view returns (address);
    function setPoolTaxToken(PoolKey calldata key, address taxToken) external;
    function setUninitializePoolConfigAndInitialize(
        PoolKey calldata key,
        SihPoolConfig calldata cfg,
        uint160 sqrtPriceX96,
        bool checkSolvency
    ) external returns (uint256 required0, uint256 required1, int24 tick);
    function setPoolConfig(
        bytes32 id,
        SihPoolConfig calldata cfg,
        bool checkSolvency,
        uint256 maxRequired0,
        uint256 maxRequired1
    ) external returns (uint256 required0, uint256 required1);
    function withdraw(Currency[] calldata currencies, uint256[] calldata amounts, address to) external;
}

/// @dev `CLSharedInventoryHook` views used by the manager.
interface ISihHook {
    function getPoolConfig(bytes32 id) external view returns (SihPoolConfig memory);
    /// @dev Amounts (currency0, currency1) that injecting `cfg` costs at `sqrtPriceX96`, +1 wei per side.
    function requiredInventory(SihPoolConfig calldata cfg, uint160 sqrtPriceX96)
        external
        pure
        returns (uint256 amount0, uint256 amount1);
}

/// @dev `CLPoolManager.getSlot0` (not on the minimal IV4Core `IPoolManager`).
interface ICLPoolSlot0 {
    function getSlot0(bytes32 id)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
}

interface ISihHookMonitor {
    function addPool(bytes32 id) external;
}

/// @dev Graduation / migration hub shared by all `PancakeSwapV4SihMigrateModule` clones.
interface IStock4SihManager {
    function hookOf(address quote) external view returns (address);
    function stockOfToken(address token) external view returns (address);
    function graduate(address token, uint256 memeAmount, uint256 quoteAmount) external returns (bytes32 poolId);
    function graduateUntaxed(address token, uint256 memeAmount, uint256 quoteAmount) external returns (bytes32 poolId);
    function untaxed(address token) external view returns (bool);
    function extraSihRoutes() external view returns (address[] memory);
    function quoteOf(address token) external view returns (address quote, PoolKey memory key);
    function poolKeyOf(address token, address quote) external view returns (PoolKey memory);
    function addTaxLiquidity(address token, uint256 memeAmount, uint256 quoteAmount) external returns (uint128 addedL);
    function convertForMigration(address token, uint256 amount) external returns (address bStock);
}

interface IStock4SihMigrateModule {
    function setSisterQuote(address sister) external;
    function cutoverQuote(address newQuote, address converter) external;
}

/// @dev Stock4 tax token graduating into the SIH. `sihTaxRates` / `onSihTax` mirror the hook-side `ISihTaxToken`
///      (contracts/stock4/sih, separate Foundry project).
interface IStock4SihTaxToken {
    function configureSih(address hook, address[] calldata routes) external;
    function setSisterQuote(address sister) external;
    function cutoverQuote(address newQuote, address converter) external;
    function absorbSisterTax() external;
    function sihTaxRates(address counterAsset) external view returns (uint16 buyBps, uint16 sellBps);
    function onSihTax(address currency, uint256 amount) external;
}
