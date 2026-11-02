// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IOpenFourMigrateModule} from "../../interfaces/IOpenFourMigrateModule.sol";
import {IOpenFourModuleSchema} from "../../interfaces/IOpenFourModuleSchema.sol";
import {IOpenFourToken} from "../../interfaces/IOpenFourToken.sol";
import {IOpenFourVault} from "../../interfaces/IOpenFourVault.sol";
import {PancakeV2MigrateLib} from "../../libraries/PancakeV2MigrateLib.sol";
import {OpenFourTypes, ParamDescriptor, ModuleEncodeSchema} from "../../libraries/OpenFourTypes.sol";

/// @title FairLaunchMigrateModule
/// @notice FairLaunch graduation: sold out / soft cap / timeout, then OpenFour-style PCS V2 add-liquidity.
/// @dev Matches the public PCS V2 migrate payload: `migratedDataVersion = 1`, `encodedMigratedData = abi.encode(pair)`.
///      Router is selected by chainid (BSC / BSC Testnet). LP is minted to `0xdead`.
contract FairLaunchMigrateModule is Initializable, IOpenFourMigrateModule, IOpenFourModuleSchema {
    address internal constant LP_RECIPIENT_DEAD = 0x000000000000000000000000000000000000dEaD;
    address internal constant BSC_V2_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    address internal constant BSC_TESTNET_V2_ROUTER = 0xD99D1c33F9fC3444f8101754aBC46c52416550D1;
    uint8 private constant PCS_V2_ENCODED_MIGRATED_DATA_V1 = 1;

    /// @notice Stored migration configuration.
    /// @param softCap Quote amount that can trigger migration before duration ends. Zero disables it.
    /// @param endTime Absolute timestamp when migration becomes available.
    /// @param tokenLiquidityAmount Token amount into the pair. Zero means `maxSupply - sold`.
    /// @param maxQuoteToUse Maximum quote into the pair. Zero means all `totalRaised`.
    struct Params {
        uint256 softCap;
        uint256 endTime;
        uint256 tokenLiquidityAmount;
        uint256 maxQuoteToUse;
    }

    /// @notice ABI input layout supplied at token creation.
    /// @dev `duration` is converted to an absolute `endTime` during initialization.
    struct InputParams {
        uint256 softCap;
        uint256 duration;
        uint256 tokenLiquidityAmount;
        uint256 maxQuoteToUse;
    }

    address public boundToken;
    address public fourCore;
    Params public params;
    bytes private _initParams;
    string private _moduleVersion;

    modifier onlyFourCore() {
        require(msg.sender == fourCore, "FairMigrate: only fourCore");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function init(address token, address fourCore_, address, bytes calldata rawParams, string calldata moduleVersion_)
        external
        override
        initializer
    {
        require(fourCore_ != address(0), "FairMigrate: zero fourCore");
        InputParams memory inp = abi.decode(rawParams, (InputParams));

        boundToken = token;
        fourCore = fourCore_;
        params = Params({
            softCap: inp.softCap,
            endTime: block.timestamp + inp.duration,
            tokenLiquidityAmount: inp.tokenLiquidityAmount,
            maxQuoteToUse: inp.maxQuoteToUse
        });
        _initParams = rawParams;
        _moduleVersion = moduleVersion_;
    }

    function descriptor() external view override returns (bytes8 tagId, string memory tag, string memory version) {
        tag = "module.migrate.fair_launch";
        return (bytes8(keccak256(bytes(tag))), tag, _moduleVersion);
    }

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

    /// @dev Rechecks conditions, then adds liquidity to an empty official PCS V2 pair.
    function executeMigration(OpenFourTypes.MigrateHookContext calldata ctx, bytes calldata hookData)
        external
        override
        onlyFourCore
        returns (uint8 migratedDataVersion, bytes memory encodedMigratedData)
    {
        require(ctx.token == boundToken, "FairMigrate: wrong token");
        require(_canMigrate(ctx.remainingForSale <= 1e18, ctx.totalRaised, ctx.timestamp), "FairMigrate: conditions not met");

        address router = _router();
        if (router == address(0)) {
            return (0, "");
        }

        uint256 hintedQuote = hookData.length == 0 ? ctx.totalRaised : abi.decode(hookData, (uint256));
        if (hintedQuote > ctx.totalRaised) hintedQuote = ctx.totalRaised;
        uint256 quoteToUse = _cappedQuoteToUse(hintedQuote);
        require(quoteToUse > 0, "FairMigrate: zero quote");

        PancakeV2MigrateLib.LiqParams memory lp;
        lp.router = router;
        lp.lpRecipient = LP_RECIPIENT_DEAD;
        lp.tokenLiquidityAmount = _tokenLiquidityAmount(ctx.token, ctx.vault);
        lp.quoteToUse = quoteToUse;

        address pair = PancakeV2MigrateLib.executePancakeLiquidity(lp, ctx);
        require(pair != address(0), "FairMigrate: pair missing");
        IOpenFourToken(ctx.token).setMigratedPool(pair, true);
        return (PCS_V2_ENCODED_MIGRATED_DATA_V1, abi.encode(pair));
    }

    function moduleEncodeSchema() external pure override returns (ModuleEncodeSchema memory) {
        ParamDescriptor[] memory p = new ParamDescriptor[](4);
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
            name: "tokenLiquidityAmount",
            abiType: "uint256",
            decimals: 0,
            optional: true,
            title: "Token liquidity amount",
            defaultValue: "0",
            hint: "0 means maxSupply - sold.",
            minValue: "0",
            maxValue: ""
        });
        p[3] = ParamDescriptor({
            name: "maxQuoteToUse",
            abiType: "uint256",
            decimals: 18,
            optional: true,
            title: "Max quote to use",
            defaultValue: "0",
            hint: "0 means all totalRaised.",
            minValue: "0",
            maxValue: ""
        });
        return ModuleEncodeSchema("migrate", 1, p);
    }

    function getInitParams() external view returns (bytes memory) {
        return _initParams;
    }

    function _canMigrate(bool soldOut, uint256 totalRaised, uint256 timestamp) internal view returns (bool) {
        return soldOut || (params.softCap > 0 && totalRaised >= params.softCap) || (timestamp >= params.endTime);
    }

    function _router() internal view returns (address) {
        if (block.chainid == 56) {
            return BSC_V2_ROUTER;
        }
        if (block.chainid == 97) {
            return BSC_TESTNET_V2_ROUTER;
        }
        return address(0);
    }

    function _cappedQuoteToUse(uint256 quoteAmount) internal view returns (uint256) {
        if (params.maxQuoteToUse > 0 && quoteAmount > params.maxQuoteToUse) {
            return params.maxQuoteToUse;
        }
        return quoteAmount;
    }

    function _tokenLiquidityAmount(address token, address vault) internal view returns (uint256) {
        if (params.tokenLiquidityAmount > 0) {
            return params.tokenLiquidityAmount;
        }
        uint256 maxSupply = IOpenFourToken(token).maxSupply();
        uint256 sold = IOpenFourVault(vault).soldAmount();
        require(maxSupply > sold, "FairMigrate: no token liquidity");
        return maxSupply - sold;
    }
}
