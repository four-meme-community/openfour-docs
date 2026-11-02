import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AbiCoder, Contract, ZeroHash, getBytes, keccak256, solidityPacked } from 'ethers'
import { SchemaDrivenForm } from '../components/SchemaDrivenForm'
import { DebugPanel } from '../components/DebugPanel'
import { useDeployment } from '../eth/deployment'
import { ifaceTokenCreated, TOPIC_TOKEN_CREATED } from '../eth/coreEvents'
import { formatRevert, getFourCoreReadOnly, getFourCoreWithSigner } from '../eth/fourCore'
import { getSignerProvider } from '../eth/provider'
import { getPreset, getPresetEncodeSchemas, getPresetIds, getTokenBaseSchema } from '../eth/moduleRegistry'
import { defaultFormDataFromSchema, encodeModuleParams, toUnitsOrNull } from '../eth/encodeFromSchema'
import { computeCreateTokenTxValue } from '../eth/createTokenTxValue'
import { useWallet } from '../hooks/useWallet'
import { useT } from '../i18n'

const OUTER_FORM_DEFAULTS = { createFee: '0', presaleQuote: '0' }
const DEFAULT_MAX_SUPPLY_TOKENS = '1000000000'
const DEFAULT_SALE_AMOUNT_TOKENS = '800000000'
const QUOTE_DECIMALS_ABI = ['function decimals() view returns (uint8)']

function buildCombinedParams(base, schemas) {
  return [
    ...base,
    ...schemas.token.params,
    ...schemas.curve.params,
    ...schemas.trade.params,
    ...schemas.migrate.params,
  ]
}

