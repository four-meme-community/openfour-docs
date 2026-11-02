// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";

/// @dev Minimal Core helper used by startup tests. Not OpenFourCore.
contract MockFourCore {
    address public wrappedNative;

    constructor(address wrappedNative_) {
        wrappedNative = wrappedNative_;
    }

    /// @dev Same consumption path as OpenFourCore: bubble Trade.evaluate `revertData` unchanged.
    function enforceTradeResult(OpenFourTypes.TradeResult calldata result) external pure {
        OpenFourTypes.revertIfDisallowed(result);
    }
}
