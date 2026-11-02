import { useCallback, useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import './App.css'
import { useWallet } from './hooks/useWallet'
import { HomePage } from './pages/HomePage'
import { DocsPage } from './pages/DocsPage'
import { ForkPage } from './pages/ForkPage'
import { ModulesPage } from './pages/ModulesPage'
import { RegisterPage } from './pages/RegisterPage'
import { CreateTokenPage } from './pages/CreateTokenPage'
import { TokensPage } from './pages/TokensPage'
import { TokenDetailPage } from './pages/TokenDetailPage'
import { SubmitPage } from './pages/SubmitPage'
import { DeploymentContext, useDeployment } from './eth/deployment'
import {
  PROTECTED_CHAIN_IDS,
  configFromForkDeployment,
  mergeConfig,
  writeStoredConfig,
} from './eth/config'
import { clearAddressCache, resolveCoreAndToolsAddresses } from './eth/addressResolver'
import { getFourCoreReadOnly } from './eth/fourCore'
import { addCreatedToken, fetchWorkspace, importForkFromDeploy, saveForkJson } from './eth/workspace'
import { STEPS, isStepPath } from './steps'
import { useLocale } from './i18n'

function DeploymentProvider({ children }) {
  const [config, setConfig] = useState(() => ({ ...mergeConfig(), registry: '' }))
  const [resolved, setResolved] = useState(null)
  const [fork, setFork] = useState(null)
  const [tokens, setTokens] = useState([])
  const [forkStatus, setForkStatus] = useState('')

  const refreshResolved = useCallback(async (next) => {
    clearAddressCache()
    if (!next.registry) {
      setResolved(null)
      return
    }
    try {
      const addrs = await resolveCoreAndToolsAddresses(next)
      const core = await getFourCoreReadOnly(next)
      const [wrappedNative, signer] = await Promise.all([core.wrappedNative(), core.signer()])
      setResolved({ ...addrs, wrappedNative, signer })
    } catch (err) {
      setResolved(null)
      console.warn('resolve deployment failed', err)
    }
  }, [])

  const save = useCallback((next) => {
    const merged = mergeConfig(next)
    writeStoredConfig(merged)
    setConfig(merged)
    return merged
  }, [])

  const applyFork = useCallback((json) => {
    setFork(json)
    if (json?.addresses?.registry) {
      return save(configFromForkDeployment(json))
    }
    return mergeConfig()
  }, [save])

  const refreshWorkspace = useCallback(async () => {
    const data = await fetchWorkspace()
    setTokens(data.tokens)
    if (data.fork) {
      applyFork(data.fork)
    } else {
      setFork(null)
      save({ registry: '' })
    }
    return data
  }, [applyFork, save])

  const persistFork = useCallback(async (json) => {
    const saved = await saveForkJson(json)
    return applyFork(saved)
  }, [applyFork])

  const loadFromFork = useCallback(async () => {
    const json = await importForkFromDeploy()
    const next = await persistFork({ ...json, rpcUrl: mergeConfig().rpcUrl })
    setForkStatus(['fork.wrote', { registry: next.registry }])
    return next
  }, [persistFork])

  const recordToken = useCallback(async (record) => {
    const next = await addCreatedToken(record)
    setTokens(next)
    return next
  }, [])

  useEffect(() => {
    refreshResolved(config)
  }, [config, refreshResolved])

  useEffect(() => {
    refreshWorkspace().catch((err) => {
      setForkStatus(['fork.workspaceMissing'])
    })
  }, [refreshWorkspace])

  const value = useMemo(
    () => ({
      config,
      save,
      loadFromFork,
      persistFork,
      forkStatus,
      resolved,
      fork,
      tokens,
      refreshWorkspace,
      recordToken,
    }),
    [config, save, loadFromFork, persistFork, forkStatus, resolved, fork, tokens, refreshWorkspace, recordToken],
  )
  return <DeploymentContext.Provider value={value}>{children}</DeploymentContext.Provider>
}

function AppShell() {
  const { address, connect, loading } = useWallet()
  const { config } = useDeployment()
  const { pathname } = useLocation()
  const { locale, setLocale, t } = useLocale()
  const [navOpen, setNavOpen] = useState(false)

  useEffect(() => {
    setNavOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!navOpen) return
    function onKey(e) {
      if (e.key === 'Escape') setNavOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navOpen])

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/art/logo-640.png" alt="OpenFour" />
          <span className="brand-tag">Dev</span>
        </Link>
        <button
          type="button"
          className={`nav-toggle${navOpen ? ' is-open' : ''}`}
          aria-expanded={navOpen}
          aria-controls="workbench-nav"
          onClick={() => setNavOpen((open) => !open)}
        >
          <span className="nav-toggle-bars" aria-hidden="true" />
          <span className="sr-only">{navOpen ? t('nav.closeMenu') : t('nav.openMenu')}</span>
        </button>
        <nav id="workbench-nav" className={`nav-links${navOpen ? ' is-open' : ''}`}>
          <NavLink to="/" className={pathname === '/' ? 'active' : ''}>{t('nav.flow')}</NavLink>
          {STEPS.map((step) => (
            <NavLink
              key={step.to}
              to={step.to}
              className={isStepPath(pathname, step.to) ? 'active' : ''}
            >
              {t(`nav.${step.id}`)}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-end">
          <div className="lang-switch" role="group" aria-label={t('lang.switch')}>
            <button type="button" className={locale === 'zh' ? 'active' : ''} onClick={() => setLocale('zh')}>
              {t('lang.zh')}
            </button>
            <button type="button" className={locale === 'en' ? 'active' : ''} onClick={() => setLocale('en')}>
              {t('lang.en')}
            </button>
          </div>
          {address ? (
            <span className="wallet-addr">{address.slice(0, 8)}…</span>
          ) : (
            <button className="xbtn" onClick={connect} disabled={loading}>
              <span className="xbtn-full">{loading ? t('nav.connecting') : t('nav.connectFull')}</span>
              <span className="xbtn-short">{loading ? '…' : t('nav.connect')}</span>
              <span className="arrow" aria-hidden="true">↗</span>
            </button>
          )}
        </div>
      </header>
      {navOpen && (
        <button type="button" className="nav-backdrop" aria-label="Close menu" onClick={() => setNavOpen(false)} />
      )}
      {PROTECTED_CHAIN_IDS.has(Number(config.chainId)) && (
        <div className="banner-warn">{t('banner.mainnet')}</div>
      )}
      <main className="app-main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/fork" element={<ForkPage />} />
          <Route path="/modules" element={<ModulesPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/create" element={<CreateTokenPage />} />
          <Route path="/tokens" element={<TokensPage />} />
          <Route path="/token/:tokenAddress" element={<TokenDetailPage />} />
          <Route path="/submit" element={<SubmitPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <DeploymentProvider>
        <AppShell />
      </DeploymentProvider>
    </BrowserRouter>
  )
}
