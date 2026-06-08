/**
 * Example: submit createToken after the OpenFour creation API returns createArg + signature.
 *
 * Prerequisites:
 *   - Wallet private key or BrowserProvider signer
 *   - OPEN_FOUR_CORE from deployments
 */
import { JsonRpcProvider, Wallet } from 'ethers'
import {
  prepareCreateTokenOnChain,
  submitCreateTokenOnChain,
} from '../create/createOnChain.js'

const RPC_URL = 'https://bsc-testnet.publicnode.com'
const PRIVATE_KEY = process.env.PRIVATE_KEY // never commit real keys
const OPEN_FOUR_CORE = '0xYourOpenFourCore'
const WRAPPED_NATIVE = process.env.WRAPPED_NATIVE // WBNB / WETH on this chain

// Replace with real values from the creation API response:
//   { code: 0, data: { createArg, signature, tokenId }, msg: "" }
const BACKEND_RESPONSE = {
  createArg: '0x...',
  signature: '0x...',
  tokenId: '12345',
}

async function main() {
  if (!PRIVATE_KEY) {
    throw new Error('Set PRIVATE_KEY env for this example')
  }

  const provider = new JsonRpcProvider(RPC_URL)
  const signer = new Wallet(PRIVATE_KEY, provider)

  const { createArg, signature, txValue, decoded, presaleNative, quoteAsset } =
    prepareCreateTokenOnChain({
      rawCreateArg: BACKEND_RESPONSE.createArg,
      signature: BACKEND_RESPONSE.signature,
      wrappedNative: WRAPPED_NATIVE,
    })

  console.log('quoteAsset:', quoteAsset)
  console.log('presaleNative:', presaleNative)
  console.log('createFee:', decoded.createFee?.toString())
  console.log('presaleQuote:', decoded.presaleQuote?.toString())
  console.log('txValue (msg.value):', txValue.toString())

  const result = await submitCreateTokenOnChain({
    signer,
    coreAddress: OPEN_FOUR_CORE,
    createArg,
    signature,
    txValue,
    simulate: true,
  })

  console.log('tx hash:', result.hash)
  console.log('status:', result.status)
}

main().catch(console.error)
