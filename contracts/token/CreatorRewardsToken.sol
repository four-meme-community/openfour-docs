// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OpenFourToken} from "./OpenFourToken.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";

interface ITokenHelper {
    /// @notice Swaps token fees to the token's quote asset and sends output to `to`.
    function swapForQuote(address to, uint256 amountToken) external returns (uint256 amountQuote);
    /// @notice Swaps token fees to native ETH/BNB and sends output to `to`.
    function swapForETH(address to, uint256 amountToken) external returns (uint256 amountETH);
}

interface ICreatorFeeManager {
    /// @notice Returns dynamic protocol and creator fee bps for a token; may update TWAP state.
    function resolveFeeRate(address token) external returns (uint256 rateProtocol, uint256 rateCreator);
    /// @notice Returns the custom creator fee recipient for a token, or zero for default creator.
    function feeRecipients(address token) external view returns (address recipient);
    /// @notice Returns the protocol fee recipient.
    function protocol() external view returns (address);
}

/// @notice OpenFour-compatible creator rewards token.
/// @dev Fee applies after migration on pool trades and accumulates in token units,
///      then optional dispatch swaps token fee to quote/ETH for creator and protocol.
contract CreatorRewardsToken is OpenFourToken {

    /// @notice Quote asset used when dispatching accumulated token fees.
    address public quote;
    /// @notice Default creator recipient for creator rewards.
    address public creator;
    /// @notice Wrapped native token; quote dispatch unwraps to native ETH/BNB when this matches `quote`.
    address public wrappedNative;
    /// @notice Helper contract used to swap token fees into quote or native asset.
    address public tokenHelper;
    /// @notice Manager that resolves dynamic creator/protocol fee rates and recipients.
    address public creatorFeeManager;

    /// @notice Reserved creator fee bps slot; active rates are resolved from `creatorFeeManager`.
    uint256 public creatorFeeBps;
    /// @notice Reserved protocol fee bps slot; active rates are resolved from `creatorFeeManager`.
    uint256 public protocolFeeBps;

    /// @notice Undispatched creator fee accumulated in token units.
    uint256 public accCreator;
    /// @notice Total creator fee dispatched in token units.
    uint256 public feeCreator;
    /// @notice Total quote/native asset received for creator dispatches.
    uint256 public quoteCreator;

    /// @notice Undispatched protocol fee accumulated in token units.
    uint256 public accProtocol;
    /// @notice Total protocol fee dispatched in token units.
    uint256 public feeProtocol;
    /// @notice Total quote/native asset received for protocol dispatches.
    uint256 public quoteProtocol;

    /// @dev Reentrancy guard for helper-triggered token transfers during fee dispatch.
    bool private _swapping;

    event FeeAccrued(uint256 creatorTokenFee, uint256 protocolTokenFee);
    event FeeDispatched(address indexed recipient, uint256 amountToken, uint256 amountQuote);

    /// @notice Initializes the token clone and stores the default creator recipient.
    function initialize(OpenFourToken.InitArgs calldata c) external override initializer {
        __OpenFourToken_init(c);
        creator = c.creator;
    }

    /// @notice Completes module wiring after token creation.
    function postInitialize(address wrappedNative_, address quote_, address creatorFeeManager_, address tokenHelper_) external {
        require(msg.sender == tokenModule, "CreatorRewards: only token module can call");
        wrappedNative = wrappedNative_;
        creatorFeeManager = creatorFeeManager_;
        tokenHelper = tokenHelper_;
        quote = quote_;
    }

    function _transfer(address from, address to, uint256 amount) internal override {
        require(to != address(this), "CreatorRewards: invalid recipient");

        bool fromPool = migratedPools[from];
        bool toPool = migratedPools[to];

        if (tokenPhase == OpenFourTypes.Phase.Migrated && !_swapping) {
            // Flush previously accumulated fees before a sell (toPool), never during a buy (fromPool).
            if (toPool) {
                _dispatchFee();
            }
            // Apply fee only on pool trades and skip vault-side settlement transfers.
            if ((fromPool && to != vault) || (toPool && from != vault)) {
                (uint256 protocolBps, uint256 creatorBps) = _resolveFeeRates();
                uint256 totalBps = protocolBps + creatorBps;
                if (totalBps > 0) {
                    uint256 fee = (amount * totalBps) / 10_000;
                    if (fee > 0) {
                        amount -= fee;
                        super._transfer(from, address(this), fee);
                        uint256 protocolPart = (fee * protocolBps) / totalBps;
                        uint256 creatorPart = fee - protocolPart;
                        accProtocol += protocolPart;
                        accCreator += creatorPart;
                        emit FeeAccrued(creatorPart, protocolPart);
                    }
                }
            }
        }

        super._transfer(from, to, amount);

        // Dispatch on wallet-to-wallet transfers; pool legs defer to the next sell or wallet transfer.
        if (tokenPhase == OpenFourTypes.Phase.Migrated && !_swapping && !fromPool && !toPool) {
            _dispatchFee();
        }
    }

    function _resolveFeeRates() internal returns (uint256 protocolBps, uint256 creatorBps) {
        protocolBps = 0;
        creatorBps = 0;
        if (creatorFeeManager != address(0)) {
            try ICreatorFeeManager(creatorFeeManager).resolveFeeRate(address(this)) returns (uint256 protocolRate, uint256 creatorRate) {
                if (protocolRate + creatorRate < 10_000) {
                    protocolBps = protocolRate;
                    creatorBps = creatorRate;
                }
            } catch {
            }
        }
    }

    function _dispatchFee() internal {
        if (tokenHelper == address(0)) return;

        if (accCreator > 0) {
            uint256 amountToken = accCreator;
            accCreator = 0;

            address recipient = creator;
            if (creatorFeeManager != address(0)) {
                try ICreatorFeeManager(creatorFeeManager).feeRecipients(address(this)) returns (address customRecipient) {
                    if (customRecipient != address(0)) recipient = customRecipient;
                } catch {}
            }

            uint256 amountQuote = _swapOut(recipient, amountToken);
            feeCreator += amountToken;
            quoteCreator += amountQuote;
            emit FeeDispatched(recipient, amountToken, amountQuote);
        }

        if (accProtocol > 0) {
            uint256 amountToken = accProtocol;
            accProtocol = 0;

            address recipient = address(0);
            if (creatorFeeManager != address(0)) {
                try ICreatorFeeManager(creatorFeeManager).protocol() returns (address protocolRecipient) {
                    recipient = protocolRecipient;
                } catch {}
            }
            if (recipient == address(0)) recipient = creator;

            uint256 amountQuote = _swapOut(recipient, amountToken);
            feeProtocol += amountToken;
            quoteProtocol += amountQuote;
            emit FeeDispatched(recipient, amountToken, amountQuote);
        }
    }

    function _swapOut(address recipient, uint256 amountToken) internal returns (uint256 amountQuote) {
        _swapping = true;
        _approve(address(this), tokenHelper, amountToken);
        if (quote == wrappedNative && wrappedNative != address(0)) {
            amountQuote = ITokenHelper(tokenHelper).swapForETH(recipient, amountToken);
        } else {
            amountQuote = ITokenHelper(tokenHelper).swapForQuote(recipient, amountToken);
        }
        _swapping = false;
    }

    function _descriptorTag() internal pure override returns (string memory) {
        return "token.creator_rewards";
    }
}
