import { Contract, Interface, ZeroAddress, isAddress } from 'ethers'
import { getReadProvider } from './provider'

const registryAbi = new Interface([
  'function openFourCore() view returns (address)',
  'function openFourTool() view returns (address)',
])

/** @type {{ key: string, core: string, tools: string } | null} */
let cached = null

export function clearAddressCache() {
  cached = null
}

export async function resolveCoreAndToolsAddresses(config) {
  if (!config?.registry) throw new Error('Registry address is not configured')
  const provider = getReadProvider(config)
  const { chainId } = await provider.getNetwork()
  const key = `${config.registry.toLowerCase()}-${chainId.toString()}`
  if (cached && cached.key === key) return { core: cached.core, tools: cached.tools }

  const registry = new Contract(config.registry, registryAbi, provider)
  const [core, tools] = await Promise.all([registry.openFourCore(), registry.openFourTool()])
  if (!isAddress(core) || core === ZeroAddress) throw new Error('Registry.openFourCore is not set')
  if (!isAddress(tools) || tools === ZeroAddress) throw new Error('Registry.openFourTool is not set')

  cached = { key, core, tools }
  return { core, tools }
}
