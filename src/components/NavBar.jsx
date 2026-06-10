import { useState, useRef, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { LogOut, ChevronDown, Eye, ChevronRight, KeyRound, Check, Glasses, Bell } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import Logo from './Logo'
import { fetchUsers, fetchNotifications, markNotificationsRead } from '../lib/db'

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

// Bell: in-app notifications (new deal-note replies, etc). Polls every 60s
// and on tab focus; clicking an item jumps to that deal's thread on the Deals
// page. Opening the panel marks everything read.
function NotificationBell() {
  const { realProfile } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [open, setOpen]   = useState(false)
  const ref = useRef(null)

  const load = () => {
    if (!realProfile?.id) return
    fetchNotifications(realProfile.id).then(({ data }) => setItems(data || []))
  }
  useEffect(() => {
    load()
    const t = setInterval(load, 60000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus) }
  }, [realProfile?.id])

  useEffect(() => {
    if (!open) return
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const unread = items.filter(n => !n.read).length

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && unread > 0) {
      markNotificationsRead(realProfile.id)
      setTimeout(() => setItems(xs => xs.map(n => ({ ...n, read: true }))), 1200)
    }
  }

  const fmtWhen = (iso) => {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
    if (mins < 1) return 'now'
    if (mins < 60) return `${mins}m`
    if (mins < 48 * 60) return `${Math.floor(mins / 60)}h`
    return `${Math.floor(mins / 1440)}d`
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle} title="Notifications"
        className="relative p-2 rounded-lg text-white/45 hover:text-white hover:bg-white/5 transition-colors">
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold text-dark flex items-center justify-center"
            style={{ background: '#f59e0b' }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute top-10 right-0 w-72 rounded-xl shadow-2xl py-1.5 z-50 max-h-[360px] overflow-y-auto"
          style={{ background: '#2a2a2a', border: '1px solid #3a3a3a' }}>
          <p className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/30">Notifications</p>
          {items.length === 0 ? (
            <p className="px-4 py-4 text-[12px] text-white/30">Nothing yet — you'll see deal-note replies here.</p>
          ) : items.map(n => (
            <button key={n.id}
              onClick={() => { setOpen(false); if (n.deal_id) navigate(`/deals?note=${n.deal_id}`) }}
              className="w-full text-left px-4 py-2.5 hover:bg-white/5 transition-colors border-t border-white/5">
              <p className={`text-[12px] ${n.read ? 'text-white/55' : 'text-white/90 font-semibold'}`}>{n.body}</p>
              <p className="text-[10px] text-white/25 mt-0.5">{fmtWhen(n.created_at)} ago · tap to open the thread</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function NavBar() {
  const { pathname } = useLocation()
  const { realProfile, profile: effProfile, signOut, isPreviewMode, previewAs, clearPreview, changePassword, demoMode } = useAuth()
  const { siteName } = useSettings()
  useEffect(() => { document.title = siteName }, [siteName])
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

  // Site-admin = the admin title OR the is_admin flag — judged on the REAL
  // profile so the menu stays usable while a preview is active.
  const isAdmin = profile?.role === 'admin' || profile?.is_admin === true

  // Role preview: stay yourself, but clamp permissions to rep/manager level —
  // for screen-sharing without exposing overrides/payroll/admin.
  const roleView = isPreviewMode && effProfile?.id === realProfile?.id ? effProfile?.role : null
  function toggleRoleView(role) {
    if (roleView === role) clearPreview()
    else previewAs({ ...realProfile, role, is_admin: false })
    setOpen(false)
  }

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
        <Logo size={28} />
        <span className="font-bold text-white text-[13px] tracking-tight">{siteName}</span>
      </div>

      {/* Page title */}
      <h1 className="flex-1 text-center text-[14px] font-semibold text-white/80">
        {TITLES[pathname] ?? 'Turf Time'}
      </h1>

      {/* User menu — always shows real (admin) profile info */}
      <div className="w-48 flex items-center justify-end gap-1" ref={ref}>
        <NotificationBell />
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

            {/* View site as role — admin only. Permission preview for screen
                sharing: you stay you, overrides/payroll/admin disappear. */}
            {isAdmin && (
              <div className="border-b border-white/5 pb-1 mb-1">
                <p className="px-4 pt-1 pb-0.5 text-[9px] font-bold uppercase tracking-widest text-white/30">View site as</p>
                {[['rep', 'Rep view'], ['manager', 'Manager view']].map(([role, label]) => (
                  <button key={role}
                    onClick={() => toggleRoleView(role)}
                    className="w-full flex items-center justify-between gap-2 px-4 py-2 text-[13px] text-white/60 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <Glasses size={14} />
                      {label}
                    </span>
                    {roleView === role && <Check size={13} className="text-amber-400" />}
                  </button>
                ))}
              </div>
            )}

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
