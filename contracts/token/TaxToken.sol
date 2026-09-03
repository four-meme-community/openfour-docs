// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {OpenFourToken} from "./OpenFourToken.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";
import {ITaxTokenBonding} from "../interfaces/ITaxTokenBonding.sol";
import {IWrappedNative} from "../interfaces/IWrappedNative.sol";
import {ITaxVault} from "../taxvault/ITaxVault.sol";

interface ITokenHelper {
    /// @notice Returns the configured native payout gas limit for a token.
    function getGasLimit(address token) external view returns (uint256);
    /// @notice Adds token-funded liquidity for the calling token.
    function addLiquidity(uint256 amountToken) external;
    /// @notice Adds quote-funded liquidity for the calling token.
    function addLiquidityWithQuote(uint256 amountQuote) external;
    /// @notice Swaps the calling token into quote and sends output to `to`.
    function swapForQuote(address to, uint256 amountToken) external returns (uint256 amountQuote);
    /// @notice Swaps quote into the calling token and sends output to `to`.
    function swapForToken(address to, uint256 amountQuote) external returns (uint256 amountToken);
    /// @notice Swaps the calling token into native ETH/BNB and sends output to `to`.
    function swapForETH(address to, uint256 amountToken) external returns (uint256 amountETH);
}

interface IShareHolderManager {
    /// @notice Returns whether an account is excluded from holder rewards.
    function isBlacklisted(address token, address account) external view returns (bool);
}

