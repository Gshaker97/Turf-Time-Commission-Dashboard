import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const { signIn, demoMode, deactivated } = useAuth()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd]   = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: err } = await signIn(email, password)
    if (err) setError(err.message)
    setLoading(false)
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: '#1a1a1a' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-8 shadow-2xl"
        style={{ background: '#242424', border: '1px solid #333' }}
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-teal/30"
            style={{ background: '#0f1a0f', border: '1px solid #2a4a2a' }}>
            <svg viewBox="0 0 20 20" fill="none" width="26" height="26">
              <path d="M10 18 C10 14 7 9 8 3 C8.5 1.5 10 2 10.5 3.5 C10 8 10 13 10 18Z" fill="#4ade80"/>
              <path d="M10 18 C10 14 13 9 12.5 4 C12 2 10.5 2 10.5 3.5 C11 8 10.5 13 10 18Z" fill="#22c55e"/>
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white">Turf Time Dashboard</h1>
          <p className="text-[12px] text-white/30 mt-1 text-center">
            Sales Pipeline &amp; Commission Tracker
          </p>
        </div>

        {(error || deactivated) && (
          <div
            className="rounded-xl px-4 py-3 mb-5 text-[13px] text-red-400"
            style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}
          >
            {deactivated ? 'This account has been deactivated. Contact an administrator.' : error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1.5">
              Email
            </label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              style={{ background: '#1a1a1a', border: '1px solid #3a3a3a' }}
              className="w-full px-4 py-3 rounded-xl text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-teal/50 transition-colors"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1.5">
              Password
            </label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{ background: '#1a1a1a', border: '1px solid #3a3a3a' }}
                className="w-full px-4 py-3 rounded-xl text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-teal/50 transition-colors pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
              >
                {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl text-[13px] font-bold text-dark bg-teal hover:bg-teal-dark disabled:opacity-50 transition-colors mt-2"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="text-[11px] text-white/20 text-center mt-6">
          Contact your admin to create an account.
        </p>

        {demoMode && (
          <div
            className="mt-4 rounded-lg p-3 text-[11px] text-white/30"
            style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}
          >
            <p className="font-semibold text-white/40 mb-1">Demo credentials</p>
            <p>keaton@turftime.com (VP) · garrison@turftime.com (Director)</p>
            <p>jared@turftime.com (Manager) · stephen@turftime.com (Rep)</p>
            <p>admin@turftime.com (Admin)</p>
            <p className="mt-1 text-teal/60">Password: TurfTime2026!</p>
          </div>
        )}
      </div>
    </div>
  )
}
