#!/usr/bin/env node
/**
 * Verify SDK-assembled initParams and CreateTokenArgs layout against on-chain schemas.
 *
 * Usage (from SDK root):
 *   node scripts/verify-create-args.mjs
 *   REGISTRY_ADDRESS=0x... RPC_URL=... node scripts/verify-create-args.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AbiCoder, JsonRpcProvider, ZeroHash } from 'ethers'
import { buildCreateTaxTokenRequest } from '../createTaxTokenRequest.js'
import { decodeModuleParams, encodeModuleParams } from '../encodeFromSchema.js'
import { normalizeCreateArg, computeCreateTokenTxValue } from '../createArgCodec.js'
import {
  resolveAllPresetCreateSchemas,
  resolvePresetCreateSchema,
} from '../resolvePresetCreateSchemas.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

async function loadDeployment(provider) {
  const rpc = process.env.RPC_URL || 'http://127.0.0.1:8545'
  const preferred = process.env.DEPLOYMENT_FILE
  const files = preferred
    ? [preferred]
    : ['localhost.json', 'hardhat.json', 'bsctestnet.json']
  const network = await provider.getNetwork()
  const chainId = Number(network.chainId)

  for (const f of files) {
    const p = path.join(ROOT, 'public/deployments', f)
    if (!fs.existsSync(p)) continue
    const cfg = JSON.parse(fs.readFileSync(p, 'utf8'))
    if (!cfg?.addresses?.registry || !cfg?.addresses?.core) continue
    if (!preferred && cfg.chainId && Number(cfg.chainId) !== chainId) continue
    return {
      rpc,
      registry: cfg.addresses.registry,
      core: cfg.addresses.core,
      wbnb: cfg.addresses.wbnb || cfg.config?.wbnb,
      presets: cfg.presets ?? {},
      file: f,
    }
  }
  throw new Error(`No deployment json for chainId=${chainId}`)
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`)
}

function assertEq(a, b, label) {
  if (String(a) !== String(b)) {
    throw new Error(`ASSERT ${label}: expected ${b}, got ${a}`)
  }
}

/** Build minimal CreateTokenArgs bytes (same layout as backend / createArgCodec). */
function encodeSyntheticCreateArgs({
  requestId,
  presetId,
  validTimestamp,
  createFee,
  presaleQuote,
  antiSniperEnabled,
  initParams,
}) {
  const coder = AbiCoder.defaultAbiCoder()
  const type =
    'tuple(uint256 requestId,uint256 presetId,uint256 validTimestamp,uint256 createFee,uint256 presaleQuote,bool antiSniperEnabled,tuple(string name,string symbol,string tokenUri,uint256 maxSupply,uint256 saleAmount,uint256 raiseAmount,address quoteAsset,bytes32 tokenSalt,bytes tokenParams,bytes vaultParams,bytes curveParams,bytes tradeParams,bytes migrateParams,bytes customDataParams) initParams)'
  return coder.encode([type], [
    [
      requestId,
      presetId,
      validTimestamp,
      createFee,
      presaleQuote,
      antiSniperEnabled,
      [
        initParams.name,
        initParams.symbol,
        initParams.tokenUri,
        initParams.maxSupply,
        initParams.saleAmount,
        initParams.raiseAmount,
        initParams.quoteAsset,
        initParams.tokenSalt,
        initParams.tokenParams,
        initParams.vaultParams,
        initParams.curveParams,
        initParams.tradeParams,
        initParams.migrateParams,
        initParams.customDataParams,
      ],
    ],
  ])
}

