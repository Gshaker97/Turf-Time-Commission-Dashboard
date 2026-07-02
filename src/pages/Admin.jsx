import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, RefreshCw, Activity, KeyRound, UserPlus, Search, ShieldCheck } from 'lucide-react'
import {
  fetchUsers, insertUser, updateUser, deleteUser,
  userAdmin, userAdminConfigured, fetchTeamChanges,
} from '../lib/db'
import UserModal from '../components/UserModal'
import { headIdSet } from '../utils/team'
import SettingsPanel from '../components/SettingsPanel'
import { useSettings } from '../contexts/SettingsContext'
import { DEMO_MODE } from '../lib/supabase'

const TABS = ['Users', 'Settings']

const ROLE_COLOR = {
  vp: 'text-purple-400', director: 'text-indigo-400',
  manager: 'text-amber-400', rep: 'text-white/50', admin: 'text-teal',
}

// ── System health — heartbeats written by the Apps Scripts into app_settings.
// Catches the two silent failure modes that have actually happened: the sync
// stuck in DRY_RUN (preview) after a re-paste, and the sync/backup not running
// at all.
const agoText = (iso) => {
  if (!iso) return null
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 48) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function HealthRow({ label, ok, color, text }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
      <span className="text-[12px] text-white/60 w-[110px] flex-shrink-0">{label}</span>
      <span className="text-[12px] font-semibold" style={{ color: ok ? 'rgba(255,255,255,0.85)' : color }}>{text}</span>
    </div>
  )
}

function SystemHealth() {
  const { settings, refresh } = useSettings()
  const [, setTick] = useState(0)
  useEffect(() => {
    refresh()
    const t = setInterval(() => { refresh(); setTick(x => x + 1) }, 60000)
    return () => clearInterval(t)
  }, [])

  const hb = settings?.sync_heartbeat
  const bk = settings?.backup_heartbeat
  const wd = settings?.watchdog_heartbeat

  let sync
  if (!hb?.at) sync = { ok: false, color: '#6b7280', text: 'no heartbeat yet — paste the latest ScheduleSync.gs' }
  else {
    const mins = (Date.now() - new Date(hb.at).getTime()) / 60000
    if (hb.dry_run)      sync = { ok: false, color: '#f59e0b', text: `PREVIEW MODE — running but writing nothing (SCH_DRY_RUN=true) · ${agoText(hb.at)}` }
    else if (mins > 10)  sync = { ok: false, color: '#ef4444', text: `stalled — last ran ${agoText(hb.at)}` }
    else if (hb.errors > 0) sync = { ok: false, color: '#f59e0b', text: `ran ${agoText(hb.at)} with ${hb.errors} error${hb.errors === 1 ? '' : 's'} — check the Apps Script execution log` }
    else sync = { ok: true, color: '#00b894', text: `ran ${agoText(hb.at)}` }
  }

  let backup
  if (!bk?.at) backup = { ok: false, color: '#6b7280', text: 'no heartbeat yet — runs after the next nightly backup' }
  else {
    const hrs = (Date.now() - new Date(bk.at).getTime()) / 3600000
    if (hrs > 26)           backup = { ok: false, color: '#ef4444', text: `overdue — last backup ${agoText(bk.at)}` }
    else if (bk.errors > 0) backup = { ok: false, color: '#f59e0b', text: `ran ${agoText(bk.at)} with ${bk.errors} table error${bk.errors === 1 ? '' : 's'}` }
    else backup = { ok: true, color: '#00b894', text: `ran ${agoText(bk.at)}` }
  }

  return (
    <div className="rounded-xl px-4 py-2.5" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
      <div className="flex items-center gap-2 mb-1">
        <Activity size={13} className="text-teal" />
        <span className="text-[10px] uppercase tracking-wider text-white/30 font-semibold">System health</span>
      </div>
      <HealthRow label="Scheduler sync" {...sync} />
      <HealthRow label="Nightly backup" {...backup} />
      {(() => {
        let dog
        if (!wd?.at) dog = { ok: false, color: '#6b7280', text: 'not running yet — set up Watchdog.gs' }
        else {
          const hrs = (Date.now() - new Date(wd.at).getTime()) / 3600000
          const n = wd.issues?.length || 0
          if (hrs > 2)       dog = { ok: false, color: '#ef4444', text: `stalled — last ran ${agoText(wd.at)}` }
          else if (n > 0)    dog = { ok: false, color: wd.issues.some(i => i.startsWith('[CRIT]')) ? '#ef4444' : '#f59e0b', text: `${n} issue${n === 1 ? '' : 's'} found · ${agoText(wd.at)}` }
          else               dog = { ok: true, color: '#00b894', text: `all clear · ${agoText(wd.at)}` }
        }
        return (
          <>
            <HealthRow label="Watchdog" {...dog} />
            {wd?.issues?.length > 0 && (
              <div className="ml-[126px] -mt-0.5 pb-1 space-y-0.5">
                {wd.issues.map((t, i) => (
                  <p key={i} className="text-[11px]" style={{ color: t.startsWith('[CRIT]') ? '#f87171' : '#fbbf24' }}>{t}</p>
                ))}
              </div>
            )}
          </>
        )
      })()}
    </div>
  )
}

