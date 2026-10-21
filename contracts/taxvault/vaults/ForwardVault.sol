// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {BaseTaxVault} from "../BaseTaxVault.sol";
import {ModuleEncodeSchema, ParamDescriptor} from "../../libraries/OpenFourTypes.sol";

interface IForwardVaultTemplate {
    function initialize(
        address token,
        address quote,
        address owner,
        address[] calldata roles,
        bytes calldata initParams
    ) external;

    function taxVaultToken() external view returns (address);
    function taxVaultQuote() external view returns (address);
    function authorWallet() external view returns (address);
    function onERC20TaxReceived(address asset, uint256 amount) external;
}

interface IForwardVaultWrappedNative is IERC20 {
    function deposit() external payable;
}

/// @notice Clones a TaxVault template and routes each native-tax receipt atomically.
/// @dev The registry must provide a trusted template implementation; WBNB is resolved from the chain.
contract ForwardVault is BaseTaxVault, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant ROYALTY_BPS = 600;

    struct InitParams {
        address template;
        bytes initData;
    }

    bytes32 public constant TYPE_ID = keccak256("SafuSkill.ForwardVault.v1");
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    address public template;
    address public clonedVault;
    address private _authorWallet;

    enum RevenueAsset {
        Unset,
        Native,
        ERC20
    }

    RevenueAsset private _revenueAsset;

    event VaultCloned(address indexed template, address indexed clonedVault);
    event TaxForwarded(
        address indexed sender,
        address indexed recipient,
        address indexed asset,
        uint256 amount
    );
    event ERC20TaxCallbackFailed(address indexed clonedVault, address indexed asset, uint256 amount);

    error InvalidTemplate();
    error InvalidQuote();
    error InvalidClonedVault();
    error InvalidAuthorWallet();
    error InvalidWrappedNative();
    error UnsupportedChain(uint256 chainId);
    error NativeForwardFailed();
    error RevenueAssetMismatch();

    constructor() {
        _disableInitializers();
    }

    modifier onlyTaxSender() {
        require(
            msg.sender == _taxVaultToken || msg.sender == _taxVaultInitializer,
            "BaseTaxVault: unauthorized caller"
        );
        _;
    }

    function _validateTaxVaultAsset(address asset) internal view {
        require(asset == _taxVaultQuote, "BaseTaxVault: wrong asset");
    }

    receive() external payable override onlyTaxSender nonReentrant {
        _ensureRevenueAsset(RevenueAsset.Native);
        emit Received(msg.sender, msg.value);
        if (msg.value == 0) return;

        (address author, uint256 royaltyAmount, uint256 cloneAmount) = _calculateTaxSplit(msg.value);

        if (royaltyAmount != 0) {
            address wrappedNative = _wrappedNative();
            IForwardVaultWrappedNative(wrappedNative).deposit{value: royaltyAmount}();
            IERC20(wrappedNative).safeTransfer(author, royaltyAmount);
            emit TaxForwarded(msg.sender, author, wrappedNative, royaltyAmount);
        }

        _forwardNativeToClone(cloneAmount);
    }

    /// @notice Routes ERC20 tax received from the bound TaxToken.
    /// @dev Uses the actual balance so fee-on-transfer quote tokens are handled correctly.
    function onERC20TaxReceived(address asset, uint256)
        public
        virtual
        override
        onlyTaxSender
        nonReentrant
    {
        _validateTaxVaultAsset(asset);
        _ensureRevenueAsset(RevenueAsset.ERC20);

        uint256 balance = IERC20(asset).balanceOf(address(this));
        if (balance == 0) return;

        (address author, uint256 royaltyAmount, uint256 cloneAmount) = _calculateTaxSplit(balance);

        if (royaltyAmount != 0) {
            _forwardERC20(asset, author, royaltyAmount);
        }

        _forwardERC20(asset, clonedVault, cloneAmount);
    }

    function _customInit(address[] calldata, bytes calldata initParams) internal override {
        _setTypeId(TYPE_ID);
        __ReentrancyGuard_init();

        InitParams memory p = abi.decode(initParams, (InitParams));
        if (p.template == address(0) || p.template.code.length == 0) revert InvalidTemplate();
        if (_taxVaultQuote == address(0) || _taxVaultQuote.code.length == 0) revert InvalidQuote();
        if (_wrappedNative().code.length == 0) revert InvalidWrappedNative();
        template = p.template;

        address clone = Clones.clone(p.template);
        clonedVault = clone;

        address[] memory emptyRoles = new address[](0);
        IForwardVaultTemplate(clone).initialize(
            _taxVaultToken,
            _taxVaultQuote,
            owner(),
            emptyRoles,
            p.initData
        );

        if (
            IForwardVaultTemplate(clone).taxVaultToken() != _taxVaultToken
                || IForwardVaultTemplate(clone).taxVaultQuote() != _taxVaultQuote
        ) {
            revert InvalidClonedVault();
        }

        _authorWallet = _readAuthorWallet();
        emit VaultCloned(p.template, clone);
    }

    function authorWallet() public view override returns (address) {
        return _authorWallet;
    }

    function moduleEncodeSchema() external pure override returns (ModuleEncodeSchema memory) {
        ParamDescriptor[] memory params = new ParamDescriptor[](2);
        params[0] = ParamDescriptor({
            name: "template",
            abiType: "address",
            decimals: 0,
            optional: false,
            title: "Template",
            defaultValue: "",
            hint: "TaxVault template implementation address",
            minValue: "",
            maxValue: ""
        });
        params[1] = ParamDescriptor({
            name: "initData",
            abiType: "bytes",
            decimals: 0,
            optional: false,
            title: "Initialization data",
            defaultValue: "",
            hint: "ABI-encoded init parameters for the cloned TaxVault template",
            minValue: "",
            maxValue: ""
        });

        return ModuleEncodeSchema("SafuSkill.ForwardVault", 1, params);
    }

    function _readAuthorWallet() private view returns (address author) {
        (bool ok, bytes memory data) =
            clonedVault.staticcall(abi.encodeCall(IForwardVaultTemplate.authorWallet, ()));
        if (!ok || data.length != 32) revert InvalidAuthorWallet();
        author = abi.decode(data, (address));
    }

    function _calculateTaxSplit(uint256 amount)
        internal
        view
        returns (address author, uint256 royaltyAmount, uint256 cloneAmount)
    {
        author = _readAuthorWallet();
        if (author == address(0) || author == DEAD || author == address(this)) {
            author = address(0);
            return (author, 0, amount);
        }

        royaltyAmount = (amount * ROYALTY_BPS) / BPS_DENOMINATOR;
        cloneAmount = amount - royaltyAmount;
    }

    function _forwardNativeToClone(uint256 amount) private {
        address clone = clonedVault;
        (bool ok,) = payable(clone).call{value: amount}("");
        if (!ok) revert NativeForwardFailed();

        emit TaxForwarded(msg.sender, clone, address(0), amount);
    }

    function _forwardERC20(address asset, address recipient, uint256 amount) private {
        IERC20(asset).safeTransfer(recipient, amount);
        emit TaxForwarded(msg.sender, recipient, asset, amount);

        if (recipient == clonedVault) {
            try IForwardVaultTemplate(recipient).onERC20TaxReceived(asset, amount) {} catch {
                emit ERC20TaxCallbackFailed(recipient, asset, amount);
            }
        }
    }

    function _ensureRevenueAsset(RevenueAsset expected) private {
        RevenueAsset current = _revenueAsset;
        if (current == RevenueAsset.Unset) {
            _revenueAsset = expected;
        } else if (current != expected) {
            revert RevenueAssetMismatch();
        }
    }

    function _wrappedNative() internal view virtual returns (address) {
        return _wrappedNativeForChain(block.chainid);
    }

    function _wrappedNativeForChain(uint256 chainId) internal pure returns (address) {
        if (chainId == 56) return 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
        if (chainId == 97) return 0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd;
        if (chainId == 4663) return 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
        if (chainId == 46630) return 0x7943e237c7F95DA44E0301572D358911207852Fa;
        revert UnsupportedChain(chainId);
    }
}
