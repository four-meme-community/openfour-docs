// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ─── PancakeSwap Infinity (CL) aligned types ─────────────────────────────────
// PoolKey / PoolId follow infinity-core `src/types/PoolKey.sol` + `PoolId.sol`.
// Position manager entrypoint follows infinity-periphery `CLPositionManager.modifyLiquidities`.

/// @dev V4 currency is simply an address (or address(0) for native).
type Currency is address;

library CurrencyLibrary {
    function unwrap(Currency currency) internal pure returns (address) {
        return Currency.unwrap(currency);
    }

    function wrap(address addr) internal pure returns (Currency) {
        return Currency.wrap(addr);
    }

    /// @dev Orders two currencies so currency0 < currency1 (by address value).
    function sort(address a, address b) internal pure returns (Currency c0, Currency c1) {
        return a < b ? (Currency.wrap(a), Currency.wrap(b)) : (Currency.wrap(b), Currency.wrap(a));
    }
}

/// @dev CL pool key (Pancake Infinity / infinity-core layout).
struct PoolKey {
    Currency currency0;
    Currency currency1;
    address hooks;
    /// @dev Must be the CLPoolManager that will own the pool (address of the manager contract).
    address poolManager;
    uint24 fee;
    /// @dev CL tick spacing is packed at bit offset 16 (24 bits), per CLPoolParametersHelper.
    bytes32 parameters;
}

type PoolId is bytes32;

library PoolIdLibrary {
    /// @dev keccak256(abi.encodePacked(struct)) over 6 words — matches PoolIdLibrary in infinity-core.
    function toId(PoolKey memory poolKey) internal pure returns (PoolId poolId) {
        assembly ("memory-safe") {
            poolId := keccak256(poolKey, 0xc0)
        }
    }
}

/// @dev Pancake Infinity CL hook registration offsets (`ICLHooks.sol` in infinity-core).
library PancakeInfinityHookBitmap {
    uint8 internal constant HOOKS_BEFORE_INITIALIZE_OFFSET = 0;
    uint8 internal constant HOOKS_BEFORE_ADD_LIQUIDITY_OFFSET = 2;
    uint8 internal constant HOOKS_AFTER_ADD_LIQUIDITY_OFFSET = 3;
    uint8 internal constant HOOKS_BEFORE_REMOVE_LIQUIDITY_OFFSET = 4;
    uint8 internal constant HOOKS_AFTER_REMOVE_LIQUIDITY_OFFSET = 5;
    uint8 internal constant HOOKS_BEFORE_SWAP_OFFSET = 6;
    uint8 internal constant HOOKS_AFTER_SWAP_OFFSET = 7;
    uint8 internal constant HOOKS_BEFORE_SWAP_RETURNS_DELTA_OFFSET = 10;
    uint8 internal constant HOOKS_AFTER_SWAP_RETURNS_DELTA_OFFSET = 11;

    /// @dev UniTokenV4Hook: gate initialize + pre-migration LP; afterAddLiquidity + afterSwap for runtime.
    uint16 internal constant UNITOKEN_HOOK_BITMAP = uint16(
        (1 << HOOKS_BEFORE_INITIALIZE_OFFSET) | (1 << HOOKS_BEFORE_ADD_LIQUIDITY_OFFSET)
            | (1 << HOOKS_AFTER_ADD_LIQUIDITY_OFFSET) | (1 << HOOKS_AFTER_SWAP_OFFSET)
    );

    /// @dev Stock4 Shared Inventory Hook (contracts/stock4/sih): JIT liquidity + quote swap tax via return deltas, plus
    ///      the four add/remove-liquidity callbacks (pass-through today, reserved for upgrades) = 0x0cfd.
    uint16 internal constant SIH_TAX_HOOK_BITMAP = uint16(
        (1 << HOOKS_BEFORE_INITIALIZE_OFFSET) | (1 << HOOKS_BEFORE_ADD_LIQUIDITY_OFFSET)
            | (1 << HOOKS_AFTER_ADD_LIQUIDITY_OFFSET) | (1 << HOOKS_BEFORE_REMOVE_LIQUIDITY_OFFSET)
            | (1 << HOOKS_AFTER_REMOVE_LIQUIDITY_OFFSET) | (1 << HOOKS_BEFORE_SWAP_OFFSET) | (1 << HOOKS_AFTER_SWAP_OFFSET)
            | (1 << HOOKS_BEFORE_SWAP_RETURNS_DELTA_OFFSET) | (1 << HOOKS_AFTER_SWAP_RETURNS_DELTA_OFFSET)
    );
}