/// @title TaxToken
/// @notice Dual-phase tax token for OpenFour bonding + DEX presets.
/// @dev All fee statistics use **quote** in `feeAccumulated` / `feeFounder` / `feeHolder` / `feeBurn` /
///      `feeLiquidity` / `feeDispatched`. DEX pool transfers stage **token** tax in `tokenAccumulated` until
///      merged via swap. Bonding quote tax is credited via `onBondingTrade(taxQuote)` from vault `VaultTradeParams.taxFee`.
///      `_dispatchFee` merges DEX token tax then allocates quote (bonding defers burn/LP; migrated burns immediately).
///      `tokenBurned` tracks token sent to DEAD.
contract TaxToken is OpenFourToken, ITaxTokenBonding {
    using SafeERC20 for IERC20;

    /// @notice Burn recipient used for token burns and burned liquidity.
    address public constant DEAD = address(0xdEaD);
    uint256 internal constant MAGNITUDE = 2 ** 128;

    struct UserInfo {
        uint256 share;
        uint256 rewardDebt;
        uint256 claimable;
        uint256 claimed;
        bool exists;
    }

    /// @dev Create-form / `tokenParams` bytes from frontend (no dispatch thresholds).
    struct TaxTokenUserParams {
        address founder;
        uint256 buyFeeRate;
        uint256 sellFeeRate;
        uint256 rateFounder;
        uint256 rateHolder;
        uint256 rateBurn;
        uint256 rateLiquidity;
        uint256 minShare;
        bytes32 taxVaultTypeId;
        bytes taxVaultInitParams;
    }

    struct TaxTokenParams {
        address founder;
        uint256 buyFeeRate;
        uint256 sellFeeRate;
        uint256 rateFounder;
        uint256 rateHolder;
        uint256 rateBurn;
        uint256 rateLiquidity;
        uint256 minDispatch;
        uint256 minDispatchQuote;
        uint256 minShare;
        bytes32 taxVaultTypeId;
        bytes taxVaultInitParams;
    }

    /// @notice Quote asset used for bonding fees, swaps, claims, and liquidity operations.
    address public quote;
    /// @notice Recipient of the founder share; may be a cloned TaxVault.
    address public founder;
    /// @notice Registered TaxVault type id used at creation, or zero when no TaxVault is used.
    bytes32 public taxVaultTypeId;
    /// @notice Wrapped native token used by helper integrations.
    address public wrappedNative;
    /// @notice Helper contract used for post-migration swaps and liquidity adds.
    address public tokenHelper;
    /// @notice Optional blacklist source for fee claims and shareholder eligibility.
    address public shareHolderManager;

    /// @dev Reentrancy guard for helper-triggered token transfers during swaps and liquidity adds.
    ///      Also read by `_transfer()` to skip tax/dispatch logic for those trusted internal moves,
    ///      so it must never be set around calls to externally-controlled addresses (e.g. `founder`).
    bool private swapping;

    /// @dev Reentrancy guard scoped to `_dispatchFee()` only. Unlike `swapping`, `_transfer()` never
    ///      reads this flag, so a founder contract that reenters via a transfer during its callback
    ///      still pays tax normally -- it just cannot trigger a nested fee dispatch.
    bool private dispatchingFee;

    /// @notice Buy fee rate in basis points for post-migration pool buys.
    uint256 public buyFeeRate;
    /// @notice Sell fee rate in basis points for post-migration pool sells.
    uint256 public sellFeeRate;
    /// @notice Founder allocation weight within dispatched quote fees.
    uint256 public rateFounder;
    /// @notice Holder allocation weight within dispatched quote fees.
    uint256 public rateHolder;
    /// @notice Burn allocation weight within dispatched quote fees.
    uint256 public rateBurn;
    /// @notice Liquidity allocation weight within dispatched quote fees.
    uint256 public rateLiquidity;
    /// @notice Token-tax threshold for merging DEX fees into quote after migration.
    uint256 public minDispatch;
    /// @notice Quote-fee threshold for dispatching accumulated bonding or merged DEX fees.
    uint256 public minDispatchQuote;
    /// @notice Minimum token balance counted as holder share for quote fee distribution.
    uint256 public minShare;

    /// @dev Enumerable list of accounts that have entered holder tracking.
    address[] private _users;
    /// @notice Holder accounting used for quote fee distribution and claim tracking.
    mapping(address => UserInfo) public userInfo;
    /// @notice Total token balance counted across eligible fee-sharing holders.
    uint256 public totalShares;
    /// @notice Accumulated quote fee per share, scaled by `MAGNITUDE`.
    uint256 public feePerShare;

    /// @notice Undispatched fees in **quote** (bonding + migrated working balance).
    uint256 public feeAccumulated;
    /// @notice DEX tax collected in **token** before swap merge.
    uint256 public tokenAccumulated;
    /// @notice Total quote amount allocated out of `feeAccumulated`.
    uint256 public feeDispatched;
    /// @notice Total quote-equivalent tax collected from bonding and merged DEX fees.
    uint256 public totalTaxCollected;
    /// @notice Total quote sent to the founder recipient.
    uint256 public feeFounder;
    /// @notice Total quote allocated to holder rewards.
    uint256 public feeHolder;
    /// @notice Total quote spent on buyback-and-burn.
    uint256 public feeBurn;
    /// @notice Total quote spent on tax liquidity.
    uint256 public feeLiquidity;
    /// @notice Total quote claimed by holders.
    uint256 public feeClaimed;
    /// @notice Cumulative token amount sent to DEAD via quote→swap→burn.
    uint256 public tokenBurned;

    /// @notice Burn quote reserved until buyback-and-burn succeeds.
    uint256 public feeToBurn;
    /// @notice Liquidity quote reserved until helper liquidity add succeeds.
    uint256 public feeToLiquidity;
    /// @notice Founder quote reserved until native transfer succeeds.
    uint256 public feeToFounder;
    /// @notice Cumulative quote manually funded for holder rewards.
    uint256 public totalManualRewards;

    /// @notice Whether the token supports manually funding holder rewards.
    bool public constant supportsManualRewards = true;

    event FeeDispatched(
        uint256 amountFounder,
        uint256 amountHolder,
        uint256 amountBurn,
        uint256 amountLiquidity
    );
    event FeeClaimed(address account, uint256 amount);
    event FeeInsufficient(address account, uint256 claimable, uint256 balance);
    event FeeDispatchDeferred(uint8 indexed kind, uint256 amount, bytes reason);
    /// @notice Signals that accumulated work has crossed a dispatch threshold.
    /// @param reason 0 for token tax, 1 for quote tax.
    /// @param pendingAmount Accumulated amount in the corresponding asset's native units.
    /// @dev This is a keeper hint only; callers must confirm with `canDispatchTax()` before sending a transaction.
    event DispatchReady(uint8 indexed reason, uint256 pendingAmount);
    /// @notice Emitted after quote is manually funded and credited entirely to holder rewards.
    event ManualHolderRewardsFunded(address indexed sender, uint256 amount);

    /// @notice Initializes tax parameters and inherited token runtime fields.
    function initialize(OpenFourToken.InitArgs calldata c) external override initializer {
        __OpenFourToken_init(c);

        TaxTokenParams memory p = _decodeOrDefault(c.tokenParams, c.creator);

        require(p.buyFeeRate <= 1000, "TaxToken: invalid buyFeeRate");
        require(p.sellFeeRate >= 100 && p.sellFeeRate <= 1000, "TaxToken: invalid sellFeeRate");
        require(p.rateFounder + p.rateHolder + p.rateBurn + p.rateLiquidity == 100, "TaxToken: invalid total rates");
        require(p.rateFounder == 0 || p.founder != address(0), "TaxToken: founder required when rateFounder > 0");

        quote = c.quoteAsset;
        founder = p.founder;
        taxVaultTypeId = p.taxVaultTypeId;
        buyFeeRate = p.buyFeeRate;
        sellFeeRate = p.sellFeeRate;
        rateFounder = p.rateFounder;
        rateHolder = p.rateHolder;
        rateBurn = p.rateBurn;
        rateLiquidity = p.rateLiquidity;
        minDispatch = p.minDispatch;
        minDispatchQuote = p.minDispatchQuote;
        minShare = p.minShare;
    }

    /// @notice Completes helper, quote, and shareholder-manager wiring after token creation.
    function postInitialize(address wrappedNative_, address quote_, address shareHolderManager_, address tokenHelper_) external {
        require(msg.sender == tokenModule, "TaxToken: only token module can call");
        wrappedNative = wrappedNative_;
        tokenHelper = tokenHelper_;
        shareHolderManager = shareHolderManager_;
        quote = quote_;
    }

    modifier onlyTaxVault() {
        require(msg.sender == vault, "TaxToken: only vault");
        _;
    }

    modifier onlyMigrateModule() {
        require(msg.sender == migrateModule, "TaxToken: only migrate");
        _;
    }

    /// @notice Credits bonding-curve tax in quote units; callable only by the vault.
    function onBondingTrade(uint256 taxQuote, bool /*isBuy*/) external onlyTaxVault {
        _creditBondingTax(taxQuote);
    }

    /// @dev Migration hook: flush `feeToBurn` / `feeToLiquidity` backlog. Does not dispatch `feeAccumulated`
    ///      (remaining quote tax is allocated on post-migrate DEX/P2P transfers).
    function onMigrate() external onlyMigrateModule {
        _flushDeferredBurnLp();
    }

    /// @notice Returns whether a keeper dispatch would attempt meaningful work.
    /// @dev A true result indicates eligible work, but does not guarantee downstream swaps or payouts succeed.
    function canDispatchTax() external view returns (bool) {
        if (swapping || dispatchingFee) {
            return false;
        }
        if (feeToFounder > 0) {
            return true;
        }

        bool migrated = tokenPhase == OpenFourTypes.Phase.Migrated;
        if (
            migrated && tokenHelper != address(0)
                && (tokenAccumulated > minDispatch || feeToBurn > 0 || feeToLiquidity > 0)
        ) {
            return true;
        }

        bool dispatchPhase = tokenPhase == OpenFourTypes.Phase.Trading
            || tokenPhase == OpenFourTypes.Phase.MigratePending || migrated;
        if (!dispatchPhase || feeAccumulated == 0 || feeAccumulated < minDispatchQuote) {
            return false;
        }

        bool deferBurnLp = !migrated;
        return (rateFounder > 0 && founder != address(0))
            || (rateHolder > 0 && totalShares > 0 && quote != address(0)) || rateBurn > 0
            || (rateLiquidity > 0 && (deferBurnLp || tokenHelper != address(0)));
    }

    /// @notice Lets a keeper or any other caller dispatch pending tax before the next user transfer.
    /// @dev Existing minimum thresholds and configured fee destinations remain enforced.
    ///      A nested call during an active swap or payout is ignored.
    function dispatchTax() external {
        if (swapping) {
            return;
        }
        _dispatchFee();
    }

    function _decodeOrDefault(bytes calldata raw, address creator) internal pure returns (TaxTokenParams memory p) {
        if (raw.length == 0) {
            p = TaxTokenParams({
                founder: creator,
                buyFeeRate: 300,
                sellFeeRate: 300,
                rateFounder: 20,
                rateHolder: 70,
                rateBurn: 5,
                rateLiquidity: 5,
                minDispatch: 100_000 ether,
                minDispatchQuote: 0.001 ether,
                minShare: 1,
                taxVaultTypeId: bytes32(0),
                taxVaultInitParams: ""
            });
        } else {
            p = abi.decode(raw, (TaxTokenParams));
        }

        if (p.founder == address(0)) p.founder = creator;
        require(p.minDispatchQuote > 0, "TaxToken: zero minDispatchQuote");
    }

    function _transfer(address from, address to, uint256 amount) internal override {
        require(to != address(this), "TaxToken: invalid recipient");
        if (
            shareHolderManager != address(0) &&
            from != address(0) &&
            to != address(0) &&
            IShareHolderManager(shareHolderManager).isBlacklisted(address(this), from)
        ) {
            revert("TaxToken: blacklisted sender");
        }

        bool fromPool = migratedPools[from];
        bool toPool = migratedPools[to];

        if (tokenPhase == OpenFourTypes.Phase.Migrated && !swapping) {
            if (toPool) {
                _dispatchFee();
            }
            bool isBuy = fromPool && to != vault;
            bool isSell = toPool && from != vault;
            if (isBuy || isSell) {
                uint256 feeRate = isBuy ? buyFeeRate : sellFeeRate;
                uint256 fee = (amount * feeRate) / 10_000;
                if (fee > 0) {
                    amount -= fee;
                    super._transfer(from, address(this), fee);
                    uint256 previous = tokenAccumulated;
                    tokenAccumulated += fee;
                    if (
                        tokenHelper != address(0) && previous <= minDispatch
                            && tokenAccumulated > minDispatch
                    ) {
                        emit DispatchReady(0, tokenAccumulated);
                    }
                }
            }
        }

        if (tokenPhase == OpenFourTypes.Phase.Trading && !swapping) {
            _dispatchFee();
        }

        super._transfer(from, to, amount);

        // Bonding: allocate existing quote fees before transfer, then sync shares to new balances.
        if (tokenPhase == OpenFourTypes.Phase.Trading && !swapping) {
            _updateShare(from);
            if (from != to) {
                _updateShare(to);
            }
        }

        if (tokenPhase == OpenFourTypes.Phase.Migrated) {
            _updateShare(from);
            if (from != to) {
                _updateShare(to);
            }
            if (!swapping && !fromPool && !toPool) {
                _dispatchFee();
                _claimFee(from);
            }
        }
        // Hook: notify vault of share changes
        if (taxVaultTypeId != bytes32(0) && founder.code.length > 0) {
            try ITaxVault(founder).updateShares(from, to, userInfo[from].share, userInfo[to].share) {} catch {}
        }
    }

    function _creditBondingTax(uint256 taxQuote) internal {
        if (taxQuote == 0) {
            return;
        }
        uint256 previous = feeAccumulated;
        feeAccumulated += taxQuote;
        totalTaxCollected += taxQuote;
        if (previous < minDispatchQuote && feeAccumulated >= minDispatchQuote) {
            emit DispatchReady(1, feeAccumulated);
        }
    }

    /// @dev Merge DEX `tokenAccumulated` when migrated, then split `feeAccumulated` (quote) by rates.
    /// @param ignoreMinThreshold When true, skip `minDispatchQuote` check (reserved; not used by `onMigrate`).
    function _dispatchFee(bool ignoreMinThreshold) internal {
        if (dispatchingFee) {
            return;
        }
        dispatchingFee = true;
        _doDispatchFee(ignoreMinThreshold);
        dispatchingFee = false;
    }

    /// @dev Actual dispatch logic, entered only once per top-level `_dispatchFee()` call. A reentrant
    ///      transfer or `dispatchTax()` call triggered by an external hook (e.g. `founder`) during this
    ///      execution is blocked by the `dispatchingFee` guard in `_dispatchFee()` above.
    function _doDispatchFee(bool ignoreMinThreshold) internal {
        if (tokenPhase == OpenFourTypes.Phase.Migrated && tokenHelper != address(0)) {
            _flushDeferredBurnLp();
        }
        _flushDeferredFounder();
        if (tokenPhase == OpenFourTypes.Phase.Migrated) {
            if (tokenAccumulated > minDispatch && tokenHelper != address(0)) {
                uint256 amountToken = tokenAccumulated;
                (bool mergeOk, uint256 quoteOut, bytes memory mergeReason) = _trySwapForQuote(address(this), amountToken);
                if (mergeOk) {
                    tokenAccumulated = 0;
                    feeAccumulated += quoteOut;
                    totalTaxCollected += quoteOut;
                } else {
                    emit FeeDispatchDeferred(0, amountToken, mergeReason);
                }
            }
        }

        if (
            tokenPhase != OpenFourTypes.Phase.Trading && tokenPhase != OpenFourTypes.Phase.MigratePending
                && tokenPhase != OpenFourTypes.Phase.Migrated
        ) {
            return;
        }

        uint256 amountTotal = feeAccumulated;
        if (!ignoreMinThreshold && amountTotal < minDispatchQuote) {
            return;
        }
        if (amountTotal == 0) {
            return;
        }

        bool deferBurnLp = tokenPhase != OpenFourTypes.Phase.Migrated;
        bool founderActive = rateFounder > 0 && founder != address(0);
        bool holderActive = rateHolder > 0 && totalShares > 0 && quote != address(0);
        bool burnActive = rateBurn > 0;
        bool liquidityActive = rateLiquidity > 0;
        bool migratedImmediate = !deferBurnLp && tokenHelper != address(0);

        uint256 rateTotal;
        if (founderActive) rateTotal += rateFounder;
        if (holderActive) rateTotal += rateHolder;
        if (burnActive) rateTotal += rateBurn;
        if (liquidityActive && (deferBurnLp || migratedImmediate)) rateTotal += rateLiquidity;
        if (rateTotal == 0) {
            return;
        }

        uint256 amountFounder;
        uint256 amountHolder;
        uint256 amountBurn;
        uint256 amountLiquidity;
        uint256 amountFounderDone;
        uint256 amountHolderDone;
        uint256 amountBurnDone;
        uint256 amountLiquidityDone;
        uint256 amountDispatched;

        if (holderActive) {
            amountHolder = (amountTotal * rateHolder) / rateTotal;
            if (amountHolder > 0) {
                amountHolderDone = amountHolder;
                feeHolder += amountHolder;
                amountDispatched += amountHolder;
                feePerShare += (amountHolder * MAGNITUDE) / totalShares;
            }
        }
        if (founderActive) {
            amountFounder = (amountTotal * rateFounder) / rateTotal;
            if (amountFounder > 0) {
                if (_transferFounderFee(amountFounder)) {
                    amountFounderDone = amountFounder;
                    feeFounder += amountFounder;
                } else {
                    feeToFounder += amountFounder;
                }
                amountDispatched += amountFounder;
            }
        }
        if (burnActive) {
            amountBurn = (amountTotal * rateBurn) / rateTotal;
            if (deferBurnLp) {
                feeToBurn += amountBurn;
                amountDispatched += amountBurn;
            } else if (amountBurn > 0) {
                if (_burnQuoteForDead(amountBurn)) {
                    amountBurnDone = amountBurn;
                    amountDispatched += amountBurn;
                } else {
                    feeToBurn += amountBurn;
                    amountDispatched += amountBurn;
                }
            }
        }
        if (liquidityActive) {
            amountLiquidity = (amountTotal * rateLiquidity) / rateTotal;
            if (deferBurnLp) {
                feeToLiquidity += amountLiquidity;
                amountDispatched += amountLiquidity;
            } else if (amountLiquidity > 0) {
                (bool liquidityOk, bytes memory liquidityReason) = _tryAddLiquidityWithQuote(amountLiquidity);
                if (liquidityOk) {
                    amountLiquidityDone = amountLiquidity;
                    feeLiquidity += amountLiquidity;
                    amountDispatched += amountLiquidity;
                } else {
                    feeToLiquidity += amountLiquidity;
                    amountDispatched += amountLiquidity;
                    emit FeeDispatchDeferred(3, amountLiquidity, liquidityReason);
                }
            }
        }

        if (tokenPhase == OpenFourTypes.Phase.Migrated && tokenHelper != address(0)) {
            _flushDeferredBurnLp();
        }

        feeAccumulated = amountTotal - amountDispatched;
        feeDispatched += amountDispatched;

        emit FeeDispatched(amountFounderDone, amountHolderDone, amountBurnDone, amountLiquidityDone);
    }

    function _dispatchFee() internal {
        _dispatchFee(false);
    }

    /// @dev `founder` is externally controlled; the `dispatchingFee` guard on `_dispatchFee()` already
    ///      blocks a nested dispatch if this hook reenters, so no additional flag is set here.
    function _transferFounderFee(uint256 amountQuote) internal returns (bool) {
        if (quote == wrappedNative && wrappedNative != address(0)) {
            IWrappedNative(wrappedNative).withdraw(amountQuote);
            return _sendFounderNative(amountQuote);
        } else {
            IERC20(quote).safeTransfer(founder, amountQuote);
            // Only contract founder can be notified
            if (taxVaultTypeId != bytes32(0) && founder.code.length > 0) {
                try ITaxVault(founder).onERC20TaxReceived(quote, amountQuote) {} catch {}
            }
        }
        return true;
    }

    function _sendFounderNative(uint256 amountQuote) internal returns (bool) {
        if (amountQuote == 0) {
            return true;
        }

        (bool ok,) = payable(founder).call{
            value: amountQuote,
            gas: ITokenHelper(tokenHelper).getGasLimit(address(this))
        }("");
        if (!ok) {
            emit FeeDispatchDeferred(5, amountQuote, bytes("TaxToken: founder native transfer failed"));
            return false;
        }
        return true;
    }

    function _flushDeferredFounder() internal {
        if (feeToFounder == 0) {
            return;
        }

        uint256 amountQuote = feeToFounder;
        feeToFounder = 0;
        if (_sendFounderNative(amountQuote)) {
            feeFounder += amountQuote;
        } else {
            feeToFounder = amountQuote;
        }
    }

    /// @dev Swap `amountQuote` to token and send to `DEAD`. Updates `feeBurn` (quote) and `tokenBurned` (token out).
    function _burnQuoteForDead(uint256 amountQuote) internal returns (bool) {
        if (amountQuote == 0) {
            return true;
        }
        (bool ok, uint256 amountToken, bytes memory reason) = _trySwapForToken(DEAD, amountQuote);
        if (!ok) {
            emit FeeDispatchDeferred(4, amountQuote, reason);
            return false;
        }
        feeBurn += amountQuote;
        tokenBurned += amountToken;
        return true;
    }

    /// @dev Execute swap→DEAD / addLiquidity for quote held in `feeToBurn` and `feeToLiquidity`.
    function _flushDeferredBurnLp() internal {
        if (feeToBurn > 0) {
            uint256 amountQuote = feeToBurn;
            feeToBurn = 0;
            if (!_burnQuoteForDead(amountQuote)) {
                feeToBurn = amountQuote;
            }
        }
        if (feeToLiquidity > 0) {
            uint256 amountQuote = feeToLiquidity;
            feeToLiquidity = 0;
            (bool ok, bytes memory reason) = _tryAddLiquidityWithQuote(amountQuote);
            if (ok) {
                feeLiquidity += amountQuote;
            } else {
                feeToLiquidity = amountQuote;
                emit FeeDispatchDeferred(3, amountQuote, reason);
            }
        }
    }

    function _isShareHolder(address account) internal view returns (bool) {
        return !migratedPools[account] &&
            account != vault &&
            account != address(this) &&
            account != address(0) &&
            account != DEAD;
    }

    function _updateShare(address account) internal {
        if (rateHolder == 0 || !_isShareHolder(account)) {
            return;
        }

        uint256 newShare = balanceOf(account);
        if (newShare < minShare) {
            newShare = 0;
        }

        UserInfo storage info = userInfo[account];
        uint256 curShare = info.share;
        if (newShare == curShare) {
            return;
        }

        if (!info.exists) {
            _users.push(account);
            info.exists = true;
        }

        if (curShare > 0) {
            uint256 accFee = (curShare * feePerShare) / MAGNITUDE;
            if (accFee > info.rewardDebt) {
                info.claimable += accFee - info.rewardDebt;
            }
        }

        info.share = newShare;
        info.rewardDebt = (newShare * feePerShare) / MAGNITUDE;
        if (newShare > curShare) {
            totalShares += (newShare - curShare);
        } else {
            totalShares -= (curShare - newShare);
        }
    }

    /// @notice Returns claimable quote rewards for an account, including pending per-share accrual.
    function claimableFee(address account) public view returns (uint256) {
        UserInfo storage info = userInfo[account];
        uint256 amount = info.claimable;
        uint256 accFee = (info.share * feePerShare) / MAGNITUDE;
        if (accFee > info.rewardDebt) {
            amount += accFee - info.rewardDebt;
        }
        return amount;
    }

    /// @notice Returns total quote rewards already claimed by an account.
    function claimedFee(address account) external view returns (uint256) {
        return userInfo[account].claimed;
    }

    /// @notice Claims available quote rewards for the caller.
    function claimFee() external {
        _claimFee(msg.sender);
    }

    /// @notice Claims available quote rewards for each account in the list.
    function claimFee(address[] calldata accounts) external {
        for (uint256 i = 0; i < accounts.length; i++) {
            _claimFee(accounts[i]);
        }
    }

    /// @notice Funds holder rewards with native currency or the configured ERC20 quote.
    /// @dev Send native currency with `amountQuote == 0`, or approve quote and pass a positive amount
    ///      with `msg.value == 0`. Native funding is only available when quote is wrapped native.
    function manualFundHolderRewards(uint256 amountQuote) external payable {
        require(!swapping && !dispatchingFee, "TaxToken: manual funding while busy");
        require(rateHolder > 0, "TaxToken: holder rewards disabled");
        require(totalShares > 0, "TaxToken: no eligible holders");

        uint256 received;
        swapping = true;
        if (msg.value > 0) {
            require(amountQuote == 0, "TaxToken: ambiguous funding");
            require(
                wrappedNative != address(0) && quote == wrappedNative,
                "TaxToken: native quote unsupported"
            );
            IWrappedNative(wrappedNative).deposit{value: msg.value}();
            received = msg.value;
        } else {
            require(amountQuote > 0, "TaxToken: zero amount");
            uint256 balanceBefore = IERC20(quote).balanceOf(address(this));
            IERC20(quote).safeTransferFrom(msg.sender, address(this), amountQuote);
            received = IERC20(quote).balanceOf(address(this)) - balanceBefore;
        }
        swapping = false;

        require(received > 0, "TaxToken: zero received");
        feeHolder += received;
        feePerShare += (received * MAGNITUDE) / totalShares;
        totalManualRewards += received;

        emit ManualHolderRewardsFunded(msg.sender, received);
    }

    /// @notice Returns the number of accounts ever added to holder tracking.
    function userCount() external view returns (uint256) {
        return _users.length;
    }

    /// @notice Returns a page of tracked holders; entries below `minClaimable` are returned as `DEAD`.
    function users(uint256 index, uint256 count, uint256 minClaimable) external view returns (address[] memory) {
        address[] memory result = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            address account;
            if (index < _users.length) {
                account = _users[index];
                if (minClaimable > 0 && claimableFee(account) < minClaimable) {
                    account = DEAD;
                }
            }
            result[i] = account;
            index++;
        }
        return result;
    }

    function _claimFee(address account) internal {
        if (swapping) {
            return;
        }
        if (quote == address(0)) {
            return;
        }
        if (shareHolderManager != address(0) && IShareHolderManager(shareHolderManager).isBlacklisted(address(this), account)) {
            return;
        }
        uint256 amountQuote = claimableFee(account);
        if (amountQuote == 0) {
            return;
        }

        UserInfo storage info = userInfo[account];
        info.rewardDebt = (info.share * feePerShare) / MAGNITUDE;
        info.claimable = 0;

        uint256 balanceQuote = IERC20(quote).balanceOf(address(this));
        if (amountQuote > balanceQuote) {
            emit FeeInsufficient(account, amountQuote, balanceQuote);
            amountQuote = balanceQuote;
        }
        if (amountQuote == 0) {
            return;
        }

        IERC20(quote).safeTransfer(account, amountQuote);
        info.claimed += amountQuote;
        feeClaimed += amountQuote;
        emit FeeClaimed(account, amountQuote);
    }

    function _swapForQuote(address to, uint256 amountToken) internal returns (uint256) {
        if (amountToken == 0 || tokenHelper == address(0)) return 0;
        swapping = true;
        _approve(address(this), tokenHelper, amountToken);
        uint256 amountQuote = ITokenHelper(tokenHelper).swapForQuote(to, amountToken);
        swapping = false;
        return amountQuote;
    }

    function _swapForToken(address to, uint256 amountQuote) internal returns (uint256) {
        if (amountQuote == 0 || tokenHelper == address(0) || quote == address(0)) return 0;
        swapping = true;
        IERC20(quote).forceApprove(tokenHelper, amountQuote);
        uint256 amountToken = ITokenHelper(tokenHelper).swapForToken(to, amountQuote);
        swapping = false;
        return amountToken;
    }

    function _addLiquidityWithQuote(uint256 amountQuote) internal {
        if (amountQuote == 0 || tokenHelper == address(0) || quote == address(0)) return;
        swapping = true;
        IERC20(quote).forceApprove(tokenHelper, amountQuote);
        ITokenHelper(tokenHelper).addLiquidityWithQuote(amountQuote);
        swapping = false;
    }

    function _trySwapForQuote(address to, uint256 amountToken)
        internal
        returns (bool ok, uint256 amountQuote, bytes memory reason)
    {
        if (amountToken == 0 || tokenHelper == address(0)) return (false, 0, bytes("TaxToken: helper disabled"));
        try this._swapForQuoteWrapped(to, amountToken) returns (uint256 amountOut) {
            return (true, amountOut, bytes(""));
        } catch (bytes memory err) {
            return (false, 0, err);
        }
    }

    function _trySwapForToken(address to, uint256 amountQuote)
        internal
        returns (bool ok, uint256 amountToken, bytes memory reason)
    {
        if (amountQuote == 0 || tokenHelper == address(0)) {
            return (false, 0, bytes("TaxToken: helper disabled"));
        }
        try this._swapForTokenWrapped(to, amountQuote) returns (uint256 amountOut) {
            return (true, amountOut, bytes(""));
        } catch (bytes memory err) {
            return (false, 0, err);
        }
    }

    function _tryAddLiquidityWithQuote(uint256 amountQuote) internal returns (bool ok, bytes memory reason) {
        if (amountQuote == 0 || tokenHelper == address(0)) {
            return (false, bytes("TaxToken: helper disabled"));
        }
        try this._addLiquidityWithQuoteWrapped(amountQuote) {
            return (true, bytes(""));
        } catch (bytes memory err) {
            return (false, err);
        }
    }

    /// @notice Self-call wrapper for guarded token-to-quote swaps.
    function _swapForQuoteWrapped(address to, uint256 amountToken) external returns (uint256) {
        require(msg.sender == address(this), "TaxToken: internal only");
        return _swapForQuote(to, amountToken);
    }

    /// @notice Self-call wrapper for guarded quote-to-token swaps.
    function _swapForTokenWrapped(address to, uint256 amountQuote) external returns (uint256) {
        require(msg.sender == address(this), "TaxToken: internal only");
        return _swapForToken(to, amountQuote);
    }

    /// @notice Self-call wrapper for guarded quote-funded liquidity adds.
    function _addLiquidityWithQuoteWrapped(uint256 amountQuote) external {
        require(msg.sender == address(this), "TaxToken: internal only");
        _addLiquidityWithQuote(amountQuote);
    }

    /// @dev Accepts wrapped-native `withdraw()` callbacks and other native transfers without accounting.
    ///      External holder-reward funding must use `manualFundHolderRewards`.
    receive() external payable {}

    function _descriptorTag() internal pure override returns (string memory) {
        return "token.tax";
    }
}
