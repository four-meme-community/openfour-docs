import { AbiCoder } from 'ethers'
import codecConfig from './abi/createTokenArgsCodec.json' with { type: 'json' }

const coder = AbiCoder.defaultAbiCoder()

function buildCreateArgAbi(includeCustomData) {
  const initComponents = includeCustomData
    ? [...codecConfig.initParams13, { name: 'customDataParams', type: 'bytes' }]
    : codecConfig.initParams13

  return [
    {
      name: 'args',
      type: 'tuple',
      components: [
        ...codecConfig.outerFields,
        { name: 'initParams', type: 'tuple', components: initComponents },
      ],
    },
  ]
}

const ABI_13 = buildCreateArgAbi(false)
const ABI_14 = buildCreateArgAbi(true)

function toBigInt(value) {
  if (value == null) return 0n
  if (typeof value === 'bigint') return value
  return BigInt(value)
}

/**
 * Normalize backend `createArg` bytes to 14-field layout (with customDataParams).
 * Returns decoded struct for fee / presale calculations.
 */
export function normalizeCreateArg(rawCreateArg) {
  if (!rawCreateArg || rawCreateArg === '0x') {
    throw new Error('normalizeCreateArg: rawCreateArg is required')
  }

  let createArg = rawCreateArg
  let decoded

  try {
    ;[decoded] = coder.decode(ABI_14, rawCreateArg)
  } catch (err14) {
    try {
      const [d] = coder.decode(ABI_13, rawCreateArg)
      decoded = d
      createArg = coder.encode(ABI_14, [
        { ...d, initParams: { ...d.initParams, customDataParams: '0x' } },
      ])
    } catch {
      const hint = err14 instanceof Error ? err14.message : String(err14)
      throw new Error(`normalizeCreateArg: failed to decode createArg (${hint})`)
    }
  }

  return { createArg, decoded }
}

/**
 * Whether presale is paid via msg.value (quoteAsset must equal wrappedNative).
 * Mirrors OpenFourCoreLib: presaleNative = presaleQuote > 0 && quoteAsset == wrappedNative.
 */
export function isPresaleNative({ presaleQuote, quoteAsset, wrappedNative }) {
  const presale = toBigInt(presaleQuote)
  if (presale <= 0n) return false
  const q = String(quoteAsset ?? '').toLowerCase()
  const w = String(wrappedNative ?? '').toLowerCase()
  return Boolean(q && w && q === w)
}

/**
 * msg.value for OpenFourCore.createToken.
 *
 * Contract rules (OpenFourCoreLib.executeCreateToken):
 * - createFee is always paid in native (msg.value).
 * - presaleQuote is included in msg.value only when presaleNative (quoteAsset == wrappedNative).
 * - ERC20 presale: msg.value = createFee only; presale uses transferFrom on quote token.
 */
export function computeCreateTokenTxValue(decoded, options = {}) {
  const { quoteAsset, wrappedNative, quoteIsNative } = options
  const createFee = toBigInt(decoded?.createFee)
  const presaleQuote = toBigInt(decoded?.presaleQuote)
  const quote = quoteAsset ?? decoded?.initParams?.quoteAsset

  if (wrappedNative != null && quote != null) {
    if (isPresaleNative({ presaleQuote, quoteAsset: quote, wrappedNative })) {
      return createFee + presaleQuote
    }
    return createFee
  }

  // Legacy fallback when wrappedNative is not provided (prefer passing wrappedNative).
  if (quoteIsNative === false) return createFee
  if (quoteIsNative === true && presaleQuote > 0n) return createFee + presaleQuote
  return createFee
}
