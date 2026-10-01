import { AbiCoder, ZeroAddress } from 'ethers'
import codecConfig from '../abi/createTokenArgsCodec.json' with { type: 'json' }

const coder = AbiCoder.defaultAbiCoder()

function buildCreateArgAbi(includeCustomData, includePartner = true) {
  const initComponents = includeCustomData
    ? [...codecConfig.initParams13, { name: 'customDataParams', type: 'bytes' }]
    : codecConfig.initParams13
  const outerFields = includePartner
    ? codecConfig.outerFields
    : codecConfig.outerFields.filter((field) => field.name !== 'partner')

  return [
    {
      name: 'args',
      type: 'tuple',
      components: [
        ...outerFields,
        { name: 'initParams', type: 'tuple', components: initComponents },
      ],
    },
  ]
}

const ABI_CURRENT = buildCreateArgAbi(true, true)
const ABI_LEGACY_NO_PARTNER = buildCreateArgAbi(true, false)
const ABI_LEGACY_NO_CUSTOM = buildCreateArgAbi(false, false)

function toBigInt(value) {
  if (value == null) return 0n
  if (typeof value === 'bigint') return value
  return BigInt(value)
}

/**
 * Normalize backend `createArg` bytes to the current layout
 * (outer `partner` + initParams `customDataParams`).
 * Returns decoded struct for fee / presale calculations.
 */
export function normalizeCreateArg(rawCreateArg) {
  if (!rawCreateArg || rawCreateArg === '0x') {
    throw new Error('normalizeCreateArg: rawCreateArg is required')
  }

  let createArg = rawCreateArg
  let decoded

  try {
    ;[decoded] = coder.decode(ABI_CURRENT, rawCreateArg)
  } catch (errCurrent) {
    try {
      const [d] = coder.decode(ABI_LEGACY_NO_PARTNER, rawCreateArg)
      decoded = { ...d, partner: ZeroAddress }
      createArg = coder.encode(ABI_CURRENT, [decoded])
    } catch {
      try {
        const [d] = coder.decode(ABI_LEGACY_NO_CUSTOM, rawCreateArg)
        decoded = {
          ...d,
          partner: ZeroAddress,
          initParams: { ...d.initParams, customDataParams: '0x' },
        }
        createArg = coder.encode(ABI_CURRENT, [decoded])
      } catch {
        const hint = errCurrent instanceof Error ? errCurrent.message : String(errCurrent)
        throw new Error(`normalizeCreateArg: failed to decode createArg (${hint})`)
      }
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
