import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PROTECTED_CHAIN_IDS } from '../eth/config'
import { useDeployment } from '../eth/deployment'
import { formatStatus, useT } from '../i18n'

export function ForkPage() {
  const { config, save, loadFromFork, persistFork, forkStatus, resolved, fork } = useDeployment()
  const t = useT()
  const [rpcUrl, setRpcUrl] = useState(config.rpcUrl)
  const [chainId, setChainId] = useState(String(config.chainId))
  const [registry, setRegistry] = useState(config.registry || fork?.addresses?.registry || '')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setRpcUrl(config.rpcUrl)
    setChainId(String(config.chainId))
    setRegistry(config.registry || fork?.addresses?.registry || '')
  }, [config, fork])

  async function onSave(e) {
    e.preventDefault()
    setError('')
    try {
      const next = save({ rpcUrl, chainId: Number(chainId), registry })
      await persistFork({
        ...(fork || {}),
        rpcUrl: next.rpcUrl,
        chainId: next.chainId,
        addresses: { ...(fork?.addresses || {}), registry: next.registry },
      })
      setMessage(t('common.saved'))
    } catch (err) {
      setError(err.message || String(err))
    }
  }

  async function onImport() {
    setError('')
    setMessage('')
    try {
      const next = await loadFromFork()
      setRpcUrl(next.rpcUrl)
      setChainId(String(next.chainId))
      setRegistry(next.registry)
      setMessage(t('fork.imported', { registry: next.registry }))
    } catch (err) {
      setError(err.message || String(err))
    }
  }

  const addresses = fork?.addresses || {}

  return (
    <div className="page">
      <p className="kicker">{t('fork.kicker')}</p>
      <Link className="back-link" to="/">{t('common.backFlow')}</Link>
      <h2>{t('fork.title')}</h2>
      <p className="lede">{t('fork.lede')}</p>
      {PROTECTED_CHAIN_IDS.has(Number(chainId)) && (
        <p className="error">{t('fork.mainnet')}</p>
      )}

      <ol className="how-list">
        <li>
          <span>1</span>
          <div>
            <b>{t('fork.run')}</b>
            <p>{t('fork.runHint')}</p>
            <pre className="mono">{`cd developer/fork-deploy
npm install
cp .env.example .env
npm run fork:dry
npm run fork`}</pre>
          </div>
        </li>
        <li>
          <span>2</span>
          <div>
            <b>{t('fork.importTitle')}</b>
            <p>{t('fork.importHint')}</p>
            <div className="trade-buttons">
              <button type="button" onClick={onImport}>{t('fork.importBtn')}</button>
            </div>
          </div>
        </li>
        <li>
          <span>3</span>
          <div>
            <b>{t('fork.confirm')}</b>
            <p>{t('fork.confirmHint')}</p>
            <form className="form" onSubmit={onSave}>
              <label className="schema-field">
                RPC
                <input value={rpcUrl} onChange={(e) => setRpcUrl(e.target.value)} />
              </label>
              <label className="schema-field">
                Chain ID
                <input value={chainId} onChange={(e) => setChainId(e.target.value)} />
              </label>
              <label className="schema-field">
                Registry
                <input className="mono" value={registry} onChange={(e) => setRegistry(e.target.value)} />
              </label>
              <button type="submit">{t('common.save')}</button>
            </form>
            {fork && (
              <div className="workspace-strip">
                <p className="unit-hint">Registry: <span className="mono">{addresses.registry || registry}</span></p>
                <p className="unit-hint">Core: <span className="mono">{addresses.core || resolved?.core || '—'}</span></p>
                <p className="unit-hint">Tools: <span className="mono">{addresses.tools || resolved?.tools || '—'}</span></p>
                <p className="unit-hint">signer: <span className="mono">{resolved?.signer || '—'}</span></p>
              </div>
            )}
          </div>
        </li>
      </ol>

      {forkStatus && <p className="unit-hint">{formatStatus(t, forkStatus)}</p>}
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}

      <p><Link to="/modules" className="flow-link">{t('fork.next')}</Link></p>
    </div>
  )
}
