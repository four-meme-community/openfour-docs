import { Link } from 'react-router-dom'
import { useDeployment } from '../eth/deployment'
import { STEPS } from '../steps'
import { useT } from '../i18n'

export function HomePage() {
  const { fork, tokens } = useDeployment()
  const t = useT()
  const registry = fork?.addresses?.registry || ''

  function status(step) {
    if (step.id === 2) return registry ? t('common.done') : t('common.notStarted')
    if (step.id === 5 || step.id === 6) {
      return tokens.length ? t('common.tokensCount', { n: tokens.length }) : t('common.notStarted')
    }
    return t(`nav.${step.id}`)
  }

  function isOpen(step) {
    if (step.id === 2) return Boolean(registry)
    if (step.id === 5 || step.id === 6) return tokens.length > 0
    return false
  }

  return (
    <div className="page">
      <p className="kicker green">{t('home.kicker')}</p>
      <h2>{t('home.title')}</h2>
      <p className="lede">{t('home.lede')}</p>

      <ol className="mech-list">
        {STEPS.map((step) => (
          <li key={step.id} className={`mech-row${isOpen(step) ? ' is-open' : ''}`}>
            <Link className="mech-head" to={step.to}>
              <span className="mk">{String(step.id).padStart(2, '0')}</span>
              <b>{t(`steps.${step.id}.title`)}</b>
              <span className="mech-meta">{status(step)}</span>
              <p>{t(`steps.${step.id}.body`)}</p>
            </Link>
          </li>
        ))}
      </ol>

      <section className="workspace-strip">
        <h3>{t('home.workspace')}</h3>
        <p className="unit-hint">{t('home.forkRegistry')} <span className="mono">{registry || t('common.notImported')}</span></p>
        <p className="unit-hint">tokens.json: {t('common.records', { n: tokens.length })}</p>
        {tokens.length > 0 && (
          <p className="unit-hint">{t('home.latestCreate')} <Link to={`/token/${tokens[0].tokenAddress}`}>{tokens[0].name || tokens[0].tokenAddress}</Link></p>
        )}
      </section>
    </div>
  )
}
