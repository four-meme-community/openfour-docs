// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ITaxTokenBonding
/// @notice Hooks for TaxToken during bonding (Trading phase). Not used after migration.
/// @dev Intended callers:
///      - `TaxBondingVault` → `onBondingTrade` after each `onBuy` / `onSell` settlement
///      - `BondingTaxPcsV2MigrateModule` → `onMigrate` after liquidity is added
interface ITaxTokenBonding {
    /// @notice Credit bonding quote tax into `feeAccumulated` (from FeeRouter `taxFee`). Does not dispatch.
    /// @param taxQuote Quote tax amount for this trade (must match Core `TradePaymentResult.taxFee`).
    /// @param isBuy True when called from `onBuy`, false from `onSell` (reserved for future use).
    function onBondingTrade(uint256 taxQuote, bool isBuy) external;

    /// @notice Migration hook: flush deferred burn/LP (`feeToBurn` / `feeToLiquidity`). Does not dispatch
    ///         `feeAccumulated`; post-migrate transfers handle quote allocation (and continue flushing backlog).
    function onMigrate() external;
}
