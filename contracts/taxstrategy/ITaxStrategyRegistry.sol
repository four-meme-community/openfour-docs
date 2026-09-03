// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ITaxStrategyRegistry
/// @notice Registry interface for resolving and cloning strategy-tax implementations.
interface ITaxStrategyRegistry {
    struct StrategyTypeRecord {
        address beacon;
        string name;
        string version;
        string description;
        bool active;
    }

    function cloneStrategy(
        bytes32 strategyTypeId,
        address token,
        address quote,
        address owner,
        bytes calldata initParams
    ) external returns (address taxStrategy);

    function upgradeStrategyType(
        bytes32 strategyTypeId,
        address newImplementation,
        string calldata name,
        string calldata version,
        string calldata description,
        bool active
    ) external;

    function getStrategyType(bytes32 strategyTypeId)
        external
        view
        returns (StrategyTypeRecord memory);

    function isActiveStrategyType(bytes32 strategyTypeId) external view returns (bool);
}