async function verifyTaxPreset({ registry, wbnb, provider, presetId }) {
  const resolved = await resolvePresetCreateSchema({
    registryAddress: registry,
    presetId,
    provider,
  })

  assert(resolved.flags.isTaxToken, `preset ${presetId} should be tax mode`)
  assert(
    resolved.preset.tokenModuleTag === 'module.token.tax',
    `preset ${presetId} tokenModuleTag`,
  )

  const taxInfo = {
    ...resolved.defaultTaxInfo,
    buyFeeRate: 300,
    sellFeeRate: 300,
    rateFounder: 100,
    rateHolder: 0,
    rateBurn: 0,
    rateLiquidity: 0,
    minShare: 1000000,
    founder: '0x0000000000000000000000000000000000000001',
    quoteAsset: wbnb,
  }

  const { payload, enrichedTaxInfo, encodedParams } = buildCreateTaxTokenRequest({
    presetId,
    schemas: resolved.schemas,
    taxInfo,
    activeParam: resolved.activeParams,
    tokenModuleTag: resolved.preset.tokenModuleTag,
    createParams: {
      name: 'SDK Verify Token',
      shortName: 'SVT',
      preSale: 0,
    },
    vaultSelection: {
      typeId: ZeroHash,
      initParamsHex: '0x',
    },
    raisedToken: { nativeSymbol: 'BNB', totalBAmount: '18' },
    saleAmount: 800000000,
    totalSupply: 1000000000,
  })

  assert(payload.presaleQuote === 0, 'preSale should map to presaleQuote 0')
  assert(payload.initParams.tokenParams.startsWith('0x'), 'tokenParams hex')
  assert(payload.initParams.tokenParams.length > 2, 'tokenParams non-empty')

  const decodedToken = decodeModuleParams(
    resolved.schemas.token,
    encodedParams.tokenParams,
  )

  assertEq(decodedToken.buyFeeRate, 300n, 'buyFeeRate')
  assertEq(decodedToken.sellFeeRate, 300n, 'sellFeeRate')
  assertEq(decodedToken.rateFounder, 100n, 'rateFounder')
  assertEq(decodedToken.taxVaultTypeId, ZeroHash, 'taxVaultTypeId')

  // Round-trip: re-encode enriched tax info must match SDK output
  const reencoded = encodeModuleParams(resolved.schemas.token, enrichedTaxInfo)
  assertEq(reencoded, encodedParams.tokenParams, 'tokenParams round-trip')

  // Synthetic createArgs using SDK initParams bytes
  const createArgs = encodeSyntheticCreateArgs({
    requestId: 1n,
    presetId: BigInt(presetId),
    validTimestamp: BigInt(Math.floor(Date.now() / 1000) + 3600),
    createFee: 0n,
    presaleQuote: 0n,
    antiSniperEnabled: payload.feePlan === true,
    initParams: {
      name: payload.name,
      symbol: payload.shortName,
      tokenUri: payload.imgUrl || '',
      maxSupply: BigInt(payload.totalSupply),
      saleAmount: BigInt(payload.saleAmount),
      raiseAmount: 0n,
      quoteAsset: wbnb,
      tokenSalt: ZeroHash,
      tokenParams: encodedParams.tokenParams,
      vaultParams: encodedParams.vaultParams,
      curveParams: encodedParams.curveParams,
      tradeParams: encodedParams.tradeParams,
      migrateParams: encodedParams.migrateParams,
      customDataParams: encodedParams.customDataParams,
    },
  })

  const { createArg, decoded } = normalizeCreateArg(createArgs)
  assertEq(createArg, createArgs, 'normalize 14-field idempotent')
  assertEq(decoded.presetId, BigInt(presetId), 'decoded presetId')
  assertEq(decoded.initParams.tokenParams, encodedParams.tokenParams, 'decoded tokenParams')
  assertEq(decoded.initParams.quoteAsset, wbnb, 'decoded quoteAsset')

  const txValue = computeCreateTokenTxValue(decoded, {
    quoteAsset: wbnb,
    wrappedNative: wbnb,
  })
  assertEq(txValue, 0n, 'txValue with zero fees')

  return { presetId, payload, decodedToken }
}

async function main() {
  const provider = new JsonRpcProvider(process.env.RPC_URL || 'http://127.0.0.1:8545')
  const dep = await loadDeployment(provider)
  const network = await provider.getNetwork()
  console.log(`Network chainId=${network.chainId} deployment=${dep.file}`)
  console.log(`Registry=${dep.registry} Core=${dep.core} WBNB=${dep.wbnb}`)

  const { items, summary } = await resolveAllPresetCreateSchemas({
    registryAddress: dep.registry,
    provider,
  })

  console.log('\nCreatable presets:')
  console.table(summary)

  const taxPresets = items.filter((x) => x.flags.isTaxToken)
  assert(taxPresets.length > 0, 'no tax preset on chain — deploy tax preset first')

  for (const item of taxPresets.slice(0, 2)) {
    console.log(`\n--- Verifying tax preset ${item.presetId} (${item.preset.name}) ---`)
    const result = await verifyTaxPreset({
      registry: dep.registry,
      wbnb: dep.wbnb,
      provider,
      presetId: item.presetId,
    })
    console.log('OK tokenParams decode:', {
      buyFeeRate: String(result.decodedToken.buyFeeRate),
      sellFeeRate: String(result.decodedToken.sellFeeRate),
      rateFounder: String(result.decodedToken.rateFounder),
    })
    console.log('OK createArgs normalize + initParams match')
  }

  console.log('\nAll verify-create-args checks passed.')
}

main().catch((err) => {
  console.error('\nverify-create-args FAILED:', err.message)
  process.exit(1)
})
