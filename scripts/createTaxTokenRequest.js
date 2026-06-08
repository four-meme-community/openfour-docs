import { encodeModuleParams } from './encodeFromSchema.js'
import { isTaxTokenModuleTag } from './moduleTags.js'

const ZERO_HASH =
  '0x0000000000000000000000000000000000000000000000000000000000000000'

/**
 * Backend/API presale field: supports presaleQuote and legacy preSale.
 */
export function resolvePresaleQuote(sources = {}) {
  const { presaleQuote, preSale } = sources
  if (presaleQuote != null && presaleQuote !== '') return presaleQuote
  if (preSale != null && preSale !== '') return preSale
  return 0
}

/**
 * Build the backend request payload for token creation (POST body + initParams encoding).
 *
 * Module param values (buyFeeRate, router, etc.) must be set on `taxInfo` by
 * the caller — no HTML/form layer; integrator maps UI to schema field names.
 *
 * This only assembles params and does not handle image uploading.
 * Pass the final avatar URL via `imgUrl`.
 */
export function buildCreateTaxTokenRequest(input) {
  const {
    presetId,
    taxInfo = {},
    createParams = {},
    schemas,
    raisedToken = {},
    activeParam = [],
    tokenModuleTag = '',
    vaultSelection = { typeId: ZERO_HASH, initParamsHex: '0x' },
    feePlan = true,
    imgUrl = '',
    saleAmount = 0,
    totalSupply = 0,
    customDataParams = '0x',
    vaultParams = '0x',
    extraPayload = {},
  } = input ?? {}

  if (!presetId && presetId !== 0) {
    throw new Error('buildCreateTaxTokenRequest: presetId is required')
  }
  if (!schemas?.token || !schemas?.curve || !schemas?.trade || !schemas?.migrate) {
    throw new Error('buildCreateTaxTokenRequest: schemas.token/curve/trade/migrate are required')
  }

  const isTaxToken =
    isTaxTokenModuleTag(tokenModuleTag) ||
    activeParam.some((p) => p?.name === 'taxVaultTypeId')

  const enrichedTaxInfo = {
    ...taxInfo,
    ...(isTaxToken
      ? {
          taxVaultTypeId: vaultSelection.typeId ?? ZERO_HASH,
          taxVaultInitParams: vaultSelection.initParamsHex ?? '0x',
        }
      : {}),
  }

  const tokenParams = encodeModuleParams(schemas.token, enrichedTaxInfo)
  const curveParams = encodeModuleParams(schemas.curve, taxInfo)
  const tradeParams = encodeModuleParams(schemas.trade, taxInfo)
  const migrateParams = encodeModuleParams(schemas.migrate, taxInfo)

  const presaleQuote = resolvePresaleQuote({
    ...extraPayload,
    ...createParams,
  })

  const payload = {
    ...extraPayload,
    ...createParams,
    presetId,
    templateId: presetId,
    imgUrl,
    name: createParams.name ?? '',
    shortName: createParams.shortName ?? '',
    symbol: createParams.symbol ?? raisedToken.nativeSymbol ?? '',
    raisedAmount: createParams.raisedAmount ?? raisedToken.totalBAmount ?? 0,
    saleAmount: createParams.saleAmount ?? saleAmount,
    totalSupply: createParams.totalSupply ?? totalSupply,
    presaleQuote,
    feePlan: createParams.feePlan ?? feePlan,
    initParams: {
      ...(createParams.initParams ?? {}),
      tokenParams,
      vaultParams,
      curveParams,
      tradeParams,
      migrateParams,
      customDataParams,
    },
  }

  return {
    payload,
    enrichedTaxInfo,
    encodedParams: {
      tokenParams,
      vaultParams,
      curveParams,
      tradeParams,
      migrateParams,
      customDataParams,
    },
  }
}
