// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal Tapeout ProjectCore surface used by OpenFour Tapeout modules.
interface ITapeoutProject {
    function nandNFT() external view returns (address);
    function minerNFT() external view returns (address);
    function projectToken() external view returns (address);
    function nandPriceWei() external view returns (uint256);
    function nandCap() external view returns (uint256);
    function sold() external view returns (uint256);
    function openFourVault() external view returns (address);

    function mintNandFromOpenFour(address to, uint256 quantity)
        external
        returns (uint256 firstId, uint256 lastId);

    function returnNandToInventory(address from, uint256[] calldata tokenIds, address openFourCore)
        external;

    /// @dev Called after OpenFour migrate has added PCS V2 liquidity and sent mining allocation.
    function graduateFromOpenFour(address pair, uint256 totalRaised) external;
}

interface ITapeoutFactory {
    /// @dev One-shot: only `openFourDeployer` may call; authorizes `moduleProxy` for create.
    function authorizeCreate(address moduleProxy) external;

    function createProjectForOpenFour(
        string calldata tokenName,
        string calldata tokenSymbol,
        uint256 nandPriceWei,
        uint256 nandCap,
        address paymentToken,
        address openFourToken,
        address openFourVault,
        address openFourCore,
        address creator,
        bytes32 projectCoreSalt
    ) external returns (address projectCore, address nandNFT, address minerNFT);
}
