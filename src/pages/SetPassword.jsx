import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { supabase, DEMO_MODE } from '../lib/supabase'
import { updateOwnPassword } from '../lib/db'
import Logo from '../components/Logo'

// Where invite + password-reset email links land. The link carries auth
// tokens in the URL hash; the Supabase client picks them up and signs the
// user in, then this page lets them choose their own password.
export default function SetPassword() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)     // finished checking for a session
  const [hasSession, setHasSession] = useState(false)
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (DEMO_MODE) { setReady(true); return }
    let alive = true
    // The hash tokens are processed asynchronously on load — check now and
    // listen briefly so a slow token exchange still lands.
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (alive && session) { setHasSession(true); setReady(true) }
    })
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      if (data.session) setHasSession(true)
      setReady(true)
    })
    const t = setTimeout(() => { if (alive) setReady(true) }, 2500)
    return () => { alive = false; clearTimeout(t); sub?.subscription?.unsubscribe?.() }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (pwd.length < 8) { setError('Use at least 8 characters.'); return }
    if (pwd !== pwd2) { setError("The passwords don't match."); return }
    setSaving(true)
    const { error: err } = await updateOwnPassword(pwd)
    setSaving(false)
    if (err) { setError(err.message || 'Could not set the password.'); return }
    navigate('/dashboard', { replace: true })
  }

  const inputCls = 'w-full px-4 py-3 rounded-xl text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-teal/60 transition-colors'
  const inputStyle = { background: '#171717', border: '1px solid #343434' }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden" style={{ background: '#161616' }}>
      <div aria-hidden className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(600px 320px at 50% -60px, rgba(0,184,148,0.14), transparent 70%)' }} />

      <div className="relative w-full max-w-[380px] rounded-2xl p-8 shadow-2xl"
        style={{ background: '#1f1f1f', border: '1px solid #2c2c2c' }}>
        <div className="flex flex-col items-center mb-7">
          <Logo size={48} />
          <p className="text-[10px] font-bold tracking-[0.3em] text-teal mt-4">TURF TIME</p>
          <h1 className="text-[17px] font-bold text-white mt-1">
            {hasSession ? 'Create your password' : 'Set password'}
          </h1>
        </div>

        {!ready ? (
          <p className="text-[13px] text-white/40 text-center py-6">Checking your link…</p>
        ) : !hasSession ? (
          <div className="space-y-4">
            <div className="rounded-xl px-4 py-3 text-[13px] text-amber-300"
              style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)' }}>
              This link is invalid or has expired. Invite and reset links only work once and for a limited time.
            </div>
            <p className="text-[12px] text-white/40 text-center">
              Use “Forgot password?” on the <Link to="/login" className="text-teal hover:underline">sign-in page</Link> to
              get a fresh link, or ask an admin to resend your invite.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-[12px] text-white/45 text-center -mt-2 mb-2">
              Choose the password you'll use to sign in from now on.
            </p>
            {error && (
              <div className="rounded-xl px-4 py-3 text-[13px] text-red-400"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
                {error}
              </div>
            )}
            <div>
              <label className="block text-[10px] font-semibold text-white/35 uppercase tracking-widest mb-1.5">New password</label>
              <div className="relative">
                <input type={show ? 'text' : 'password'} required autoFocus autoComplete="new-password"
                  value={pwd} onChange={e => setPwd(e.target.value)} placeholder="At least 8 characters"
                  style={inputStyle} className={`${inputCls} pr-10`} />
                <button type="button" onClick={() => setShow(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
                  {show ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-white/35 uppercase tracking-widest mb-1.5">Confirm password</label>
              <input type={show ? 'text' : 'password'} required autoComplete="new-password"
                value={pwd2} onChange={e => setPwd2(e.target.value)} placeholder="Type it again"
                style={inputStyle} className={inputCls} />
            </div>
            <button type="submit" disabled={saving}
              className="w-full h-11 rounded-xl text-[13px] font-bold text-dark bg-teal hover:bg-teal-dark disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
              <Lock size={14} /> {saving ? 'Saving…' : 'Set password & sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
