// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IZapRouter
/// @notice Public configured-route quoting and execution for ERC-20 and native multi-DEX swaps.
interface IZapRouter {
    /// @dev `token == address(0)` denotes a native-currency refund.
    event RouteInputRefunded(address indexed payer, address indexed token, uint256 amount);

    event ERC20Rescued(address indexed token, address indexed recipient, uint256 amount);

    /// @notice Quote an exact ERC-20 input through the configured route.
    function quoteExactInput(address tokenIn, address tokenOut, uint256 amountIn)
        external
        returns (uint256 amountOut, address[] memory midTokens);

    /// @notice Quote the ERC-20 input required for an exact output through the configured route.
    function quoteExactOutput(address tokenIn, address tokenOut, uint256 amountOut)
        external
        returns (uint256 amountIn, address[] memory midTokens);

    /// @notice Swap an exact ERC-20 input, enforce a minimum output, and refund
    ///         any input-side token left by a partial hop to `msg.sender`.
    function swapExactInput(
        address tokenIn,
        address tokenOut,
        address recipient,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external returns (uint256 amountOut, address[] memory midTokens);

    /// @notice Receive an exact ERC-20 output, spending at most `maxAmountIn`.
    function swapExactOutput(
        address tokenIn,
        address tokenOut,
        address recipient,
        uint256 amountOut,
        uint256 maxAmountIn,
        uint256 deadline
    ) external returns (uint256 amountIn, address[] memory midTokens);

    /// @notice Quote the configured route that `swapNativeToToken` would execute for `amountIn`.
    /// @dev `midTokens` lists configured intermediate tokens; it is empty for a direct route.
    function quoteNativeToToken(address tokenOut, uint256 amountIn)
        external
        returns (uint256 amountOut, address[] memory midTokens);

    /// @notice Quote an exact native input through a configured bridge route
    ///         and a dynamic final DEX hop.
    function quoteNativeToTokenViaBridge(
        address bridgeToken,
        address tokenOut,
        uint8 finalDexId,
        uint24 finalFee,
        uint256 amountIn
    ) external returns (uint256 amountOut, address[] memory midTokens);

    /// @notice Quote native input required to receive exactly `amountOut`.
    function quoteNativeForExactToken(address tokenOut, uint256 amountOut)
        external
        returns (uint256 amountIn, address[] memory midTokens);

    /// @notice Quote native input for an exact token output through the
    ///         configured WBNB-to-bridge route and a dynamic final DEX hop.
    function quoteNativeForExactTokenViaBridge(
        address bridgeToken,
        address tokenOut,
        uint8 finalDexId,
        uint24 finalFee,
        uint256 amountOut
    ) external returns (uint256 amountIn, address[] memory midTokens);

    /// @notice Execute the configured native-BNB route, send output to `recipient`,
    ///         and refund input-side leftovers to `msg.sender`.
    /// @dev `midTokens` matches `quoteNativeToToken`: intermediate hop tokens, empty for a direct route.
    function swapNativeToToken(
        address tokenOut,
        address recipient,
        uint256 minAmountOut,
        uint256 deadline
    )
        external
        payable
        returns (uint256 amountOut, address[] memory midTokens);

    /// @notice Spend up to `msg.value` through a configured bridge route and
    ///         dynamic final DEX hop, refunding input-side leftovers.
    function swapNativeToTokenViaBridge(
        address bridgeToken,
        address tokenOut,
        uint8 finalDexId,
        uint24 finalFee,
        address recipient,
        uint256 minAmountOut,
        uint256 deadline
    ) external payable returns (uint256 amountOut, address[] memory midTokens);

    /// @notice Receive exactly `amountOut` and refund unused `msg.value` as native currency.
    function swapNativeForExactToken(
        address tokenOut,
        address recipient,
        uint256 amountOut,
        uint256 deadline
    ) external payable returns (uint256 amountIn, address[] memory midTokens);

    /// @notice Receive an exact token output through a configured bridge route
    ///         and dynamic final DEX hop, refunding unused input as native currency.
    function swapNativeForExactTokenViaBridge(
        address bridgeToken,
        address tokenOut,
        uint8 finalDexId,
        uint24 finalFee,
        address recipient,
        uint256 amountOut,
        uint256 deadline
    ) external payable returns (uint256 amountIn, address[] memory midTokens);

    /// @notice Buy a V2 tax token and refund input-side leftovers from partial hops.
    function swapNativeToTaxToken(
        address bridgeToken,
        address tokenOut,
        uint8 finalDexId,
        uint24 finalFee,
        address recipient,
        uint256 minAmountOut,
        uint256 deadline
    )
        external
        payable
        returns (uint256 amountOut, address[] memory midTokens);

    /// @notice Quote the route that `swapTokenToNative` would execute for `amountIn`.
    function quoteTokenToNative(address tokenIn, uint256 amountIn)
        external
        returns (uint256 amountOut, address[] memory midTokens);

    /// @notice Quote an exact token input through a dynamic first DEX hop and
    ///         the configured bridge-to-WBNB route.
    function quoteTokenToNativeViaBridge(
        address tokenIn,
        address bridgeToken,
        uint8 firstDexId,
        uint24 firstFee,
        uint256 amountIn
    ) external returns (uint256 amountOut, address[] memory midTokens);

    /// @notice Execute the selected token->native route and send BNB to `recipient`.
    function swapTokenToNative(
        address tokenIn,
        address recipient,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    )
        external
        returns (uint256 amountOut, address[] memory midTokens);

    /// @notice Swap an exact token input through a dynamic first DEX hop and
    ///         configured bridge route, then send native currency to `recipient`.
    function swapTokenToNativeViaBridge(
        address tokenIn,
        address bridgeToken,
        uint8 firstDexId,
        uint24 firstFee,
        address recipient,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external returns (uint256 amountOut, address[] memory midTokens);

    /// @notice Sell a fee-on-transfer token through a V2 first hop and the
    ///         configured bridge route, then send native currency to `recipient`.
    function swapTaxTokenToNative(
        address tokenIn,
        address bridgeToken,
        uint8 firstDexId,
        uint24 firstFee,
        address recipient,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external returns (uint256 amountOut, address[] memory midTokens);

    /// @notice Execute the selected token->wrapped-native route and send WBNB to `recipient`.
    function swapTokenToWrappedNative(
        address tokenIn,
        address recipient,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    )
        external
        returns (uint256 amountOut, address[] memory midTokens);

    /// @notice Recover a specified ERC-20 amount held by the router.
    function rescueERC20(address token, address recipient, uint256 amount) external;
}
