// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";

interface IOpenFourPresetValidator {
    function validate(uint256 presetId, OpenFourTypes.TokenInitParams calldata params) external view;
}
