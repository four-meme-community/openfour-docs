// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IStockTokenRegistry
/// @notice Public allowlist + RFQ pricing config for stock (RWA) tokens used by the stock-dividend strategy.
interface IStockTokenRegistry {
    struct StockMeta {
        bool enabled; // in allowlist and currently usable (platform kill-switch)
        uint8 stockDecimals; // ERC20 decimals of the stock token
        uint16 premiumBps; // premium paid to solver above oracle value (RFQ incentive)
        uint32 maxStaleness; // max seconds since feed update before quotes revert
        address priceFeed; // Chainlink-style stock/USD feed
        uint256 dailyLimitQuote; // @custom:deprecated no longer enforced (was: max quote paid per day; 0 = unlimited); kept for struct/storage layout
        string symbol; // display only
    }

    function isAllowed(address stock) external view returns (bool);

    function isSolver(address solver) external view returns (bool);

    /// @notice Whether the solver whitelist is enforced (default true). When false, fillStock is permissionless.
    function solverWhitelistEnabled() external view returns (bool);

    /// @notice Effective fill permission for `solver`: allowlist membership when enforced, else always true.
    function isSolverAllowed(address solver) external view returns (bool);

    function getStock(address stock) external view returns (StockMeta memory);

    /// @notice Global anti-dust threshold: stock pools below this are skipped in distribution.
    function minStockAmount() external view returns (uint256);

    /// @notice USD feed for one non-USD-pegged quote asset.
    function quoteUsdFeed(address quote) external view returns (address);

    /// @notice Whether an ERC-20 quote is platform-approved to settle at a fixed 1 USD per token.
    function isUsdPeggedQuote(address quote) external view returns (bool);
}
