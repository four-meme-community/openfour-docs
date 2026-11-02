// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IOpenFourPresetValidator} from "../interfaces/IOpenFourPresetValidator.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";

/// @dev Generated skeleton. Put cross-module create-time checks here.
contract {{CONTRACT}} is IOpenFourPresetValidator {
    function validate(uint256, OpenFourTypes.TokenInitParams calldata params) external pure override {
        require(params.maxSupply >= params.saleAmount, "Validator: saleAmount > maxSupply");
        require(params.saleAmount > 0, "Validator: zero saleAmount");
    }
}
