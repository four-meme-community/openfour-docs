/**
 * Example: estimate and trade an OpenFour token with slippage protection.
 *
 * Usage:
 *   TRADE_ACTION=buyExact \
 *   REGISTRY_ADDRESS=0x... TOKEN_ADDRESS=0x... PRIVATE_KEY=0x... \
 *   AMOUNT=100 SLIPPAGE_BPS=500 RPC_URL=https://... \
 *   node scripts/examples/06-trade-with-slippage.example.mjs
 *
 * TRADE_ACTION:
 *   - buyExact     Buy an exact token amount. Slippage is applied upward to userPays.
 *   - buyByBudget  Spend a max quote budget. Slippage is applied downward to minAmountOut.
 *   - sellExact    Sell an exact token amount. Slippage is applied downward to userReceives.
 */
import { Contract, JsonRpcProvider, Wallet, formatUnits } from 'ethers'
import OpenFourCoreAbi from '../abi/OpenFourCore.json' with { type: 'json' }
import OpenFourRegistryAbi from '../abi/OpenFourRegistry.json' with { type: 'json' }
import {
  buildBuyByBudgetTx,
  buildBuyExactAmountTx,
  buildSellExactAmountTx,
  ensureErc20Approval,
  estimateBuyByBudget,
  estimateBuyExactAmount,
  estimateSellExactAmount,
  isNativeQuoteAsset,
  parseTokenAmount,
  submitTradeTx,
} from '../trade/tradeFlow.js'

const RPC_URL = process.env.RPC_URL || 'https://bsc-testnet.publicnode.com'
const REGISTRY_ADDRESS = process.env.REGISTRY_ADDRESS
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS
const PRIVATE_KEY = process.env.PRIVATE_KEY
const TRADE_ACTION = process.env.TRADE_ACTION || 'buyExact'
const AMOUNT = process.env.AMOUNT || '100'
const SLIPPAGE_BPS = BigInt(process.env.SLIPPAGE_BPS || '500') // 500 = 5%
const TOKEN_DECIMALS = Number(process.env.TOKEN_DECIMALS || '18')
const PROOF = process.env.PROOF || '0x'
const RECEIVE_WRAPPED_NATIVE = process.env.RECEIVE_WRAPPED_NATIVE === 'true'

