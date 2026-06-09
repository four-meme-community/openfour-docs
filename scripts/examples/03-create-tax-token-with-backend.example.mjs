/**
 * Example: Four.meme login → upload image → build payload → POST create API
 * → createToken on chain (tax preset).
 *
 * Env:
 *   PRIVATE_KEY, REGISTRY_ADDRESS, OPEN_FOUR_CORE, PRESET_ID, WRAPPED_NATIVE
 *   IMAGE_PATH (or IMAGE_URL), TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DESC
 *   Optional: FOUR_MEME_API_BASE, RPC_URL, QUOTE_SYMBOL
 *   Optional TaxVault: TAX_VAULT_TYPE_ID, TAX_VAULT_INIT_PARAMS_HEX,
 *   TAX_VAULT_INIT_PARAMS_JSON
 */
import { Contract, JsonRpcProvider, Wallet, ZeroAddress, ZeroHash } from 'ethers'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { createFourMemeApiClient } from '../api/fourMemeClient.js'
import { createTaxTokenWithBackendAndChain } from '../create/createTaxTokenFlow.js'
import { defaultFormDataFromSchema, encodeModuleParams } from '../schema/encodeFromSchema.js'
import { loadPresetSchemas } from '../schema/loadPresetSchemas.js'

const RPC_URL = process.env.RPC_URL ?? 'https://bsc-testnet.publicnode.com'
const PRIVATE_KEY = process.env.PRIVATE_KEY
const REGISTRY_ADDRESS = process.env.REGISTRY_ADDRESS ?? '0xYourRegistry'
const OPEN_FOUR_CORE = process.env.OPEN_FOUR_CORE ?? '0xYourOpenFourCore'
const WRAPPED_NATIVE = process.env.WRAPPED_NATIVE
const PRESET_ID = process.env.PRESET_ID ?? '1778027615723'
const IMAGE_PATH = process.env.IMAGE_PATH
const IMAGE_URL = process.env.IMAGE_URL
const QUOTE_SYMBOL = process.env.QUOTE_SYMBOL

// TaxVault selection:
// - unset TAX_VAULT_TYPE_ID: auto-pick the first active vault type from TaxVaultRegistry
// - TAX_VAULT_TYPE_ID=none/0/ZeroHash: create without an extra TaxVault
// - set TAX_VAULT_TYPE_ID: use that exact active typeId
const TAX_VAULT_TYPE_ID = process.env.TAX_VAULT_TYPE_ID

// If your chosen vault type has init params, either pass pre-encoded bytes here,
// or pass a JSON object by field name via TAX_VAULT_INIT_PARAMS_JSON.
const TAX_VAULT_INIT_PARAMS_HEX = process.env.TAX_VAULT_INIT_PARAMS_HEX
const TAX_VAULT_INIT_PARAMS_JSON = process.env.TAX_VAULT_INIT_PARAMS_JSON

const PARAM_TUPLE =
  '(string name,string abiType,uint8 decimals,bool optional,string title,string defaultValue,string hint,string minValue,string maxValue)'

// Minimal ABI fragments keep this example self-contained.
const OPEN_FOUR_REGISTRY_ABI = [
  'function taxVaultRegistry() view returns (address)',
]

const TAX_VAULT_REGISTRY_ABI = [
  `function getVaultTypeList() view returns (
    (bytes32 typeId,address beacon,address implementation,string name,string version,string description,bool active)[]
  )`,
  `function getVaultTypeEncodeSchema(bytes32 typeId) view returns (
    (string kind,uint8 version,${PARAM_TUPLE}[] params)
  )`,
]

async function main() {
  if (!PRIVATE_KEY) throw new Error('Set PRIVATE_KEY')
  if (!IMAGE_PATH && !IMAGE_URL) throw new Error('Set IMAGE_PATH or IMAGE_URL')

  const provider = new JsonRpcProvider(RPC_URL)
  const signer = new Wallet(PRIVATE_KEY, provider)
  const api = createFourMemeApiClient({
    apiBase: process.env.FOUR_MEME_API_BASE,
  })
  const { accessToken, address } = await api.loginWithSigner({ signer })
  const templateConfig = await api.getTokenTemplateConfig({
    templateId: PRESET_ID,
    symbol: QUOTE_SYMBOL,
  })
  const imgUrl =
    IMAGE_URL ??
    (await api.uploadTokenImage({
      accessToken,
      file: readFileSync(IMAGE_PATH),
      filename: basename(IMAGE_PATH),
    }))

  const { schemas } = await loadPresetSchemas({
    registryAddress: REGISTRY_ADDRESS,
    presetId: PRESET_ID,
    provider,
  })

  const activeParam = [
    ...schemas.token.params,
    ...schemas.curve.params,
    ...schemas.trade.params,
    ...schemas.migrate.params,
  ]

  // Resolve the taxVaultTypeId/taxVaultInitParams pair consumed by TaxTokenModule.
  const vaultSelection = await resolveTaxVaultSelection({
    registryAddress: REGISTRY_ADDRESS,
    provider,
  })

  const result = await createTaxTokenWithBackendAndChain({
    buildRequest: {
      presetId: PRESET_ID,
      schemas,
      taxInfo: {
        buyFeeRate: 100,
        sellFeeRate: 100,
        rateFounder: 100,
        rateBurn: 0,
        rateHolder: 0,
        rateLiquidity: 0,
        minShare: 1000000,
        founder: address,
      },
      activeParam,
      imgUrl,
      createParams: {
        name: process.env.TOKEN_NAME ?? 'Full Flow Token',
        shortName: process.env.TOKEN_SYMBOL ?? 'FFT',
        symbol: templateConfig.symbol,
        desc: process.env.TOKEN_DESC ?? 'SDK full flow',
        preSale: 0,
      },
      templateConfig,
      vaultSelection,
    },
    postCreate: (payload) => api.postCreate(payload, { accessToken }),
    signer,
    coreAddress: OPEN_FOUR_CORE,
    wrappedNative: WRAPPED_NATIVE,
  })

  console.log('tokenId:', result.tokenId)
  console.log('tx:', result.hash)
  console.log('txValue:', result.txValue?.toString())
  console.log('presaleNative:', result.presaleNative)
}

