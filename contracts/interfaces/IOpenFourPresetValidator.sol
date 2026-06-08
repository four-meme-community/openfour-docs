// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";

/// @title IOpenFourPresetValidator
/// @notice Optional preset-level validator called during token creation.
/// @dev A validator checks cross-module invariants that individual module `init`
///      functions cannot validate alone. It should be immutable or otherwise
///      tightly governed because Core relies on it before creating a token.
interface IOpenFourPresetValidator {
    function validate(
        uint256 presetId,
        OpenFourTypes.TokenInitParams calldata params
    ) external view;
}
