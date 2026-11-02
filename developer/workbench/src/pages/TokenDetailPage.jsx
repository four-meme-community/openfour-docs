import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Contract, MaxUint256, ZeroAddress, formatUnits, getAddress, isAddress, isHexString, parseUnits } from 'ethers'
import { useDeployment } from '../eth/deployment'
import { SELL_OPTION_RECEIVE_WBNB, getFourCoreReadOnly, getFourCoreWithSigner } from '../eth/fourCore'
import { getReadProvider, getSignerProvider } from '../eth/provider'
import { getVaultReadOnlyAt } from '../eth/vault'
import { getToolsReadOnly, parseTradeEstimate } from '../eth/tools'
import { useWallet } from '../hooks/useWallet'
import { DebugPanel } from '../components/DebugPanel'
import { useT } from '../i18n'

function parseRuntimeRow(r) {
  const pick = (i, key) => (r[key] !== undefined && r[key] !== null ? r[key] : r[i])
  return {
    creator: String(pick(1, 'creator')),
    presetId: String(pick(2, 'presetId')),
    token: String(pick(3, 'token')),
    name: String(pick(4, 'name')),
    symbol: String(pick(5, 'symbol')),
    maxSupply: pick(6, 'maxSupply'),
    saleAmount: pick(7, 'saleAmount'),
    raiseAmount: pick(8, 'raiseAmount'),
    quoteAsset: String(pick(9, 'quoteAsset')),
    vault: String(pick(10, 'vault')),
    exists: Boolean(pick(17, 'exists')),
    paused: Boolean(pick(18, 'paused')),
  }
}

