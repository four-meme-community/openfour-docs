// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TaxToken} from "./TaxToken.sol";

/// @notice TaxToken with burn helpers for Tapeout Fuel / failure cleanup.
contract TapeoutOpenFourToken is TaxToken {
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function burnFrom(address account, uint256 amount) external {
        _spendAllowance(account, msg.sender, amount);
        _burn(account, amount);
    }

    function _descriptorTag() internal pure override returns (string memory) {
        return "token.tapeout";
    }
}
