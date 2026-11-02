import { AbiCoder, parseUnits, ZeroAddress, ZeroHash } from 'ethers'

const coder = AbiCoder.defaultAbiCoder()

function parseArrayValue(raw) {
  if (Array.isArray(raw)) return raw
  const str = String(raw ?? '').trim()
  if (!str) return []
  if (str.startsWith('[')) {
    const parsed = JSON.parse(str)
    if (!Array.isArray(parsed)) throw new Error('array param must be a JSON array')
    return parsed
  }
  return str.split(/[\n,]+/).map((v) => v.trim()).filter(Boolean)
}

function zeroValue(abiType) {
  if (abiType.endsWith('[]')) return []
  if (abiType === 'address') return ZeroAddress
  if (abiType === 'bool') return false
  if (abiType === 'bytes32') return ZeroHash
  if (abiType === 'bytes' || abiType === 'string') return abiType === 'bytes' ? '0x' : ''
  return 0n
}

function resolveParam(desc, form) {
  const raw = form[desc.name]
  const str = String(raw ?? '').trim()
  const missing = raw == null || str === ''

  if (missing) {
    if (desc.optional) return zeroValue(desc.abiType)
    throw new Error(`encodeFromSchema: required param "${desc.name}" is missing`)
  }

  switch (desc.abiType) {
    case 'address[]':
      return parseArrayValue(raw).map((v) => String(v).trim())
    case 'uint16[]':
      return parseArrayValue(raw).map((v) => BigInt(String(v).trim()))
    case 'uint256[]':
      return parseArrayValue(raw).map((v) => {
        const s = String(v).trim()
        return desc.decimals > 0 ? parseUnits(s, desc.decimals) : BigInt(s)
      })
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
      return desc.decimals > 0 ? parseUnits(str, desc.decimals) : BigInt(str)
  }
}

export function encodeModuleParams(schema, form) {
  if (!schema?.params?.length) return '0x'
  const types = schema.params.map((p) => p.abiType)
  const values = schema.params.map((p) => resolveParam(p, form))
  return coder.encode([`(${types.join(',')})`], [values])
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
