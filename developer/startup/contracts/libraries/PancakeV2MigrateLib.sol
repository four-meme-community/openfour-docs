// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OpenFourTypes} from "./OpenFourTypes.sol";

interface IPancakeV2RouterMeta {
    function factory() external view returns (address);
}

interface IPancakeV2FactoryLike {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
    function createPair(address tokenA, address tokenB) external returns (address pair);
}

interface IPancakeV2PairLike {
    function totalSupply() external view returns (uint256);
    function mint(address to) external returns (uint256 liquidity);
}

interface IOpenFourVaultMigration {
    function transferQuoteForMigration(address to, uint256 amount) external;
    function transferTokenForMigration(address to, uint256 amount) external;
}

/// @dev Public FairLaunch copy of the OpenFour PCS V2 graduation path.
///      Transfer both sides straight into an empty V2 pair, then `pair.mint`.
///      This is not bonding-curve source and does not go through the router `addLiquidity`.
library PancakeV2MigrateLib {
    struct LiqParams {
        address router;
        address lpRecipient;
        uint256 tokenLiquidityAmount;
        uint256 quoteToUse;
    }

    function executePancakeLiquidity(LiqParams memory p, OpenFourTypes.MigrateHookContext calldata ctx)
        internal
        returns (address pair)
    {
        require(ctx.token != address(0), "PancakeMigrate: zero token");
        if (p.router == address(0)) {
            return address(0);
        }
        require(ctx.vault != address(0), "PancakeMigrate: zero vault");
        require(ctx.quoteAsset != address(0), "PancakeMigrate: zero quote");
        require(p.quoteToUse > 0, "PancakeMigrate: zero quote liquidity");
        require(p.tokenLiquidityAmount > 0, "PancakeMigrate: zero token liquidity");

        address factory = IPancakeV2RouterMeta(p.router).factory();
        require(factory != address(0), "PancakeMigrate: zero factory");
        pair = IPancakeV2FactoryLike(factory).getPair(ctx.token, ctx.quoteAsset);
        if (pair == address(0)) {
            pair = IPancakeV2FactoryLike(factory).createPair(ctx.token, ctx.quoteAsset);
        }
        require(pair != address(0), "PancakeMigrate: pair not created");
        require(IPancakeV2PairLike(pair).totalSupply() == 0, "PancakeMigrate: non-empty pool");

        IOpenFourVaultMigration(ctx.vault).transferTokenForMigration(pair, p.tokenLiquidityAmount);
        IOpenFourVaultMigration(ctx.vault).transferQuoteForMigration(pair, p.quoteToUse);

        uint256 liquidity = IPancakeV2PairLike(pair).mint(p.lpRecipient);
        require(liquidity > 0, "PancakeMigrate: zero liquidity minted");
    }
}
