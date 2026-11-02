import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ZeroAddress, ZeroHash, getAddress, isAddress } from 'ethers'
import { useDeployment } from '../eth/deployment'
import { useWallet } from '../hooks/useWallet'
import {
  MODULE_KINDS,
  STANDARD_MODULE_SOURCES,
  getRegistryOwner,
  kindLabel,
  listRegisteredModules,
  listRegisteredPresets,
  listRegisteredTokenImpls,
  moduleKeyFromSource,
  upsertModule,
  upsertPreset,
} from '../eth/moduleRegistry'
import { useT } from '../i18n'

function emptyModuleForm(author) {
  return {
    keySource: 'module.curve.my_play',
    moduleKey: '',
    implementation: '',
    kind: 2,
    name: '',
    version: '1.0.0',
    description: '',
    feeShareBps: '0',
    author,
    active: true,
  }
}

function emptyPresetForm(author) {
  return {
    id: String(Date.now()),
    name: '',
    description: '',
    version: '1.0.0',
    active: true,
    createEnabled: true,
    validator: ZeroAddress,
    tokenModuleId: ZeroHash,
    vaultModuleId: ZeroHash,
    curveModuleId: ZeroHash,
    tradeModuleId: ZeroHash,
    migrateModuleId: ZeroHash,
    tokenImplId: ZeroHash,
    customDataId: ZeroHash,
    author,
  }
}

function keepSlot(current, fallback) {
  return current && current !== ZeroHash ? current : (fallback || current)
}

function Field({ label, children }) {
  return (
    <label className="schema-field">
      {label}
      {children}
    </label>
  )
}

