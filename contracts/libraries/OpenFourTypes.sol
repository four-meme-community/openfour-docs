// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Describes a single parameter in a module's ABI-encoded params blob.
/// The front-end derives encoding purely from these fields — no separate enum lookup.
///
/// Encoding rules (applied in order):
///   1. decimals > 0  → parseUnits(userInput, decimals)
///   2. otherwise     → pass BigInt(userInput) raw (or direct string/address/bool)
///
/// Time fields: contracts accept duration-in-seconds and compute block.timestamp + duration
/// internally in init(), so no special front-end time-offset logic is required.
struct ParamDescriptor {
    string  name;               // machine-readable field name; matches form field key
    string  abiType;            // Solidity ABI type: "uint256","uint16","uint8","address","bool","string"
    uint8   decimals;           // 0 = raw; >0 = fixed precision (e.g. 18 for quote asset)
    bool    optional;           // true → encode zero-value when form field is absent/empty
    string  title;              // human-readable field label for the UI
    string  defaultValue;       // default form value as string (e.g. "1000", "0x0…", "true")
    string  hint;               // optional help text shown below the field
    string  minValue;           // "" = no constraint; for uint*: min value; for string: min length
    string  maxValue;           // "" = no constraint; for uint*: max value; for string: max length
}

/// @notice Full encoding schema for one module slot (curve / trade / migrate).
/// params order == ABI encode order; always use flat abi.encode(types, values).
struct ModuleEncodeSchema {
    string            kind;    // "curve" | "trade" | "migrate"
    uint8             version;
    ParamDescriptor[] params;
}

