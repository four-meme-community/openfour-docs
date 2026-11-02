import { Component } from 'react'
import { LocaleContext, translate } from '../i18n'

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static contextType = LocaleContext

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      const locale = this.context?.locale || 'en'
      const t = (key) => translate(locale, key)
      return (
        <div className="error-boundary">
          <h2>{t('error.title')}</h2>
          <p>{this.state.error?.message ?? 'Unknown error'}</p>
          <button type="button" onClick={() => window.location.reload()}>{t('error.reload')}</button>
        </div>
      )
    }
    return this.props.children
  }
}
