import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

// Global notices, mounted once in Layout:
//  • Toasts — non-blocking replacements for alert() (see src/lib/toast.js).
//  • Session-expired banner — shown when a read still fails after a token
//    refresh (db.js broadcasts 'tt-session-expired'), so users see WHY the
//    page is empty instead of a silently blank screen.

const TOAST_STYLE = {
  error:   { border: 'var(--neg)',  icon: AlertTriangle, color: 'var(--neg)', ttl: 10000 },
  success: { border: 'var(--pos)',  icon: CheckCircle2,  color: 'var(--pos)', ttl: 5000 },
  info:    { border: 'var(--line)', icon: Info,          color: 'var(--mu)',  ttl: 7000 },
}

export default function Notices() {
  const { signOut } = useAuth()
  const [toasts, setToasts] = useState([])
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    const onToast = (e) => {
      const { message, type } = e.detail || {}
      const id = Math.random().toString(36).slice(2)
      setToasts(xs => [...xs.slice(-4), { id, message, type: TOAST_STYLE[type] ? type : 'info' }])
      setTimeout(() => setToasts(xs => xs.filter(x => x.id !== id)), TOAST_STYLE[type]?.ttl ?? 7000)
    }
    const onExpired = () => setExpired(true)
    window.addEventListener('tt-toast', onToast)
    window.addEventListener('tt-session-expired', onExpired)
    return () => {
      window.removeEventListener('tt-toast', onToast)
      window.removeEventListener('tt-session-expired', onExpired)
    }
  }, [])

  return (
    <>
      {expired && (
        <div className="fixed top-0 inset-x-0 z-[90] flex items-center justify-center gap-3 px-4 py-2.5"
          style={{ background: '#7f1d1d', borderBottom: '1px solid #ef4444' }}>
          <AlertTriangle size={15} className="text-red-200 flex-shrink-0" />
          <span className="text-[13px] font-semibold text-red-50">
            Your session expired — data may not load or save until you sign in again.
          </span>
          <button
            onClick={async () => { try { await signOut?.() } finally { window.location.href = '/login' } }}
            className="px-3 py-1.5 min-h-[44px] md:min-h-0 rounded-lg text-[13px] font-bold text-red-900 bg-red-100 hover:bg-white transition-colors">
            Sign in again
          </button>
        </div>
      )}

      <div className="fixed bottom-4 right-4 z-[85] flex flex-col gap-2 w-[min(360px,calc(100vw-2rem))]">
        {toasts.map(t => {
          const s = TOAST_STYLE[t.type]
          const Icon = s.icon
          return (
            <div key={t.id} className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 shadow-card"
              style={{ background: 'var(--card)', border: `1px solid ${s.border}` }}>
              <Icon size={15} className="flex-shrink-0 mt-0.5" style={{ color: s.color }} />
              <p className="text-[13px] leading-snug text-bank-tx whitespace-pre-line flex-1 min-w-0">{t.message}</p>
              <button onClick={() => setToasts(xs => xs.filter(x => x.id !== t.id))}
                aria-label="Dismiss" className="text-bank-fa hover:text-bank-tx transition-colors flex-shrink-0 -m-2 p-2"><X size={13} /></button>
            </div>
          )
        })}
      </div>
    </>
  )
}
