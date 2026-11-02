// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ParamDescriptor, ModuleEncodeSchema } from '../libraries/OpenFourTypes.sol';

/// @title IOpenFourModuleSchema
/// @notice Optional interface for modules to expose a typed ABI-encoding schema
///         that the front-end (and any off-chain tooling) can consume to derive
///         encoding/decoding without hard-coded per-preset logic.
///
///         Each implementing module returns a `ModuleEncodeSchema` whose `params`
///         array exactly mirrors the struct fields passed to `abi.encode` inside
///         `init()`, in the same order.  The front-end encodes as flat
///         `abi.encode(types[], values[])`, which is ABI-compatible with both flat
///         and named-struct decodes on the Solidity side.
interface IOpenFourModuleSchema {
    /// @notice Returns the ABI encoding schema for this module's params blob.
    /// @dev Must be `pure` — no state reads.  Returns an empty schema if the
    ///      module takes no params (e.g. BondingCurveModule with curveParams = 0x).
    function moduleEncodeSchema() external pure returns (ModuleEncodeSchema memory);
}
