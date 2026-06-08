import { defaultFormDataFromSchema } from './encodeFromSchema.js'
import {
  getPreset,
  getPresetEncodeSchemas,
  getPresetIds,
  getTokenBaseSchema,
  resolveToolsAddress,
} from './loadPresetSchemas.js'
import {
  isTaxTokenModuleTag,
  isUniTokenModuleTag,
  TAX_TOKEN_MODULE_TAG,
  UNI_TOKEN_MODULE_TAG,
} from './moduleTags.js'

export { TAX_TOKEN_MODULE_TAG, UNI_TOKEN_MODULE_TAG } from './moduleTags.js'

/**
 * SDK-only UI grouping for create flows. Not stored on OpenFour contracts.
 *
 * Derived by `detectCreateMode()` from `preset.tokenModuleTag` (module `descriptor().tag`):
 *
 * | CREATE_MODE | On-chain `tokenModuleTag` |
 * |-------------|---------------------------|
 * | uni_v4      | `module.token.uni` |
 * | tax         | `module.token.tax` |
 * | generic     | e.g. `module.token.standard` |
 *
 * Priority: uni_v4 → tax → generic. Prefer `preset.tokenModuleTag` over `mode`.
 */
export const CREATE_MODE = {
  TAX: 'tax',
  UNI_V4: 'uni_v4',
  GENERIC: 'generic',
}

/** Params handled outside the main schema form. */
export const VAULT_PARAM_NAMES = new Set(['taxVaultTypeId', 'taxVaultInitParams'])
export const AUTO_MINED_PARAM_NAMES = new Set(['hookSalt'])

/**
 * Merge base + per-preset module params (same layout as CreateTokenPage / meme-launcher).
 */
export function buildCombinedParams(baseSchema, schemas, { raiseAmountField } = {}) {
  const hiddenBase =
    raiseAmountField && raiseAmountField !== 'raiseAmount'
      ? new Set(['raiseAmount'])
      : new Set()

  const filteredBase = baseSchema.filter((d) => !hiddenBase.has(d.name))
  return [
    ...filteredBase,
    ...schemas.token.params,
    ...schemas.curve.params,
    ...schemas.trade.params,
    ...schemas.migrate.params,
  ]
}

/**
 * Map on-chain `preset.tokenModuleTag` to SDK `CREATE_MODE` (see `CREATE_MODE` JSDoc).
 */
export function detectCreateMode({ preset }) {
  const tag = preset?.tokenModuleTag ?? ''
  if (isUniTokenModuleTag(tag)) return CREATE_MODE.UNI_V4
  if (isTaxTokenModuleTag(tag)) return CREATE_MODE.TAX
  return CREATE_MODE.GENERIC
}

export function buildCreateModeFlags({ preset, activeParams, mode }) {
  const tag = preset?.tokenModuleTag ?? ''
  const isTaxToken = isTaxTokenModuleTag(tag)
  const isUniToken = isUniTokenModuleTag(tag)
  const hasVaultParams = activeParams.some((p) => p.name === 'taxVaultTypeId')

  return {
    mode,
    isTaxToken,
    isUniToken,
    tokenModuleTag: tag,
    needsVaultSelection: isTaxToken && hasVaultParams,
    needsHookSalt: isUniToken,
    hasCustomDataSchema: Boolean(preset?.customDataId && !isZeroBytes32(preset.customDataId)),
  }
}

function isZeroBytes32(value) {
  if (value == null) return true
  const s = String(value).toLowerCase()
  return (
    s === '0x0000000000000000000000000000000000000000000000000000000000000000' ||
    s === '0x00'
  )
}

/**
 * Params for SchemaDrivenForm — excludes vault fields and auto-mined hookSalt.
 */
export function getDisplayParams(activeParams) {
  return activeParams.filter(
    (p) => !VAULT_PARAM_NAMES.has(p.name) && !AUTO_MINED_PARAM_NAMES.has(p.name),
  )
}

/**
 * Resolve one preset: metadata + module schemas + combined active params + defaults.
 */
export async function resolvePresetCreateSchema({
  registryAddress,
  presetId,
  provider,
  raiseAmountField,
}) {
  const toolsAddress = await resolveToolsAddress({ registryAddress, provider })
  const runner = provider

  const [preset, schemas, baseSchema] = await Promise.all([
    getPreset({ registryAddress, presetId, provider: runner }),
    getPresetEncodeSchemas({ toolsAddress, presetId, provider: runner }),
    getTokenBaseSchema({ toolsAddress, provider: runner }),
  ])

  const activeParams = buildCombinedParams(baseSchema, schemas, { raiseAmountField })
  const mode = detectCreateMode({ preset })
  const flags = buildCreateModeFlags({ preset, activeParams, mode })
  const displayParams = getDisplayParams(activeParams)
  const defaultTaxInfo = defaultFormDataFromSchema(activeParams)

  return {
    presetId: String(presetId),
    preset,
    schemas,
    baseSchema,
    toolsAddress,
    activeParams,
    displayParams,
    mode,
    flags,
    defaultTaxInfo,
  }
}

/**
 * List on-chain presets and resolve create schemas for each creatable preset.
 *
 * @param {object} options
 * @param {string} options.registryAddress
 * @param {import('ethers').Provider} [options.provider]
 * @param {boolean} [options.onlyCreateEnabled=true] - filter active && createEnabled
 * @param {boolean} [options.includeDisabled=false] - include inactive/disabled presets
 */
export async function resolveAllPresetCreateSchemas({
  registryAddress,
  provider,
  onlyCreateEnabled = true,
  includeDisabled = false,
}) {
  const presetIds = await getPresetIds({ registryAddress, provider })

  const presetViews = await Promise.all(
    presetIds.map((id) => getPreset({ registryAddress, presetId: id, provider })),
  )

  const targetIds = presetIds.filter((id, i) => {
    const p = presetViews[i]
    if (includeDisabled) return true
    if (!onlyCreateEnabled) return true
    return p.active && p.createEnabled
  })

  const items = await Promise.all(
    targetIds.map((presetId) =>
      resolvePresetCreateSchema({ registryAddress, presetId, provider }),
    ),
  )

  return {
    presetIds: targetIds,
    items,
    byId: Object.fromEntries(items.map((item) => [item.presetId, item])),
    summary: items.map((item) => ({
      presetId: item.presetId,
      name: item.preset.name,
      mode: item.mode,
      tokenModuleTag: item.preset.tokenModuleTag,
      paramCount: item.activeParams.length,
      displayParamCount: item.displayParams.length,
      flags: item.flags,
    })),
  }
}
