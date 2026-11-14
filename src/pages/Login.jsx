import { useState } from 'react'
import { Eye, EyeOff, ArrowLeft } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { sendPasswordReset } from '../lib/db'
import Logo from '../components/Logo'
import { SURFACE, PrimaryButton, inputCls as sharedInputCls, inputStyle as sharedInputStyle } from '../components/ui'

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

  const inputCls = `${sharedInputCls} !min-h-[44px] !h-11 px-4`
  const inputStyle = sharedInputStyle
  const label = 'block text-[13px] font-semibold text-bank-fa uppercase tracking-wide mb-1.5'
  const eyeBtn = 'absolute right-1 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-bank-fa hover:text-bank-tx transition-colors'

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden" style={{ background: 'var(--bg)', color: 'var(--tx)' }}>
      {/* Ambient brand glow — gold, faint. */}
      <div aria-hidden className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(640px 340px at 50% -80px, rgba(191,164,108,0.12), transparent 70%)' }} />

      <div className="relative w-full max-w-[380px] rounded-2xl p-6 md:p-8"
        style={{ ...SURFACE.card, boxShadow: 'var(--card-shadow), 0 24px 60px rgba(0,0,0,0.45)' }}>

        {/* Brand */}
        <div className="flex flex-col items-center mb-7">
          <Logo size={48} />
          <p className="text-[13px] font-bold tracking-[0.3em] text-bank-gold-tx mt-4">TURF TIME</p>
          <h1 className="text-[17px] font-bold text-bank-tx mt-1">
            {mode === 'forgot' ? 'Reset your password' : 'Commission Dashboard'}
          </h1>
        </div>

        {(error || deactivated) && (
          <div className="rounded-xl px-4 py-3 mb-4 text-[13px]" role="alert"
            style={{ color: 'var(--neg)', background: 'rgba(217,140,128,0.10)', border: '1px solid rgba(217,140,128,0.35)' }}>
            {deactivated ? 'This account has been deactivated. Contact an administrator.' : error}
          </div>
        )}
        {info && (
          <div className="rounded-xl px-4 py-3 mb-4 text-[13px]" role="status"
            style={{ color: 'var(--pos)', background: 'rgba(169,196,178,0.10)', border: '1px solid rgba(169,196,178,0.35)' }}>
            {info}
          </div>
        )}

        {mode === 'signin' ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={label} htmlFor="login-email">Email</label>
              <input id="login-email" type="email" required autoComplete="email" autoFocus
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@turftimeaz.com" style={inputStyle} className={inputCls} />
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <label className="text-[13px] font-semibold text-bank-fa uppercase tracking-wide" htmlFor="login-password">Password</label>
                <button type="button" onClick={() => { setMode('forgot'); setError(''); setInfo('') }}
                  className="text-[13px] text-bank-mu hover:text-bank-gold-tx transition-colors min-h-[44px] md:min-h-0 px-1">
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <input id="login-password" type={showPwd ? 'text' : 'password'} required autoComplete="current-password"
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" style={inputStyle} className={`${inputCls} pr-12`} />
                <button type="button" onClick={() => setShowPwd(v => !v)} aria-label={showPwd ? 'Hide password' : 'Show password'} className={eyeBtn}>
                  {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <PrimaryButton type="submit" disabled={loading} className="w-full h-11">
              {loading ? 'Signing in…' : 'Sign in'}
            </PrimaryButton>
          </form>
        ) : (
          <form onSubmit={handleForgot} className="space-y-4">
            <p className="text-[13px] text-bank-mu -mt-2">
              Enter your work email and we'll send a link to choose a new password.
            </p>
            <div>
              <label className={label} htmlFor="forgot-email">Email</label>
              <input id="forgot-email" type="email" required autoComplete="email" autoFocus
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@turftimeaz.com" style={inputStyle} className={inputCls} />
            </div>
            <PrimaryButton type="submit" disabled={loading} className="w-full h-11">
              {loading ? 'Sending…' : 'Email me a reset link'}
            </PrimaryButton>
            <button type="button" onClick={() => { setMode('signin'); setError(''); setInfo('') }}
              className="w-full min-h-[44px] flex items-center justify-center gap-1.5 text-[13px] text-bank-mu hover:text-bank-tx transition-colors">
              <ArrowLeft size={13} /> Back to sign in
            </button>
          </form>
        )}

        {demoMode && (
          <div className="mt-5 rounded-xl p-3 text-[13px] text-bank-mu" style={SURFACE.well}>
            <p className="font-semibold text-bank-tx mb-1">Demo credentials</p>
            <p>keaton@turftime.com (VP) · garrison@turftime.com (Director)</p>
            <p>jared@turftime.com (Manager) · stephen@turftime.com (Rep)</p>
            <p>admin@turftime.com (Admin)</p>
            <p className="mt-1 text-bank-fa">Password: TurfTime2026!</p>
          </div>
        )}
      </div>

      <p className="relative text-[13px] text-bank-fa mt-6 text-center">
        Access is invite-only — new here? Your invite email has your link.
      </p>
    </div>
  )
}
