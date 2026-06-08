/**
 * Example: build backend request payload only (no HTTP, no chain tx).
 *
 * Prerequisites:
 *   - ethers ^6.x
 *   - Set REGISTRY_ADDRESS, PRESET_ID, TOOLS_ADDRESS (or use loadPresetSchemas)
 */
import { JsonRpcProvider } from 'ethers'
import { buildCreateTaxTokenRequest } from '../createTaxTokenRequest.js'
import { resolvePresetCreateSchema } from '../resolvePresetCreateSchemas.js'

const REGISTRY_ADDRESS = '0xYourRegistry'
const PRESET_ID = '1778027615723' // custom tax preset example
const RPC_URL = 'https://bsc-testnet.publicnode.com'

async function main() {
  const provider = new JsonRpcProvider(RPC_URL)

  const { schemas, activeParams: activeParam, preset, mode, flags } =
    await resolvePresetCreateSchema({
      registryAddress: REGISTRY_ADDRESS,
      presetId: PRESET_ID,
      provider,
    })

  console.log('mode:', mode, 'flags:', flags)

  // Use on-chain schema field names (caller maps from app UI if needed).
  const taxInfo = {
    router: '0xD99D1c33F9fC3444f8101754aBC46c52416550D1',
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
      preSale: 0,
    },
    raisedToken: {
      nativeSymbol: 'BNB',
      totalBAmount: '18',
    },
    saleAmount: 800000000,
    totalSupply: 1000000000,
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
