import { useState } from 'react'
import { PROTECTED_CHAIN_IDS } from '../eth/config'
import { useDeployment } from '../eth/deployment'

export function SettingsPage() {
  const { config, save, loadFromFork, forkStatus, resolved } = useDeployment()
  const [rpcUrl, setRpcUrl] = useState(config.rpcUrl)
  const [chainId, setChainId] = useState(String(config.chainId))
  const [registry, setRegistry] = useState(config.registry)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function onSave(e) {
    e.preventDefault()
    setError('')
    try {
      save({ rpcUrl, chainId: Number(chainId), registry })
      setMessage('Saved on this machine. The page will resolve Core / Tools from the new Registry.')
    } catch (err) {
      setError(err.message || String(err))
    }
  }

  async function onLoadFork() {
    setError('')
    setMessage('')
    try {
      const next = await loadFromFork()
      setRpcUrl(next.rpcUrl)
      setChainId(String(next.chainId))
      setRegistry(next.registry)
      setMessage(`Read fork-deploy output: Registry ${next.registry}`)
    } catch (err) {
      setError(err.message || String(err))
    }
  }

  return (
    <div className="page">
      <h2>Deployment settings</h2>
      <p className="hint">
        This is a developer sandbox, not the official frontend. Prefer the testnet proxies you forked.
        Create signatures are signed locally by the current wallet. That wallet must be Core.signer.
      </p>
      {PROTECTED_CHAIN_IDS.has(Number(chainId)) && (
        <p className="error">The current chainId is a mainnet. Use this page on a testnet or a local fork only.</p>
      )}

      <form className="form" onSubmit={onSave}>
        <label className="schema-field">
          RPC
          <input value={rpcUrl} onChange={(e) => setRpcUrl(e.target.value)} placeholder="https://bsc-testnet.publicnode.com" />
        </label>
        <label className="schema-field">
          Chain ID
          <input value={chainId} onChange={(e) => setChainId(e.target.value)} placeholder="97" />
        </label>
        <label className="schema-field">
          Registry
          <input className="mono" value={registry} onChange={(e) => setRegistry(e.target.value)} placeholder="0x…" />
        </label>
        <div className="trade-buttons">
          <button type="submit">Save</button>
          <button type="button" onClick={onLoadFork}>Read fork-deployment.json</button>
        </div>
      </form>

      {forkStatus && <p className="unit-hint">{forkStatus}</p>}
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}

      {resolved && (
        <section className="trade-section">
          <h3>Resolved now</h3>
          <p className="unit-hint">Core: <span className="mono">{resolved.core}</span></p>
          <p className="unit-hint">Tools: <span className="mono">{resolved.tools}</span></p>
          <p className="unit-hint">wrappedNative: <span className="mono">{resolved.wrappedNative}</span></p>
          <p className="unit-hint">signer: <span className="mono">{resolved.signer}</span></p>
        </section>
      )}
    </div>
  )
}
