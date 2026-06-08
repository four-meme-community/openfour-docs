// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IOpenFourMigrateModule} from "../../interfaces/IOpenFourMigrateModule.sol";
import {IOpenFourModuleSchema} from "../../interfaces/IOpenFourModuleSchema.sol";
import {IOpenFourToken} from "../../interfaces/IOpenFourToken.sol";
import {IPancakeV2MigrationAdapter} from "../../interfaces/IPancakeV2MigrationAdapter.sol";
import {OpenFourTypes, ParamDescriptor, ModuleEncodeSchema} from "../../libraries/OpenFourTypes.sol";

/// @title FairLaunchMigrateModule
/// @notice Reference migration module for a fixed-duration / soft-cap FairLaunch preset.
/// @dev Migrate modules decide when launch trading should end and optionally execute final
///      liquidity actions. Low-level DEX routing is intentionally delegated to an adapter in
///      this docs skeleton so the OpenFour-facing interface stays clear.
contract FairLaunchMigrateModule is Initializable, IOpenFourMigrateModule, IOpenFourModuleSchema {
    /// @dev Module-local payload version: `encodedMigratedData = abi.encode(address pair)`.
    uint8 private constant PCS_V2_ENCODED_MIGRATED_DATA_V1 = 1;

    /// @notice Stored migration configuration.
    /// @param softCap Quote amount that can trigger migration before duration ends. Zero disables it.
    /// @param endTime Absolute timestamp when migration becomes available.
    /// @param migrationAdapter Optional adapter that performs DEX liquidity actions.
    /// @param lpRecipient Recipient of LP tokens created by the adapter.
    /// @param tokenLiquidityAmount Token amount sent into liquidity.
    /// @param maxQuoteToUse Maximum quote amount that may be migrated into liquidity. Zero means all raised quote.
    struct Params {
        uint256 softCap;
        uint256 endTime;
        address migrationAdapter;
        address lpRecipient;
        uint256 tokenLiquidityAmount;
        uint256 maxQuoteToUse;
    }

    /// @notice ABI input layout supplied at token creation.
    /// @dev `duration` is converted to an absolute `endTime` during initialization.
    struct InputParams {
        uint256 softCap;
        uint256 duration;
        address migrationAdapter;
        address lpRecipient;
        uint256 tokenLiquidityAmount;
        uint256 maxQuoteToUse;
    }

    address public boundToken;
    address public fourCore;
    Params public params;
    bytes private _initParams;
    string private _moduleVersion;

    /// @dev OpenFourCore is the only caller allowed to ask for or execute migration.
    modifier onlyFourCore() {
        require(msg.sender == fourCore, "FairMigrate: only fourCore");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes this module clone for one OpenFour token.
    /// @param token Token bound to this module clone.
    /// @param fourCore_ Core contract that owns module execution.
    /// @param rawParams ABI-encoded `InputParams`.
    /// @param moduleVersion_ Version string stored for registry/indexer display.
    function init(address token, address fourCore_, address, bytes calldata rawParams, string calldata moduleVersion_)
        external
        override
        initializer
    {
        require(fourCore_ != address(0), "FairMigrate: zero fourCore");
        InputParams memory inp = abi.decode(rawParams, (InputParams));
        if (inp.migrationAdapter != address(0)) {
            require(inp.tokenLiquidityAmount > 0, "FairMigrate: zero tokenLiquidity");
        }

        boundToken = token;
        fourCore = fourCore_;
        params = Params({
            softCap: inp.softCap,
            endTime: block.timestamp + inp.duration,
            migrationAdapter: inp.migrationAdapter,
            lpRecipient: inp.lpRecipient,
            tokenLiquidityAmount: inp.tokenLiquidityAmount,
            maxQuoteToUse: inp.maxQuoteToUse
        });
        _initParams = rawParams;
        _moduleVersion = moduleVersion_;
    }

    /// @notice Returns the stable registry tag and the version captured at initialization.
    function descriptor() external view override returns (bytes8 tagId, string memory tag, string memory version) {
        tag = "module.migrate.fair_launch";
        return (bytes8(keccak256(bytes(tag))), tag, _moduleVersion);
    }

    /// @notice Checks whether launch trading should migrate.
    /// @dev Migration can trigger when sale inventory is exhausted, the soft cap is reached, or the duration expires.
    ///      The encoded data carries a capped `quoteToUse` hint for `executeMigration`.
    function evaluate(OpenFourTypes.MigrateContext calldata ctx)
        external
        view
        override
        onlyFourCore
        returns (OpenFourTypes.MigrateResult memory)
    {
        require(fourCore != address(0), "FairMigrate: not initialized");
        require(ctx.token == boundToken, "FairMigrate: wrong token");
        if (!_canMigrate(ctx.soldOut, ctx.totalRaised, ctx.timestamp)) {
            return OpenFourTypes.MigrateResult({canMigrate: false, data: "", reason: "Launch conditions not met"});
        }

        uint256 quoteToUse = _cappedQuoteToUse(ctx.totalRaised);
        return OpenFourTypes.MigrateResult({canMigrate: true, data: abi.encode(quoteToUse), reason: ""});
    }

    /// @notice Executes optional post-launch liquidity migration.
    /// @dev This docs example accepts `hookData` from `evaluate`, but still re-applies the cap here.
    ///      Rechecking execution-time invariants avoids turning encoded data into an authority boundary.
    function executeMigration(OpenFourTypes.MigrateHookContext calldata ctx, bytes calldata hookData)
        external
        override
        onlyFourCore
        returns (uint8 migratedDataVersion, bytes memory encodedMigratedData)
    {
        require(ctx.token == boundToken, "FairMigrate: wrong token");
        require(_canMigrate(ctx.soldOut, ctx.totalRaised, ctx.timestamp), "FairMigrate: conditions not met");
        if (params.migrationAdapter == address(0)) {
            return (0, "");
        }

        uint256 hintedQuote = hookData.length == 0 ? ctx.totalRaised : abi.decode(hookData, (uint256));
        if (hintedQuote > ctx.totalRaised) hintedQuote = ctx.totalRaised;
        uint256 quoteToUse = _cappedQuoteToUse(hintedQuote);
        address pair = IPancakeV2MigrationAdapter(params.migrationAdapter).executeLiquidity(
            ctx,
            quoteToUse,
            params.tokenLiquidityAmount,
            params.lpRecipient
        );
        require(pair != address(0), "FairMigrate: pair missing");
        IOpenFourToken(ctx.token).setMigratedPool(pair, true);
        return (PCS_V2_ENCODED_MIGRATED_DATA_V1, abi.encode(pair));
    }

    /// @notice Describes the ABI layout expected by `init`.
    /// @dev Off-chain builders can use this schema to render forms and encode `InputParams`.
    function moduleEncodeSchema() external pure override returns (ModuleEncodeSchema memory) {
        ParamDescriptor[] memory p = new ParamDescriptor[](6);
        p[0] = ParamDescriptor({
            name: "softCap",
            abiType: "uint256",
            decimals: 18,
            optional: true,
            title: "Soft cap (quote asset)",
            defaultValue: "0",
            hint: "Reaching the soft cap triggers migration; 0 disables the soft cap.",
            minValue: "0",
            maxValue: ""
        });
        p[1] = ParamDescriptor({
            name: "duration",
            abiType: "uint256",
            decimals: 0,
            optional: true,
            title: "Duration (seconds)",
            defaultValue: "86400",
            hint: "Fair launch duration; 0 means the launch can migrate immediately.",
            minValue: "0",
            maxValue: ""
        });
        p[2] = ParamDescriptor({
            name: "migrationAdapter",
            abiType: "address",
            decimals: 0,
            optional: true,
            title: "Migration adapter",
            defaultValue: "",
            hint: "0x0 skips on-chain liquidity actions.",
            minValue: "",
            maxValue: ""
        });
        p[3] = ParamDescriptor({
            name: "lpRecipient",
            abiType: "address",
            decimals: 0,
            optional: true,
            title: "LP recipient",
            defaultValue: "",
            hint: "",
            minValue: "",
            maxValue: ""
        });
        p[4] = ParamDescriptor({
            name: "tokenLiquidityAmount",
            abiType: "uint256",
            decimals: 0,
            optional: false,
            title: "Token liquidity amount",
            defaultValue: "0",
            hint: "",
            minValue: "0",
            maxValue: ""
        });
        p[5] = ParamDescriptor({
            name: "maxQuoteToUse",
            abiType: "uint256",
            decimals: 18,
            optional: true,
            title: "Max quote to use",
            defaultValue: "0",
            hint: "0 means unlimited.",
            minValue: "0",
            maxValue: ""
        });
        return ModuleEncodeSchema("migrate", 1, p);
    }

    /// @notice Returns the raw ABI-encoded params used to initialize this module clone.
    function getInitParams() external view returns (bytes memory) {
        return _initParams;
    }

    /// @dev Shared migration predicate used by both `evaluate` and `executeMigration`.
    function _canMigrate(bool soldOut, uint256 totalRaised, uint256 timestamp) internal view returns (bool) {
        return soldOut || (params.softCap > 0 && totalRaised >= params.softCap) || (timestamp >= params.endTime);
    }

    /// @dev Applies the migration quote cap consistently in both evaluation and execution paths.
    function _cappedQuoteToUse(uint256 quoteAmount) internal view returns (uint256) {
        if (params.maxQuoteToUse > 0 && quoteAmount > params.maxQuoteToUse) {
            return params.maxQuoteToUse;
        }
        return quoteAmount;
    }
}
