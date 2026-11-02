// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IOpenFourTokenModule} from "../../interfaces/IOpenFourTokenModule.sol";
import {OpenFourTypes} from "../../libraries/OpenFourTypes.sol";
import {OpenFourToken} from "../../token/OpenFourToken.sol";

contract StandardTokenModule is IOpenFourTokenModule {
    bytes private _initParams;
    string private _moduleVersion;

    function descriptor() external view override returns (bytes8 tagId, string memory tag, string memory version) {
        tag = "module.token.standard";
        return (bytes8(keccak256(bytes(tag))), tag, _moduleVersion);
    }

    function createToken(
        address creator,
        address token,
        address vault,
        address curveModule,
        address tradeModule,
        address migrateModule,
        address customDataModule,
        OpenFourTypes.TokenCreateParams calldata tokenParams,
        string calldata tokenImplVersion,
        string calldata tokenModuleVersion
    ) external override returns (uint256 maxSupply, string memory name, string memory symbol) {
        _moduleVersion = tokenModuleVersion;
        _initParams = tokenParams.tokenParams;
        name = tokenParams.name;
        symbol = tokenParams.symbol;
        maxSupply = tokenParams.maxSupply;

        require(bytes(name).length != 0, "TokenModule: empty name");
        require(bytes(symbol).length != 0, "TokenModule: empty symbol");
        require(token != address(0), "TokenModule: zero token");

        OpenFourToken(token).initialize(
            OpenFourToken.InitArgs({
                name: name,
                symbol: symbol,
                vault: vault,
                maxSupply: maxSupply,
                tokenUri: tokenParams.tokenUri,
                curveModule: curveModule,
                tradeModule: tradeModule,
                migrateModule: migrateModule,
                tokenModule: address(this),
                customDataModule: customDataModule,
                creator: creator,
                quoteAsset: tokenParams.quoteAsset,
                tokenParams: tokenParams.tokenParams,
                requestId: tokenParams.requestId,
                tokenImplVersion: tokenImplVersion
            })
        );
    }

    function getInitParams() external view returns (bytes memory) {
        return _initParams;
    }
}