export function RegisterPage() {
  const { fork, config, persistFork } = useDeployment()
  const { address, connect } = useWallet()
  const t = useT()
  const registry = fork?.addresses?.registry || config.registry
  const [owner, setOwner] = useState('')
  const [ownerLoading, setOwnerLoading] = useState(false)
  const [chainModules, setChainModules] = useState([])
  const [chainPresets, setChainPresets] = useState([])
  const [chainTokenImpls, setChainTokenImpls] = useState([])
  const [listLoading, setListLoading] = useState(false)
  const [listErr, setListErr] = useState('')
  const [listTick, setListTick] = useState(0)
  const [moduleForm, setModuleForm] = useState(() => emptyModuleForm(''))
  const [presetForm, setPresetForm] = useState(() => emptyPresetForm(''))
  const [moduleBusy, setModuleBusy] = useState(false)
  const [presetBusy, setPresetBusy] = useState(false)
  const [moduleMsg, setModuleMsg] = useState('')
  const [presetMsg, setPresetMsg] = useState('')
  const [moduleErr, setModuleErr] = useState('')
  const [presetErr, setPresetErr] = useState('')

  const moduleKey = useMemo(() => {
    if (moduleForm.keySource.trim()) return moduleKeyFromSource(moduleForm.keySource)
    return moduleForm.moduleKey || ZeroHash
  }, [moduleForm.keySource, moduleForm.moduleKey])
  const isOwner = owner && address && owner.toLowerCase() === address.toLowerCase()
  const standardIds = fork?.moduleIds || {}
  const customModules = fork?.developerModules || []
  const customPresets = fork?.developerPresets || []

  useEffect(() => {
    if (address) {
      setModuleForm((prev) => ({ ...prev, author: prev.author || address }))
      setPresetForm((prev) => ({ ...prev, author: prev.author || address }))
    }
  }, [address])

  useEffect(() => {
    const ids = fork?.moduleIds || {}
    setPresetForm((prev) => ({
      ...prev,
      tokenModuleId: keepSlot(prev.tokenModuleId, ids.TOKEN_STANDARD),
      vaultModuleId: keepSlot(prev.vaultModuleId, ids.VAULT_BASIC),
      curveModuleId: keepSlot(prev.curveModuleId, ids.CURVE_BONDING),
      tradeModuleId: keepSlot(prev.tradeModuleId, ids.TRADE_SIMPLE),
      migrateModuleId: keepSlot(prev.migrateModuleId, ids.MIGRATE_BONDING),
    }))
  }, [fork])

  useEffect(() => {
    if (!registry) return
    const cfg = { ...config, registry }
    let cancelled = false
    setOwnerLoading(true)
    setListLoading(true)
    setListErr('')
    ;(async () => {
      const [ownerAddr, presets] = await Promise.all([
        getRegistryOwner(cfg),
        listRegisteredPresets(cfg).catch(() => []),
      ])
      if (cancelled) return
      setOwner(ownerAddr)
      setChainPresets(presets)
      const [modules, tokenImpls] = await Promise.all([
        listRegisteredModules(cfg, {
          moduleIds: fork?.moduleIds,
          beacons: fork?.beacons,
          developerModules: fork?.developerModules,
          presets,
        }),
        listRegisteredTokenImpls(cfg, {
          tokenImplIds: fork?.tokenImplIds,
          presets,
        }),
      ])
      if (cancelled) return
      setChainModules(modules)
      setChainTokenImpls(tokenImpls)
    })().catch((err) => {
      if (cancelled) return
      setOwner('')
      setListErr(err.message || String(err))
    }).finally(() => {
      if (cancelled) return
      setOwnerLoading(false)
      setListLoading(false)
    })
    return () => { cancelled = true }
  }, [config, fork?.developerModules, fork?.moduleIds, listTick, registry])

  function setModule(patch) {
    setModuleForm((prev) => ({ ...prev, ...patch }))
  }

  function setPreset(patch) {
    setPresetForm((prev) => ({ ...prev, ...patch }))
  }

  function loadModule(row) {
    setModuleErr('')
    setModuleMsg('')
    setModuleForm({
      keySource: row.keySource || '',
      moduleKey: row.moduleKey,
      implementation: row.implementation,
      kind: Number(row.kind),
      name: row.name || '',
      version: row.version || '1.0.0',
      description: row.description || '',
      feeShareBps: String(row.feeShareBps || 0),
      author: row.author || address || '',
      active: row.active,
    })
    document.getElementById('register-module-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function loadPreset(row) {
    setPresetErr('')
    setPresetMsg('')
    setPresetForm({
      id: String(row.id),
      name: row.name || '',
      description: row.description || '',
      version: row.version || '1.0.0',
      active: row.active,
      createEnabled: row.createEnabled,
      validator: row.validator || ZeroAddress,
      tokenModuleId: row.tokenModuleId || ZeroHash,
      vaultModuleId: row.vaultModuleId || ZeroHash,
      curveModuleId: row.curveModuleId || ZeroHash,
      tradeModuleId: row.tradeModuleId || ZeroHash,
      migrateModuleId: row.migrateModuleId || ZeroHash,
      tokenImplId: row.tokenImplId || ZeroHash,
      customDataId: row.customDataId || ZeroHash,
      author: row.author || address || '',
    })
    document.getElementById('register-preset-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function onRegisterModule(e) {
    e.preventDefault()
    setModuleErr('')
    setModuleMsg('')
    setModuleBusy(true)
    try {
      if (!moduleKey || moduleKey === ZeroHash) throw new Error(t('register.needKey'))
      if (!isAddress(moduleForm.implementation)) throw new Error(t('register.needImpl'))
      const author = moduleForm.author || address
      const txHash = await upsertModule({ ...config, registry }, {
        moduleKey,
        implementation: getAddress(moduleForm.implementation),
        kind: Number(moduleForm.kind),
        version: moduleForm.version.trim() || '1.0.0',
        name: moduleForm.name.trim() || moduleForm.keySource.trim(),
        description: moduleForm.description.trim(),
        author,
        feeShareBps: moduleForm.feeShareBps,
        active: moduleForm.active,
      })
      if (fork && persistFork) {
        await persistFork({
          ...fork,
          developerModules: [
            {
              keySource: moduleForm.keySource.trim(),
              moduleKey,
              implementation: getAddress(moduleForm.implementation),
              kind: Number(moduleForm.kind),
              name: moduleForm.name.trim() || moduleForm.keySource.trim(),
              txHash,
            },
            ...customModules.filter((row) => row.moduleKey !== moduleKey),
          ],
        })
      }
      setModuleMsg(t('register.moduleSaved', { hash: txHash }))
      setListTick((n) => n + 1)
    } catch (err) {
      setModuleErr(err.message || String(err))
    } finally {
      setModuleBusy(false)
    }
  }

  async function onRegisterPreset(e) {
    e.preventDefault()
    setPresetErr('')
    setPresetMsg('')
    setPresetBusy(true)
    try {
      const author = presetForm.author || address
      const payload = {
        ...presetForm,
        id: String(presetForm.id).trim(),
        name: presetForm.name.trim(),
        description: presetForm.description.trim(),
        version: presetForm.version.trim() || '1.0.0',
        author,
        validator: presetForm.validator.trim() || ZeroAddress,
        customDataId: presetForm.customDataId.trim() || ZeroHash,
      }
      if (!payload.name) throw new Error(t('register.needPresetName'))
      const txHash = await upsertPreset({ ...config, registry }, payload)
      if (fork && persistFork) {
        await persistFork({
          ...fork,
          developerPresets: [
            { id: payload.id, name: payload.name, txHash },
            ...customPresets.filter((row) => String(row.id) !== payload.id),
          ],
        })
      }
      setPresetMsg(t('register.presetSaved', { hash: txHash }))
      setListTick((n) => n + 1)
    } catch (err) {
      setPresetErr(err.message || String(err))
    } finally {
      setPresetBusy(false)
    }
  }

  if (!registry) {
    return (
      <div className="page">
        <p className="kicker">{t('register.kicker')}</p>
        <Link className="back-link" to="/">{t('common.backFlow')}</Link>
        <h2>{t('register.title')}</h2>
        <p className="error">{t('register.noRegistry')} <Link to="/fork">{t('register.noRegistryLink')}</Link> {t('register.noRegistryAfter')}</p>
      </div>
    )
  }

  return (
    <div className="page">
      <p className="kicker">{t('register.kicker')}</p>
      <Link className="back-link" to="/">{t('common.backFlow')}</Link>
      <h2>{t('register.title')}</h2>
      <p className="lede">
        {t('register.ledeBefore')}{' '}
        <Link to="/submit">{t('register.officialAudit')}</Link>
        {t('register.ledeAfter')}
      </p>

      <ol className="how-list">
        <li>
          <span>1</span>
          <div>
            <b>{t('register.how1')}</b>
            <p>{t('register.how1Body')}</p>
          </div>
        </li>
        <li>
          <span>2</span>
          <div>
            <b>{t('register.how2')}</b>
            <p>{t('register.how2Body')}</p>
          </div>
        </li>
        <li>
          <span>3</span>
          <div>
            <b>{t('register.how3')}</b>
            <p>{t('register.how3Body')}</p>
          </div>
        </li>
      </ol>

      <section className="trade-section">
        <h3>{t('register.currentFork')}</h3>
        <p className="unit-hint">Registry: <span className="mono">{registry}</span></p>
        <p className="unit-hint">{t('register.owner')} <span className="mono">{owner || (ownerLoading ? t('common.loading') : t('register.couldNotRead'))}</span></p>
        {address ? (
          <p className="unit-hint">
            {t('register.currentWallet')} <span className="mono">{address}</span>
            {owner && !isOwner && <span className="error">{t('register.notOwner')}</span>}
          </p>
        ) : (
          <p className="unit-hint">
            <button type="button" className="text-btn" onClick={connect}>{t('common.connectWallet')}</button>
            {' '}{t('register.connectFirst')}
          </p>
        )}
      </section>

      <section className="trade-section">
        <div className="section-head">
          <h3>{t('register.onChainModules')}</h3>
          <button type="button" className="text-btn" onClick={() => setListTick((n) => n + 1)} disabled={listLoading}>
            {listLoading ? t('common.reading') : t('common.refresh')}
          </button>
        </div>
        <p className="unit-hint">{t('register.modulesHint')}</p>
        {listErr && <p className="error">{listErr}</p>}
        {chainModules.length === 0 && !listLoading && (
          <p className="unit-hint">
            {t('register.noModules')}
            {STANDARD_MODULE_SOURCES.some(([key]) => standardIds[key])
              ? t('register.waitRpc')
              : t('register.importForkKeys')}
          </p>
        )}
        {chainModules.length > 0 && (
          <ul className="token-list registry-list">
            {chainModules.map((row) => (
              <li key={row.moduleKey} className="token-item">
                <div className="token-item-main">
                  <div className="token-item-title">
                    <span className="name">{row.name || row.keySource || t('common.module')}</span>
                    <span className="preset-badge">{kindLabel(row.kind)}</span>
                    {row.active ? <span className="preset-badge">{t('common.active')}</span> : <span className="preset-badge">{t('common.inactive')}</span>}
                    {row.version && <span className="preset-badge">v{row.version}</span>}
                  </div>
                  {row.keySource && <p className="unit-hint"><code>{row.keySource}</code></p>}
                  <p className="unit-hint mono">{row.moduleKey}</p>
                  <p className="unit-hint">beacon: <span className="mono">{row.beacon}</span></p>
                  <p className="unit-hint">impl: <span className="mono">{row.implementation}</span></p>
                </div>
                <button type="button" className="text-btn" onClick={() => loadModule(row)}>{t('register.loadUpgrade')}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="trade-section">
        <h3>{t('register.onChainPresets')}</h3>
        {chainPresets.length === 0 && !listLoading && (
          <p className="unit-hint">{t('register.noPresets')}</p>
        )}
        {chainPresets.length > 0 && (
          <ul className="token-list registry-list">
            {chainPresets.map((row) => (
              <li key={row.id} className="token-item">
                <div className="token-item-main">
                  <div className="token-item-title">
                    <span className="name">{row.name || `Preset ${row.id}`}</span>
                    <span className="preset-badge">id {row.id}</span>
                    {row.active ? <span className="preset-badge">{t('common.active')}</span> : <span className="preset-badge">{t('common.inactive')}</span>}
                    {row.createEnabled ? <span className="preset-badge">{t('common.create')}</span> : <span className="preset-badge">{t('common.noCreate')}</span>}
                    {row.version && <span className="preset-badge">v{row.version}</span>}
                  </div>
                  {row.description && <p className="unit-hint">{row.description}</p>}
                </div>
                <button type="button" className="text-btn" onClick={() => loadPreset(row)}>{t('register.loadUpgrade')}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="trade-section">
        <h3>{t('register.onChainTokenImpls')}</h3>
        {chainTokenImpls.length === 0 && !listLoading && (
          <p className="unit-hint">{t('register.noTokenImpls')}</p>
        )}
        {chainTokenImpls.length > 0 && (
          <ul className="token-list registry-list">
            {chainTokenImpls.map((row) => (
              <li key={row.tokenImplId} className="token-item">
                <div className="token-item-main">
                  <div className="token-item-title">
                    <span className="name">{row.label || t('register.tokenImpl')}</span>
                    {row.version && <span className="preset-badge">v{row.version}</span>}
                  </div>
                  <p className="unit-hint mono">{row.tokenImplId}</p>
                  <p className="unit-hint">impl: <span className="mono">{row.implementation}</span></p>
                </div>
                <button type="button" className="text-btn" onClick={() => setPreset({ tokenImplId: row.tokenImplId })}>
                  {t('register.useInPreset')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form id="register-module-form" className="form" onSubmit={onRegisterModule}>
        <h3>{t('register.formModule')}</h3>
        <Field label={t('register.keySource')}>
          <input
            className="mono"
            value={moduleForm.keySource}
            onChange={(e) => setModule({ keySource: e.target.value, moduleKey: '' })}
            placeholder="module.curve.my_play"
            required={!moduleForm.moduleKey}
          />
        </Field>
        <p className="unit-hint">
          moduleKey: <span className="mono">{moduleKey}</span>
          {!moduleForm.keySource.trim() && moduleForm.moduleKey && t('register.loadedKey')}
        </p>
        <Field label={t('register.implAddr')}>
          <input
            className="mono"
            value={moduleForm.implementation}
            onChange={(e) => setModule({ implementation: e.target.value })}
            placeholder="0x…"
            required
          />
        </Field>
        <Field label={t('register.slotKind')}>
          <select value={moduleForm.kind} onChange={(e) => setModule({ kind: Number(e.target.value) })}>
            {MODULE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.value} · {k.label}</option>
            ))}
          </select>
        </Field>
        <Field label={t('common.name')}>
          <input value={moduleForm.name} onChange={(e) => setModule({ name: e.target.value })} placeholder="MyCurveModule" />
        </Field>
        <Field label={t('common.version')}>
          <input value={moduleForm.version} onChange={(e) => setModule({ version: e.target.value })} />
        </Field>
        <Field label={t('common.description')}>
          <input value={moduleForm.description} onChange={(e) => setModule({ description: e.target.value })} />
        </Field>
        <label className="checkbox-row schema-field">
          <input type="checkbox" checked={moduleForm.active} onChange={(e) => setModule({ active: e.target.checked })} />
          active
        </label>
        <button type="submit" disabled={moduleBusy || !isOwner}>{moduleBusy ? t('register.saving') : t('register.saveModule')}</button>
        {moduleMsg && <p className="success">{moduleMsg}</p>}
        {moduleErr && <p className="error">{moduleErr}</p>}
      </form>

      <form id="register-preset-form" className="form" onSubmit={onRegisterPreset}>
        <h3>{t('register.formPreset')}</h3>
        <p className="unit-hint">{t('register.presetHint')}</p>
        <Field label={t('register.presetId')}>
          <input className="mono" value={presetForm.id} onChange={(e) => setPreset({ id: e.target.value })} required />
        </Field>
        <Field label={t('common.name')}>
          <input value={presetForm.name} onChange={(e) => setPreset({ name: e.target.value })} placeholder="MyPlay" required />
        </Field>
        <Field label={t('common.description')}>
          <input value={presetForm.description} onChange={(e) => setPreset({ description: e.target.value })} />
        </Field>
        <Field label="Token moduleId">
          <input className="mono" value={presetForm.tokenModuleId} onChange={(e) => setPreset({ tokenModuleId: e.target.value })} />
          <button type="button" className="text-btn" onClick={() => setPreset({ tokenModuleId: moduleKey })}>{t('register.useThisKey')}</button>
        </Field>
        <Field label="Vault moduleId">
          <input className="mono" value={presetForm.vaultModuleId} onChange={(e) => setPreset({ vaultModuleId: e.target.value })} />
          <button type="button" className="text-btn" onClick={() => setPreset({ vaultModuleId: moduleKey })}>{t('register.useThisKey')}</button>
        </Field>
        <Field label="Curve moduleId">
          <input className="mono" value={presetForm.curveModuleId} onChange={(e) => setPreset({ curveModuleId: e.target.value })} />
          <button type="button" className="text-btn" onClick={() => setPreset({ curveModuleId: moduleKey })}>{t('register.useThisKey')}</button>
        </Field>
        <Field label="Trade moduleId">
          <input className="mono" value={presetForm.tradeModuleId} onChange={(e) => setPreset({ tradeModuleId: e.target.value })} />
          <button type="button" className="text-btn" onClick={() => setPreset({ tradeModuleId: moduleKey })}>{t('register.useThisKey')}</button>
        </Field>
        <Field label="Migrate moduleId">
          <input className="mono" value={presetForm.migrateModuleId} onChange={(e) => setPreset({ migrateModuleId: e.target.value })} />
          <button type="button" className="text-btn" onClick={() => setPreset({ migrateModuleId: moduleKey })}>{t('register.useThisKey')}</button>
        </Field>
        <Field label="tokenImplId">
          <input className="mono" value={presetForm.tokenImplId} onChange={(e) => setPreset({ tokenImplId: e.target.value })} />
        </Field>
        <Field label="validator">
          <input className="mono" value={presetForm.validator} onChange={(e) => setPreset({ validator: e.target.value })} />
        </Field>
        <Field label={t('register.customDataOptional')}>
          <input className="mono" value={presetForm.customDataId} onChange={(e) => setPreset({ customDataId: e.target.value })} />
        </Field>
        <label className="checkbox-row schema-field">
          <input type="checkbox" checked={presetForm.active} onChange={(e) => setPreset({ active: e.target.checked })} />
          active
        </label>
        <label className="checkbox-row schema-field">
          <input type="checkbox" checked={presetForm.createEnabled} onChange={(e) => setPreset({ createEnabled: e.target.checked })} />
          createEnabled
        </label>
        <button type="submit" disabled={presetBusy || !isOwner}>{presetBusy ? t('register.saving') : t('register.savePreset')}</button>
        {presetMsg && <p className="success">{presetMsg}</p>}
        {presetErr && <p className="error">{presetErr}</p>}
      </form>

      <p><Link to="/create" className="flow-link">{t('register.next')}</Link></p>
    </div>
  )
}