export function CreateTokenPage() {
  const navigate = useNavigate()
  const { config, recordToken } = useDeployment()
  const { address } = useWallet()
  const t = useT()
  const [tabs, setTabs] = useState([])
  const [activePresetId, setActivePresetId] = useState('')
  const [wrappedNative, setWrappedNative] = useState('')
  const [coreSigner, setCoreSigner] = useState('')
  const [forms, setForms] = useState({})
  const [loading, setLoading] = useState(false)
  const [txHash, setTxHash] = useState(null)
  const [error, setError] = useState(null)
  const [debug, setDebug] = useState(null)
  const [activeParams, setActiveParams] = useState([])
  const baseSchemaRef = useRef([])
  const schemaCache = useRef({})
  const presetViewCache = useRef({})

  async function loadSchemas(presetId) {
    if (schemaCache.current[presetId] && presetViewCache.current[presetId]) {
      return { schemas: schemaCache.current[presetId], view: presetViewCache.current[presetId] }
    }
    const [schemas, view] = await Promise.all([
      getPresetEncodeSchemas(config, presetId),
      getPreset(config, presetId),
    ])
    schemaCache.current[presetId] = schemas
    presetViewCache.current[presetId] = view
    return { schemas, view }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!config.registry) {
        setError(t('create.registryMissing'))
        return
      }
      const core = await getFourCoreReadOnly(config)
      const [wn, signerAddr] = await Promise.all([core.wrappedNative(), core.signer()])
      if (cancelled) return
      setWrappedNative(wn)
      setCoreSigner(signerAddr)

      let baseSchema = []
      try {
        baseSchema = await getTokenBaseSchema(config)
        baseSchemaRef.current = baseSchema
      } catch {
        baseSchema = []
      }

      const presetIds = await getPresetIds(config)
      const builtTabs = []
      const initialForms = {}
      for (const id of presetIds) {
        const { schemas, view } = await loadSchemas(id)
        if (!view.active || !view.createEnabled) continue
        const combined = schemas ? buildCombinedParams(baseSchema, schemas) : baseSchema
        const defaults = defaultFormDataFromSchema(combined)
        if (defaults.saleAmount && defaults.maxSupply && defaults.saleAmount === defaults.maxSupply) {
          const maxVal = parseFloat(defaults.maxSupply)
          if (!Number.isNaN(maxVal)) defaults.saleAmount = String(Math.floor(maxVal * 0.8))
        }
        if (Number(defaults.maxSupply) > Number(DEFAULT_MAX_SUPPLY_TOKENS)) {
          defaults.maxSupply = DEFAULT_MAX_SUPPLY_TOKENS
          defaults.saleAmount = DEFAULT_SALE_AMOUNT_TOKENS
        }
        initialForms[id] = { ...defaults, ...OUTER_FORM_DEFAULTS, quoteAsset: wn }
        builtTabs.push({ id, label: view.name || id, description: view.description ?? '' })
      }
      if (cancelled) return
      setTabs(builtTabs)
      setForms(initialForms)
      if (builtTabs.length > 0) {
        const firstId = builtTabs[0].id
        setActivePresetId(firstId)
        const first = schemaCache.current[firstId]
        if (first) setActiveParams(buildCombinedParams(baseSchema, first))
      }
    })().catch((err) => {
      if (!cancelled) setError(err.message || String(err))
    })
    return () => { cancelled = true }
  }, [config])

  useEffect(() => {
    if (!activePresetId) return
    const schemas = schemaCache.current[activePresetId]
    if (schemas) setActiveParams(buildCombinedParams(baseSchemaRef.current, schemas))
  }, [activePresetId])

  const formData = forms[activePresetId] ?? {}
  function setFormForActive(next) {
    setForms((p) => ({ ...p, [activePresetId]: next }))
  }

  async function onSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setTxHash(null)
    setDebug(null)
    try {
      const form = forms[activePresetId]
      const maxSupplyWei = toUnitsOrNull(form.maxSupply, 18)
      const saleAmountWei = toUnitsOrNull(form.saleAmount, 18)
      if (!maxSupplyWei || !saleAmountWei) throw new Error(t('create.checkSupply'))
      if (saleAmountWei >= maxSupplyWei) throw new Error(t('create.saleLtMax'))
      const name = String(form.name ?? '').trim()
      const symbol = String(form.symbol ?? '').trim()
      const quoteAsset = String(form.quoteAsset ?? '').trim()
      if (!name || !symbol || !quoteAsset) throw new Error(t('create.needFields'))

      const core = await getFourCoreWithSigner(config)
      const quote = new Contract(quoteAsset, QUOTE_DECIMALS_ABI, core.runner)
      const quoteDecimals = Number(await quote.decimals())
      const { schemas } = await loadSchemas(activePresetId)
      const tokenParams = encodeModuleParams(schemas.token, form)
      const curveParams = encodeModuleParams(schemas.curve, form)
      const tradeParams = encodeModuleParams(schemas.trade, form)
      const migrateParams = encodeModuleParams(schemas.migrate, form)
      const raiseAmount = toUnitsOrNull(form.raiseAmount, quoteDecimals) ?? 0n
      const presaleQuote = toUnitsOrNull(form.presaleQuote, quoteDecimals) ?? 0n
      const createFee = toUnitsOrNull(form.createFee, 18) ?? 0n
      const antiSniperEnabled = form.antiSniperEnabled === true || String(form.antiSniperEnabled) === 'true'
      const tokenUri = String(form.tokenUri ?? '').trim()
      const nowSec = BigInt(Math.floor(Date.now() / 1000))
      const requestId = BigInt(Date.now())
      const validUntil = nowSec + 3600n
      const presetIdBn = BigInt(String(activePresetId))
      const createArgs = AbiCoder.defaultAbiCoder().encode(
        ['tuple(uint256 requestId,uint256 presetId,uint256 validTimestamp,uint256 createFee,uint256 presaleQuote,bool antiSniperEnabled,address partner,tuple(string name,string symbol,string tokenUri,uint256 maxSupply,uint256 saleAmount,uint256 raiseAmount,address quoteAsset,bytes32 tokenSalt,bytes tokenParams,bytes vaultParams,bytes curveParams,bytes tradeParams,bytes migrateParams,bytes customDataParams) initParams)'],
        [[requestId, presetIdBn, validUntil, createFee, presaleQuote, antiSniperEnabled, '0x0000000000000000000000000000000000000000', [name, symbol, tokenUri, maxSupplyWei, saleAmountWei, raiseAmount, quoteAsset, ZeroHash, tokenParams, '0x', curveParams, tradeParams, migrateParams, '0x']]],
      )

      const { provider, signer } = await getSignerProvider(config)
      const caller = await signer.getAddress()
      const chainId = (await provider.getNetwork()).chainId
      const payload = solidityPacked(
        ['string', 'uint256', 'address', 'bytes32'],
        ['createOpenFourToken', chainId, caller, keccak256(createArgs)],
      )
      const digest = keccak256(payload)
      const signature = await signer.signMessage(getBytes(digest))
      const txValue = computeCreateTokenTxValue({ createFee, presaleQuote, quoteAsset, wrappedNative })
      const snapshot = {
        requestId: requestId.toString(),
        presetId: activePresetId,
        caller,
        chainId: chainId.toString(),
        coreSigner,
        digest,
        txValue: txValue.toString(),
        tokenParams,
        curveParams,
        tradeParams,
        migrateParams,
      }
      setDebug(snapshot)

      try {
        await core.createToken.staticCall(createArgs, signature, { value: txValue })
      } catch (preErr) {
        throw new Error(t('create.precheck', { reason: formatRevert(preErr, core.interface) }))
      }

      const tx = await core.createToken(createArgs, signature, { value: txValue })
      setTxHash(tx.hash)
      const rec = await tx.wait()
      if (!rec || rec.status !== 1) throw new Error(t('create.txFailed'))
      let tokenAddr = ''
      const fromReceipt = rec.logs?.find((log) =>
        String(log.address).toLowerCase() === String(core.target).toLowerCase()
        && Array.isArray(log.topics)
        && log.topics[0] === TOPIC_TOKEN_CREATED,
      )
      if (fromReceipt) {
        tokenAddr = String(ifaceTokenCreated.parseLog(fromReceipt)?.args?.token ?? '')
      }
      if (!tokenAddr) throw new Error(t('create.noTokenAddr'))
      await recordToken({
        tokenAddress: tokenAddr,
        name,
        symbol,
        presetId: String(activePresetId),
        presetName: tabs.find((tab) => tab.id === activePresetId)?.label || '',
        creator: caller,
        txHash: rec.hash || tx.hash,
        chainId: Number(chainId),
        quoteAsset,
        createdAt: new Date().toISOString(),
      })
      navigate(`/token/${tokenAddr}`)
    } catch (err) {
      console.error(err)
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  if (!config.registry) {
    return (
      <div className="page">
        <p className="kicker">{t('create.kicker')}</p>
        <Link className="back-link" to="/">{t('common.backFlow')}</Link>
        <h2>{t('create.title')}</h2>
        <p className="error">{t('create.noRegistry')} <Link to="/fork">{t('create.noRegistryLink')}</Link>{t('create.noRegistryAfter')}</p>
      </div>
    )
  }

  return (
    <div className="page">
      <p className="kicker">{t('create.kicker')}</p>
      <Link className="back-link" to="/">{t('common.backFlow')}</Link>
      <h2>{t('create.title')}</h2>
      <p className="hint">{t('create.hint')}</p>
      {coreSigner && (
        <p className="unit-hint">
          Core.signer: <span className="mono">{coreSigner}</span>
          {address && address.toLowerCase() !== coreSigner.toLowerCase() && (
            <span className="error">{t('create.notSigner')}</span>
          )}
        </p>
      )}

      {tabs.length > 0 && (
        <div className="form-group">
          <label className="label-row">Preset</label>
          <div className="play-type-tabs">
            {tabs.map((tab) => (
              <button key={tab.id} type="button" className={activePresetId === tab.id ? 'active' : ''} onClick={() => setActivePresetId(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>
          {tabs.find((t) => t.id === activePresetId)?.description && (
            <p className="preset-description">{tabs.find((t) => t.id === activePresetId).description}</p>
          )}
        </div>
      )}

      <form onSubmit={onSubmit} className="form">
        {activeParams.length > 0 ? (
          <SchemaDrivenForm params={activeParams} formData={formData} onChange={setFormForActive} />
        ) : (
          <p className="hint">{t('create.loadingSchema')}</p>
        )}
        <fieldset className="create-outer-fields">
          <legend>{t('create.feeLegend')}</legend>
          <label className="schema-field">
            {t('create.createFee')}
            <input value={formData.createFee ?? '0'} onChange={(e) => setFormForActive({ ...formData, createFee: e.target.value })} />
          </label>
          <label className="schema-field">
            presaleQuote
            <input value={formData.presaleQuote ?? '0'} onChange={(e) => setFormForActive({ ...formData, presaleQuote: e.target.value })} />
          </label>
        </fieldset>
        {wrappedNative && <p className="unit-hint">wrappedNative: <span className="mono">{wrappedNative}</span></p>}
        <button type="submit" disabled={loading || activeParams.length === 0}>{loading ? t('create.creating') : t('create.createBtn')}</button>
      </form>
      {txHash && <p className="success">{t('create.txSent')} <code>{txHash}</code></p>}
      {error && <p className="error">{error}</p>}
      <DebugPanel title={t('create.debugTitle')} data={debug} />
      <p><Link to="/tokens" className="flow-link">{t('create.next')}</Link></p>
    </div>
  )
}