library OpenFourTypes {
    error TradeNotAllowed();

    /// @dev Byte 0 of `IOpenFourCore.TokenCreated.encodedTags`; bump when slot order or hash semantics change.
    uint8 internal constant CREATION_TAGS_SCHEMA_V1 = 1;
    /// @dev Sell option bit0: keep WBNB instead of unwrapping after a direct or bit1 Zap payout.
    uint256 internal constant TRADE_OPTION_RECEIVE_WRAPPED_NATIVE = 1 << 0;
    /// @dev Trade option bit1: use ZapRouter for native BNB/WBNB input/output estimation or execution.
    uint256 internal constant TRADE_OPTION_ZAP_NATIVE = 1 << 1;

    enum Phase {
        Created,
        Trading,
        MigratePending,
        Migrated,
        Terminal,
        SoldOut
    }

    struct ModuleMetadata {
        bytes32 moduleId;
        string version;
        string name;
        string description;
        address author;
        uint16 feeShareBps;
    }

    struct Preset {
        uint256 id;
        /// @dev Human-readable preset label for UI / indexers.
        string name;
        /// @dev Longer explanation of what this preset does.
        string description;
        /// @dev Semantic version of this preset composition (not Solidity pragma).
        string version;
        /// @dev Whether preset can be resolved by `resolvePresetImplementations`.
        bool active;
        /// @dev Whether new tokens can be created with this preset.
        ///      Set to false to stop new creations without deactivating existing tokens.
        bool createEnabled;
        /// @dev Optional preset-level validation hook used by OpenFourCore during create.
        address validator;
        bytes32 tokenModuleId;
        bytes32 vaultModuleId;
        bytes32 curveModuleId;
        bytes32 tradeModuleId;
        bytes32 migrateModuleId;
        /// @dev Token implementation registry key resolved at create time.
        bytes32 tokenImplId;
        /// @dev Optional module registry key for the per-token customData BeaconProxy.
        ///      Zero = no customData for this preset.
        bytes32 customDataId;
        /// @dev Recipient of developer fee pool for trades using this preset (claim via FeeRouter).
        address author;
    }

    struct TokenInitParams {
        string name;
        string symbol;
        string tokenUri;
        uint256 maxSupply;
        uint256 saleAmount;
        uint256 raiseAmount;
        address quoteAsset;
        bytes32 tokenSalt;
        bytes tokenParams;
        bytes vaultParams;
        bytes curveParams;
        bytes tradeParams;
        bytes migrateParams;
        /// @dev Forwarded verbatim to IOpenFourCustomDataModule.init() when preset has a customDataId.
        bytes customDataParams;
    }

    struct TokenCreateParams {
        uint256 requestId;
        string name;
        string symbol;
        uint256 maxSupply;
        uint256 saleAmount;
        uint256 raiseAmount;
        address quoteAsset;
        string tokenUri;
        bytes tokenParams;
        bytes32 tokenSalt;
    }

    struct CreateTokenArgs {
        uint256 requestId;
        uint256 presetId;
        uint256 validTimestamp;
        uint256 createFee;
        /// @dev Quote amount (gross, including fees) for an immediate post-creation buy.
        ///      0 = no presale. Excess quote beyond actual spend is refunded to the creator.
        uint256 presaleQuote;
        bool antiSniperEnabled;
        address partner;
        TokenInitParams initParams;
    }

    struct RuntimeConfig {
        uint32 version;
        address creator;
        uint256 presetId;
        address token;
        string name;
        string symbol;
        uint256 maxSupply;
        uint256 saleAmount;
        uint256 raiseAmount;
        address quoteAsset;
        address vault;
        address curveModule;
        address tradeModule;
        address migrateModule;
        address tokenModule;
        address customData;
        uint256 createBlock;
        bool exists;
        bool paused;
        /// @dev When true, early-block anti-sniper surcharge applies (see OpenFourAntiSniper ladder).
        bool antiSniperEnabled;
    }

    struct CurveContext {
        address token;
        address trader;
        uint256 amount;
        bool isBuy;
        uint256 remainingForSale;
        uint256 totalRaised;
        uint256 timestamp;
        bytes proof;
    }

    struct CurveResult {
        bool executable;
        uint256 quoteAmount;
        uint256 adjustedAmount;
        string reason;
    }

    struct CurveLiquiditySnapshot {
        /// @dev Whether curve module supports standardized liquidity snapshot.
        bool available;
        /// @dev Initial quote-side liquidity proxy at curve init.
        uint256 initialQuoteLiquidity;
        /// @dev Initial token-side liquidity proxy at curve init.
        uint256 initialTokenLiquidity;
        /// @dev Current quote-side liquidity proxy.
        uint256 currentQuoteLiquidity;
        /// @dev Current token-side liquidity proxy.
        uint256 currentTokenLiquidity;
        /// @dev Current remaining token amount available for sale.
        uint256 remainingForSale;
        /// @dev Current accumulated raised quote amount.
        uint256 totalRaised;
        /// @dev Price in quote per 1 token (scaled 1e18), if applicable.
        uint256 lastPrice;
    }

    struct FeeTier {
        address recipient;
        uint16 bps;
    }

    /// @dev Settlement passed from OpenFourCore to vault after FeeRouter payment (`TradePaymentResult`).
    struct VaultTradeParams {
        address trader;
        uint256 tokenAmount;
        uint256 curveQuote;
        uint256 protocolFee;
        uint256 taxFee;
        uint256 devFee;
        uint256 antiSniperQuote;
    }

    struct TradeContext {
        address token;
        address trader;
        uint256 amount;
        bool isBuy;
        uint256 timestamp;
        uint256 blockNumber;
        uint256 remainingForSale;
        uint256 totalRaised;
        uint256 curveQuote;
        bytes proof;
    }

    struct TradeResult {
        bool allowed;
        uint256 minAmount;
        uint256 maxAmount;
        FeeTier[] fees;
        /// @dev ABI-encoded revert payload used when `allowed` is false.
        bytes revertData;
    }

    /// @dev Bubbles a trade module's rejection payload unchanged.
    function revertIfDisallowed(TradeResult memory result) internal pure {
        if (result.allowed) return;
        bytes memory data = result.revertData;
        if (data.length == 0) revert TradeNotAllowed();
        assembly ("memory-safe") {
            revert(add(data, 0x20), mload(data))
        }
    }

    struct TradeHookContext {
        address token;
        address trader;
        uint256 requestedAmount;
        uint256 executedAmount;
        bool isBuy;
        uint256 timestamp;
        uint256 blockNumber;
        uint256 curveQuote;
        /// @dev Trader's actual quote flow: grossQuote + totalFee on buy, grossQuote - totalFee on sell.
        uint256 traderQuote;
        bytes proof;
    }

    struct MigrateContext {
        address token;
        uint256 totalRaised;
        uint256 remainingForSale;
        bool soldOut;
        uint256 timestamp;
    }

    struct MigrateResult {
        bool canMigrate;
        bytes data;
        string reason;
    }

    struct MigrateHookContext {
        address vault;
        address token;
        address quoteAsset;
        address creator;
        uint256 totalRaised;
        uint256 remainingForSale;
        uint256 timestamp;
    }
}
