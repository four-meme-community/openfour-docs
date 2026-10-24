// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TaxToken} from "./TaxToken.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";

interface IBinanceAgentTokenVault {
    function fourCore() external view returns (address);
}

/// @title BinanceAgentTaxToken
/// @notice Agent token that only permits canonical Core/Vault transfers before migration.
contract BinanceAgentTaxToken is TaxToken {
    error BinanceAgentTokenErrTransferLocked();
    error BinanceAgentTokenErrInvalidCore();

    function _transfer(address from, address to, uint256 amount) internal override {
        OpenFourTypes.Phase phase = tokenPhase;
        bool transfersUnlocked =
            phase == OpenFourTypes.Phase.MigratePending || phase == OpenFourTypes.Phase.Migrated;
        if (!transfersUnlocked) {
            address core = IBinanceAgentTokenVault(vault).fourCore();
            if (core == address(0)) revert BinanceAgentTokenErrInvalidCore();

            bool isCanonicalBuy = from == vault && msg.sender == vault;
            bool isCanonicalSell = to == vault && msg.sender == core;
            if (!isCanonicalBuy && !isCanonicalSell) {
                revert BinanceAgentTokenErrTransferLocked();
            }
        }

        super._transfer(from, to, amount);
    }

    function _descriptorTag() internal pure override returns (string memory) {
        return "token.tax.binance_agent";
    }
}
