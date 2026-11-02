import { Link } from 'react-router-dom'
import { DOCS_REPO } from '../eth/workspace'
import { useLocale } from '../i18n'

export function ModulesPage() {
  const { locale, t } = useLocale()
  const guidePath = locale === 'zh' ? 'docs/zh-Hant/developer-guide.md' : 'docs/developer-guide.md'

  return (
    <div className="page">
      <p className="kicker">{t('modules.kicker')}</p>
      <Link className="back-link" to="/">{t('common.backFlow')}</Link>
      <h2>{t('modules.title')}</h2>
      <p className="lede">{t('modules.lede')}</p>

      <section className="trade-section">
        <h3>{t('modules.tokenImpl')}</h3>
        <ul className="plain-list">
          <li>
            {t('modules.tokenReuse')}
            {' '}<a href={`${DOCS_REPO}/blob/main/contracts/token`} target="_blank" rel="noreferrer">contracts/token</a>
            {t('modules.tokenIncludes')}
          </li>
          <li>{t('modules.tokenStandard')}</li>
          <li>{t('modules.tokenDontRewrite')}</li>
          <li>{t('modules.tokenInherit')}</li>
          <li>{t('modules.tokenExternal')}</li>
          <li>{t('modules.tokenImplId')}</li>
        </ul>
      </section>

      <section className="trade-section">
        <h3>{t('modules.fiveSlots')}</h3>
        <ul className="plain-list">
          <li>{t('modules.slotToken')}</li>
          <li>{t('modules.slotVault')}</li>
          <li>{t('modules.slotCurve')}</li>
          <li>{t('modules.slotTrade')}</li>
          <li>{t('modules.slotMigrate')}</li>
        </ul>
      </section>

      <section className="trade-section">
        <h3>{t('modules.starting')}</h3>
        <ul className="plain-list">
          <li><a href={`${DOCS_REPO}/blob/main/developer/startup`} target="_blank" rel="noreferrer">developer/startup</a>{t('modules.startStartup')}</li>
          <li><a href={`${DOCS_REPO}/blob/main/developer/startup/contracts/modules`} target="_blank" rel="noreferrer">developer/startup/contracts/modules</a>{t('modules.startModules')}</li>
          <li><a href={`${DOCS_REPO}/blob/main/developer/startup/contracts/validators/FairLaunchPresetValidator.sol`} target="_blank" rel="noreferrer">FairLaunchPresetValidator</a>{t('modules.startValidator')}</li>
          <li><a href={`${DOCS_REPO}/blob/main/contracts/token/OpenFourToken.sol`} target="_blank" rel="noreferrer">OpenFourToken.sol</a>{t('modules.startToken')}</li>
          <li><a href={`${DOCS_REPO}/blob/main/contracts/token`} target="_blank" rel="noreferrer">contracts/token</a>{t('modules.startTokenDir')}</li>
          <li><a href={`${DOCS_REPO}/blob/main/contracts/interfaces`} target="_blank" rel="noreferrer">contracts/interfaces</a>{t('modules.startIfaces')}</li>
          <li><a href={`${DOCS_REPO}/blob/main/${guidePath}`} target="_blank" rel="noreferrer">Developer Guide §20</a>{t('modules.startGuide')}</li>
        </ul>
      </section>
      <section className="trade-section">
        <h3>{t('modules.everyModule')}</h3>
        <ul className="plain-list">
          <li>{t('modules.needInit')}</li>
          <li>{t('modules.needTag')}</li>
          <li>{t('modules.needSchema')}</li>
          <li>{t('modules.needFns')}</li>
          <li>{t('modules.needInherit')}</li>
        </ul>
      </section>
      <p><Link to="/register" className="flow-link">{t('modules.next')}</Link></p>
    </div>
  )
}
