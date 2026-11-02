import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useDeployment } from '../eth/deployment'
import { useT } from '../i18n'

export function TokensPage() {
  const { tokens, fork, recordToken } = useDeployment()
  const t = useT()
  const [manual, setManual] = useState({ tokenAddress: '', name: '', symbol: '', presetName: '' })
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function onRegister(e) {
    e.preventDefault()
    setError('')
    setMessage('')
    try {
      const tokenAddress = manual.tokenAddress.trim()
      if (!tokenAddress) throw new Error(t('tokens.needAddress'))
      await recordToken({
        ...manual,
        tokenAddress,
        createdAt: new Date().toISOString(),
      })
      setManual({ tokenAddress: '', name: '', symbol: '', presetName: '' })
      setMessage(t('tokens.wrote'))
    } catch (err) {
      setError(err.message || String(err))
    }
  }

  return (
    <div className="page">
      <p className="kicker">{t('tokens.kicker')}</p>
      <Link className="back-link" to="/">{t('common.backFlow')}</Link>
      <h2>{t('tokens.title')}</h2>
      <p className="hint">{t('tokens.hint')}</p>
      {tokens.length === 0 && (
        <p>{t('tokens.empty')} <Link to="/create">{t('tokens.emptyLink')}</Link>.</p>
      )}
      {tokens.length > 0 && (
        <ul className="token-list">
          {tokens.map((row) => (
            <li key={row.tokenAddress} className="token-item">
              <div className="token-item-main">
                <div className="token-item-title">
                  <Link to={`/token/${row.tokenAddress}`}>
                    <span className="name">{row.name || t('common.unnamedToken')}</span>
                    <span className="symbol">({row.symbol || '-'})</span>
                  </Link>
                  <span className="preset-badge">{row.presetName || row.presetId}</span>
                </div>
                <p className="unit-hint mono">{row.tokenAddress}</p>
              </div>
              <span className="creator">{row.createdAt ? row.createdAt.slice(0, 10) : ''}</span>
            </li>
          ))}
        </ul>
      )}
      {fork?.addresses?.core && (
        <p className="unit-hint">{t('tokens.currentCore')} <span className="mono">{fork.addresses.core}</span></p>
      )}

      <form className="form" onSubmit={onRegister}>
        <h3>{t('tokens.registerExisting')}</h3>
        <p className="unit-hint">{t('tokens.registerHint')}</p>
        <label className="schema-field">
          {t('common.address')}
          <input className="mono" value={manual.tokenAddress} onChange={(e) => setManual({ ...manual, tokenAddress: e.target.value })} />
        </label>
        <label className="schema-field">
          {t('common.name')}
          <input value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} />
        </label>
        <label className="schema-field">
          Symbol
          <input value={manual.symbol} onChange={(e) => setManual({ ...manual, symbol: e.target.value })} />
        </label>
        <button type="submit">{t('tokens.write')}</button>
      </form>
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
      <p><Link to="/submit" className="flow-link">{t('tokens.next')}</Link></p>
    </div>
  )
}
