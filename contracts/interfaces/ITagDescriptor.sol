// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITagDescriptor {
    function descriptor() external view returns (bytes8 tagId, string memory tag, string memory version);
}
