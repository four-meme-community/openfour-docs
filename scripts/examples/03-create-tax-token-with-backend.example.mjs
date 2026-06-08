/**
 * Example: Four.meme login → upload image → build payload → POST create API
 * → createToken on chain (tax preset).
 *
 * Env:
 *   PRIVATE_KEY, REGISTRY_ADDRESS, OPEN_FOUR_CORE, PRESET_ID, WRAPPED_NATIVE
 *   IMAGE_PATH (or IMAGE_URL), TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DESC
 *   Optional: FOUR_MEME_API_BASE, RPC_URL, QUOTE_SYMBOL
 */
import { JsonRpcProvider, Wallet } from 'ethers'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { createFourMemeApiClient } from '../api/fourMemeClient.js'
import { createTaxTokenWithBackendAndChain } from '../create/createTaxTokenFlow.js'
import { loadPresetSchemas } from '../schema/loadPresetSchemas.js'

const RPC_URL = process.env.RPC_URL ?? 'https://bsc-testnet.publicnode.com'
const PRIVATE_KEY = process.env.PRIVATE_KEY
const REGISTRY_ADDRESS = process.env.REGISTRY_ADDRESS ?? '0xYourRegistry'
const OPEN_FOUR_CORE = process.env.OPEN_FOUR_CORE ?? '0xYourOpenFourCore'
const WRAPPED_NATIVE = process.env.WRAPPED_NATIVE
const PRESET_ID = process.env.PRESET_ID ?? '1778027615723'
const IMAGE_PATH = process.env.IMAGE_PATH
const IMAGE_URL = process.env.IMAGE_URL
const QUOTE_SYMBOL = process.env.QUOTE_SYMBOL

async function main() {
  if (!PRIVATE_KEY) throw new Error('Set PRIVATE_KEY')
  if (!IMAGE_PATH && !IMAGE_URL) throw new Error('Set IMAGE_PATH or IMAGE_URL')

  const provider = new JsonRpcProvider(RPC_URL)
  const signer = new Wallet(PRIVATE_KEY, provider)
  const api = createFourMemeApiClient({
    apiBase: process.env.FOUR_MEME_API_BASE,
  })
  const { accessToken, address } = await api.loginWithSigner({ signer })
  const templateConfig = await api.getTokenTemplateConfig({
    templateId: PRESET_ID,
    symbol: QUOTE_SYMBOL,
  })
  const imgUrl =
    IMAGE_URL ??
    (await api.uploadTokenImage({
      accessToken,
      file: readFileSync(IMAGE_PATH),
      filename: basename(IMAGE_PATH),
    }))

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
        founder: address,
      },
      activeParam,
      imgUrl,
      createParams: {
        name: process.env.TOKEN_NAME ?? 'Full Flow Token',
        shortName: process.env.TOKEN_SYMBOL ?? 'FFT',
        symbol: templateConfig.symbol,
        desc: process.env.TOKEN_DESC ?? 'SDK full flow',
        preSale: 0,
      },
      templateConfig,
      vaultSelection: {
        typeId:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        initParamsHex: '0x',
      },
    },
    postCreate: (payload) => api.postCreate(payload, { accessToken }),
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
