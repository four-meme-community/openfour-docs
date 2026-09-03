import { Contract, MaxUint256, ZeroAddress, parseUnits } from 'ethers'
import OpenFourCoreAbi from '../abi/OpenFourCore.json' with { type: 'json' }
import OpenFourToolsAbi from '../abi/OpenFourTools.json' with { type: 'json' }

export const BPS_DENOMINATOR = 10_000n
export const SELL_OPTION_RECEIVE_WRAPPED_NATIVE = 1n

export const ERC20_APPROVAL_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]

export function parseTradeEstimate(res) {
  return {
    curveQuote: BigInt(res.curveQuote.toString()),
    totalFee: BigInt(res.totalFee.toString()),
    userPays: BigInt(res.userPays.toString()),
    userReceives: BigInt(res.userReceives.toString()),
    tokenAmount: BigInt(res.tokenAmount.toString()),
    executionPrice: BigInt(res.executionPrice.toString()),
  }
}

export function applySlippageUp(amount, slippageBps) {
  return (BigInt(amount) * (BPS_DENOMINATOR + BigInt(slippageBps))) / BPS_DENOMINATOR
}

export function applySlippageDown(amount, slippageBps) {
  return (BigInt(amount) * (BPS_DENOMINATOR - BigInt(slippageBps))) / BPS_DENOMINATOR
}

export function isNativeQuoteAsset(quoteAsset, wrappedNative) {
  return normalizeAddress(quoteAsset) === normalizeAddress(wrappedNative)
}

export async function estimateBuyExactAmount({
  toolsAddress,
  provider,
  token,
  trader = ZeroAddress,
  amount,
  options = 0n,
  proof = '0x',
}) {
  const tools = new Contract(toolsAddress, OpenFourToolsAbi, provider)
  return parseTradeEstimate(
    await tools.estimateBuy.staticCall(token, trader, amount, options, proof),
  )
}

export async function estimateBuyByBudget({
  toolsAddress,
  provider,
  token,
  trader = ZeroAddress,
  maxQuotePayAmount,
  options = 0n,
  proof = '0x',
}) {
  const tools = new Contract(toolsAddress, OpenFourToolsAbi, provider)
  return parseTradeEstimate(
    await tools.estimateBuyByBudget.staticCall(
      token,
      trader,
      maxQuotePayAmount,
      options,
      proof,
    ),
  )
}

export async function estimateSellExactAmount({
  toolsAddress,
  provider,
  token,
  trader = ZeroAddress,
  amount,
  receiveWrappedNative = false,
  proof = '0x',
}) {
  const tools = new Contract(toolsAddress, OpenFourToolsAbi, provider)
  const options = receiveWrappedNative ? SELL_OPTION_RECEIVE_WRAPPED_NATIVE : 0n
  return parseTradeEstimate(
    await tools.estimateSell.staticCall(token, trader, amount, options, proof),
  )
}

export function buildBuyExactAmountTx({
  token,
  tokenAmount,
  estimate,
  slippageBps,
  quoteAsset,
  wrappedNative,
  options = 0n,
  proof = '0x',
}) {
  const maxQuotePayAmount = applySlippageUp(estimate.userPays, slippageBps)
  return {
    method: 'buy',
    args: [token, tokenAmount, maxQuotePayAmount, BigInt(options), proof],
    value: isNativeQuoteAsset(quoteAsset, wrappedNative) ? maxQuotePayAmount : 0n,
    maxQuotePayAmount,
  }
}

export function buildBuyByBudgetTx({
  token,
  maxQuotePayAmount,
  estimate,
  slippageBps,
  quoteAsset,
  wrappedNative,
  options = 0n,
  proof = '0x',
}) {
  const minAmountOut = applySlippageDown(estimate.tokenAmount, slippageBps)
  return {
    method: 'buyByBudget',
    args: [token, maxQuotePayAmount, minAmountOut, BigInt(options), proof],
    value: isNativeQuoteAsset(quoteAsset, wrappedNative) ? maxQuotePayAmount : 0n,
    minAmountOut,
  }
}

export function buildSellExactAmountTx({
  token,
  tokenAmount,
  estimate,
  slippageBps,
  receiveWrappedNative = false,
  proof = '0x',
}) {
  const minQuoteReceiveAmount = applySlippageDown(estimate.userReceives, slippageBps)
  const options = receiveWrappedNative ? SELL_OPTION_RECEIVE_WRAPPED_NATIVE : 0n
  return {
    method: 'sell',
    args: [token, tokenAmount, minQuoteReceiveAmount, options, proof],
    value: 0n,
    minQuoteReceiveAmount,
    options,
  }
}

export async function ensureErc20Approval({
  token,
  owner,
  spender,
  signer,
  requiredAmount,
  approveAmount = MaxUint256,
}) {
  const erc20 = new Contract(token, ERC20_APPROVAL_ABI, signer)
  const allowance = BigInt((await erc20.allowance(owner, spender)).toString())
  if (allowance >= BigInt(requiredAmount)) {
    return { approved: false, allowance }
  }
  const tx = await erc20.approve(spender, approveAmount)
  await tx.wait()
  return { approved: true, allowance, txHash: tx.hash }
}

export async function submitTradeTx({ coreAddress, signer, txPlan }) {
  const core = new Contract(coreAddress, OpenFourCoreAbi, signer)
  const tx = await core[txPlan.method](...txPlan.args, { value: txPlan.value })
  await tx.wait()
  return tx
}

export function parseTokenAmount(value, decimals = 18) {
  return parseUnits(String(value), decimals)
}

function normalizeAddress(address) {
  return String(address ?? '').toLowerCase()
}
