// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Local quote asset for unit tests. Not part of the official protocol.
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock Quote", "QUOTE") {
        _mint(msg.sender, 1_000_000 ether);
    }
}
