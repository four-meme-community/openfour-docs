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

    struct OverriddenFeeConfig {
        uint16 protocolFeeBps;
        uint16 developerFeePoolBps;
        uint16 maxProtocolDevFeeBps;
        uint16 maxTaxBps;
        uint8 maxTaxTiers;
        bool active;
    }

    event FeeAssigned(address indexed token, address indexed quoteAsset, address recipient, uint8 indexed kind, uint256 amount, bool pending);
    event DeveloperFeeClaimed(address indexed quoteAsset, address indexed author, uint256 amount, address indexed to);
    event PresetFeeConfigUpdated(
        uint256 indexed presetId,
        bool active,
        uint16 protocolFeeBps,
        uint16 developerFeePoolBps,
        uint16 maxProtocolDevFeeBps,
        uint16 maxTaxBps,
        uint8 maxTaxTiers
    );

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
        uint256 antiSniperFee
    );

    function distributeFeesFromBalance(address token, address quoteAsset, uint256 evalTotalFee, FeeRecipient[] memory recipients)
        external;
    function previewDistribution(
        uint256 presetId,
        uint256 curveQuote,
        OpenFourTypes.FeeTier[] calldata tradeFees,
        bool antiSniperEnabled,
        uint256 createBlock
    ) external view returns (uint256 totalFee, uint256 netQuote, uint256 antiSniperFee);
    function setPresetFeeConfig(uint256 presetId, OverriddenFeeConfig calldata cfg) external;
    function devFeePending(address quoteAsset, address author) external view returns (uint256);
    function claimDevFee(address quoteAsset, address to) external;
    function claimDevFees(address[] calldata quoteAssets, address to) external;
    function treasury() external view returns (address);
}
