// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";

interface IOpenFourFeeRouter {
    struct FeeRecipient {
        address recipient;
        uint256 amount;
        uint8 kind;
        bool pending;
    }

    struct FeeConfig {
        uint16 protocolFeeBps;
        uint16 developerFeePoolBps;
        uint16 maxProtocolDevFeeBps;
        uint16 maxTaxBps;
        uint8 maxTaxTiers;
        /// @dev Share of post-rebate protocol fee credited to token partner (pull/claim).
        ///      Remainder goes to treasury immediately. 0 = all to treasury.
        ///      Kept as uint256 to occupy the former `placeholder1` storage slot (value ≤ MAX_BPS).
        uint256 partnerProtocolShareBps;
        uint256 placeholder2;
        uint256 placeholder3;
        uint256 placeholder4;
        uint256 placeholder5;
        uint256 placeholder6;
    }

    struct OverriddenFeeConfig {
        uint16 protocolFeeBps;
        uint16 developerFeePoolBps;
        uint16 maxProtocolDevFeeBps;
        uint16 maxTaxBps;
        uint8 maxTaxTiers;
        bool active;
        /// @dev Preset-specific override of partnerProtocolShareBps when `active` (≤ MAX_BPS).
        uint256 partnerProtocolShareBps;
    }

    /// @notice Emitted for every fee assignment to a recipient (protocol / tax / developer).
    event FeeAssigned(address indexed token, address indexed quoteAsset, address recipient, uint8 indexed kind, uint256 amount, bool pending);

    /// @notice Emitted when an author claims their pending developer fees.
    event DeveloperFeeClaimed(address indexed quoteAsset, address indexed author, uint256 amount, address indexed to);

    /// @notice Emitted when a partner claims their pending protocol-fee share.
    event PartnerFeeClaimed(address indexed quoteAsset, address indexed partner, uint256 amount, address indexed to);

    event PresetFeeConfigUpdated(
        uint256 indexed presetId,
        bool active,
        uint16 protocolFeeBps,
        uint16 developerFeePoolBps,
        uint16 maxProtocolDevFeeBps,
        uint16 maxTaxBps,
        uint8 maxTaxTiers,
        uint256 partnerProtocolShareBps
    );

    /// @notice Compute fee distribution for a trade.
    /// @dev Direction-agnostic: always returns netQuote = curveQuote - totalFee.
    ///      Callers derive the trader's actual flow independently:
    ///        buy  → traderQuote = curveQuote + totalFee
    ///        sell → traderQuote = netQuote    (= curveQuote - totalFee)
    ///      `partnerFee` is the pull/claim share of protocol (excluded from immediate distribute).
    function buildDistribution(
        address token,
        uint256 presetId,
        uint256 curveQuote,
        OpenFourTypes.FeeTier[] calldata tradeFees,
        address quoteAsset,
        bool antiSniperEnabled,
        uint256 createBlock
    ) external returns (
        FeeRecipient[] memory recipients,
        uint256 netQuote,
        uint256 totalFee,
        uint256 protocolFee,
        uint256 taxFee,
        uint256 developerFee,
        uint256 antiSniperFee,
        uint256 partnerFee
    );

    /// @notice Distributes immediately payable fees (protocol treasury + rebate + tax) from the router's balance.
    /// @dev Developer and partner fees are NOT included — they remain claimable.
    function distributeFeesFromBalance(address token, address quoteAsset, uint256 evalTotalFee, FeeRecipient[] memory recipients)
        external;

    /// @notice Preview of fee breakdown with preset-specific fee config support.
    /// @dev Returns totalFee including antiSniperFee; antiSniperFee is also returned separately for breakdown.
    function previewDistribution(
        uint256 presetId,
        uint256 curveQuote,
        OpenFourTypes.FeeTier[] calldata tradeFees,
        bool antiSniperEnabled,
        uint256 createBlock
    ) external view returns (uint256 totalFee, uint256 netQuote, uint256 antiSniperFee);

    function setPresetFeeConfig(uint256 presetId, OverriddenFeeConfig calldata cfg) external;

    /// @notice Register token partner once at create time. Zero address is a no-op.
    function registerPartner(address token, address partner) external;

    /// @notice Returns the pending developer fee claimable by `author` for a given quote asset.
    function devFeePending(address quoteAsset, address author) external view returns (uint256);

    /// @notice Returns the pending partner protocol-fee share claimable by `partner`.
    function partnerFeePending(address quoteAsset, address partner) external view returns (uint256);

    /// @notice Claim accumulated developer fees for a single quote asset.
    function claimDevFee(address quoteAsset, address to) external;

    /// @notice Claim accumulated developer fees for multiple quote assets in one call.
    function claimDevFees(address[] calldata quoteAssets, address to) external;

    /// @notice Claim accumulated partner protocol-fee share for a single quote asset.
    function claimPartnerFee(address quoteAsset, address to) external;

    /// @notice Claim accumulated partner protocol-fee share for multiple quote assets.
    function claimPartnerFees(address[] calldata quoteAssets, address to) external;

    function treasury() external view returns (address);

    /// @notice Recipient of 5% of protocol fees. Zero means the split is disabled.
    function rebate() external view returns (address);

    /// @notice Token → partner address registered at create (zero if none).
    function partnerOf(address token) external view returns (address);

    /// @notice Returns the current fee configuration including caps and active rates.
    function feeConfig() external view returns (
        uint16 protocolFeeBps,
        uint16 developerFeePoolBps,
        uint16 maxProtocolDevFeeBps,
        uint16 maxTaxBps,
        uint8 maxTaxTiers,
        uint256 partnerProtocolShareBps,
        uint256 placeholder2,
        uint256 placeholder3,
        uint256 placeholder4,
        uint256 placeholder5,
        uint256 placeholder6
    );
}
