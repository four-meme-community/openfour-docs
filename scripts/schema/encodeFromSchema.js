import { AbiCoder, ZeroAddress, ZeroHash, parseUnits } from 'ethers'

const coder = AbiCoder.defaultAbiCoder()

function resolveParam(desc, form) {
  const raw = form[desc.name]
  const str = String(raw ?? '').trim()
  const missing = raw == null || str === ''

  if (missing) {
    if (desc.optional) return zeroValue(desc.abiType)
    throw new Error(`encodeFromSchema: required param "${desc.name}" is missing`)
  }

  switch (desc.abiType) {
    case 'bool':
      if (typeof raw === 'boolean') return raw
      return str === 'true' || str === '1'
    case 'address':
      return str || ZeroAddress
    case 'string':
      return str
    case 'bytes32':
      return str || ZeroHash
    case 'bytes':
      return str || '0x'
    default:
      if (desc.decimals > 0) return parseUnits(str, desc.decimals)
      return BigInt(str)
  }
}

function zeroValue(abiType) {
  if (abiType === 'address') return ZeroAddress
  if (abiType === 'bool') return false
  return 0n
}

export function encodeModuleParams(schema, form) {
  if (schema.params.length === 0) return '0x'
  const types = schema.params.map((p) => p.abiType)
  const values = schema.params.map((p) => resolveParam(p, form))
  const tupleType = `(${types.join(',')})`
  return coder.encode([tupleType], [values])
}

export function decodeModuleParams(schema, encoded) {
  if (schema.params.length === 0 || !encoded || encoded === '0x') return {}
  const types = schema.params.map((p) => p.abiType)
  const tupleType = `(${types.join(',')})`
  const row = coder.decode([tupleType], encoded)[0]
  const vals = Array.from(row)
  return Object.fromEntries(schema.params.map((p, i) => [p.name, vals[i]]))
}

export function toUnitsOrNull(value, decimals) {
  if (value == null) return null
  const s = String(value).trim()
  if (!s) return null
  try {
    return parseUnits(s, decimals)
  } catch {
    return null
  }
}

export function defaultFormDataFromSchema(params) {
  const out = {}
  for (const p of params) {
    if (p.defaultValue !== '') out[p.name] = p.defaultValue
  }
  return out
}
