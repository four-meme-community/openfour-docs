// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ITaxVault} from "./ITaxVault.sol";
import {ParamDescriptor, ModuleEncodeSchema} from "../libraries/OpenFourTypes.sol";

/// @title BaseTaxVault
/// @notice Abstract base for all TaxVault implementations.
///         Handles the common initialization pattern (token / quote / owner binding)
///         and ETH reception. Withdrawal logic is left entirely to subclasses.
///
///         Subclasses must implement:
///           • `_customInit(address[] calldata roles, bytes calldata initParams)`
///             — consume registry-managed roles and apply vault-specific params
///           • `moduleEncodeSchema()` — expose the ABI schema of those params to the front-end
abstract contract BaseTaxVault is Initializable, OwnableUpgradeable, ITaxVault {

    address internal _taxVaultToken;
    address internal _taxVaultQuote;
    bytes32 internal _taxVaultTypeId;
    address internal _taxVaultInitializer;

    event Received(address indexed sender, uint256 amount);

    /// @dev Storage gap for future BaseTaxVault field additions without breaking subclass layouts.
    uint256[46] private __gap;

    // ─── ITaxVault ──────────────────────────────────────────────────────────────

    /// @notice Called once by TaxVaultRegistry immediately after clone.
    function initialize(
        address token,
        address quote,
        address owner,
        address[] calldata roles,
        bytes calldata initParams
    ) external override initializer {
        require(token != address(0), "BaseTaxVault: zero token");
        require(owner != address(0), "BaseTaxVault: zero owner");
        __Ownable_init();
        _transferOwnership(owner);
        _taxVaultInitializer = msg.sender;
        _taxVaultToken = token;
        _taxVaultQuote = quote;
        _customInit(roles, initParams);
    }

    /// @notice The TaxToken this vault is bound to.
    function taxVaultToken() external view override returns (address) {
        return _taxVaultToken;
    }

    /// @notice The quote asset received from TaxToken fee dispatches.
    function taxVaultQuote() external view override returns (address) {
        return _taxVaultQuote;
    }

    /// @notice The vault type key registered in TaxVaultRegistry.
    function taxVaultTypeId() external view override returns (bytes32) {
        return _taxVaultTypeId;
    }

    /// @notice Handles notification after ERC20 founder tax is transferred by the bound TaxToken.
    function onERC20TaxReceived(address asset, uint256) public virtual override {
        require(
            msg.sender == _taxVaultToken || msg.sender == _taxVaultInitializer,
            "BaseTaxVault: unauthorized caller"
        );
        require(asset == _taxVaultQuote, "BaseTaxVault: wrong asset");
    }

    /// @notice Default NOOP; override in vaults that track TaxToken holder shares.
    function updateShares(address, address, uint256, uint256) external virtual override {}

    /// @notice Returns the fee recipient designated by the vault template developer.
    /// @dev Returning `address(0)` or `address(0xdEaD)` means the developer voluntarily
    ///      waives receiving developer tax. Each concrete vault must implement this function.
    function authorWallet() public view virtual override returns (address);

    // ─── ETH Reception ─────────────────────────────────────────────────────────

    /// @dev Receives native ETH when TaxToken's quote == wrappedNative and
    ///      fee dispatch calls swapForETH(founder, amount).
    receive() external payable virtual {
        emit Received(msg.sender, msg.value);
    }

    // ─── Abstract Hooks ─────────────────────────────────────────────────────────

    /// @notice Subclasses consume registry-managed `roles` and decode `initParams` here.
    ///         Called once from `initialize()`. NOOP for vaults with no custom params.
    function _customInit(address[] calldata roles, bytes calldata initParams) internal virtual;

    /// @notice Called by subclass constructor/init to record its vault type key.
    function _setTypeId(bytes32 typeId) internal {
        _taxVaultTypeId = typeId;
    }
}