main().catch(console.error)

async function resolveTaxVaultSelection({ registryAddress, provider }) {
  // Explicit opt-out: keep taxVaultTypeId as ZeroHash and no init params.
  if (isNoTaxVaultType(TAX_VAULT_TYPE_ID)) {
    return { typeId: ZeroHash, initParamsHex: '0x' }
  }

  // OpenFourRegistry owns the configured TaxVaultRegistry address for this deployment.
  const taxVaultRegistryAddr = await getTaxVaultRegistryAddress({
    registryAddress,
    provider,
  })
  const vaultTypes = await getVaultTypeList({
    taxVaultRegistryAddr,
    provider,
  })

  // If no env override is provided, use the first active template as the demo default.
  const selectedType =
    TAX_VAULT_TYPE_ID ? findVaultType(vaultTypes, TAX_VAULT_TYPE_ID) : vaultTypes[0]

  if (TAX_VAULT_TYPE_ID && !selectedType) {
    throw new Error(`TaxVault type not found or inactive: ${TAX_VAULT_TYPE_ID}`)
  }

  if (!selectedType) {
    console.warn('No active TaxVault types found; using no-vault selection.')
    return { typeId: ZeroHash, initParamsHex: '0x' }
  }

  // Explicit pre-encoded bytes win; otherwise encode from the type's on-chain schema.
  const initParamsHex =
    TAX_VAULT_INIT_PARAMS_HEX ??
    (await encodeVaultInitParams({
      taxVaultRegistryAddr,
      typeId: selectedType.typeId,
      provider,
    }))

  console.log('taxVaultRegistry:', taxVaultRegistryAddr)
  console.log('taxVaultType:', selectedType.name, selectedType.typeId)
  return { typeId: selectedType.typeId, initParamsHex }
}

async function getTaxVaultRegistryAddress({ registryAddress, provider }) {
  const registry = new Contract(registryAddress, OPEN_FOUR_REGISTRY_ABI, provider)
  const taxVaultRegistryAddr = await registry.taxVaultRegistry()
  if (!taxVaultRegistryAddr || taxVaultRegistryAddr === ZeroAddress) {
    throw new Error('OpenFourRegistry.taxVaultRegistry is not configured')
  }
  return taxVaultRegistryAddr
}

async function getVaultTypeList({ taxVaultRegistryAddr, provider }) {
  // Registry returns the whole catalog; creation UI/examples only use active templates.
  const registry = new Contract(taxVaultRegistryAddr, TAX_VAULT_REGISTRY_ABI, provider)
  const raw = await registry.getVaultTypeList()
  return Array.from(raw)
    .map((v) => ({
      typeId: v.typeId,
      name: v.name,
      version: v.version,
      description: v.description,
      active: v.active,
      beacon: v.beacon,
      implementation: v.implementation,
    }))
    .filter((v) => v.active)
}

async function encodeVaultInitParams({ taxVaultRegistryAddr, typeId, provider }) {
  // No-vault and no-param vaults both encode to empty bytes.
  if (!typeId || typeId === ZeroHash) return '0x'

  const registry = new Contract(taxVaultRegistryAddr, TAX_VAULT_REGISTRY_ABI, provider)
  const raw = await registry.getVaultTypeEncodeSchema(typeId)
  const schema = {
    kind: raw.kind,
    version: Number(raw.version),
    params: Array.from(raw.params).map(mapParamDescriptor),
  }
  if (schema.params.length === 0) return '0x'

  // Defaults come from schema; JSON env can override or fill required fields.
  const initForm = {
    ...defaultFormDataFromSchema(schema.params),
    ...parseVaultInitParamsJson(),
  }

  // Fail early with field names instead of letting ABI encoding throw a vague error.
  const missing = schema.params
    .filter((p) => !p.optional && initForm[p.name] == null)
    .map((p) => p.name)
  if (missing.length > 0) {
    throw new Error(
      `Set TAX_VAULT_INIT_PARAMS_JSON for required vault params: ${missing.join(', ')}`,
    )
  }
  return encodeModuleParams(schema, initForm)
}

function mapParamDescriptor(p) {
  // ethers may expose Solidity structs as named fields or tuple indexes.
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

function parseVaultInitParamsJson() {
  if (!TAX_VAULT_INIT_PARAMS_JSON) return {}
  const parsed = JSON.parse(TAX_VAULT_INIT_PARAMS_JSON)
  if (parsed == null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('TAX_VAULT_INIT_PARAMS_JSON must be a JSON object')
  }
  return parsed
}

function findVaultType(vaultTypes, typeId) {
  if (!typeId) return null
  return vaultTypes.find((v) => v.typeId.toLowerCase() === typeId.toLowerCase())
}

function isNoTaxVaultType(typeId) {
  return typeId === 'none' || typeId === '0' || typeId === ZeroHash
}
