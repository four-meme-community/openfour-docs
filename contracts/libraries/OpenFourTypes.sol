// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

struct ParamDescriptor {
    string name;
    string abiType;
    uint8 decimals;
    bool optional;
    string title;
    string defaultValue;
    string hint;
    string minValue;
    string maxValue;
}

struct ModuleEncodeSchema {
    string kind;
    uint8 version;
    ParamDescriptor[] params;
}

library OpenFourTypes {
    uint8 internal constant CREATION_TAGS_SCHEMA_V1 = 1;

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
        string name;
        string description;
        string version;
        bool active;
        bool createEnabled;
        address validator;
        bytes32 tokenModuleId;
        bytes32 vaultModuleId;
        bytes32 curveModuleId;
        bytes32 tradeModuleId;
        bytes32 migrateModuleId;
        bytes32 tokenImplId;
        bytes32 customDataId;
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
        uint256 presaleQuote;
        bool antiSniperEnabled;
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
        bool available;
        uint256 initialQuoteLiquidity;
        uint256 initialTokenLiquidity;
        uint256 currentQuoteLiquidity;
        uint256 currentTokenLiquidity;
        uint256 remainingForSale;
        uint256 totalRaised;
        uint256 lastPrice;
    }

    struct FeeTier {
        address recipient;
        uint16 bps;
    }

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
        string reason;
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
