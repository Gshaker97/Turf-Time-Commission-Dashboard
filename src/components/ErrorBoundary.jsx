import { Component } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { logClientError } from '../lib/db'

// Catches a crash in the page below it so the rest of the app (nav, other
// pages) keeps working instead of white-screening, and reports the error to
// client_errors for the Watchdog. Reset by giving it a fresh `key` (Layout
// keys it by route so navigating away clears the error state).
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    logClientError({
      message: String(error?.message || error),
      stack: (error?.stack || '') + '\n--component--\n' + (info?.componentStack || ''),
    })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: '#ef444418', border: '1px solid #ef444455' }}>
          <AlertTriangle size={22} className="text-red-400" />
        </div>
        <p className="text-[15px] font-bold text-white mb-1">Something broke on this page</p>
        <p className="text-[12px] text-white/40 mb-5 max-w-[340px]">
          The error has been reported automatically. Reloading usually clears it.
        </p>
        <button onClick={() => window.location.reload()}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold text-dark bg-teal transition-colors">
          <RefreshCw size={14} /> Reload
        </button>
      </div>
    )
  }
}
