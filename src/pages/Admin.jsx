import { useState, useEffect } from 'react'
import { RefreshCw, Activity } from 'lucide-react'
import {
  fetchUsers, insertUser, updateUser, deleteUser,
  userAdmin, userAdminConfigured, fetchTeamChanges, fetchLeads,
} from '../lib/db'
import { toast } from '../lib/toast'
import UserModal from '../components/UserModal'
import PeopleChart from '../components/PeopleChart'
import { teamLabel } from '../utils/team'
import { leadFeedHealth } from '../utils/feedHealth'
import SettingsPanel from '../components/SettingsPanel'
import { useSettings } from '../contexts/SettingsContext'
import { DEMO_MODE } from '../lib/supabase'

const TABS = ['People', 'Settings']

// ── System health — heartbeats written by the Apps Scripts into app_settings.
// Catches the two silent failure modes that have actually happened: the sync
// stuck in DRY_RUN (preview) after a re-paste, and the sync not running at
// all. (DB backups are Railway volume snapshots now — not monitored here.)
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
  const wd = settings?.watchdog_heartbeat
  // Lead feed: push-based, so its health is 'when did we last hear from
  // it', not a cron heartbeat.
  const [leadRows, setLeadRows] = useState([])
  useEffect(() => { fetchLeads().then(({ data }) => setLeadRows(data || [])) }, [])
  const feed = leadFeedHealth(leadRows, settings?.lead_last_payload?.at)

  let sync
  const syncVer = hb?.version ? ` · v${hb.version}` : ''
  if (!hb?.at) sync = { ok: false, color: '#6b7280', text: 'no heartbeat yet — paste the latest ScheduleSync.gs' }
  else {
    const mins = (Date.now() - new Date(hb.at).getTime()) / 60000
    if (hb.dry_run)      sync = { ok: false, color: '#f59e0b', text: `PREVIEW MODE — running but writing nothing (SCH_DRY_RUN=true) · ${agoText(hb.at)}` }
    else if (mins > 10)  sync = { ok: false, color: '#ef4444', text: `stalled — last ran ${agoText(hb.at)}${syncVer}` }
    else if (hb.sheet_issue) sync = { ok: false, color: '#ef4444', text: `SHEET FORMAT PROBLEM · ran ${agoText(hb.at)}${syncVer}` }
    else if (hb.errors > 0) sync = { ok: false, color: '#f59e0b', text: `ran ${agoText(hb.at)} with ${hb.errors} error${hb.errors === 1 ? '' : 's'}${syncVer}` }
    else sync = { ok: true, color: '#00b894', text: `ran ${agoText(hb.at)}${syncVer}` }
  }
  // WHY the last run had problems (unmatched setters, failed writes, sheet
  // format issues) — surfaced here so bad imports are visible in the site,
  // not just the Apps Script execution log.
  const syncIssues = [hb?.sheet_issue, ...(Array.isArray(hb?.issues) ? hb.issues : [])].filter(Boolean).slice(0, 8)

  // (The nightly Drive backup was retired — database backups are Railway
  // volume snapshots now, managed and monitored in Railway itself.)

  return (
    <div className="rounded-xl px-4 py-2.5" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
      <div className="flex items-center gap-2 mb-1">
        <Activity size={13} className="text-teal" />
        <span className="text-[10px] uppercase tracking-wider text-white/30 font-semibold">System health</span>
      </div>
      <HealthRow label="Scheduler sync" {...sync} />
      <HealthRow label="Lead feed" ok={feed.level === 'ok'} color={feed.color}
        text={`${feed.text}${feed.lastAt ? ` · ${feed.last7} in 7 days` : ''}`} />
      {syncIssues.length > 0 && (
        <div className="ml-[126px] -mt-0.5 pb-1 space-y-0.5">
          {syncIssues.map((t, i) => (
            <p key={i} className="text-[11px] text-amber-400/90">{t}</p>
          ))}
        </div>
      )}
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
  const [tab,      setTab]      = useState('People')
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
      // Email = login. When the email changes, route it through the user-admin
      // endpoint, which updates the AUTH login first and mirrors the profile —
      // so whatever email is on the roster is always the email they sign in
      // with. Everything else saves normally.
      const { email: newEmail, ...rest } = data
      if (newEmail && newEmail !== editUser.email) {
        const r = await userAdmin('change_email', { email: editUser.email, newEmail })
        if (!r?.ok) {
          if (DEMO_MODE) await updateUser(editUser.id, { email: newEmail })
          else toast.error('Could not change the email (their login keeps the old one): ' + (r?.error || 'unknown error'))
        }
      }
      await updateUser(editUser.id, rest)
      // Cascade: if this person's team affiliation changed (new reports-to, or
      // no longer a manager) and people report to THEM, offer to bring those
      // reports along to the new lead — each move is date-stamped in the
      // team-change log. e.g. moving Colt under Danny moves Colt's reps too.
      const directs = users.filter(u => u.manager_id === editUser.id)
      const movedTeams   = (data.manager_id ?? null) !== (editUser.manager_id ?? null)
      const lostHeadship = editUser.role === 'manager' && data.role !== 'manager'
      if (directs.length && (movedTeams || lostHeadship)) {
        const destId = data.manager_id ?? null
        const destName = destId ? (users.find(u => u.id === destId)?.name || 'their new lead') : 'Unassigned'
        if (confirm(`${editUser.name} has ${directs.length} direct report${directs.length === 1 ? '' : 's'}. Move ${directs.length === 1 ? 'them' : 'them all'} to ${destName} too?\n\nOK = reports follow (each move is date-stamped) · Cancel = they keep reporting to ${editUser.name}.`)) {
          await Promise.all(directs.map(d => updateUser(d.id, { manager_id: destId })))
        }
      }
    } else {
      const { error } = await insertUser(data)
      if (error) { toast.error('Could not create profile: ' + error.message); return }
      if (!DEMO_MODE) {
        toast.info(
          'Profile created.\n\nTo give them a login, open Edit on their row and type a password in the ' +
          'Login Password field — their email becomes their sign-in.'
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
    if (res?.error) { toast.error('Could not update: ' + (res.error.message || '')); loadAll() }
  }

  const [busyUser, setBusyUser] = useState('')   // user id mid-action
  const hasUserAdmin = userAdminConfigured()

  // Create the Supabase login for a roster member. Preferred path: EMAIL them
  // an invite so they set their own password (needs SMTP on the auth service);
  // fallback: admin sets a temporary password by hand.
  async function createLogin(u) {
    const viaEmail = confirm(
      `Create ${u.name}'s login?\n\nOK — EMAIL AN INVITE to ${u.email} so they choose their own password (recommended).\nCancel — set a temporary password by hand instead.`)
    setBusyUser(u.id)
    if (viaEmail) {
      const r = await userAdmin('invite', { email: u.email })
      setBusyUser('')
      if (!r.ok) return toast.error('Invite failed: ' + (r.error || 'unknown error'))
      loadAll()
      toast.success(`Invite emailed to ${u.email} — they'll set their own password from the link.`)
      return
    }
    const r = await userAdmin('create_login', { email: u.email })
    setBusyUser('')
    if (!r.ok) return toast.error('Could not create login: ' + (r.error || 'unknown error'))
    loadAll()
    window.prompt(`Login created for ${u.name}. Copy their temporary password and share it securely:`, r.password || '')
  }

  // Reset a user's password. Preferred: email them a reset link; fallback:
  // set a new temporary password by hand.
  async function resetLogin(u) {
    const viaEmail = confirm(
      `Reset ${u.name}'s password?\n\nOK — EMAIL a reset link to ${u.email} so they choose a new password (recommended).\nCancel — set a temporary password by hand instead.`)
    setBusyUser(u.id)
    if (viaEmail) {
      const r = await userAdmin('send_reset', { email: u.email })
      setBusyUser('')
      if (!r.ok) return toast.error('Could not send the reset email: ' + (r.error || 'unknown error'))
      toast.success(`Password-reset email sent to ${u.email}.`)
      return
    }
    const r = await userAdmin('reset_password', { email: u.email })
    setBusyUser('')
    if (!r.ok) return toast.error('Could not reset password: ' + (r.error || 'unknown error'))
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
      if (!r.ok) toast.error('Profile updated, but the login toggle failed: ' + (r.error || '') + '\nThey may still be able to sign in until fixed.')
    }
  }

  const btnCls = (active) =>
    `px-3 py-1.5 rounded-lg text-[12px] md:text-[13px] font-medium transition-colors ${
      active ? 'bg-teal/15 text-teal border border-teal/25' : 'text-white/40 hover:text-white hover:bg-white/5 border border-transparent'
    }`

  const card  = { background: '#242424', border: '1px solid #2e2e2e' }
  const [showLog, setShowLog] = useState(false)
  const fmtSince = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  // Drag-to-move from the People chart. Only non-heads are draggable (the
  // chart enforces it), so no reports cascade is needed here — that stays in
  // saveUser for the Edit form. Same patchUser → updateUser path as every
  // other roster write, so the team_changes trigger stamps the move.
  async function moveUser(u, destId) {
    const destLabel = destId ? teamLabel(users.find(x => x.id === destId)) : 'Unassigned'
    const fromLabel = u.manager_id ? teamLabel(users.find(x => x.id === u.manager_id)) : 'Unassigned'
    if (!confirm(`Move ${u.name} to ${destLabel}?\n\nLogged today in the team change log. ${u.name}'s past deals stay with ${fromLabel} — only sales from today forward count for ${destLabel}.`)) return
    await patchUser(u.id, { manager_id: destId })
    // Refresh just the log so the "since" date on their card updates.
    const { data: tc } = await fetchTeamChanges()
    setTeamChanges(tc ?? [])
  }

  // Official team name — lives on the head's profile (migration 046) so every
  // page that loads users labels the team the same way via teamLabel().
  function renameTeam(head, name) { patchUser(head.id, { team_name: name }) }

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

      {/* ── PEOPLE — the roster as an org chart ── */}
      {tab === 'People' && (
        <div className="space-y-3">
          <PeopleChart
            users={users} teamChanges={teamChanges}
            hasUserAdmin={hasUserAdmin} busyUser={busyUser}
            onAdd={() => { setEditUser(null); setUserModal(true) }}
            onEdit={u => { setEditUser(u); setUserModal(true) }}
            onDelete={handleDeleteUser}
            onToggleActive={toggleActive}
            onResetLogin={resetLogin}
            onCreateLogin={createLogin}
            onMove={moveUser}
            onRenameTeam={renameTeam}
          />

          {/* Date-stamped log of reports-to moves (trigger-written, migration 029) */}
          {teamChanges.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={card}>
              <button onClick={() => setShowLog(v => !v)}
                className="w-full px-3 md:px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors"
                style={{ background: '#1e1e1e' }}>
                <span className="text-[12px] font-bold text-white">Team change log</span>
                <span className="text-[10px] text-white/25 hidden md:inline">sales &amp; overrides attribute to teams by these dates</span>
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

      {userModal && <UserModal user={editUser} allUsers={users} teamChanges={teamChanges} onSave={saveUser} onClose={() => { setUserModal(false); setEditUser(null) }} />}
    </div>
  )
}
