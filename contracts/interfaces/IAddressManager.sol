// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal read interface for the shared protocol address book.
interface IAddressManager {
    function listaVault() external view returns (address);
    function lisUsdVault() external view returns (address);
    function listaStableVault() external view returns (address);
    function stakedUsdu() external view returns (address);
    function swapper() external view returns (address);
    function wrappedNative() external view returns (address);
    function usdt() external view returns (address);
    function lpV2Manager() external view returns (address);
    function binanceAgentIDNft() external view returns (address);
}