async function main() {
  if (!REGISTRY_ADDRESS) throw new Error('Set REGISTRY_ADDRESS')
  if (!TOKEN_ADDRESS) throw new Error('Set TOKEN_ADDRESS')
  if (!PRIVATE_KEY) throw new Error('Set PRIVATE_KEY')

  const provider = new JsonRpcProvider(RPC_URL)
  const signer = new Wallet(PRIVATE_KEY, provider)
  const trader = await signer.getAddress()

  const registry = new Contract(REGISTRY_ADDRESS, OpenFourRegistryAbi, provider)
  const coreAddress = await registry.openFourCore()
  const toolsAddress = await registry.openFourTool()
  const core = new Contract(coreAddress, OpenFourCoreAbi, provider)
  const wrappedNative = await core.wrappedNative()
  const runtime = await core.tokens(TOKEN_ADDRESS)

  if (!runtime.exists) {
    throw new Error('TOKEN_ADDRESS is not managed by this OpenFourCore')
  }

  const quoteAsset = runtime.quoteAsset
  const nativeQuote = isNativeQuoteAsset(quoteAsset, wrappedNative)

  console.log('trader:', trader)
  console.log('core:', coreAddress)
  console.log('tools:', toolsAddress)
  console.log('token:', TOKEN_ADDRESS)
  console.log('quoteAsset:', quoteAsset)
  console.log('nativeQuote:', nativeQuote)
  console.log('action:', TRADE_ACTION)

  if (TRADE_ACTION === 'buyExact') {
    const tokenAmount = parseTokenAmount(AMOUNT, TOKEN_DECIMALS)
    const estimate = await estimateBuyExactAmount({
      toolsAddress,
      provider,
      token: TOKEN_ADDRESS,
      trader,
      amount: tokenAmount,
      proof: PROOF,
    })

    const txPlan = buildBuyExactAmountTx({
      token: TOKEN_ADDRESS,
      tokenAmount,
      estimate,
      slippageBps: SLIPPAGE_BPS,
      quoteAsset,
      wrappedNative,
      proof: PROOF,
    })

    printEstimate(estimate)
    console.log('maxQuotePayAmount:', txPlan.maxQuotePayAmount.toString())
    console.log('tx.value:', txPlan.value.toString())

    if (!nativeQuote) {
      await ensureErc20Approval({
        token: quoteAsset,
        owner: trader,
        spender: coreAddress,
        signer,
        requiredAmount: txPlan.maxQuotePayAmount,
      })
    }

    const tx = await submitTradeTx({ coreAddress, signer, txPlan })
    console.log('buy tx:', tx.hash)
    return
  }

  if (TRADE_ACTION === 'buyByBudget') {
    const maxQuotePayAmount = parseTokenAmount(AMOUNT, 18)
    const estimate = await estimateBuyByBudget({
      toolsAddress,
      provider,
      token: TOKEN_ADDRESS,
      trader,
      maxQuotePayAmount,
      proof: PROOF,
    })

    const txPlan = buildBuyByBudgetTx({
      token: TOKEN_ADDRESS,
      maxQuotePayAmount,
      estimate,
      slippageBps: SLIPPAGE_BPS,
      quoteAsset,
      wrappedNative,
      proof: PROOF,
    })

    printEstimate(estimate)
    console.log('minAmountOut:', txPlan.minAmountOut.toString())
    console.log('tx.value:', txPlan.value.toString())

    if (!nativeQuote) {
      await ensureErc20Approval({
        token: quoteAsset,
        owner: trader,
        spender: coreAddress,
        signer,
        requiredAmount: maxQuotePayAmount,
      })
    }

    const tx = await submitTradeTx({ coreAddress, signer, txPlan })
    console.log('buyByBudget tx:', tx.hash)
    return
  }

  if (TRADE_ACTION === 'sellExact') {
    const tokenAmount = parseTokenAmount(AMOUNT, TOKEN_DECIMALS)
    const estimate = await estimateSellExactAmount({
      toolsAddress,
      provider,
      token: TOKEN_ADDRESS,
      trader,
      amount: tokenAmount,
      receiveWrappedNative: RECEIVE_WRAPPED_NATIVE,
      proof: PROOF,
    })

    const txPlan = buildSellExactAmountTx({
      token: TOKEN_ADDRESS,
      tokenAmount,
      estimate,
      slippageBps: SLIPPAGE_BPS,
      receiveWrappedNative: RECEIVE_WRAPPED_NATIVE,
      proof: PROOF,
    })

    printEstimate(estimate)
    console.log('minQuoteReceiveAmount:', txPlan.minQuoteReceiveAmount.toString())
    console.log('sellOptions:', txPlan.options.toString())

    await ensureErc20Approval({
      token: TOKEN_ADDRESS,
      owner: trader,
      spender: coreAddress,
      signer,
      requiredAmount: tokenAmount,
    })

    const tx = await submitTradeTx({ coreAddress, signer, txPlan })
    console.log('sell tx:', tx.hash)
    return
  }

  throw new Error(`Unknown TRADE_ACTION: ${TRADE_ACTION}`)
}

function printEstimate(estimate) {
  console.log('curveQuote:', estimate.curveQuote.toString(), formatUnits(estimate.curveQuote, 18))
  console.log('totalFee:', estimate.totalFee.toString(), formatUnits(estimate.totalFee, 18))
  console.log('userPays:', estimate.userPays.toString(), formatUnits(estimate.userPays, 18))
  console.log('userReceives:', estimate.userReceives.toString(), formatUnits(estimate.userReceives, 18))
  console.log('tokenAmount:', estimate.tokenAmount.toString())
  console.log('executionPrice:', estimate.executionPrice.toString())
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
