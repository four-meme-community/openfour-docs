/**
 * Example: list on-chain presets and resolve create schema per mode.
 *
 * Usage:
 *   REGISTRY_ADDRESS=0x... RPC_URL=https://... node scripts/examples/04-list-preset-create-schemas.example.mjs
 */
import { JsonRpcProvider } from 'ethers'
import {
  CREATE_MODE,
  resolveAllPresetCreateSchemas,
  resolvePresetCreateSchema,
} from '../resolvePresetCreateSchemas.js'

const REGISTRY_ADDRESS = process.env.REGISTRY_ADDRESS
const RPC_URL = process.env.RPC_URL || 'https://bsc-testnet.publicnode.com'
const PRESET_ID = process.env.PRESET_ID // optional: resolve single preset

async function main() {
  if (!REGISTRY_ADDRESS) {
    throw new Error('Set REGISTRY_ADDRESS env')
  }

  const provider = new JsonRpcProvider(RPC_URL)

  if (PRESET_ID) {
    const one = await resolvePresetCreateSchema({
      registryAddress: REGISTRY_ADDRESS,
      presetId: PRESET_ID,
      provider,
    })

    console.log('=== Single preset ===')
    console.log('presetId:', one.presetId)
    console.log('name:', one.preset.name)
    console.log('tokenModuleTag (on-chain):', one.preset.tokenModuleTag)
    console.log('mode (SDK label from tag/schema):', one.mode)
    console.log('flags:', one.flags)
    console.log('display param names:', one.displayParams.map((p) => p.name).join(', '))
    console.log('defaultTaxInfo keys:', Object.keys(one.defaultTaxInfo).join(', '))
    return
  }

  const { summary, items } = await resolveAllPresetCreateSchemas({
    registryAddress: REGISTRY_ADDRESS,
    provider,
    onlyCreateEnabled: true,
  })

  console.log('=== Creatable presets ===')
  console.table(summary)

  const taxPresets = items.filter((x) => x.mode === CREATE_MODE.TAX)
  console.log(`\nTax presets: ${taxPresets.length}`)
  for (const item of taxPresets) {
    console.log(`- [${item.presetId}] ${item.preset.name}`)
    console.log(
      '  tax fields:',
      item.activeParams
        .filter((p) => p.name.includes('tax') || p.name.includes('Fee'))
        .map((p) => p.name)
        .join(', '),
    )
  }

  const uniPresets = items.filter((x) => x.mode === CREATE_MODE.UNI_V4)
  console.log(`\nUni V4 presets: ${uniPresets.length}`)
  for (const item of uniPresets) {
    console.log(`- [${item.presetId}] ${item.preset.name} (needs hookSalt mining)`)
  }
}

main().catch(console.error)
