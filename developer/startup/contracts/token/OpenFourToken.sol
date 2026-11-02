// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";
import {IOpenFourToken} from "../interfaces/IOpenFourToken.sol";

contract OpenFourToken is Initializable, ERC20, IOpenFourToken {
    struct InitArgs {
        uint256 requestId;
        string name;
        string symbol;
        address vault;
        uint256 maxSupply;
        string tokenUri;
        address curveModule;
        address tradeModule;
        address migrateModule;
        address tokenModule;
        address customDataModule;
        address creator;
        address quoteAsset;
        bytes tokenParams;
        string tokenImplVersion;
    }

    string private _tokenName;
    string private _tokenSymbol;
    string private _tokenMetadataUri;

    uint256 public maxSupply;
    address public vault;
    address public curveModule;
    address public tradeModule;
    address public migrateModule;
    address public tokenModule;
    uint256 public requestId;
    address public customData;
    mapping(address => bool) public migratedPools;
    OpenFourTypes.Phase public tokenPhase;
    string internal _descriptorVersion;

    event MigratedPoolUpdated(address indexed pool, bool enabled);
    event MigratedPoolsUpdated(address[] pools, bool enabled);
    event TokenPhaseUpdated(OpenFourTypes.Phase indexed phase);
    event TokenTransferred(address indexed from, address indexed to, uint256 indexed requestId, uint256 amount);

    constructor() ERC20("", "") {
        _disableInitializers();
    }

    function initialize(InitArgs calldata c) external virtual initializer {
        __OpenFourToken_init(c);
    }

    function __OpenFourToken_init(InitArgs memory c) internal onlyInitializing {
        require(bytes(c.name).length != 0, "Token: empty name");
        require(bytes(c.symbol).length != 0, "Token: empty symbol");
        require(c.vault != address(0), "Token: vault is zero");
        require(
            c.curveModule != address(0)
                && c.tradeModule != address(0)
                && c.migrateModule != address(0)
                && c.tokenModule != address(0),
            "Token: zero module"
        );
        _tokenName = c.name;
        _tokenSymbol = c.symbol;
        vault = c.vault;
        maxSupply = c.maxSupply;
        _tokenMetadataUri = c.tokenUri;
        curveModule = c.curveModule;
        tradeModule = c.tradeModule;
        migrateModule = c.migrateModule;
        tokenModule = c.tokenModule;
        customData = c.customDataModule;
        requestId = c.requestId;
        _descriptorVersion = c.tokenImplVersion;
        _mintInitialSupply(c.vault, c.maxSupply);
    }

    function _mintInitialSupply(address vault_, uint256 maxSupply_) internal virtual {
        if (maxSupply_ > 0) {
            _mint(vault_, maxSupply_);
        }
    }

    function descriptor() external view virtual returns (bytes8 tagId, string memory tag, string memory version) {
        tag = _descriptorTag();
        return (bytes8(keccak256(bytes(tag))), tag, _descriptorVersion);
    }

    function _descriptorTag() internal pure virtual returns (string memory) {
        return "token.standard";
    }

    function name() public view virtual override returns (string memory) {
        return _tokenName;
    }

    function symbol() public view virtual override returns (string memory) {
        return _tokenSymbol;
    }

    modifier onlyVault() {
        require(msg.sender == vault, "Token: only vault");
        _;
    }

    modifier onlyMigrate() {
        require(msg.sender == migrateModule, "Token: only migrate");
        _;
    }

    function setMigratedPool(address pool, bool enabled) external onlyMigrate {
        require(pool != address(0), "Token: zero pool");
        migratedPools[pool] = enabled;
        emit MigratedPoolUpdated(pool, enabled);
    }

    function setMigratedPools(address[] calldata pools, bool enabled) external onlyMigrate {
        uint256 n = pools.length;
        for (uint256 i = 0; i < n; ) {
            address pool = pools[i];
            require(pool != address(0), "Token: zero pool");
            migratedPools[pool] = enabled;
            unchecked {
                ++i;
            }
        }
        if (n > 0) {
            emit MigratedPoolsUpdated(pools, enabled);
        }
    }

    function setPhase(OpenFourTypes.Phase newPhase) external onlyVault {
        require(tokenPhase != OpenFourTypes.Phase.Migrated, "Token: already migrated");
        tokenPhase = newPhase;
        emit TokenPhaseUpdated(newPhase);
    }

    function tokenURI() external view returns (string memory) {
        return _tokenMetadataUri;
    }

    function _beforeTokenTransfer(address from, address to, uint256 amount) internal override {
        if (_blocksBeforeMigration(from, to)) {
            revert("Token: pool transfer blocked before migration");
        }
        super._beforeTokenTransfer(from, to, amount);
    }

    function _blocksBeforeMigration(address from, address to) internal view returns (bool) {
        if (from == address(0) || to == address(0)) {
            return false;
        }
        OpenFourTypes.Phase phase = tokenPhase;
        if (phase == OpenFourTypes.Phase.MigratePending || phase == OpenFourTypes.Phase.Migrated) {
            return false;
        }
        return migratedPools[from] || migratedPools[to];
    }

    function _afterTokenTransfer(address from, address to, uint256 amount) internal virtual override {
        super._afterTokenTransfer(from, to, amount);
        emit TokenTransferred(from, to, requestId, amount);
    }
}
