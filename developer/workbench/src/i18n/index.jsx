import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { en } from './en'
import { zh } from './zh'

export const LOCALES = { en, zh }
export const LOCALE_KEY = 'openfour-dev-workbench-locale'

function detectLocale() {
  try {
    const stored = localStorage.getItem(LOCALE_KEY)
    if (stored === 'zh' || stored === 'en') return stored
  } catch {
    // ignore
  }
  const nav = String(navigator.language || navigator.userLanguage || '').toLowerCase()
  return nav.startsWith('zh') ? 'zh' : 'en'
}

export function getLocale() {
  return detectLocale()
}

function lookup(dict, path) {
  return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), dict)
}

function format(template, vars) {
  if (!vars) return template
  return String(template).replace(/\{(\w+)\}/g, (_, key) => (vars[key] == null ? `{${key}}` : String(vars[key])))
}

export function translate(locale, key, vars) {
  const dict = LOCALES[locale] || en
  const value = lookup(dict, key) ?? lookup(en, key) ?? key
  return typeof value === 'string' ? format(value, vars) : value
}

const LocaleContext = createContext(null)

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(detectLocale)

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
    document.title = locale === 'zh' ? 'OpenFour 工作台' : 'OpenFour Workbench'
  }, [locale])

  const setLocale = useCallback((next) => {
    const value = next === 'zh' ? 'zh' : 'en'
    setLocaleState(value)
    try {
      localStorage.setItem(LOCALE_KEY, value)
    } catch {
      // ignore
    }
  }, [])

  const t = useCallback((key, vars) => translate(locale, key, vars), [locale])

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale() {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used inside LocaleProvider')
  return ctx
}

export function useT() {
  return useLocale().t
}

export function formatStatus(t, status) {
  if (Array.isArray(status)) return t(status[0], status[1])
  return status || ''
}

export { LocaleContext }