export function TokenDetailPage() {
  const { tokenAddress: tokenAddressParam } = useParams()
  const tokenAddress = tokenAddressParam && isAddress(tokenAddressParam) ? getAddress(tokenAddressParam) : ''
  const { config, tokens } = useDeployment()
  const local = tokens.find((row) => row.tokenAddress?.toLowerCase() === tokenAddress.toLowerCase())
  const { address } = useWallet()
  const t = useT()
  const [runtime, setRuntime] = useState(null)
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [decimals, setDecimals] = useState(18)
  const [quoteAsset, setQuoteAsset] = useState(ZeroAddress)
  const [wrappedNative, setWrappedNative] = useState(ZeroAddress)
  const [phase, setPhase] = useState(0)
  const [totalRaised, setTotalRaised] = useState(0n)
  const [raiseAmount, setRaiseAmount] = useState(0n)
  const [initialSaleAmount, setInitialSaleAmount] = useState(0n)
  const [remainingForSale, setRemainingForSale] = useState(0n)
  const [myBalance, setMyBalance] = useState(0n)
  const [sellAllowance, setSellAllowance] = useState(0n)
  const [buyAllowance, setBuyAllowance] = useState(0n)
  const [amount, setAmount] = useState('')
  const [budget, setBudget] = useState('')
  const [sellAmount, setSellAmount] = useState('')
  const [sellMinQuote, setSellMinQuote] = useState('')
  const [sellProof, setSellProof] = useState('0x')
  const [sellReceiveWbnb, setSellReceiveWbnb] = useState(false)
  const [preview, setPreview] = useState(null)
  const [budgetPreview, setBudgetPreview] = useState(null)
  const [sellPreview, setSellPreview] = useState(null)
  const [slippageBps, setSlippageBps] = useState(500)
  const [loadingAction, setLoadingAction] = useState('none')
  const [error, setError] = useState(null)
  const [lastTx, setLastTx] = useState(null)
  const [trades, setTrades] = useState([])
  const [refreshNonce, setRefreshNonce] = useState(0)

  const erc20Abi = useMemo(() => [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'function balanceOf(address owner) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
  ], [])

  const isNativeQuote = quoteAsset.toLowerCase() === wrappedNative.toLowerCase()

  const refresh = useCallback(async () => {
    if (!tokenAddress) return
    if (!config.registry) {
      setError(t('token.noFork'))
      return
    }
    const core = await getFourCoreReadOnly(config)
    const runtimeRaw = parseRuntimeRow(await core.tokens(tokenAddress))
    if (!runtimeRaw.exists) throw new Error(t('token.notExist'))
    setRuntime(runtimeRaw)
    const token = new Contract(runtimeRaw.token, erc20Abi, core.runner)
    const vault = getVaultReadOnlyAt(config, runtimeRaw.vault)
    const [wn, n, s, d, q, p, raised, remain] = await Promise.all([
      core.wrappedNative(),
      token.name(),
      token.symbol(),
      token.decimals(),
      vault.quoteAsset(),
      vault.phase(),
      vault.totalRaised(),
      vault.remainingForSale(),
    ])
    setWrappedNative(wn)
    setName(n)
    setSymbol(s)
    setDecimals(Number(d))
    setQuoteAsset(q)
    setPhase(Number(p))
    setTotalRaised(BigInt(raised.toString()))
    setRaiseAmount(BigInt(String(runtimeRaw.raiseAmount ?? 0)))
    setInitialSaleAmount(BigInt(String(runtimeRaw.saleAmount ?? 0)))
    setRemainingForSale(BigInt(remain.toString()))
    if (address) {
      const coreAddr = await core.getAddress()
      const [b, sellA] = await Promise.all([token.balanceOf(address), token.allowance(address, coreAddr)])
      setMyBalance(BigInt(b.toString()))
      setSellAllowance(BigInt(sellA.toString()))
      if (q !== wn) {
        const quote = new Contract(q, erc20Abi, core.runner)
        setBuyAllowance(BigInt((await quote.allowance(address, coreAddr)).toString()))
      } else {
        setBuyAllowance(0n)
      }
    }
  }, [address, config, erc20Abi, t, tokenAddress])

  useEffect(() => {
    refresh().catch((e) => setError(e.message || String(e)))
  }, [refresh, refreshNonce])

  useEffect(() => {
    if (!runtime || !amount.trim()) { setPreview(null); return }
    let cancelled = false
    ;(async () => {
      try {
        const amt = parseUnits(amount, decimals)
        const tools = await getToolsReadOnly(config)
        const est = parseTradeEstimate(await tools.estimateBuy(runtime.token, address ?? ZeroAddress, amt, 0n, '0x'))
        if (!cancelled) setPreview(est.curveQuote > 0n ? est : null)
      } catch {
        if (!cancelled) setPreview(null)
      }
    })()
    return () => { cancelled = true }
  }, [address, amount, config, decimals, runtime])

  useEffect(() => {
    if (!runtime || !budget.trim()) { setBudgetPreview(null); return }
    let cancelled = false
    ;(async () => {
      try {
        const maxQuote = parseUnits(budget, 18)
        const tools = await getToolsReadOnly(config)
        const est = parseTradeEstimate(await tools.estimateBuyByBudget(runtime.token, address ?? ZeroAddress, maxQuote, 0n, '0x'))
        if (!cancelled) setBudgetPreview(est.tokenAmount > 0n ? est : null)
      } catch {
        if (!cancelled) setBudgetPreview(null)
      }
    })()
    return () => { cancelled = true }
  }, [address, budget, config, runtime])

  useEffect(() => {
    if (!runtime || !sellAmount.trim()) { setSellPreview(null); return }
    let cancelled = false
    ;(async () => {
      try {
        const amt = parseUnits(sellAmount, decimals)
        const tools = await getToolsReadOnly(config)
        const options = isNativeQuote && sellReceiveWbnb ? SELL_OPTION_RECEIVE_WBNB : 0n
        const est = parseTradeEstimate(await tools.estimateSell(runtime.token, address ?? ZeroAddress, amt, options, sellProof.trim() || '0x'))
        if (!cancelled) setSellPreview(est.userReceives > 0n ? est : null)
      } catch {
        if (!cancelled) setSellPreview(null)
      }
    })()
    return () => { cancelled = true }
  }, [address, config, decimals, isNativeQuote, runtime, sellAmount, sellProof, sellReceiveWbnb])

  useEffect(() => {
    if (!tokenAddress || !config.registry) return
    let cancelled = false
    ;(async () => {
      const core = await getFourCoreReadOnly(config)
      const block = await getReadProvider(config).getBlockNumber()
      const evs = await core.queryFilter(core.filters.TradeExecuted(tokenAddress), Math.max(0, block - 8000), block)
      if (cancelled) return
      setTrades(evs.map((ev) => {
        const a = ev.args ?? {}
        return {
          txHash: ev.transactionHash ?? '',
          isBuy: Boolean(a.isBuy),
          tokenAmount: BigInt(a.tokenAmount.toString()),
          traderQuoteAmount: BigInt(a.traderQuoteAmount.toString()),
        }
      }).reverse())
    })().catch(() => {})
    return () => { cancelled = true }
  }, [config, refreshNonce, tokenAddress])

  async function withAction(name, fn) {
    setLoadingAction(name)
    setError(null)
    try {
      const tx = await fn()
      if (tx?.hash) {
        setLastTx(tx.hash)
        await tx.wait()
      }
      setRefreshNonce((v) => v + 1)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoadingAction('none')
    }
  }

  async function approve(token, label) {
    return withAction(label, async () => {
      const core = await getFourCoreReadOnly(config)
      const { signer } = await getSignerProvider(config)
      const c = new Contract(token, erc20Abi, signer)
      return c.approve(await core.getAddress(), MaxUint256)
    })
  }

  async function buy() {
    if (!preview) return
    return withAction('buy', async () => {
      const core = await getFourCoreWithSigner(config)
      const amt = parseUnits(amount, decimals)
      const slippage = (preview.userPays * (10000n + BigInt(slippageBps))) / 10000n
      return isNativeQuote
        ? core.buy(tokenAddress, amt, slippage, 0n, '0x', { value: slippage })
        : core.buy(tokenAddress, amt, slippage, 0n, '0x')
    })
  }

  async function buyByBudget() {
    if (!budgetPreview) return
    return withAction('buyByBudget', async () => {
      const core = await getFourCoreWithSigner(config)
      const maxQuotePayAmount = parseUnits(budget, 18)
      const minAmountOut = (budgetPreview.tokenAmount * (10000n - BigInt(slippageBps))) / 10000n
      return isNativeQuote
        ? core.buyByBudget(tokenAddress, maxQuotePayAmount, minAmountOut, 0n, '0x', { value: maxQuotePayAmount })
        : core.buyByBudget(tokenAddress, maxQuotePayAmount, minAmountOut, 0n, '0x')
    })
  }

  async function sell() {
    return withAction('sell', async () => {
      const core = await getFourCoreWithSigner(config)
      const amt = parseUnits(sellAmount, decimals)
      const minOut = sellMinQuote.trim() ? parseUnits(sellMinQuote, 18) : 0n
      const options = isNativeQuote && sellReceiveWbnb ? SELL_OPTION_RECEIVE_WBNB : 0n
      return core.sell(tokenAddress, amt, minOut, options, sellProof.trim() || '0x')
    })
  }

  async function migrate() {
    return withAction('migrate', async () => {
      const core = await getFourCoreWithSigner(config)
      return core.migrate(tokenAddress)
    })
  }

  if (!tokenAddress) return <p>{t('token.missing')}</p>
  if (!runtime) {
    return (
      <div className="page">
        <Link className="back-link" to="/tokens">{t('token.backList')}</Link>
        {local && (
          <>
            <h2>{local.name || t('common.unnamedToken')} ({local.symbol || '-'})</h2>
            <p className="unit-hint mono">{local.tokenAddress}</p>
            <p className="unit-hint">{t('token.fromJson')}</p>
          </>
        )}
        {error ? <p className="error">{error}</p> : <p>{t('common.loading')}</p>}
      </div>
    )
  }

  const sold = initialSaleAmount > remainingForSale ? initialSaleAmount - remainingForSale : 0n
  const progressPct = initialSaleAmount > 0n ? Number((sold * 10000n) / initialSaleAmount) / 100 : 0
  const sellAmountWei = sellAmount.trim() ? (() => { try { return parseUnits(sellAmount, decimals) } catch { return 0n } })() : 0n
  const sellProofValid = isHexString(sellProof.trim() || '0x')

  return (
    <div className="page">
      <Link className="back-link" to="/tokens">{t('token.backList')}</Link>
      <div className="detail-header">
        <h2>{name} ({symbol})</h2>
        <span className="preset-badge">{t(`token.phase.${phase}`) === `token.phase.${phase}` ? phase : t(`token.phase.${phase}`)}</span>
      </div>
      <p className="unit-hint">token: <span className="mono">{runtime.token}</span></p>
      <p className="unit-hint">vault: <span className="mono">{runtime.vault}</span></p>
      <p className="unit-hint">{t('token.balance')} {formatUnits(myBalance, decimals)}</p>
      <div className="progress-section">
        <div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.min(100, progressPct)}%` }} /></div>
        <p className="unit-hint">{progressPct.toFixed(2)}% · {t('token.raised')} {formatUnits(totalRaised, 18)} / {formatUnits(raiseAmount, 18)}</p>
      </div>

      <section className="trade-section">
        <h3>{t('token.trade')}</h3>
        <div className="slippage-control">
          <span className="label">{t('token.slippage')}</span>
          {[50, 100, 300, 500].map((bps) => (
            <button key={bps} type="button" className={`slippage-preset${slippageBps === bps ? ' active' : ''}`} onClick={() => setSlippageBps(bps)}>
              {bps / 100}%
            </button>
          ))}
        </div>

        <div className="trade-mode">
          <h4>{t('token.buyByAmount')}</h4>
          <input type="text" placeholder={t('token.tokenAmount')} value={amount} onChange={(e) => setAmount(e.target.value)} />
          {preview && <p className="price-preview">{t('token.paysAbout', { amount: formatUnits(preview.userPays, 18) })}</p>}
          <div className="trade-buttons">
            {!isNativeQuote && <button type="button" onClick={() => approve(quoteAsset, 'approveBuy')} disabled={loadingAction !== 'none'}>{t('token.approveBuy')}</button>}
            <button type="button" onClick={buy} disabled={loadingAction !== 'none' || !preview}>{t('token.buy')}</button>
          </div>
        </div>

        <div className="trade-mode">
          <h4>{t('token.buyByBudget')}</h4>
          <input type="text" placeholder={t('token.quoteBudget')} value={budget} onChange={(e) => setBudget(e.target.value)} />
          {budgetPreview && <p className="price-preview">{t('token.buysAbout', { amount: formatUnits(budgetPreview.tokenAmount, decimals), symbol })}</p>}
          <div className="trade-buttons">
            {!isNativeQuote && <button type="button" onClick={() => approve(quoteAsset, 'approveBuy')} disabled={loadingAction !== 'none'}>{t('token.approveBuy')}</button>}
            <button type="button" onClick={buyByBudget} disabled={loadingAction !== 'none' || !budgetPreview}>{t('token.buy')}</button>
          </div>
        </div>

        <div className="trade-mode">
          <h4>{t('token.sell')}</h4>
          <input type="text" placeholder={t('token.sellAmount')} value={sellAmount} onChange={(e) => setSellAmount(e.target.value)} />
          <input type="text" placeholder={t('token.minQuote')} value={sellMinQuote} onChange={(e) => setSellMinQuote(e.target.value)} />
          <input type="text" placeholder="proof" value={sellProof} onChange={(e) => setSellProof(e.target.value)} />
          {isNativeQuote && (
            <label className="checkbox-row">
              <input type="checkbox" checked={sellReceiveWbnb} onChange={(e) => setSellReceiveWbnb(e.target.checked)} />
              {t('token.receiveWbnb')}
            </label>
          )}
          {sellPreview && <p className="price-preview">{t('token.receivesAbout', { amount: formatUnits(sellPreview.userReceives, 18) })}</p>}
          <div className="trade-buttons">
            <button type="button" onClick={() => approve(runtime.token, 'approveSell')} disabled={loadingAction !== 'none'}>{t('token.approveSell')}</button>
            <button type="button" onClick={sell} disabled={loadingAction !== 'none' || sellAmountWei <= 0n || sellAllowance < sellAmountWei || !sellProofValid}>{t('token.sell')}</button>
          </div>
        </div>

        <div className="trade-mode">
          <h4>{t('token.migrate')}</h4>
          <button type="button" onClick={migrate} disabled={loadingAction !== 'none'}>{t('token.triggerMigrate')}</button>
        </div>
        {!isNativeQuote && <p className="unit-hint">{t('token.buyAllowance')} {buyAllowance.toString()}</p>}
        <p className="unit-hint">{t('token.sellAllowance')} {sellAllowance.toString()}</p>
      </section>

      {trades.length > 0 && (
        <section className="trade-section">
          <h3>{t('token.recent')}</h3>
          <ul className="token-list">
            {trades.slice(0, 12).map((row) => (
              <li key={row.txHash} className="token-item">
                <span>{row.isBuy ? t('token.buy') : t('token.sell')} {formatUnits(row.tokenAmount, decimals)} / quote {formatUnits(row.traderQuoteAmount, 18)}</span>
                <span className="mono creator">{row.txHash.slice(0, 10)}…</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && <p className="error">{error}</p>}
      <DebugPanel title={t('token.debugTitle')} data={lastTx ? { lastTx, action: loadingAction } : null} />
    </div>
  )
}
