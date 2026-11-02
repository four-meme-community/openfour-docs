import { Contract, Interface, ZeroAddress, ZeroHash, keccak256, toUtf8Bytes } from 'ethers'
import { formatRevert } from './fourCore'
import { getReadProvider, getSignerProvider } from './provider'

const PARAM_TUPLE = '(string name,string abiType,uint8 decimals,bool optional,string title,string defaultValue,string hint,string minValue,string maxValue)'

export const MODULE_KINDS = [
  { value: 0, label: 'Token' },
  { value: 1, label: 'Vault' },
  { value: 2, label: 'Curve' },
  { value: 3, label: 'Trade' },
  { value: 4, label: 'Migrate' },
  { value: 5, label: 'CustomData' },
]

export const STANDARD_MODULE_SOURCES = [
  ['TOKEN_STANDARD', 'Token'],
  ['VAULT_BASIC', 'Vault'],
  ['CURVE_BONDING', 'Curve'],
  ['TRADE_SIMPLE', 'Trade'],
  ['MIGRATE_BONDING', 'Migrate'],
]

export function kindLabel(kind) {
  return MODULE_KINDS.find((row) => row.value === Number(kind))?.label || String(kind)
}

export function moduleKeyFromSource(source) {
  return keccak256(toUtf8Bytes(String(source || '').trim()))
}

const registryAbi = [
  'function owner() view returns (address)',
  'function openFourTool() view returns (address)',
  'function upsertModule(bytes32 moduleKey, address implementation, uint8 kind, tuple(bytes32 moduleId, string version, string name, string description, address author, uint16 feeShareBps) metadata, bool active)',
  'function upsertPreset(tuple(uint256 id, string name, string description, string version, bool active, bool createEnabled, address validator, bytes32 tokenModuleId, bytes32 vaultModuleId, bytes32 curveModuleId, bytes32 tradeModuleId, bytes32 migrateModuleId, bytes32 tokenImplId, bytes32 customDataId, address author) preset)',
  `function getPreset(uint256 presetId) view returns (
    (
      uint256 id,
      string name,
      string description,
      string version,
      bool active,
      bool createEnabled,
      address validator,
      bytes32 tokenModuleId,
      bytes32 vaultModuleId,
      bytes32 curveModuleId,
      bytes32 tradeModuleId,
      bytes32 migrateModuleId,
      bytes32 tokenImplId,
      bytes32 customDataId,
      address author
    ) preset
  )`,
  'function getPresetIds() view returns (uint256[])',
  `function getModule(bytes32 moduleKey) view returns (
    (
      address beacon,
      uint8 kind,
      (bytes32 moduleId, string version, string name, string description, address author, uint16 feeShareBps) metadata,
      bool active
    )
  )`,
  'function getModuleBeacon(bytes32 moduleKey) view returns (address)',
  'function getModuleImplementation(bytes32 moduleKey) view returns (address)',
  'function getTokenImpl(bytes32 tokenImplId) view returns ((address implementation, string version))',
]

const toolsAbi = [
  `function getTokenBaseSchema() pure returns (${PARAM_TUPLE}[])`,
  `function getPresetEncodeSchemas(uint256 presetId) view returns (
    (string kind, uint8 version, ${PARAM_TUPLE}[] params) token,
    (string kind, uint8 version, ${PARAM_TUPLE}[] params) vault,
    (string kind, uint8 version, ${PARAM_TUPLE}[] params) curve,
    (string kind, uint8 version, ${PARAM_TUPLE}[] params) trade,
    (string kind, uint8 version, ${PARAM_TUPLE}[] params) migrate,
    (string kind, uint8 version, ${PARAM_TUPLE}[] params) customData
  )`,
]

function mapParamDescriptor(p) {
  return {
    name: p.name,
    abiType: p.abiType,
    decimals: Number(p.decimals),
    optional: p.optional,
    title: p.title,
    defaultValue: p.defaultValue,
    hint: p.hint,
    minValue: p.minValue,
    maxValue: p.maxValue,
  }
}

function mapModuleSchema(raw) {
  return {
    kind: raw.kind,
    version: Number(raw.version),
    params: Array.from(raw.params).map(mapParamDescriptor),
  }
}

const registryIface = new Interface(registryAbi)

