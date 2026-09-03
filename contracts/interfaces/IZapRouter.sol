// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IZapRouter
/// @notice Public configured-route quoting and execution for ERC-20 and native multi-DEX swaps.
/// @dev Quote functions are not declared `view` because some external DEX quoters may write
///      transient state. `midTokens` contains configured intermediate assets and is empty for
///      a direct route.
interface IZapRouter {
    /// @notice Quote the output for an exact ERC-20 input through the configured route.
    /// @param tokenIn Input token.
    /// @param tokenOut Output token.
    /// @param amountIn Exact input amount.
    /// @return amountOut Expected output amount.
    /// @return midTokens Intermediate route tokens, excluding `tokenIn` and `tokenOut`.
    function quoteExactInput(address tokenIn, address tokenOut, uint256 amountIn)
        external
        returns (uint256 amountOut, address[] memory midTokens);

    /// @notice Quote the ERC-20 input required for an exact output through the configured route.
    /// @param tokenIn Input token.
    /// @param tokenOut Output token.
    /// @param amountOut Exact output amount.
    /// @return amountIn Required input amount.
    /// @return midTokens Intermediate route tokens, excluding `tokenIn` and `tokenOut`.
    function quoteExactOutput(address tokenIn, address tokenOut, uint256 amountOut)
        external
        returns (uint256 amountIn, address[] memory midTokens);

    /// @notice Swap an exact ERC-20 input through the configured route.
    /// @dev Reverts when output is below `minAmountOut` or after `deadline`.
    function swapExactInput(
        address tokenIn,
        address tokenOut,
        address recipient,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external returns (uint256 amountOut, address[] memory midTokens);

    /// @notice Receive an exact ERC-20 output through the configured route.
    /// @dev Spends at most `maxAmountIn`; exact-output swaps are unsuitable for taxed output tokens.
    function swapExactOutput(
        address tokenIn,
        address tokenOut,
        address recipient,
        uint256 amountOut,
        uint256 maxAmountIn,
        uint256 deadline
    ) external returns (uint256 amountIn, address[] memory midTokens);

    /// @notice Quote the configured native-to-token route for an exact native input.
    /// @param tokenOut Output token.
    /// @param amountIn Exact native input amount.
    function quoteNativeToToken(address tokenOut, uint256 amountIn)
        external
        returns (uint256 amountOut, address[] memory midTokens);

    /// @notice Quote an exact native input through the configured native-to-bridge route
    ///         followed by a caller-selected final DEX hop.
    /// @dev `finalDexId` selects the final V2/V3 DEX; `finalFee` is used by V3-compatible hops.
    function quoteNativeToTokenViaBridge(
        address bridgeToken,
        address tokenOut,
        uint8 finalDexId,
        uint24 finalFee,
        uint256 amountIn
    ) external returns (uint256 amountOut, address[] memory midTokens);

    /// @notice Quote the native input required for an exact token output.
    function quoteNativeForExactToken(address tokenOut, uint256 amountOut)
        external
        returns (uint256 amountIn, address[] memory midTokens);

    /// @notice Quote native input for an exact token output through the configured
    ///         native-to-bridge route followed by a caller-selected final DEX hop.
    function quoteNativeForExactTokenViaBridge(
        address bridgeToken,
        address tokenOut,
        uint8 finalDexId,
        uint24 finalFee,
        uint256 amountOut
    ) external returns (uint256 amountIn, address[] memory midTokens);

    /// @notice Spend exactly `msg.value` through the configured native-to-token route.
    /// @dev Sends output directly to `recipient` and enforces `minAmountOut`.
    function swapNativeToToken(
        address tokenOut,
        address recipient,
        uint256 minAmountOut,
        uint256 deadline
    ) external payable returns (uint256 amountOut, address[] memory midTokens);

    /// @notice Spend exactly `msg.value` through a configured native-to-bridge route
    ///         followed by a caller-selected final DEX hop.
    function swapNativeToTokenViaBridge(
        address bridgeToken,
        address tokenOut,
        uint8 finalDexId,
        uint24 finalFee,
        address recipient,
        uint256 minAmountOut,
        uint256 deadline
    ) external payable returns (uint256 amountOut, address[] memory midTokens);

    /// @notice Receive exactly `amountOut` through the configured native-to-token route.
    /// @dev Refunds unused `msg.value` to the caller as native currency.
    function swapNativeForExactToken(
        address tokenOut,
        address recipient,
        uint256 amountOut,
        uint256 deadline
    ) external payable returns (uint256 amountIn, address[] memory midTokens);

    /// @notice Receive an exact token output through a configured native-to-bridge route
    ///         followed by a caller-selected final DEX hop.
    /// @dev Refunds unused `msg.value` to the caller as native currency.
    function swapNativeForExactTokenViaBridge(
        address bridgeToken,
        address tokenOut,
        uint8 finalDexId,
        uint24 finalFee,
        address recipient,
        uint256 amountOut,
        uint256 deadline
    ) external payable returns (uint256 amountIn, address[] memory midTokens);

    /// @notice Buy a fee-on-transfer token with exact native input.
    /// @dev Uses a configured native-to-bridge route followed by a caller-selected V2-only
    ///      final hop, and measures the recipient's actual output balance increase.
    function swapNativeToTaxToken(
        address bridgeToken,
        address tokenOut,
        uint8 finalDexId,
        uint24 finalFee,
        address recipient,
        uint256 minAmountOut,
        uint256 deadline
    ) external payable returns (uint256 amountOut, address[] memory midTokens);

    /// @notice Quote the configured token-to-native route for an exact token input.
    function quoteTokenToNative(address tokenIn, uint256 amountIn)
        external
        returns (uint256 amountOut, address[] memory midTokens);

    /// @notice Quote an exact token input through a caller-selected first DEX hop
    ///         followed by the configured bridge-to-native route.
    /// @dev `firstDexId` selects the first V2/V3 DEX; `firstFee` is used by V3-compatible hops.
    function quoteTokenToNativeViaBridge(
        address tokenIn,
        address bridgeToken,
        uint8 firstDexId,
        uint24 firstFee,
        uint256 amountIn
    ) external returns (uint256 amountOut, address[] memory midTokens);

    /// @notice Swap an exact token input through the configured token-to-native route.
    /// @dev Sends native output directly to `recipient` and enforces `minAmountOut`.
    function swapTokenToNative(
        address tokenIn,
        address recipient,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external returns (uint256 amountOut, address[] memory midTokens);

    /// @notice Swap an exact token input through a caller-selected first DEX hop
    ///         followed by the configured bridge-to-native route.
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

    /// @notice Sell a fee-on-transfer token for native currency with exact nominal token input.
    /// @dev Uses a caller-selected V2-only first hop followed by the configured bridge route.
    ///      The V2 hop measures the pair's actual received input after transfer tax.
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

    /// @notice Swap an exact token input and deliver wrapped native to `recipient`.
    /// @dev Unlike `swapTokenToNative`, this method does not unwrap the final wrapped-native output.
    function swapTokenToWrappedNative(
        address tokenIn,
        address recipient,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external returns (uint256 amountOut, address[] memory midTokens);
}
