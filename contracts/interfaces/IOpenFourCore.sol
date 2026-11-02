// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OpenFourTypes} from "../libraries/OpenFourTypes.sol";
import {IOpenFourErrors} from "./IOpenFourErrors.sol";
import {IOpenFourRegistry} from "./IOpenFourRegistry.sol";
import {IOpenFourFeeRouter} from "./IOpenFourFeeRouter.sol";

/// @title IOpenFourCore
/// @notice Minimal integration interface for OpenFourCore.
/// @dev Uses `token` (ERC20 address) as the runtime identifier.
interface IOpenFourCore is IOpenFourErrors {
    /// @notice Emitted once per successful token creation.
    /// @dev `requestId` is an off-chain correlation id provided by the caller.
    event TokenCreated(
        /// @dev Off-chain correlation id (caller-provided).
        uint256 requestId,
        /// @dev Selected preset id.
        uint256 indexed presetId,
        /// @dev Token creator (EOA / factory).
        address indexed creator,
        /// @dev Newly created ERC20 token address (primary identifier).
        address indexed token,
        /// @dev ERC20 name.
        string name,
        /// @dev ERC20 symbol.
        string symbol,
        /// @dev Token max supply (0 means unlimited, depending on token implementation).
        uint256 maxSupply,
        /// @dev Initial sale amount configured at creation.
        uint256 saleAmount,
        /// @dev Raise target configured at creation.
        uint256 raiseAmount,
        /// @dev Initial price in quote per 1 token (1e18 token unit).
        uint256 initialPrice,
        /// @dev Quote asset (ERC20) used for trades.
        address quoteAsset,
        /// @dev Vault instance bound to this token.
        address vault,
        /// @dev Curve module instance (clone) bound to this token.
        address curveModule,
        /// @dev Trade module instance (clone) bound to this token.
        address tradeModule,
        /// @dev Migrate module instance (clone) bound to this token.
        address migrateModule,
        /// @dev Per-token customData BeaconProxy address (zero when preset has no customDataId).
        address customData,
        /// @dev Token module instance (clone) bound to this token.
        address tokenModule,
        /// @dev Token metadata URI.
        string tokenMetaUri,
        /// @dev Bit flags captured at creation. bit0 = antiSniperEnabled.
        uint256 flags,
        /// @dev Packed creation tags: byte0 = schema (`OpenFourTypes.CREATION_TAGS_SCHEMA_V1`), then 7× `bytes8`
        ///      `tagId` from `ITagDescriptor(inst).descriptor()` for token, tokenModule, vault, curve, trade,
        ///      migrate, customData (in that order); zero module address → zero `bytes8` slot. Total length 57.
        bytes encodedTags
    );

    /// @notice Emitted for every executed buy/sell.
    /// @dev Amount units: `tokenAmount` is token units, quote fields are in quote units.
    event TradeExecuted(
        address indexed token,
        address indexed trader,
        uint256 indexed presetId,
        bool isBuy,
        address quoteAsset,
        address vault,
        /// @dev Requested token amount by user (token units).
        uint256 requestedTokenAmount,
        /// @dev Executed token amount (token units).
        uint256 tokenAmount,
        /// @dev Bonding-curve price of the trade before fees (quote units).
        ///      Buy: vault receives this amount.  Sell: vault pays out this amount.
        uint256 curveQuoteAmount,
        /// @dev Actual quote amount from the trader's perspective (quote units).
        ///      Buy:  total quote the trader paid out  = curveQuoteAmount + protocol/tax/dev fees + antiSniperFee.
        ///      Sell: net quote the trader received   = curveQuoteAmount - those fees - antiSniperFee.
        ///      Always satisfies: isBuy ? traderQuoteAmount <= slippageLimit
        ///                               : traderQuoteAmount >= slippageLimit
        ///      only when the settlement asset is the vault quote (no zap). With zap, `slippageLimit`
        ///      is checked against the user's final native/WBNB amount instead.
        uint256 traderQuoteAmount,
        /// @dev Last price in quote per token, scaled by 1e18, derived from post-trade curve state.
        uint256 lastPrice,
        /// @dev User-provided slippage limit passed through as `maxPayAmount` (buy) or
        ///      `minReceiveAmount` (sell). Unit follows settlement asset selected by `options`
        ///      (vault quote, or native/WBNB when zap is enabled).
        uint256 slippageLimit,
        /// @dev Fee of protocol
        uint256 protocolFee,
        /// @dev Fee of extra tax, depends on modules
        uint256 taxFee,
        /// @dev Fee of modules developers
        uint256 devFee,
        /// @dev Anti-sniper surcharge on curveQuote (quote units); retained in vault, not in totalRaised.
        uint256 antiSniperFee,
        /// @dev Current vault.totalRaised() after this trade (quote units).
        uint256 totalRaised,
        /// @dev Current vault.remainingForSale() after this trade (token units).
        uint256 remainingForSale
    );