function getRegistry(config) {
  return new Contract(config.registry, registryAbi, getReadProvider(config))
}

export async function getRegistryOwner(config) {
  return getRegistry(config).owner()
}

export async function getRegistryWithSigner(config) {
  const { signer } = await getSignerProvider(config)
  return new Contract(config.registry, registryAbi, signer)
}

async function getTools(config) {
  const registry = getRegistry(config)
  const toolsAddress = await registry.openFourTool()
  if (!toolsAddress || toolsAddress === '0x0000000000000000000000000000000000000000') {
    throw new Error('Registry.openFourTool() is not configured')
  }
  return new Contract(toolsAddress, toolsAbi, getReadProvider(config))
}

export async function getTokenBaseSchema(config) {
  const tools = await getTools(config)
  return Array.from(await tools.getTokenBaseSchema()).map(mapParamDescriptor)
}

export async function getPresetEncodeSchemas(config, presetId) {
  const tools = await getTools(config)
  const [token, vault, curve, trade, migrate, customData] = await tools.getPresetEncodeSchemas(presetId)
  return {
    token: mapModuleSchema(token),
    vault: mapModuleSchema(vault),
    curve: mapModuleSchema(curve),
    trade: mapModuleSchema(trade),
    migrate: mapModuleSchema(migrate),
    customData: mapModuleSchema(customData),
  }
}

function mapPreset(p) {
  const row = p?.id !== undefined && p?.name !== undefined ? p : (p?.preset ?? p)
  return {
    id: String(row.id),
    name: row.name,
    description: row.description,
    version: row.version,
    active: Boolean(row.active),
    createEnabled: Boolean(row.createEnabled),
    validator: String(row.validator),
    tokenModuleId: String(row.tokenModuleId),
    vaultModuleId: String(row.vaultModuleId),
    curveModuleId: String(row.curveModuleId),
    tradeModuleId: String(row.tradeModuleId),
    migrateModuleId: String(row.migrateModuleId),
    tokenImplId: String(row.tokenImplId),
    customDataId: String(row.customDataId),
    author: String(row.author),
  }
}

export async function getPreset(config, presetId) {
  return mapPreset(await getRegistry(config).getPreset(presetId))
}

export async function upsertModule(config, args) {
  const registry = await getRegistryWithSigner(config)
  try {
    const tx = await registry.upsertModule(
      args.moduleKey,
      args.implementation,
      args.kind,
      {
        moduleId: args.moduleKey,
        version: args.version,
        name: args.name,
        description: args.description,
        author: args.author,
        feeShareBps: Number(args.feeShareBps || 0),
      },
      args.active,
    )
    const rec = await tx.wait()
    if (!rec || rec.status !== 1) throw new Error('upsertModule transaction failed')
    return rec.hash || tx.hash
  } catch (err) {
    throw new Error(formatRevert(err, registryIface))
  }
}

export async function upsertPreset(config, preset) {
  const registry = await getRegistryWithSigner(config)
  try {
    const tx = await registry.upsertPreset({
      id: BigInt(preset.id),
      name: preset.name,
      description: preset.description,
      version: preset.version,
      active: preset.active,
      createEnabled: preset.createEnabled,
      validator: preset.validator,
      tokenModuleId: preset.tokenModuleId,
      vaultModuleId: preset.vaultModuleId,
      curveModuleId: preset.curveModuleId,
      tradeModuleId: preset.tradeModuleId,
      migrateModuleId: preset.migrateModuleId,
      tokenImplId: preset.tokenImplId,
      customDataId: preset.customDataId,
      author: preset.author,
    })
    const rec = await tx.wait()
    if (!rec || rec.status !== 1) throw new Error('upsertPreset transaction failed')
    return rec.hash || tx.hash
  } catch (err) {
    throw new Error(formatRevert(err, registryIface))
  }
}

export async function getPresetIds(config) {
  const ids = await getRegistry(config).getPresetIds()
  return ids.map((id) => id.toString())
}

function isZeroBytes32(value) {
  const hex = String(value || '').toLowerCase()
  return !hex || hex === ZeroHash || hex === `0x${'0'.repeat(64)}`
}

function normalizeKey(value) {
  const hex = String(value || '')
  return hex.startsWith('0x') ? hex.toLowerCase() : hex
}

