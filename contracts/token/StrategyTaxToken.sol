// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {OpenFourToken} from "./OpenFourToken.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";
import {ITaxTokenBonding} from "../interfaces/ITaxTokenBonding.sol";
import {ITaxStrategy} from "../taxstrategy/ITaxStrategy.sol";

/// @notice Minimal shareholder-manager interface required by this token.
interface IStrategyTaxTokenShareHolderManager {
    /// @notice Returns whether `account` is excluded from transfers and dividend accounting for `token`.
    function isBlacklisted(address token, address account) external view returns (bool);
}

/// @title Strategy Tax Token
/// @notice ERC-20 token that delegates tax conversion and distribution to a per-token tax strategy.
/// @dev During bonding, quote-denominated tax is forwarded directly to the strategy. After migration,
///      buy and sell tax is collected in this token and forwarded to the strategy on dispatch.
///      Holder balances are synchronized with the strategy after each eligible transfer.
contract StrategyTaxToken is OpenFourToken, ITaxTokenBonding {
    using SafeERC20 for IERC20;

    /// @notice Conventional burn address, excluded from holder accounting.
    address public constant DEAD = address(0xdEaD);
    /// @notice Lowest configurable holder balance that may participate in strategy distributions.
    uint256 public constant MIN_SHARE_LOWER_BOUND = 1 ether;

    /// @notice User-supplied parameters consumed by `StrategyTaxTokenModule`.
    /// @dev `taxStrategyInitParams` is strategy-specific ABI-encoded data.
    struct StrategyTaxTokenUserParams {
        /// @notice Buy tax rate in basis points.
        uint256 buyFeeRate;
        /// @notice Sell tax rate in basis points.
        uint256 sellFeeRate;
        /// @notice Minimum token balance counted as a holder share.
        uint256 minShare;
        /// @notice Registered strategy type identifier used to clone the strategy.
        bytes32 taxStrategyTypeId;
        /// @notice ABI-encoded initialization parameters for the selected strategy.
        bytes taxStrategyInitParams;
    }

    /// @notice Final initialization parameters encoded by the token module.
    struct StrategyTaxTokenParams {
        /// @notice Buy tax rate in basis points.
        uint256 buyFeeRate;
        /// @notice Sell tax rate in basis points.
        uint256 sellFeeRate;
        /// @notice Minimum token balance counted as a holder share.
        uint256 minShare;
        /// @notice Address of the strategy instance dedicated to this token.
        address taxStrategy;
    }

    /// @notice Quote asset used during bonding and by the tax strategy.
    address public quote;
    /// @notice Wrapped native token used by downstream swap integrations.
    address public wrappedNative;
    /// @notice Manager responsible for shareholder blacklist decisions.
    address public shareHolderManager;
    /// @notice Tax strategy instance associated with this token.
    ITaxStrategy public taxStrategy;

    /// @notice Buy tax rate in basis points.
    uint256 public buyFeeRate;
    /// @notice Sell tax rate in basis points.
    uint256 public sellFeeRate;
    /// @notice Minimum balance required to participate in holder distributions.
    uint256 public minShare;
    /// @notice Post-migration token tax waiting to be forwarded to the strategy.
    uint256 public tokenAccumulated;
    /// @notice Cumulative post-migration tax collected in this token's units.
    uint256 public totalTaxCollected;
    /// @notice Token-tax threshold used for the post-migration `DispatchReady` hint.
    /// @dev Supplied by the token module during initialization and denominated in this token's native units.
    uint256 public minDispatch;

    /// @dev Prevents strategy dispatch transfers from recursively charging tax or updating shares.
    bool private dispatchingFee;

    /// @notice Emitted when accumulated token tax is forwarded to the strategy.
    /// @param amountToken Amount forwarded in this token's smallest unit.
    event FeeDispatched(uint256 amountToken);

    /// @notice Signals that pending tax has crossed its dispatch threshold.
    /// @param reason 0 for token tax held by this token, 1 for quote tax held by the strategy.
    /// @param pendingAmount Accumulated amount in the corresponding asset's native units.
    /// @dev A keeper hint only; callers must still check `canDispatchTax()` before sending a dispatch transaction.
    event DispatchReady(uint8 indexed reason, uint256 pendingAmount);

    /// @notice Initializes a newly created strategy-tax token.
    /// @dev Can only run once. The token module must provide ABI-encoded `StrategyTaxTokenParams`.
    /// @param c Common token initialization arguments supplied by the OpenFour deployment flow.
    function initialize(OpenFourToken.InitArgs calldata c) external override initializer {
        __OpenFourToken_init(c);

        StrategyTaxTokenParams memory p = _decodeParams(c.tokenParams);
        require(p.buyFeeRate <= 1000, "StrategyTaxToken: invalid buyFeeRate");
        require(p.sellFeeRate <= 1000, "StrategyTaxToken: invalid sellFeeRate");
        require(p.minShare >= MIN_SHARE_LOWER_BOUND, "StrategyTaxToken: invalid minShare");
        require(p.taxStrategy != address(0), "StrategyTaxToken: zero tax strategy");

        quote = c.quoteAsset;
        buyFeeRate = p.buyFeeRate;
        sellFeeRate = p.sellFeeRate;
        minShare = p.minShare;
        taxStrategy = ITaxStrategy(p.taxStrategy);
    }

    /// @notice Completes integration wiring after the base token initialization.
    /// @dev Only the token module may call this function.
    /// @param wrappedNative_ Wrapped native token used by swap integrations.
    /// @param quote_ Quote asset used by the token and its strategy.
    /// @param shareHolderManager_ Manager used for shareholder blacklist checks.
    /// @param minDispatch_ Token-tax threshold supplied by the token module's strategy initialization config.
    function postInitialize(address wrappedNative_, address quote_, address shareHolderManager_, uint256 minDispatch_) external {
        require(msg.sender == tokenModule, "StrategyTaxToken: only token module");
        wrappedNative = wrappedNative_;
        quote = quote_;
        shareHolderManager = shareHolderManager_;
        minDispatch = minDispatch_;
    }

    /// @notice Forwards quote tax collected by a bonding-curve trade to the strategy.
    /// @dev Only the token vault may call this function. Buy and sell quote tax use the same handling.
    /// @param taxQuote Tax amount denominated in the quote asset.
    function onBondingTrade(uint256 taxQuote, bool /* isBuy */) external override {
        require(msg.sender == vault, "StrategyTaxToken: only vault");
        if (taxQuote == 0) {
            return;
        }
        IERC20(quote).safeTransfer(address(taxStrategy), taxQuote);
        taxStrategy.receiveQuoteTax(taxQuote);
    }

    /// @notice Notifies the strategy that the token has migrated to external liquidity.
    /// @dev Only the migration module may call this function. This flushes strategy-side deferred
    ///      burn/liquidity work without forwarding token tax through `_dispatchFee()`.
    function onMigrate() external override {
        require(msg.sender == migrateModule, "StrategyTaxToken: only migrate");
        dispatchingFee = true;
        taxStrategy.forceDispatchTax();
        dispatchingFee = false;
    }

    /// @notice Returns the descriptor of the strategy attached to this token.
    /// @return tagId Compact identifier derived from the strategy tag.
    /// @return tag Human-readable strategy tag.
    /// @return version Registered strategy version.
    function strategyTag() external view returns (bytes8 tagId, string memory tag, string memory version) {
        return taxStrategy.descriptor();
    }

    /// @notice Returns whether a keeper dispatch would attempt meaningful token or strategy work.
    function canDispatchTax() external view returns (bool) {
        if (dispatchingFee || tokenPhase == OpenFourTypes.Phase.Created) {
            return false;
        }
        return taxStrategy.canDispatchTax(tokenAccumulated, uint8(tokenPhase));
    }

    /// @notice Lets a keeper or any other caller dispatch pending tax before the next user transfer.
    /// @dev Distribution thresholds and destinations remain enforced by the configured strategy.
    ///      A nested call during an active dispatch is ignored. The guarded phases match
    ///      `canDispatchTax()` so a keeper never submits a call this function would skip.
    function dispatchTax() external {
        if (dispatchingFee || tokenPhase == OpenFourTypes.Phase.Created) {
            return;
        }
        bool hadPendingTokenTax = tokenAccumulated > 0;
        _dispatchFee();
        if (hadPendingTokenTax) {
            _dispatchStrategyTax();
        }
    }

    /// @dev Decodes the module-generated initialization payload.
    function _decodeParams(bytes calldata raw) internal pure returns (StrategyTaxTokenParams memory p) {
        require(raw.length != 0, "StrategyTaxToken: empty params");
        p = abi.decode(raw, (StrategyTaxTokenParams));
    }

    /// @dev Applies blacklist checks, migrated-pool tax handling, strategy dispatch, and share synchronization.
    function _transfer(address from, address to, uint256 amount) internal override {
        if (
            shareHolderManager != address(0) &&
            from != address(0) &&
            to != address(0) &&
            IStrategyTaxTokenShareHolderManager(shareHolderManager).isBlacklisted(address(this), from)
        ) {
            revert("StrategyTaxToken: blacklisted sender");
        }

        bool fromPool = migratedPools[from];
        bool toPool = migratedPools[to];

        if (tokenPhase == OpenFourTypes.Phase.Migrated && !dispatchingFee) {
            if (toPool) {
                _dispatchFee();
            }

            bool isBuy = fromPool && to != vault;
            bool isSell = toPool && from != vault;
            if (isBuy || isSell) {
                uint256 feeRate = isBuy ? buyFeeRate : sellFeeRate;
                uint256 tax = (amount * feeRate) / 10_000;
                if (tax > 0) {
                    amount -= tax;
                    super._transfer(from, address(this), tax);
                    uint256 previous = tokenAccumulated;
                    tokenAccumulated = previous + tax;
                    totalTaxCollected += tax;
                    if (previous <= minDispatch && tokenAccumulated > minDispatch) {
                        emit DispatchReady(0, tokenAccumulated);
                    }
                }
            }
        }

        if (tokenPhase == OpenFourTypes.Phase.Trading && !dispatchingFee) {
            _dispatchStrategyTax();
        }

        super._transfer(from, to, amount);

        if (!dispatchingFee) {
            _updateShare(from);
            if (from != to) {
                _updateShare(to);
            }
        }

        if (tokenPhase == OpenFourTypes.Phase.Migrated && !dispatchingFee && !fromPool && !toPool) {
            _dispatchFee();
        }
    }

    /// @dev Requests strategy-side quote tax dispatch while suppressing recursive token accounting.
    function _dispatchStrategyTax() internal {
        dispatchingFee = true;
        taxStrategy.dispatchTax();
        dispatchingFee = false;
    }

    /// @dev Forwards accumulated token tax, or asks the strategy to dispatch when no token tax is pending.
    function _dispatchFee() internal {
        uint256 amount = tokenAccumulated;
        dispatchingFee = true;
        if (amount > 0) {
            tokenAccumulated = 0;
            super._transfer(address(this), address(taxStrategy), amount);
            taxStrategy.receiveTokenTax(amount);
            emit FeeDispatched(amount);
        } else {
            taxStrategy.dispatchTax();
        }
        dispatchingFee = false;
    }

    /// @notice Re-synchronizes an account after its shareholder-manager status changes.
    /// @dev Only the configured shareholder manager may call this function.
    /// @param account Account whose strategy share should be refreshed.
    function syncShareFromManager(address account) external {
        require(msg.sender == shareHolderManager, "StrategyTaxToken: only share manager");
        _updateShare(account);
    }

    /// @dev Publishes an account's eligible balance to the strategy, or zero when excluded.
    function _updateShare(address account) internal {
        if (!_isShareHolder(account)) {
            if (account != address(0)) {
                taxStrategy.updateShare(account, 0);
            }
            return;
        }

        uint256 share = balanceOf(account);
        if (share < minShare) {
            share = 0;
        }
        taxStrategy.updateShare(account, share);
    }

    /// @dev Returns whether an account is eligible for strategy holder accounting.
    function _isShareHolder(address account) internal view returns (bool) {
        return account != address(0) &&
            account != address(this) &&
            account != DEAD &&
            account != vault &&
            account != address(taxStrategy) &&
            (
                shareHolderManager == address(0) ||
                    !IStrategyTaxTokenShareHolderManager(shareHolderManager).isBlacklisted(address(this), account)
            ) &&
            !migratedPools[account];
    }

    /// @dev Returns this token implementation's registry descriptor tag.
    function _descriptorTag() internal pure override returns (string memory) {
        return "token.strategy_tax";
    }
}
