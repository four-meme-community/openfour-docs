/**
 * Example: build payload → POST backend → createToken on chain (tax preset).
 *
 * Uses createTaxTokenWithBackendAndChain (see createTaxTokenWithBackend.js).
 */
import { JsonRpcProvider, Wallet } from 'ethers'
import { createTaxTokenWithBackendAndChain } from '../createTaxTokenWithBackend.js'
import { loadPresetSchemas } from '../loadPresetSchemas.js'

const RPC_URL = 'https://bsc-testnet.publicnode.com'
const PRIVATE_KEY = process.env.PRIVATE_KEY
const REGISTRY_ADDRESS = '0xYourRegistry'
const OPEN_FOUR_CORE = '0xYourOpenFourCore'
const WRAPPED_NATIVE = process.env.WRAPPED_NATIVE
const PRESET_ID = '1778027615723'

async function postCreate(payload) {
  // Expected response shape:
  //   { code: 0, data: { createArg, signature, tokenId }, msg: "" }
  const res = await fetch('https://api.example.com/v1/private/token_template/token/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  return res.json()
}

async function main() {
  if (!PRIVATE_KEY) throw new Error('Set PRIVATE_KEY')

  const provider = new JsonRpcProvider(RPC_URL)
  const signer = new Wallet(PRIVATE_KEY, provider)
  const { schemas } = await loadPresetSchemas({
    registryAddress: REGISTRY_ADDRESS,
    presetId: PRESET_ID,
    provider,
  })

  const activeParam = [
    ...schemas.token.params,
    ...schemas.curve.params,
    ...schemas.trade.params,
    ...schemas.migrate.params,
  ]

  const result = await createTaxTokenWithBackendAndChain({
    buildRequest: {
      presetId: PRESET_ID,
      schemas,
      taxInfo: {
        buyFeeRate: 100,
        sellFeeRate: 100,
        rateFounder: 100,
        rateBurn: 0,
        rateHolder: 0,
        rateLiquidity: 0,
        minShare: 1000000,
        founder: await signer.getAddress(),
      },
      activeParam,
      imgUrl: 'https://cdn.example.com/avatar.png',
      createParams: {
        name: 'Full Flow Token',
        shortName: 'FFT',
        desc: 'SDK full flow',
        preSale: 0,
      },
      raisedToken: { nativeSymbol: 'BNB', totalBAmount: '18' },
      saleAmount: 800000000,
      totalSupply: 1000000000,
      vaultSelection: {
        typeId:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        initParamsHex: '0x',
      },
    },
    postCreate,
    signer,
    coreAddress: OPEN_FOUR_CORE,
    wrappedNative: WRAPPED_NATIVE,
  })

  console.log('tokenId:', result.tokenId)
  console.log('tx:', result.hash)
  console.log('txValue:', result.txValue?.toString())
  console.log('presaleNative:', result.presaleNative)
}

main().catch(console.error)
