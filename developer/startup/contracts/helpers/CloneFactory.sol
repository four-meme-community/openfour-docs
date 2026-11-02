// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

/// @dev Local helper. OpenFourCore clones module/token implementations the same way.
///      This contract is not part of the official protocol.
contract CloneFactory {
    function clone(address implementation) external returns (address instance) {
        instance = Clones.clone(implementation);
    }
}
