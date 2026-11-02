import { Link } from 'react-router-dom'
import { DOCS_CLONE, DOCS_REPO } from '../eth/workspace'
import { useLocale } from '../i18n'

export function DocsPage() {
  const { locale, t } = useLocale()
  const guidePath = locale === 'zh' ? 'docs/zh-Hant/developer-guide.md' : 'docs/developer-guide.md'

  return (
    <div className="page">
      <p className="kicker">{t('docs.kicker')}</p>
      <Link className="back-link" to="/">{t('common.backFlow')}</Link>
      <h2>{t('docs.title')}</h2>
      <p className="hint">{t('docs.hint')}</p>
      <section className="trade-section">
        <h3>{t('docs.clone')}</h3>
        <pre className="mono">{DOCS_CLONE}</pre>
        <p className="unit-hint">{t('docs.repo')} <a href={DOCS_REPO} target="_blank" rel="noreferrer">{DOCS_REPO}</a></p>
      </section>
      <section className="trade-section">
        <h3>{t('docs.readFirst')}</h3>
        <ul className="plain-list">
          <li><a href={`${DOCS_REPO}/blob/main/${guidePath}`} target="_blank" rel="noreferrer">{t('docs.guide')}</a>{t('docs.guideDesc')}</li>
          <li><a href={`${DOCS_REPO}/blob/main/developer/startup`} target="_blank" rel="noreferrer">{t('docs.sample')}</a>{t('docs.sampleDesc')}</li>
          <li><a href={`${DOCS_REPO}/blob/main/contracts/interfaces`} target="_blank" rel="noreferrer">contracts/interfaces</a>{t('docs.interfaces')}</li>
          <li><a href={`${DOCS_REPO}/blob/main/developer/fork-deploy/README.md`} target="_blank" rel="noreferrer">fork-deploy</a>{t('docs.forkDeploy')}</li>
        </ul>
      </section>
      <p><Link to="/fork" className="flow-link">{t('docs.next')}</Link></p>
    </div>
  )
}