function mapModule(rec, moduleKey, implementation, keySource) {
  const row = rec?.beacon !== undefined ? rec : rec?.[0] ?? rec
  const meta = row.metadata ?? row[2] ?? {}
  return {
    moduleKey,
    keySource: keySource || '',
    beacon: String(row.beacon || ''),
    implementation: String(implementation || ZeroAddress),
    kind: Number(row.kind ?? 0),
    name: String(meta.name || ''),
    version: String(meta.version || ''),
    description: String(meta.description || ''),
    author: String(meta.author || ''),
    feeShareBps: Number(meta.feeShareBps || 0),
    active: Boolean(row.active),
  }
}

export async function listRegisteredPresets(config) {
  const ids = await getPresetIds(config)
  const rows = await Promise.all(ids.map((id) => getPreset(config, id).catch(() => null)))
  return rows.filter(Boolean)
}

function rememberKey(sourceByKey, moduleKey, label) {
  if (isZeroBytes32(moduleKey)) return
  const key = normalizeKey(moduleKey)
  if (label && !sourceByKey.has(key)) sourceByKey.set(key, label)
  else if (!sourceByKey.has(key)) sourceByKey.set(key, '')
}

function collectKnownSources(extra = {}) {
  const sourceByKey = new Map()

  for (const [label] of STANDARD_MODULE_SOURCES) {
    rememberKey(sourceByKey, moduleKeyFromSource(label), label)
  }
  for (const [label, key] of Object.entries(extra.moduleIds || {})) {
    rememberKey(sourceByKey, key, label)
  }
  for (const label of Object.keys(extra.beacons || {})) {
    rememberKey(sourceByKey, moduleKeyFromSource(label), label)
  }
  for (const row of extra.developerModules || []) {
    rememberKey(sourceByKey, row?.moduleKey, row?.keySource || row?.name || '')
  }
  for (const preset of extra.presets || []) {
    for (const field of ['tokenModuleId', 'vaultModuleId', 'curveModuleId', 'tradeModuleId', 'migrateModuleId', 'customDataId']) {
      rememberKey(sourceByKey, preset[field], '')
    }
  }

  return sourceByKey
}

function isRegisteredBeacon(beacon) {
  return Boolean(beacon && beacon !== ZeroAddress)
}

export async function listRegisteredModules(config, extra = {}) {
  const registry = getRegistry(config)
  const sourceByKey = collectKnownSources(extra)

  const rows = await Promise.all(
    [...sourceByKey.entries()].map(async ([moduleKey, keySource]) => {
      try {
        const [rec, implementation, beacon] = await Promise.all([
          registry.getModule(moduleKey),
          registry.getModuleImplementation(moduleKey),
          registry.getModuleBeacon(moduleKey),
        ])
        const mapped = mapModule(rec, moduleKey, implementation, keySource)
        const resolvedBeacon = beacon || mapped.beacon
        if (!isRegisteredBeacon(resolvedBeacon)) return null
        return { ...mapped, beacon: String(resolvedBeacon) }
      } catch {
        return null
      }
    }),
  )

  return rows
    .filter(Boolean)
    .sort((a, b) => a.kind - b.kind || (a.name || a.keySource).localeCompare(b.name || b.keySource))
}

export async function listRegisteredTokenImpls(config, extra = {}) {
  const registry = getRegistry(config)
  const byId = new Map()

  for (const [label, id] of Object.entries(extra.tokenImplIds || {})) {
    if (!isZeroBytes32(id)) byId.set(normalizeKey(id), label)
  }
  for (const preset of extra.presets || []) {
    if (!isZeroBytes32(preset.tokenImplId)) {
      const key = normalizeKey(preset.tokenImplId)
      if (!byId.has(key)) byId.set(key, '')
    }
  }

  const rows = await Promise.all(
    [...byId.entries()].map(async ([tokenImplId, label]) => {
      try {
        const rec = await registry.getTokenImpl(tokenImplId)
        const implementation = rec.implementation ?? rec[0]
        if (!implementation || implementation === ZeroAddress) return null
        return {
          tokenImplId,
          label,
          implementation: String(implementation),
          version: String(rec.version ?? rec[1] ?? ''),
        }
      } catch {
        return null
      }
    }),
  )

  return rows.filter(Boolean)
}
