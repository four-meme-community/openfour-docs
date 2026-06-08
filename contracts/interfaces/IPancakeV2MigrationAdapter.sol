// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";

interface IPancakeV2MigrationAdapter {
    function executeLiquidity(
        OpenFourTypes.MigrateHookContext calldata ctx,
        uint256 quoteToUse,
        uint256 tokenLiquidityAmount,
        address lpRecipient
    ) external returns (address pair);

    function executeBuybackBurn(
        OpenFourTypes.MigrateHookContext calldata ctx,
        uint256 antiSniperQuote,
        address burnRecipient
    ) external;
}
