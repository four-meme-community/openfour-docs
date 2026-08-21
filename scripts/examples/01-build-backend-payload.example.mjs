/**
 * Example: select a quote config via the public API and build the backend
 * request payload (no create API request and no chain tx).
 *
 * Prerequisites:
 *   - ethers ^6.x
 *   - Set REGISTRY_ADDRESS, PRESET_ID, TOOLS_ADDRESS (or use loadPresetSchemas)
 *   - Optional: FOUR_MEME_API_BASE, QUOTE_SYMBOL (for example BNB)
 */
import { JsonRpcProvider } from 'ethers'
import { createFourMemeApiClient } from '../api/fourMemeClient.js'
import { buildCreateTaxTokenRequest } from '../create/buildCreatePayload.js'
import { resolvePresetCreateSchema } from '../schema/resolvePresetCreateSchemas.js'

const REGISTRY_ADDRESS = '0xYourRegistry'
const PRESET_ID = '1778027615723' // custom tax preset example
const RPC_URL = 'https://bsc-rpc.publicnode.com'
const QUOTE_SYMBOL = process.env.QUOTE_SYMBOL

async function main() {
  const provider = new JsonRpcProvider(RPC_URL)
  const api = createFourMemeApiClient({
    apiBase: process.env.FOUR_MEME_API_BASE,
  })

  // GET /public/token_template/config?templateId=...
  // The API returns the quote configs supported by this template. Pass
  // QUOTE_SYMBOL to select a specific quote; when omitted, the first is used.
  const templateConfig = await api.getTokenTemplateConfig({
    templateId: PRESET_ID,
    symbol: QUOTE_SYMBOL,
  })
  console.log('selected quote:', templateConfig.symbol)

  const { schemas, activeParams: activeParam, preset, mode, flags } =
    await resolvePresetCreateSchema({
      registryAddress: REGISTRY_ADDRESS,
      presetId: PRESET_ID,
      provider,
    })

  console.log('mode:', mode, 'flags:', flags)

  // Use on-chain schema field names (caller maps from app UI if needed).
  const taxInfo = {
    buyFeeRate: 100,
    sellFeeRate: 100,
    rateFounder: 100,
    rateBurn: 0,
    rateHolder: 0,
    rateLiquidity: 0,
    minShare: 1000000,
    founder: '0x0000000000000000000000000000000000000001',
  }

  const { payload, encodedParams } = buildCreateTaxTokenRequest({
    presetId: PRESET_ID,
    schemas,
    taxInfo,
    activeParam,
    tokenModuleTag: preset.tokenModuleTag,
    imgUrl: 'https://cdn.example.com/token-avatar.png',
    createParams: {
      name: 'Demo Tax Token',
      shortName: 'DTT',
      desc: 'SDK example',
      symbol: templateConfig.symbol,
      preSale: 0,
    },
    templateConfig,
    saleAmount: templateConfig.saleAmount,
    totalSupply: templateConfig.totalSupply,
    feePlan: true,
    vaultSelection: {
      typeId:
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      initParamsHex: '0x',
    },
  })

  console.log('POST v1/private/token_template/token/create')
  console.log(JSON.stringify(payload, null, 2))
  console.log('\nencodedParams:', encodedParams)
}

main().catch(console.error)
