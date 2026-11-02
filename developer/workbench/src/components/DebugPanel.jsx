import { useT } from '../i18n'

export function DebugPanel({ title, data }) {
  const t = useT()
  if (!data) return null
  const text = typeof data === 'string'
    ? data
    : JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)
  return (
    <details className="debug-panel" open>
      <summary>{title || t('debug.title')}</summary>
      <pre className="mono">{text}</pre>
    </details>
  )
}
