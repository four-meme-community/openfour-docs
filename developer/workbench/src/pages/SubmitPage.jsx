import { Link } from 'react-router-dom'
import { useDeployment } from '../eth/deployment'
import { DOCS_REPO, OFFICIAL_SITE } from '../eth/workspace'
import { useLocale } from '../i18n'

export function SubmitPage() {
  const { fork, config } = useDeployment()
  const { locale, t } = useLocale()
  const registry = fork?.addresses?.registry || config.registry || ''
  const guidePath = locale === 'zh' ? 'docs/zh-Hant/developer-guide.md' : 'docs/developer-guide.md'

  return (
    <div className="page">
      <p className="kicker">{t('submit.kicker')}</p>
      <Link className="back-link" to="/">{t('common.backFlow')}</Link>
      <h2>{t('submit.title')}</h2>
      <p className="hint">{t('submit.hint')}</p>
      <section className="trade-section">
        <h3>{t('submit.materials')}</h3>
        <ul className="plain-list">
          <li>{t('submit.src')}</li>
          <li>{t('submit.notes')}</li>
          <li>{t('submit.tag')}</li>
          <li>{t('submit.validator')}</li>
          <li>{t('submit.records')}</li>
          <li>
            {t('submit.forkAddr')}
            {registry ? (
              <>: <span className="mono">{registry}</span></>
            ) : (
              <>{t('submit.completeFork')} <Link to="/fork">{t('submit.completeForkLink')}</Link> {t('submit.completeForkAfter')}</>
            )}
          </li>
          <li>{t('submit.frontend')}</li>
        </ul>
      </section>
      <section className="trade-section">
        <h3>{t('submit.entry')}</h3>
        <ul className="plain-list">
          <li>{t('submit.officialSite')} <a href={OFFICIAL_SITE} target="_blank" rel="noreferrer">{OFFICIAL_SITE}</a></li>
          <li>{t('submit.process')} <a href={`${DOCS_REPO}/blob/main/${guidePath}`} target="_blank" rel="noreferrer">{t('submit.processGuide')}</a></li>
        </ul>
      </section>
    </div>
  )
}
