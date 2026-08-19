import { useState } from 'react'
import { Eye, EyeOff, ArrowLeft } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { sendPasswordReset } from '../lib/db'
import Logo from '../components/Logo'

export default function Login() {
  const { signIn, demoMode, deactivated } = useAuth()
  const [mode, setMode] = useState('signin')   // 'signin' | 'forgot'
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd]   = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [info, setInfo]         = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setInfo('')
    setLoading(true)
    const { error: err } = await signIn(email, password)
    if (err) setError(err.message)
    setLoading(false)
  }

  async function handleForgot(e) {
    e.preventDefault()
    setError(''); setInfo('')
    setLoading(true)
    const { error: err } = await sendPasswordReset(email)
    setLoading(false)
    if (err) { setError(err.message || 'Could not send the reset email.'); return }
    setInfo(`If ${email.trim()} has an account, a reset link is on its way. Check your inbox (and spam) — the link works once.`)
  }

  const inputCls = 'w-full px-4 py-3 rounded-xl text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-teal/60 transition-colors'
  const inputStyle = { background: '#171717', border: '1px solid #343434' }
  const label = 'block text-[10px] font-semibold text-white/35 uppercase tracking-widest mb-1.5'

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden" style={{ background: '#161616' }}>
      {/* Ambient brand glow */}
      <div aria-hidden className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(640px 340px at 50% -80px, rgba(0,184,148,0.14), transparent 70%)' }} />

      <div className="relative w-full max-w-[380px] rounded-2xl p-8 shadow-2xl"
        style={{ background: '#1f1f1f', border: '1px solid #2c2c2c' }}>

        {/* Brand */}
        <div className="flex flex-col items-center mb-7">
          <Logo size={48} />
          <p className="text-[10px] font-bold tracking-[0.3em] text-teal mt-4">TURF TIME</p>
          <h1 className="text-[17px] font-bold text-white mt-1">
            {mode === 'forgot' ? 'Reset your password' : 'Commission Dashboard'}
          </h1>
        </div>

        {(error || deactivated) && (
          <div className="rounded-xl px-4 py-3 mb-4 text-[13px] text-red-400"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
            {deactivated ? 'This account has been deactivated. Contact an administrator.' : error}
          </div>
        )}
        {info && (
          <div className="rounded-xl px-4 py-3 mb-4 text-[13px] text-teal"
            style={{ background: 'rgba(0,184,148,0.08)', border: '1px solid rgba(0,184,148,0.3)' }}>
            {info}
          </div>
        )}

        {mode === 'signin' ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={label}>Email</label>
              <input type="email" required autoComplete="email" autoFocus
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@turftimeaz.com" style={inputStyle} className={inputCls} />
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <label className="text-[10px] font-semibold text-white/35 uppercase tracking-widest">Password</label>
                <button type="button" onClick={() => { setMode('forgot'); setError(''); setInfo('') }}
                  className="text-[11px] text-white/35 hover:text-teal transition-colors">
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <input type={showPwd ? 'text' : 'password'} required autoComplete="current-password"
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" style={inputStyle} className={`${inputCls} pr-10`} />
                <button type="button" onClick={() => setShowPwd(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
                  {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full h-11 rounded-xl text-[13px] font-bold text-dark bg-teal hover:bg-teal-dark disabled:opacity-50 transition-colors">
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleForgot} className="space-y-4">
            <p className="text-[12px] text-white/45 -mt-2">
              Enter your work email and we'll send a link to choose a new password.
            </p>
            <div>
              <label className={label}>Email</label>
              <input type="email" required autoComplete="email" autoFocus
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@turftimeaz.com" style={inputStyle} className={inputCls} />
            </div>
            <button type="submit" disabled={loading}
              className="w-full h-11 rounded-xl text-[13px] font-bold text-dark bg-teal hover:bg-teal-dark disabled:opacity-50 transition-colors">
              {loading ? 'Sending…' : 'Email me a reset link'}
            </button>
            <button type="button" onClick={() => { setMode('signin'); setError(''); setInfo('') }}
              className="w-full flex items-center justify-center gap-1.5 text-[12px] text-white/40 hover:text-white transition-colors">
              <ArrowLeft size={13} /> Back to sign in
            </button>
          </form>
        )}

        {demoMode && (
          <div className="mt-5 rounded-lg p-3 text-[11px] text-white/30"
            style={{ background: '#171717', border: '1px solid #2a2a2a' }}>
            <p className="font-semibold text-white/40 mb-1">Demo credentials</p>
            <p>keaton@turftime.com (VP) · garrison@turftime.com (Director)</p>
            <p>jared@turftime.com (Manager) · stephen@turftime.com (Rep)</p>
            <p>admin@turftime.com (Admin)</p>
            <p className="mt-1 text-teal/60">Password: TurfTime2026!</p>
          </div>
        )}
      </div>

      <p className="relative text-[11px] text-white/25 mt-6 text-center">
        Access is invite-only — new here? Your invite email has your link.
      </p>
    </div>
  )
}
