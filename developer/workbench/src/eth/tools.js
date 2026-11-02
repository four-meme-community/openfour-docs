import { Contract, Interface } from 'ethers'
import { resolveCoreAndToolsAddresses } from './addressResolver'
import { getReadProvider } from './provider'

const toolsAbi = new Interface([
  'function estimateBuy(address token,address trader,uint256 amount,uint256 options,bytes proof) view returns (tuple(uint256 curveQuote, uint256 totalFee, uint256 userPays, uint256 userReceives, uint256 tokenAmount, uint256 executionPrice))',
  'function estimateSell(address token,address trader,uint256 amount,uint256 options,bytes proof) view returns (tuple(uint256 curveQuote, uint256 totalFee, uint256 userPays, uint256 userReceives, uint256 tokenAmount, uint256 executionPrice))',
  'function estimateBuyByBudget(address token,address trader,uint256 maxQuotePayAmount,uint256 options,bytes proof) view returns (tuple(uint256 curveQuote, uint256 totalFee, uint256 userPays, uint256 userReceives, uint256 tokenAmount, uint256 executionPrice))',
  'function getCurveLiquiditySnapshot(address) view returns (tuple(bool available, uint256 initialQuoteLiquidity, uint256 initialTokenLiquidity, uint256 currentQuoteLiquidity, uint256 currentTokenLiquidity, uint256 remainingForSale, uint256 totalRaised, uint256 lastPrice))',
])

export async function getToolsReadOnly(config) {
  const provider = getReadProvider(config)
  const { tools } = await resolveCoreAndToolsAddresses(config)
  return new Contract(tools, toolsAbi, provider)
}

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
