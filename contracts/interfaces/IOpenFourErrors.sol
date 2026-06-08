// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IOpenFourErrors
/// @notice Canonical custom errors for OpenFour (single ABI surface for off-chain selector decoding).
interface IOpenFourErrors {
    error CoreErrZeroRegistry();
    error CoreErrZeroWrappedNative();
    error CoreErrZeroFeeRouter();
    error CoreErrZeroToken();
    error CoreErrTokenNotFound();
    error CoreErrBadConfig();
    error CoreErrBadToken();
    error CoreErrDuplicateToken();
    error CoreErrRequestExpired();
    error CoreErrRequestAlreadyUsed();
    error CoreErrTokenPaused();
    error CoreErrPresetInactive();
    error CoreErrPresetCreateDisabled();
    error CoreErrBadPhase();
    error CoreErrQuoteMustBeERC20();
    error CoreErrCurveRejected();
    error CoreErrTradeRejected();
    error CoreErrSlippage();
    error CoreErrTradeMax();
    error CoreErrTradeMin();
    error CoreErrBadTax();
    error CoreErrBudgetNotExecutable();
    error CoreErrNativeOnlyWrapped();
    error CoreErrInsufficientNative();
    error CoreErrNativeRefundFailed();
    error CoreErrPresetValidatorNotFound();
    error CoreErrPresetTokenImplNotFound();
    /// @dev Deployer balance must cover the 1 wei native probe; pre-fund the deployer proxy.
    error DeployErrFounderProbeUnderfunded();
    /// @dev Founder cannot accept native (e.g. no receive/fallback); tax founder payout to native would fail.
    error DeployErrFounderCannotReceiveNative();

    // --- Likwid bonding migrate (BondingLikwidV2MigrateModule / LikwidV2MigrateLib) -----------------

    /// @dev FeeRouter.distributeFeesFromBalance reverted during migration fee split; `inner` is raw revert data.
    error LikwidMigrateErrFeeDistributeFailed(bytes inner);
    /// @dev Likwid pairPosition.addLiquidity reverted; `inner` is raw revert data.
    error LikwidMigrateErrAddLiquidityFailed(bytes inner);

    error LikwidMigrateErrZeroVault();
    error LikwidMigrateErrZeroToken();
    error LikwidMigrateErrZeroQuote();
    error LikwidMigrateErrUnsupportedChain();
    error LikwidMigrateErrZeroPairPosition();
    error LikwidMigrateErrZeroQuoteLiquidity();
    error LikwidMigrateErrIdenticalCurrency();
    error LikwidMigrateErrOnlyFourCore();
    error LikwidMigrateErrAlreadyInitialized();
    error LikwidMigrateErrZeroFourCore();
    error LikwidMigrateErrZeroFeeRouter();
    error LikwidMigrateErrParamsNotEmpty();
    error LikwidMigrateErrExistingPoolLiquidity();
    error LikwidMigrateErrNotInitialized();
    error LikwidMigrateErrWrongToken();
    error LikwidMigrateErrZeroVaultBalance();
    error LikwidMigrateErrNoTokenLiquidity();
}