    /// @notice Emitted when migration is executed.
    /// @param migrateTagId Stable tag id from `ITagDescriptor(migrateModule).descriptor()`.
    /// @param migratedDataVersion Module-local payload layout version (pairs with `encodedMigratedData`; not inside the bytes).
    /// @param encodedMigratedData Module-defined migration payload without an embedded version prefix.
    event MigrateExecuted(
        uint256 indexed presetId,
        address indexed caller,
        address indexed token,
        address vault,
        address migrateModule,
        bytes8 migrateTagId,
        uint256 totalRaised,
        uint256 remainingForSale,
        bytes32 hookDataHash,
        uint8 migratedDataVersion,
        bytes encodedMigratedData
    );

    /// @notice Emitted on vault phase transitions initiated by this core.
    event PhaseTransition(address indexed token, OpenFourTypes.Phase from, OpenFourTypes.Phase to, address operator);
    event RegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event FeeRouterUpdated(address indexed oldFeeRouter, address indexed newFeeRouter);
    event ZapRouterUpdated(address indexed oldRouter, address indexed newRouter);
    event TokenPaused(address indexed token, bool paused);
    
    function createToken(bytes memory createArgs, bytes memory signature) external payable returns (address token);

    /// @param maxPayAmount Maximum the buyer will spend. Unit is vault quote by default; with
    ///        native zap it is native wei. Core exact-outputs into quote and refunds unused native.
    /// @param options Buy path: bit1 enables native→quote zap when quote is not WBNB.
    function buy(address token, uint256 amount, uint256 maxPayAmount, uint256 options, bytes calldata proof) external payable;
    /// @notice Buy the maximum executable token amount for a spend budget, reverting if below `minAmountOut`.
    /// @dev With native zap and a non-WBNB quote, Core first quotes the native budget into quote,
    ///      then exact-outputs the executable cost and refunds unused native.
    /// @param maxPayAmount Spend budget. Unit is vault quote by default; with native zap it is native wei.
    /// @param options Buy path: bit1 enables native→quote zap when quote is not WBNB.
    function buyByBudget(address token, uint256 maxPayAmount, uint256 minAmountOut, uint256 options, bytes calldata proof) external payable;
    /// @param minReceiveAmount Minimum the seller must receive after fees (and after zap if enabled).
    ///        Unit is vault quote by default; with zap it is BNB or WBNB according to `options`.
    /// @param options bit0 = keep WBNB instead of unwrapping; bit1 = zap non-WBNB quote.
    ///        For non-WBNB quote: bit1 alone pays BNB; bit0+bit1 pays WBNB.
    function sell(address token, uint256 amount, uint256 minReceiveAmount, uint256 options, bytes calldata proof) external;

    function wrappedNative() external view returns (address);
    function zapRouter() external view returns (address);
    /// @dev Must match `IOpenFourFeeRouter public feeRouter` getter return type.
    function feeRouter() external view returns (IOpenFourFeeRouter);
    /// @dev Must match `IOpenFourRegistry public registry` getter return type.
    function registry() external view returns (IOpenFourRegistry);

    /// @dev Must match the compiler-generated getter for `mapping(address => RuntimeConfig) public tokens`.
    function tokens(address token_)
        external
        view
        returns (
            uint32 version,
            address creator,
            uint256 presetId,
            address token,
            string memory name,
            string memory symbol,
            uint256 maxSupply,
            uint256 saleAmount,
            uint256 raiseAmount,
            address quoteAsset,
            address vault,
            address curveModule,
            address tradeModule,
            address migrateModule,
            address tokenModule,
            address customData,
            uint256 createBlock,
            bool exists,
            bool paused,
            bool antiSniperEnabled
        );
}
