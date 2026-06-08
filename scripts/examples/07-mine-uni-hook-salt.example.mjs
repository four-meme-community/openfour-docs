/**
 * Example: mine CREATE2 hookSalt for Uni V4 presets.
 *
 * Uni token presets require a non-zero hookSalt whose predicted clone address
 * satisfies Pancake Infinity hook flag bits. CREATE2 deployer is OpenFourDeployer.
 *
 * Usage:
 *   REGISTRY_ADDRESS=0x... RPC_URL=https://... \
 *     node examples/07-mine-uni-hook-salt.example.mjs
 *
 * Optional:
 *   MAX_SALT=500000
 *   CREATE_DEPLOYER=0x... HOOK_IMPLEMENTATION=0x...
 */
import { Contract, JsonRpcProvider } from 'ethers'
import OpenFourRegistryAbi from '../abi/OpenFourRegistry.json' with { type: 'json' }
import { mineUniHookCloneSalt } from '../uni/mineUniHookCloneSalt.js'

const REGISTRY_ADDRESS = process.env.REGISTRY_ADDRESS
const RPC_URL = process.env.RPC_URL || 'https://bsc-testnet.publicnode.com'
const MAX_SALT = process.env.MAX_SALT ? BigInt(process.env.MAX_SALT) : undefined

async function resolveRegistryAddresses(provider) {
  if (process.env.CREATE_DEPLOYER && process.env.HOOK_IMPLEMENTATION) {
    return {
      createDeployer: process.env.CREATE_DEPLOYER,
      hookImplementation: process.env.HOOK_IMPLEMENTATION,
    }
  }

  const registry = new Contract(REGISTRY_ADDRESS, OpenFourRegistryAbi, provider)
  const [createDeployer, hookImplementation] = await Promise.all([
    registry.createDeployer(),
    registry.uniTokenV4HookImpl(),
  ])
  return { createDeployer, hookImplementation }
}

async function main() {
  if (!REGISTRY_ADDRESS && !(process.env.CREATE_DEPLOYER && process.env.HOOK_IMPLEMENTATION)) {
    throw new Error('Set REGISTRY_ADDRESS, or both CREATE_DEPLOYER and HOOK_IMPLEMENTATION')
  }

  const provider = new JsonRpcProvider(RPC_URL)
  const { createDeployer, hookImplementation } = await resolveRegistryAddresses(provider)

  const mined = await mineUniHookCloneSalt(
    provider,
    createDeployer,
    hookImplementation,
    MAX_SALT,
  )

  console.log('\n=== Result ===')
  console.log('hookSalt:', mined.salt)
  console.log('predicted hook address:', mined.hookAddress)
  console.log('attempts:', mined.attempts.toString())
  console.log('skippedOccupied:', mined.skippedOccupied.toString())
  console.log('elapsedMs:', mined.elapsedMs)
}

main().catch(console.error)
