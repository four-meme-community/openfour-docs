const STORAGE_KEY = 'openfour-dev-workbench'

export const DEFAULT_CONFIG = {
  rpcUrl: 'https://bsc-testnet.publicnode.com',
  chainId: 97,
  registry: '',
}

export const PROTECTED_CHAIN_IDS = new Set([56, 4663])

export function envConfig() {
  const rpcUrl = String(import.meta.env.VITE_RPC_URL ?? '').trim()
  const chainIdRaw = String(import.meta.env.VITE_CHAIN_ID ?? '').trim()
  const registry = String(import.meta.env.VITE_REGISTRY_ADDRESS ?? '').trim()
  return {
    rpcUrl: rpcUrl || DEFAULT_CONFIG.rpcUrl,
    chainId: Number(chainIdRaw || DEFAULT_CONFIG.chainId),
    registry,
  }
}

export function readStoredConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return {
      rpcUrl: String(parsed.rpcUrl ?? '').trim(),
      chainId: Number(parsed.chainId || 0),
      registry: String(parsed.registry ?? '').trim(),
    }
  } catch {
    return {}
  }
}

export function writeStoredConfig(config) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      rpcUrl: String(config.rpcUrl ?? '').trim(),
      chainId: Number(config.chainId),
      registry: String(config.registry ?? '').trim(),
    }),
  )
}

export function mergeConfig(overrides = {}) {
  const env = envConfig()
  const stored = readStoredConfig()
  return {
    rpcUrl: overrides.rpcUrl || stored.rpcUrl || env.rpcUrl,
    chainId: Number(overrides.chainId || stored.chainId || env.chainId),
    registry: Object.prototype.hasOwnProperty.call(overrides, 'registry')
      ? String(overrides.registry ?? '').trim()
      : (stored.registry || env.registry || ''),
  }
}

export function configFromForkDeployment(json) {
  const addresses = json?.addresses ?? {}
  const registry = addresses.registry || json.registry || ''
  const chainId = Number(json.chainId || 0)
  return {
    registry,
    chainId: chainId || DEFAULT_CONFIG.chainId,
    rpcUrl: json.rpcUrl || mergeConfig().rpcUrl,
  }
}
