import { Contract, JsonRpcProvider, ZeroAddress } from 'ethers'
import ITagDescriptorAbi from '../abi/ITagDescriptor.json' with { type: 'json' }
import OpenFourRegistryAbi from '../abi/OpenFourRegistry.json' with { type: 'json' }
import OpenFourToolsAbi from '../abi/OpenFourTools.json' with { type: 'json' }

export function mapParamDescriptor(p) {
  return {
    name: p.name ?? p[0] ?? '',
    abiType: p.abiType ?? p[1] ?? 'uint256',
    decimals: Number(p.decimals ?? p[2] ?? 0),
    optional: p.optional ?? p[3] ?? false,
    title: p.title ?? p[4] ?? '',
    defaultValue: p.defaultValue ?? p[5] ?? '',
    hint: p.hint ?? p[6] ?? '',
    minValue: p.minValue ?? p[7] ?? '',
    maxValue: p.maxValue ?? p[8] ?? '',
  }
}

/** Normalize getPresetEncodeSchemas return (named struct or ethers Result tuple). */
export function mapModuleSchema(raw) {
  if (raw == null) {
    return { kind: '', version: 0, params: [] }
  }
  const kind = raw.kind ?? raw[0] ?? ''
  const version = raw.version ?? raw[1] ?? 0
  const params = raw.params ?? raw[2] ?? []
  return {
    kind,
    version: Number(version),
    params: Array.from(params).map(mapParamDescriptor),
  }
}

function mapPresetModulesRaw(raw) {
  return {
    token: mapModuleSchema(raw.token ?? raw[0]),
    vault: mapModuleSchema(raw.vault ?? raw[1]),
    curve: mapModuleSchema(raw.curve ?? raw[2]),
    trade: mapModuleSchema(raw.trade ?? raw[3]),
    migrate: mapModuleSchema(raw.migrate ?? raw[4]),
    customData: mapModuleSchema(raw.customData ?? raw[5]),
  }
}

/**
 * Load preset encode schemas from OpenFourTools (full artifact ABI).
 */
export async function getPresetEncodeSchemas({
  toolsAddress,
  presetId,
  provider,
}) {
  const runner = provider ?? new JsonRpcProvider()
  const tools = new Contract(toolsAddress, OpenFourToolsAbi, runner)
  const raw = await tools.getPresetEncodeSchemas(presetId)
  return mapPresetModulesRaw(raw)
}

/**
 * Resolve tools address via OpenFourRegistry.openFourTool().
 */
export async function resolveToolsAddress({ registryAddress, provider }) {
  const runner = provider ?? new JsonRpcProvider()
  const registry = new Contract(registryAddress, OpenFourRegistryAbi, runner)
  return registry.openFourTool()
}

/**
 * registryAddress + presetId -> { schemas, toolsAddress }
 */
export async function loadPresetSchemas({ registryAddress, presetId, provider }) {
  const toolsAddress = await resolveToolsAddress({ registryAddress, provider })
  const schemas = await getPresetEncodeSchemas({
    toolsAddress,
    presetId,
    provider,
  })
  return { schemas, toolsAddress }
}

/**
 * Fixed base create fields from OpenFourTools.getTokenBaseSchema().
 */
export async function getTokenBaseSchema({ toolsAddress, provider }) {
  const runner = provider ?? new JsonRpcProvider()
  const tools = new Contract(toolsAddress, OpenFourToolsAbi, runner)
  const raw = await tools.getTokenBaseSchema()
  return Array.from(raw).map(mapParamDescriptor)
}

export async function getPresetIds({ registryAddress, provider }) {
  const runner = provider ?? new JsonRpcProvider()
  const registry = new Contract(registryAddress, OpenFourRegistryAbi, runner)
  const ids = await registry.getPresetIds()
  return ids.map((id) => id.toString())
}

/**
 * Preset metadata + token module tag (via getModuleImplementation + descriptor).
 */
export async function getPreset({ registryAddress, presetId, provider }) {
  const runner = provider ?? new JsonRpcProvider()
  const registry = new Contract(registryAddress, OpenFourRegistryAbi, runner)
  const p = await registry.getPreset(presetId)

  let tokenModuleTag = ''
  try {
    const impl = await registry.getModuleImplementation(p.tokenModuleId)
    if (impl && impl !== ZeroAddress) {
      const mod = new Contract(impl, ITagDescriptorAbi, runner)
      const desc = await mod.descriptor()
      tokenModuleTag = desc.tag ?? ''
    }
  } catch {
    // leave tokenModuleTag empty
  }

  return {
    id: p.id?.toString?.() ?? String(p.id),
    name: p.name,
    description: p.description,
    version: p.version,
    active: p.active,
    createEnabled: p.createEnabled,
    validator: p.validator,
    tokenModuleId: p.tokenModuleId,
    tokenModuleTag,
    vaultModuleId: p.vaultModuleId,
    curveModuleId: p.curveModuleId,
    tradeModuleId: p.tradeModuleId,
    migrateModuleId: p.migrateModuleId,
    tokenImplId: p.tokenImplId,
    customDataId: p.customDataId,
    author: p.author,
  }
}
