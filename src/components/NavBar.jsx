import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { LogOut, ChevronDown, Eye, ChevronRight, KeyRound, Check } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchUsers } from '../lib/db'

const TITLES = {
  '/deals':       'Deals Pipeline',
  '/dashboard':   'Dashboard',
  '/commissions': 'Commissions',
  '/team':        'Team',
  '/admin':       'Admin Panel',
}

const ROLE_ORDER = ['vp', 'director', 'manager', 'rep', 'admin']
const ROLE_COLOR = {
  vp:       '#a78bfa',
  director: '#fb923c',
  manager:  '#fbbf24',
  rep:      '#60a5fa',
  admin:    '#00b894',
}

export default function NavBar() {
  const { pathname } = useLocation()
  const { realProfile, signOut, isPreviewMode, previewAs, changePassword, demoMode } = useAuth()
  const [open,        setOpen]        = useState(false)
  const [showPicker,  setShowPicker]  = useState(false)
  const [users,       setUsers]       = useState([])
  const [pwOpen,      setPwOpen]      = useState(false)
  const [pw,          setPw]          = useState('')
  const [pw2,         setPw2]         = useState('')
  const [pwMsg,       setPwMsg]       = useState(null)   // {type, text}
  const [pwSaving,    setPwSaving]    = useState(false)
  const ref = useRef(null)

  async function submitPassword() {
    if (pw.length < 8)  return setPwMsg({ type: 'err', text: 'At least 8 characters.' })
    if (pw !== pw2)     return setPwMsg({ type: 'err', text: 'Passwords don\u2019t match.' })
    setPwSaving(true); setPwMsg(null)
    const { error } = await changePassword(pw)
    setPwSaving(false)
    if (error) return setPwMsg({ type: 'err', text: error.message })
    setPwMsg({ type: 'ok', text: 'Password updated.' })
    setPw(''); setPw2('')
    setTimeout(() => { setPwOpen(false); setPwMsg(null) }, 1400)
  }

  useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false)
        setShowPicker(false)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const profile  = realProfile
  const initials = profile?.name
    ?.split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'

  const isAdmin = profile?.role === 'admin'

  async function handlePreviewClick() {
    if (!users.length) {
      const { data } = await fetchUsers()
      // Exclude the admin themselves
      setUsers((data ?? []).filter(u => u.id !== profile?.id))
    }
    setShowPicker(v => !v)
  }

  function handleSelectUser(user) {
    previewAs(user)
    setOpen(false)
    setShowPicker(false)
  }

  // Group users by role for display
  const grouped = ROLE_ORDER.reduce((acc, r) => {
    const group = users.filter(u => u.role === r)
    if (group.length) acc.push({ role: r, members: group })
    return acc
  }, [])

  return (
    <nav
      className="h-14 flex items-center px-5 flex-shrink-0 z-50 relative"
      style={{ background: '#1e1e1e', borderBottom: '1px solid #2a2a2a' }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 w-48 flex-shrink-0">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shadow-lg"
          style={{ background: '#0f1a0f', border: '1px solid #2a4a2a' }}>
          <svg viewBox="0 0 20 20" fill="none" width="16" height="16">
            {/* Left blade */}
            <path d="M10 18 C10 14 7 9 8 3 C8.5 1.5 10 2 10.5 3.5 C10 8 10 13 10 18Z" fill="#4ade80"/>
            {/* Right blade */}
            <path d="M10 18 C10 14 13 9 12.5 4 C12 2 10.5 2 10.5 3.5 C11 8 10.5 13 10 18Z" fill="#22c55e"/>
          </svg>
        </div>
        <span className="font-bold text-white text-[13px] tracking-tight">Turf Time Dashboard</span>
      </div>

      {/* Page title */}
      <h1 className="flex-1 text-center text-[14px] font-semibold text-white/80">
        {TITLES[pathname] ?? 'Turf Time'}
      </h1>

      {/* User menu — always shows real (admin) profile info */}
      <div className="w-48 flex justify-end" ref={ref}>
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-2.5 text-white/70 hover:text-white transition-colors"
        >
          <div className="text-right hidden sm:block">
            <p className="text-[12px] font-semibold text-white leading-tight">
              {profile?.name ?? '—'}
            </p>
            <p className="text-[10px] text-white/40 leading-tight">
              {profile?.company_name ?? ''}
            </p>
          </div>
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
            style={{
              background: isPreviewMode ? '#f59e0b22' : '#00b89420',
              border: `1px solid ${isPreviewMode ? '#f59e0b60' : '#00b89430'}`,
              color: isPreviewMode ? '#f59e0b' : '#00b894',
            }}
          >
            {initials}
          </div>
          <ChevronDown size={13} className={`text-white/40 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div
            className="absolute top-14 right-4 w-56 rounded-xl shadow-2xl py-1.5 z-50"
            style={{ background: '#2a2a2a', border: '1px solid #3a3a3a' }}
          >
            {/* Profile info */}
            <div className="px-4 py-2 border-b border-white/5 mb-1">
              <p className="text-[12px] font-semibold text-white">{profile?.name}</p>
              <p className="text-[11px] text-white/40">{profile?.email}</p>
              <span
                className="mt-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider"
                style={{ background: '#00b89420', color: '#00b894' }}
              >
                {profile?.role}
              </span>
            </div>

            {/* Preview as User — admin only */}
            {isAdmin && (
              <div className="border-b border-white/5 pb-1 mb-1">
                <button
                  onClick={handlePreviewClick}
                  className="w-full flex items-center justify-between gap-2 px-4 py-2 text-[13px] text-white/60 hover:text-white hover:bg-white/5 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <Eye size={14} />
                    Preview as User
                  </span>
                  <ChevronRight
                    size={12}
                    className={`text-white/30 transition-transform ${showPicker ? 'rotate-90' : ''}`}
                  />
                </button>

                {showPicker && (
                  <div
                    className="mx-2 mb-1 rounded-lg overflow-hidden"
                    style={{ background: '#222', border: '1px solid #333', maxHeight: 260, overflowY: 'auto' }}
                  >
                    {grouped.map(({ role, members }) => (
                      <div key={role}>
                        <p
                          className="px-3 pt-2 pb-0.5 text-[9px] font-bold uppercase tracking-widest"
                          style={{ color: ROLE_COLOR[role] ?? '#888' }}
                        >
                          {role}
                        </p>
                        {members.map(u => (
                          <button
                            key={u.id}
                            onClick={() => handleSelectUser(u)}
                            className="w-full text-left px-3 py-1.5 text-[12px] text-white/70 hover:text-white hover:bg-white/5 transition-colors flex items-center justify-between"
                          >
                            <span>{u.name}</span>
                            <span
                              className="text-[9px] font-semibold px-1 py-0.5 rounded"
                              style={{ background: (ROLE_COLOR[role] ?? '#888') + '22', color: ROLE_COLOR[role] ?? '#888' }}
                            >
                              {u.role}
                            </span>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Change password */}
            {!demoMode && (
              <div className="border-t border-white/5">
                <button
                  onClick={() => { setPwOpen(o => !o); setPwMsg(null) }}
                  className="w-full flex items-center justify-between px-4 py-2 text-[13px] text-white/60 hover:text-white hover:bg-white/5 transition-colors"
                >
                  <span className="flex items-center gap-2.5"><KeyRound size={14} /> Change Password</span>
                  <ChevronRight size={12} className={`text-white/30 transition-transform ${pwOpen ? 'rotate-90' : ''}`} />
                </button>
                {pwOpen && (
                  <div className="px-4 pb-3 pt-1 space-y-2">
                    <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="New password"
                      className="w-full px-2.5 py-1.5 rounded-lg text-[12px] text-white focus:outline-none"
                      style={{ background: '#1a1a1a', border: '1px solid #333' }} />
                    <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="Confirm new password"
                      onKeyDown={e => { if (e.key === 'Enter') submitPassword() }}
                      className="w-full px-2.5 py-1.5 rounded-lg text-[12px] text-white focus:outline-none"
                      style={{ background: '#1a1a1a', border: '1px solid #333' }} />
                    {pwMsg && (
                      <p className="text-[11px] flex items-center gap-1" style={{ color: pwMsg.type === 'ok' ? '#34d399' : '#f87171' }}>
                        {pwMsg.type === 'ok' && <Check size={12} />}{pwMsg.text}
                      </p>
                    )}
                    <button onClick={submitPassword} disabled={pwSaving}
                      className="w-full py-1.5 rounded-lg text-[12px] font-bold text-dark bg-teal disabled:opacity-50 transition-colors">
                      {pwSaving ? 'Saving…' : 'Update password'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Sign out */}
            <button
              onClick={() => { signOut(); setOpen(false) }}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-[13px] text-white/60 hover:text-white hover:bg-white/5 transition-colors border-t border-white/5"
            >
              <LogOut size={14} />
              Sign Out
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}