export default function Admin() {
  const [tab,      setTab]      = useState('Users')
  const [users,    setUsers]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [userModal, setUserModal] = useState(false)
  const [editUser,  setEditUser]  = useState(null)

  useEffect(() => { loadAll() }, [])

  const [teamChanges, setTeamChanges] = useState([])

  async function loadAll() {
    setLoading(true)
    const [{ data: u }, { data: tc }] = await Promise.all([fetchUsers(), fetchTeamChanges()])
    setUsers(u ?? [])
    setTeamChanges(tc ?? [])
    setLoading(false)
  }

  async function saveUser(data) {
    if (editUser) {
      await updateUser(editUser.id, data)
    } else {
      const { error } = await insertUser(data)
      if (error) { alert('Could not create profile: ' + error.message); return }
      if (!DEMO_MODE) {
        alert(
          'Profile created.\n\nTo enable their login, go to Supabase Studio → Authentication → Users → Add user, ' +
          'using the SAME email. The auto-link trigger connects the new auth user to this profile.'
        )
      }
    }
    setUserModal(false); setEditUser(null); loadAll()
  }

  async function handleDeleteUser(id) {
    if (!confirm('Delete this user?')) return
    await deleteUser(id); loadAll()
  }

  // Optimistic single-field update for inline editing in the Users table.
  async function patchUser(id, patch) {
    setUsers(us => us.map(x => x.id === id ? { ...x, ...patch } : x))
    const res = await updateUser(id, patch)
    if (res?.error) { alert('Could not update: ' + (res.error.message || '')); loadAll() }
  }

  const [busyUser, setBusyUser] = useState('')   // user id mid-action
  const hasUserAdmin = userAdminConfigured()

  // Create the Supabase login for a roster member (no more Studio).
  async function createLogin(u) {
    if (!confirm(`Create a login for ${u.name} (${u.email})? They'll get a temporary password to change on first sign-in.`)) return
    setBusyUser(u.id)
    const r = await userAdmin('create_login', { email: u.email })
    setBusyUser('')
    if (!r.ok) return alert('Could not create login: ' + (r.error || 'unknown error'))
    loadAll()
    window.prompt(`Login created for ${u.name}. Copy their temporary password and share it securely:`, r.password || '')
  }

  // Set a new temporary password for a user.
  async function resetLogin(u) {
    if (!confirm(`Reset ${u.name}'s password to a new temporary one?`)) return
    setBusyUser(u.id)
    const r = await userAdmin('reset_password', { email: u.email })
    setBusyUser('')
    if (!r.ok) return alert('Could not reset password: ' + (r.error || 'unknown error'))
    window.prompt(`New temporary password for ${u.name} — copy and share securely:`, r.password || '')
  }

  // Activate / deactivate: flips profiles.active (blocks site access while all
  // their deals & stats stay intact), and disables the login at the auth layer
  // when the endpoint is configured.
  async function toggleActive(u) {
    const next = u.active === false   // becoming active?
    if (!next && !confirm(`Deactivate ${u.name}? They lose access to the site immediately. All their deals and stats stay exactly as they are.`)) return
    patchUser(u.id, { active: next })
    if (hasUserAdmin && u.auth_id) {
      const r = await userAdmin('set_active', { email: u.email, active: next })
      if (!r.ok) alert('Profile updated, but the login toggle failed: ' + (r.error || '') + '\nThey may still be able to sign in until fixed.')
    }
  }

  const btnCls = (active) =>
    `px-3 py-1.5 rounded-lg text-[12px] md:text-[13px] font-medium transition-colors ${
      active ? 'bg-teal/15 text-teal border border-teal/25' : 'text-white/40 hover:text-white hover:bg-white/5 border border-transparent'
    }`

  const card  = { background: '#242424', border: '1px solid #2e2e2e' }
  const [search, setSearch] = useState('')
  const [showLog, setShowLog] = useState(false)

  // ── Roster grouping: leadership → each team (under its lead) → unassigned.
  // A "team lead" is anyone people report to (manager_id) — manager, director,
  // or VP alike — plus every manager (even with no reps yet).
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '')
  const q = search.trim().toLowerCase()
  const match = (u) => !q || (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)
  const reportsTo = {}
  users.forEach(u => { if (u.manager_id) (reportsTo[u.manager_id] ||= []).push(u) })
  // Shared head rule (utils/team.js): direct reports make a team; a manager
  // who reports to another lead with no directs of their own is a MEMBER (so
  // an absorbed team's lead files under the absorbing team, not their own).
  const heads = headIdSet(users)
  const teams = users.filter(u => heads.has(u.id)).sort(byName).map(h => ({
    head: h,
    members: (reportsTo[h.id] || []).filter(u => !heads.has(u.id)).sort(byName),
  }))
  const grouped = new Set(teams.flatMap(t => [t.head.id, ...t.members.map(m => m.id)]))
  const restUsers  = users.filter(u => !grouped.has(u.id))
  const ROLE_RANK = { admin: 0, vp: 1, director: 2, manager: 3, rep: 4 }
  const leadership = restUsers.filter(u => u.role !== 'rep').sort((a, b) => (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9) || byName(a, b))
  const unassigned = restUsers.filter(u => u.role === 'rep').sort(byName)

  // Latest team change per person → the 'since <date>' stamp on their row.
  const sinceByProfile = {}
  for (const c of teamChanges) if (!sinceByProfile[c.profile_id]) sinceByProfile[c.profile_id] = c.changed_at
  const fmtSince = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  // One row per person — badges are display-only; edits go through the modal.
  function UserRow({ u, subtitle }) {
    const boss = users.find(x => x.id === u.manager_id)
    const initials = (u.name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
    return (
      <div className="px-3 md:px-4 py-2.5 flex items-center gap-3 hover:bg-white/[0.02] transition-colors"
        style={{ opacity: u.active === false ? 0.5 : 1 }}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
          style={{ background: '#1a1a1a', border: '1px solid #333', color: '#00b894' }}>
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-white truncate">{u.name}</span>
            <span className={`text-[9px] font-bold uppercase tracking-wide ${ROLE_COLOR[u.role] || 'text-white/40'}`}>{u.role}</span>
            {u.is_admin && u.role !== 'admin' && (
              <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full" style={{ color: '#00b894', border: '1px solid #00b89455' }}>
                <ShieldCheck size={9} /> admin
              </span>
            )}
            {u.ghost && <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full" style={{ color: '#a78bfa', border: '1px solid #a78bfa55' }}>ghost</span>}
            {u.active === false && <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full" style={{ color: '#f87171', border: '1px solid #f8717155' }}>deactivated</span>}
          </div>
          <p className="text-[11px] text-white/35 truncate mt-0.5">
            {u.email}
            {subtitle !== false && boss && <span className="text-white/25"> · reports to {boss.name}</span>}
            {subtitle !== false && boss && sinceByProfile[u.id] && <span className="text-white/20"> · since {fmtSince(sinceByProfile[u.id])}</span>}
          </p>
        </div>
        <div className="flex items-center gap-1 md:gap-1.5 flex-shrink-0">
          {u.auth_id ? (
            hasUserAdmin && (
              <button onClick={() => resetLogin(u)} disabled={busyUser === u.id} title="Reset their password"
                className="p-1.5 rounded-lg text-white/25 hover:text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-40">
                <KeyRound size={14} />
              </button>
            )
          ) : hasUserAdmin ? (
            <button onClick={() => createLogin(u)} disabled={busyUser === u.id} title="No login yet — create one"
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold text-teal transition-colors disabled:opacity-40"
              style={{ border: '1px solid #00b89440' }}>
              <UserPlus size={11} /> {busyUser === u.id ? '…' : 'login'}
            </button>
          ) : (
            <span className="text-[10px] text-white/20 hidden md:inline" title="No auth login — set VITE_USER_ADMIN_URL or use Studio">no login</span>
          )}
          <button onClick={() => toggleActive(u)} title={u.active === false ? 'Deactivated — click to reactivate' : 'Active — click to deactivate'}
            className="w-9 h-5 rounded-full flex items-center px-0.5 transition-colors flex-shrink-0"
            style={{ background: u.active === false ? '#3a3a3a' : '#00b894', justifyContent: u.active === false ? 'flex-start' : 'flex-end' }}>
            <span className="w-4 h-4 rounded-full bg-white block" />
          </button>
          <button onClick={() => { setEditUser(u); setUserModal(true) }} title="Edit"
            className="p-1.5 rounded-lg text-white/25 hover:text-teal hover:bg-teal/10 transition-colors">
            <Pencil size={14} />
          </button>
          <button onClick={() => handleDeleteUser(u.id)} title="Delete"
            className="p-1.5 rounded-lg text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    )
  }

  function Section({ title, sub, children, count }) {
    return (
      <div className="rounded-xl overflow-hidden" style={card}>
        <div className="px-3 md:px-4 py-2.5 flex items-center justify-between gap-3" style={{ background: '#1e1e1e', borderBottom: '1px solid #2a2a2a' }}>
          <div className="flex items-baseline gap-2 min-w-0">
            <h3 className="text-[12px] font-bold text-white truncate">{title}</h3>
            {sub && <span className="text-[10px] text-white/30 truncate">{sub}</span>}
          </div>
          <span className="text-[10px] text-white/30 flex-shrink-0">{count} {count === 1 ? 'person' : 'people'}</span>
        </div>
        <div className="divide-y divide-white/5">{children}</div>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-8">

      <SystemHealth />

      {/* Tab bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {TABS.map(t => <button key={t} onClick={() => setTab(t)} className={btnCls(tab === t)}>{t}</button>)}
        <button onClick={loadAll} className="ml-auto p-2 rounded-lg text-white/30 hover:text-white hover:bg-white/5 transition-colors">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ── USERS ── */}
      {tab === 'Users' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or email…"
                className="w-full pl-9 pr-3 py-2 rounded-xl text-[13px] text-white placeholder-white/25 focus:outline-none focus:border-teal/40 transition-colors"
                style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }} />
            </div>
            <p className="text-[12px] text-white/40">{users.length} users</p>
            <button onClick={() => { setEditUser(null); setUserModal(true) }}
              className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-bold text-dark bg-teal transition-colors">
              <Plus size={13} /> Add User
            </button>
          </div>

          {leadership.filter(match).length > 0 && (
            <Section title="Leadership & Admin" count={leadership.filter(match).length}>
              {leadership.filter(match).map(u => <UserRow key={u.id} u={u} />)}
            </Section>
          )}

          {teams.map(({ head, members }) => {
            const shown = [head, ...members].filter(match)
            if (!shown.length) return null
            return (
              <Section key={head.id}
                title={`${head.name}'s Team`}
                sub={head.role !== 'manager' ? `led by their ${head.role}` : null}
                count={shown.length}>
                {shown.map(u => <UserRow key={u.id} u={u} subtitle={u.id !== head.id ? false : undefined} />)}
              </Section>
            )
          })}

          {unassigned.filter(match).length > 0 && (
            <Section title="Unassigned reps" sub="no team lead set — assign one in Edit → Reports To" count={unassigned.filter(match).length}>
              {unassigned.filter(match).map(u => <UserRow key={u.id} u={u} />)}
            </Section>
          )}

          {/* Date-stamped log of reports-to moves (trigger-written, migration 029) */}
          {teamChanges.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={card}>
              <button onClick={() => setShowLog(v => !v)}
                className="w-full px-3 md:px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors"
                style={{ background: '#1e1e1e' }}>
                <span className="text-[12px] font-bold text-white">Team change log</span>
                <span className="text-[10px] text-white/30">{teamChanges.length} change{teamChanges.length === 1 ? '' : 's'} · {showLog ? 'hide' : 'show'}</span>
              </button>
              {showLog && (
                <div className="divide-y divide-white/5">
                  {teamChanges.map(c => {
                    const who  = users.find(x => x.id === c.profile_id)?.name || '—'
                    const from = c.old_manager_id ? (users.find(x => x.id === c.old_manager_id)?.name || '—') : 'Unassigned'
                    const to   = c.new_manager_id ? (users.find(x => x.id === c.new_manager_id)?.name || '—') : 'Unassigned'
                    const by   = c.changed_by ? users.find(x => x.id === c.changed_by)?.name : null
                    return (
                      <div key={c.id} className="px-3 md:px-4 py-2 flex items-center gap-3 flex-wrap">
                        <span className="text-[11px] text-white/30 w-[104px] flex-shrink-0">{fmtSince(c.changed_at)}</span>
                        <span className="text-[12px] text-white/75 min-w-0">
                          <span className="font-semibold text-white">{who}</span>
                          <span className="text-white/40"> — {from} → {to}</span>
                          {by && <span className="text-white/25"> · by {by}</span>}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── SETTINGS ── */}
      {tab === 'Settings' && <SettingsPanel />}

      {userModal && <UserModal user={editUser} allUsers={users} onSave={saveUser} onClose={() => { setUserModal(false); setEditUser(null) }} />}
    </div>
  )
}
