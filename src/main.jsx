import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { logClientError } from './lib/db'

// Errors outside React's render tree (event handlers, async) — report them too.
// Skip the opaque cross-origin "Script error." (no message/stack — browser hides
// the detail; it's almost always a browser extension or a third-party script,
// never our code), so it doesn't create unactionable Watchdog noise.
window.addEventListener('error', (e) => {
  if (!e.error && (!e.message || e.message === 'Script error.')) return
  logClientError({ message: e.message, stack: e.error?.stack })
})
window.addEventListener('unhandledrejection', (e) =>
  logClientError({ message: 'Unhandled rejection: ' + (e.reason?.message || String(e.reason)), stack: e.reason?.stack }))

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register the service worker (production only) so the app is installable and
// loads instantly on repeat visits. Dev is skipped to avoid HMR interference.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