/// @dev Pancake Infinity `IHooks` — hook contract must expose registration bitmap.
interface IPancakeHooksRegistration {
    function getHooksRegistrationBitmap() external view returns (uint16);
}

/// @dev CL pool parameters layout (infinity-core CLPoolParametersHelper):
///   [0..15]   hooks registration bitmap (uint16)
///   [16..39]  tickSpacing (int24)
library PancakeInfinityClParams {
    uint256 private constant OFFSET_TICK_SPACING = 16;
    uint256 private constant MASK_UINT24 = 0xffffff;
    uint256 private constant MASK_UINT16 = 0xffff;

    /// @notice Pack hook bitmap (low 16 bits) + tickSpacing (offset 16).
    function encodePoolParameters(int24 tickSpacing, uint16 hooksBitmap) internal pure returns (bytes32 p) {
        uint256 ts = uint256(uint24(uint256(int256(tickSpacing))));
        assembly ("memory-safe") {
            p := or(shl(OFFSET_TICK_SPACING, and(ts, MASK_UINT24)), and(hooksBitmap, MASK_UINT16))
        }
    }

    /// @notice Tick spacing only; hook bitmap = 0 (no-hook pools).
    function encodeTickSpacing(int24 tickSpacing) internal pure returns (bytes32 p) {
        return encodePoolParameters(tickSpacing, 0);
    }
}

/// @dev Parameters for modifyLiquidity (add / remove).
struct ModifyLiquidityParams {
    int24 tickLower;
    int24 tickUpper;
    int256 liquidityDelta;
    bytes32 salt;
}

/// @dev Parameters for a swap.
struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

/// @dev Signed balance delta returned by pool operations.
type BalanceDelta is int256;

library BalanceDeltaLibrary {
    function amount0(BalanceDelta delta) internal pure returns (int128) {
        return int128(BalanceDelta.unwrap(delta) >> 128);
    }

    function amount1(BalanceDelta delta) internal pure returns (int128) {
        return int128(BalanceDelta.unwrap(delta));
    }
}

// ─── IPoolManager (CL) ────────────────────────────────────────────────────────

interface IPoolManager {
    /// @notice Initialize a new pool.
    function initialize(PoolKey memory key, uint160 sqrtPriceX96) external returns (int24 tick);

    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData)
        external
        returns (BalanceDelta);

    function modifyLiquidity(
        PoolKey memory key,
        ModifyLiquidityParams memory params,
        bytes calldata hookData
    ) external returns (BalanceDelta callerDelta, BalanceDelta feesAccrued);

    function sync(Currency currency) external;
    function settle() external payable returns (uint256);
    function take(Currency currency, address to, uint256 amount) external;
    function mint(address to, uint256 id, uint256 amount) external;
    function burn(address from, uint256 id, uint256 amount) external;
}

// ─── IPositionManager (Infinity periphery) ─────────────────────────────────

/// @dev Pancake `CLPositionManager` batches liquidity via `modifyLiquidities`.
interface IPositionManager {
    function nextTokenId() external view returns (uint256);
    function modifyLiquidities(bytes calldata payload, uint256 deadline) external payable;
}

// ─── IHooks (callback interface) ─────────────────────────────────────────────

/// @dev Hook permissions bitmap. Only the flags used by UniTokenV4Hook are true.
struct HookPermissions {
    bool beforeInitialize;
    bool afterInitialize;
    bool beforeAddLiquidity;
    bool afterAddLiquidity;
    bool beforeRemoveLiquidity;
    bool afterRemoveLiquidity;
    bool beforeSwap;
    bool afterSwap;
    bool beforeDonate;
    bool afterDonate;
    bool beforeSwapReturnDelta;
    bool afterSwapReturnDelta;
    bool afterAddLiquidityReturnDelta;
    bool afterRemoveLiquidityReturnDelta;
}

/// @dev Subset of V4 hook callbacks used by UniTokenV4Hook.
interface IHooks {
    function beforeInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96)
        external
        returns (bytes4);

    function beforeAddLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata hookData
    ) external returns (bytes4);

    function afterAddLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        BalanceDelta delta,
        BalanceDelta feesAccrued,
        bytes calldata hookData
    ) external returns (bytes4 selector, BalanceDelta hookDelta);

    function afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) external returns (bytes4 selector, int128 hookDeltaSpecified);
}

// ─── IRandomSeedProvider ─────────────────────────────────────────────────────

interface IRandomSeedProvider {
    function randomSeed() external view returns (uint256);
}
