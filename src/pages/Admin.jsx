import { useState, useEffect, useMemo } from 'react'
import { RefreshCw, Activity, CalendarClock, X, Pencil, Undo2, Trash2, AlertTriangle } from 'lucide-react'
import {
  fetchUsers, insertUser, updateUser, deleteUser, fetchDeals,
  userAdmin, userAdminConfigured, fetchTeamChanges, fetchLeads,
  fetchPendingTeamMoves, moveTeamMembers, applyDueTeamMoves, cancelPendingTeamMove,
  setTeamChangeDate, deleteTeamChange,
} from '../lib/db'
import { toast } from '../lib/toast'
import { confirmDialog, choiceDialog, revealDialog } from '../lib/dialog'
import UserModal from '../components/UserModal'
import ManagerBackfillModal from '../components/ManagerBackfillModal'
import PeopleChart from '../components/PeopleChart'
import TeamMoveModal from '../components/TeamMoveModal'
import { useAuth } from '../contexts/AuthContext'
import { changeDay, localDay, teamLabel } from '../utils/team'
import { azToday, fmtDay, previewDateChange, teamKeyLabel } from '../utils/teamMove'
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

// One row of the team change log. The EFFECTIVE day is the headline, because
// that is the date attribution actually uses; `changed_at` is shown only when
// the two differ (a backdated or scheduled move), where it answers the
// separate question of when the record was made.
function LogRow({ c, users, teamChanges, editing, onStartEdit, onCancelEdit, onPickDate, onRemove }) {
  const nameOf = (id) => users.find(x => x.id === id)?.name
  const who  = nameOf(c.profile_id) || '—'
  const from = c.old_manager_id ? (nameOf(c.old_manager_id) || '—') : 'Unassigned'
  const to   = c.new_manager_id ? (nameOf(c.new_manager_id) || '—') : 'Unassigned'
  const by   = c.changed_by ? nameOf(c.changed_by) : null
  const eff  = changeDay(c)
  // The LOCAL day of changed_at, never its UTC slice — a move recorded at 6pm
  // Arizona is stored as the next day in UTC, and slicing it would print a
  // "recorded tomorrow" line under half the entries.
  const recorded = c.changed_at ? localDay(c.changed_at) : ''
  // Only the person's MOST RECENT entry can be undone: on an older one,
  // old_manager_id is not where they are now, so restoring it would move them
  // somewhere nobody asked for. The database enforces this too.
  const isLatest = teamChanges
    .filter(x => x.profile_id === c.profile_id)
    .every(x => changeDay(x) < eff || (changeDay(x) === eff && String(x.changed_at) <= String(c.changed_at)))

  return (
    <div className="group px-3 md:px-4 py-2 flex items-center gap-3 flex-wrap hover:bg-white/[0.02] transition-colors">
      {editing ? (
        <input type="date" autoFocus defaultValue={eff}
          onChange={e => e.target.value && onPickDate(e.target.value)}
          onBlur={onCancelEdit}
          onKeyDown={e => { if (e.key === 'Escape') onCancelEdit() }}
          className="px-2 py-1 rounded-lg text-[11px] text-white focus:outline-none w-[150px] flex-shrink-0"
          style={{ background: '#1a1a1a', border: '1px solid rgba(0,184,148,0.5)' }} />
      ) : (
        <span className="text-[11px] w-[150px] flex-shrink-0">
          <span className="text-white/55 font-semibold">{fmtDay(eff, { year: true })}</span>
          {recorded && recorded !== eff && (
            <span className="block text-[9.5px] text-white/25">recorded {fmtDay(recorded)}</span>
          )}
        </span>
      )}
      <span className="text-[12px] text-white/75 min-w-0 flex-1">
        <span className="font-semibold text-white">{who}</span>
        <span className="text-white/40"> — {from} → {to}</span>
        {by && <span className="text-white/25"> · by {by}</span>}
        {c.note && <span className="text-white/30"> · {c.note}</span>}
        {c.prior_effective && (
          <span className="text-[9.5px] text-amber-300/70"> · re-dated from {fmtDay(c.prior_effective)}</span>
        )}
      </span>
      <div className="flex items-center gap-0.5 flex-shrink-0 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
        <button onClick={onStartEdit} title="Change the date this move counts from"
          className="p-1.5 rounded-lg text-white/35 hover:text-teal hover:bg-teal/10 transition-colors"><Pencil size={12} /></button>
        <button onClick={() => onRemove(isLatest)}
          title={isLatest ? 'Undo this move, or remove the entry' : 'Remove this entry from the log'}
          className="p-1.5 rounded-lg text-white/35 hover:text-red-400 hover:bg-red-500/10 transition-colors">
          {isLatest ? <Undo2 size={12} /> : <Trash2 size={12} />}
        </button>
      </div>
    </div>
  )
}

export default function Admin() {
  const [tab,      setTab]      = useState('People')
  const [users,    setUsers]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [userModal, setUserModal] = useState(false)
  const [editUser,  setEditUser]  = useState(null)
  const [backfill,  setBackfill]  = useState(null)  // { rep, manager } after a team assignment
  const { profile } = useAuth()

  useEffect(() => { loadAll() }, [])

  const [teamChanges,  setTeamChanges]  = useState([])
  const [pendingMoves, setPendingMoves] = useState([])
  // Scheduled moves whose day has arrived but which are still pending. The
  // comparison is against ARIZONA's today, the same definition tt_today()
  // uses in the database, so the page and the sweep can never disagree about
  // what "due" means.
  const overdueMoves = useMemo(
    () => pendingMoves.filter(m => m.effective_date <= azToday()),
    [pendingMoves])
  // Deals are only needed for the move PREVIEW, so they are fetched on demand
  // (opening the modal, or expanding the change log) rather than on every
  // visit to a page that is mostly about the roster.
  const [deals, setDeals] = useState(null)
  const [dealsLoading, setDealsLoading] = useState(false)

  async function ensureDeals() {
    if (deals || dealsLoading) return
    setDealsLoading(true)
    const { data } = await fetchDeals()
    setDeals(data ?? [])
    setDealsLoading(false)
  }

  // Why the last sweep did not run, if it didn't. A scheduled move that
  // silently fails to apply looks EXACTLY like one that is not due yet, which
  // is the worst possible failure for this feature — the roster is wrong and
  // nothing on screen says so. Never swallow this.
  const [sweepError, setSweepError] = useState('')

  async function sweepDueMoves() {
    const { data, error } = await applyDueTeamMoves()
    setSweepError(error ? (error.message || 'unknown error') : '')
    return { data, error }
  }

  async function loadAll() {
    setLoading(true)
    // Perform any scheduled move whose day has arrived BEFORE reading the
    // roster, so the chart never shows yesterday's arrangement. The site
    // server sweeps on a timer too; this is the belt-and-braces path, and
    // it is idempotent either way.
    await sweepDueMoves()
    const [{ data: u }, { data: tc }, { data: pm }] = await Promise.all([
      fetchUsers(), fetchTeamChanges(), fetchPendingTeamMoves(),
    ])
    setUsers(u ?? [])
    setTeamChanges(tc ?? [])
    setPendingMoves(pm ?? [])
    setLoading(false)
  }

  // Run the sweep by hand. The scheduled-move card offers this whenever
  // something is overdue, so a stuck reorg is one click from being unstuck
  // instead of a support question.
  async function applyNow() {
    const { data, error } = await sweepDueMoves()
    if (error) return toast.error('Could not apply the due moves: ' + (error.message || ''))
    const n = Number(data?.applied || 0)
    if (n) toast.success(`${n} scheduled move${n === 1 ? '' : 's'} applied.`)
    else toast.info('Nothing came due — the database says none of these have reached their date yet.')
    await loadAll()
  }

  async function reloadMoves() {
    const [{ data: tc }, { data: pm }] = await Promise.all([fetchTeamChanges(), fetchPendingTeamMoves()])
    setTeamChanges(tc ?? [])
    setPendingMoves(pm ?? [])
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
        if (await confirmDialog({
          title: `${editUser.name} has ${directs.length} direct report${directs.length === 1 ? '' : 's'}`,
          message: `Move ${directs.length === 1 ? 'them' : 'them all'} to ${destName} too?`,
          bullets: [
            'Each move is date-stamped in the team change log, so past deals stay with the old team.',
            `Leave it and they keep reporting to ${editUser.name}.`,
          ],
          confirmLabel: 'Move the reports too',
          cancelLabel: 'Leave them',
        })) {
          await Promise.all(directs.map(d => updateUser(d.id, { manager_id: destId })))
        }
      }
      // New reports-to is a manager → offer to backfill the rep's past
      // manager-less deals (future deals already pick the manager up).
      const newLead = (data.manager_id ?? null) ? users.find(u => u.id === data.manager_id) : null
      if (movedTeams && newLead && newLead.role === 'manager') setBackfill({ rep: editUser, manager: newLead })
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
    if (!await confirmDialog({
      tone: 'danger',
      title: 'Delete this user?',
      message: 'Deleting is only for a row created by mistake.',
      bullets: [
        'Their deals still reference them — if this is a real person who left, Deactivate instead.',
      ],
      confirmLabel: 'Delete',
    })) return
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
    const how = await choiceDialog({
      title: `Create ${u.name}'s login?`,
      options: [
        { key: 'invite', label: 'Email an invite', description: `${u.email} gets a link and chooses their own password. Needs SMTP on the auth service.` },
        { key: 'manual', label: 'Set a temporary password', description: 'The site generates one and shows it to you to share securely.' },
      ],
    })
    if (!how) return
    setBusyUser(u.id)
    if (how === 'invite') {
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
    await revealDialog({
      title: `Login created for ${u.name}`,
      message: 'Copy their temporary password and share it securely — it is not shown again.',
      value: r.password || '',
    })
  }

  // Reset a user's password. Preferred: email them a reset link; fallback:
  // set a new temporary password by hand.
  async function resetLogin(u) {
    const how = await choiceDialog({
      title: `Reset ${u.name}'s password?`,
      options: [
        { key: 'email',  label: 'Email a reset link', description: `${u.email} chooses a new password themselves. Needs SMTP on the auth service.` },
        { key: 'manual', label: 'Set a temporary password', description: 'The site generates one and shows it to you to share securely.' },
      ],
    })
    if (!how) return
    setBusyUser(u.id)
    if (how === 'email') {
      const r = await userAdmin('send_reset', { email: u.email })
      setBusyUser('')
      if (!r.ok) return toast.error('Could not send the reset email: ' + (r.error || 'unknown error'))
      toast.success(`Password-reset email sent to ${u.email}.`)
      return
    }
    const r = await userAdmin('reset_password', { email: u.email })
    setBusyUser('')
    if (!r.ok) return toast.error('Could not reset password: ' + (r.error || 'unknown error'))
    await revealDialog({
      title: `New temporary password for ${u.name}`,
      message: 'Copy and share it securely — it is not shown again.',
      value: r.password || '',
    })
  }

  // Activate / deactivate: flips profiles.active (blocks site access while all
  // their deals & stats stay intact), and disables the login at the auth layer
  // when the endpoint is configured.
  async function toggleActive(u) {
    const next = u.active === false   // becoming active?
    if (!next && !await confirmDialog({
      tone: 'warn',
      title: `Deactivate ${u.name}?`,
      message: 'They lose access to the site immediately.',
      bullets: [
        'All their deals and stats stay exactly as they are and keep counting everywhere.',
        'They move to the Deactivated drawer, where you can reactivate them.',
      ],
      confirmLabel: 'Deactivate',
    })) return
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
  const [editDate, setEditDate] = useState(null)   // log entry id whose date is being re-picked

  // Drag-to-move from the People chart — the quick one-off, always effective
  // TODAY. Only non-heads are draggable (the chart enforces it), so no
  // reports cascade is needed here; that stays in saveUser for the Edit form,
  // and the Move people modal asks it explicitly.
  // It goes through the SAME move_team_members() call as that modal rather
  // than writing manager_id directly, so there is one write path, one place
  // that stamps the effective date, and one definition of "today" (Arizona's,
  // matching the database — see utils/teamMove azToday).
  async function moveUser(u, destId) {
    const destLabel = destId ? teamLabel(users.find(x => x.id === destId)) : 'Unassigned'
    const fromLabel = u.manager_id ? teamLabel(users.find(x => x.id === u.manager_id)) : 'Unassigned'
    const today = azToday()
    if (!await confirmDialog({
      title: `Move ${u.name} to ${destLabel}?`,
      bullets: [
        `Effective today, ${fmtDay(today, { year: true })}.`,
        `${u.name}'s deals before today stay with ${fromLabel} — only sales from today forward count for ${destLabel}.`,
        'Need a different date, several people at once, or a preview of what changes hands? Use "Move people" instead.',
      ],
      confirmLabel: 'Move them',
    })) return
    setUsers(us => us.map(x => x.id === u.id ? { ...x, manager_id: destId } : x))   // optimistic
    const { error } = await moveTeamMembers([u.id], destId, today, null, profile?.id)
    if (error) { toast.error('Could not move them: ' + (error.message || '')); await loadAll(); return }
    await loadAll()
    // If the new team's lead is a manager, offer to backfill this rep's past
    // manager-less deals with that manager + override.
    const dest = destId ? users.find(x => x.id === destId) : null
    if (dest && dest.role === 'manager') setBackfill({ rep: u, manager: dest })
  }

  // Official team name — lives on the head's profile (migration 046) so every
  // page that loads users labels the team the same way via teamLabel().
  function renameTeam(head, name) { patchUser(head.id, { team_name: name }) }

  // ── The Move people flow (migration 058) ──────────────────────────────────
  const [moveModal, setMoveModal] = useState(false)
  function openMoveModal() { ensureDeals(); setMoveModal(true) }

  // One call per reorg. The RESULT says what happened rather than the date
  // being re-interpreted here: "today" is Arizona's today in the database,
  // and a scheduled move and an applied one read very differently.
  async function submitMove({ profileIds, newManagerId, effectiveDate, note }) {
    const { data, error } = await moveTeamMembers(profileIds, newManagerId, effectiveDate, note, profile?.id)
    if (error) { toast.error('Could not move them: ' + (error.message || 'unknown error')); return false }
    const dest = newManagerId ? teamLabel(users.find(u => u.id === newManagerId)) : 'Unassigned'
    const n = Number(data?.applied || 0), s = Number(data?.scheduled || 0)
    if (s) toast.success(`${s} ${s === 1 ? 'person' : 'people'} scheduled to move to ${dest} on ${fmtDay(data.effective_date, { year: true })}.`)
    else if (n) toast.success(`${n} ${n === 1 ? 'person' : 'people'} moved to ${dest}, effective ${fmtDay(data.effective_date)}.`)
    else toast.info('Nothing to do — everyone selected is already on that team.')
    await loadAll()
    // Same offer as a drag: if the new lead is a manager, backfill the rep's
    // past manager-less deals. Only for a single applied move, where "the
    // rep" is unambiguous.
    const dst = newManagerId ? users.find(u => u.id === newManagerId) : null
    if (n === 1 && !s && dst?.role === 'manager') {
      const rep = users.find(u => u.id === profileIds[0])
      if (rep) setBackfill({ rep, manager: dst })
    }
    return true
  }

  async function cancelScheduled(m) {
    const who  = users.find(u => u.id === m.profile_id)?.name || 'them'
    const dest = m.new_manager_id ? teamLabel(users.find(u => u.id === m.new_manager_id)) : 'Unassigned'
    if (!await confirmDialog({
      tone: 'warn',
      title: `Cancel this scheduled move?`,
      message: `${who} was going to move to ${dest} on ${fmtDay(m.effective_date, { year: true })}.`,
      bullets: ['Nothing has changed yet, so there is nothing to undo — the move simply will not happen.'],
      confirmLabel: 'Cancel the move',
      cancelLabel: 'Keep it',
    })) return
    const { error } = await cancelPendingTeamMove(m.id)
    if (error) return toast.error(error.message || 'Could not cancel it')
    toast.success('Scheduled move cancelled.')
    reloadMoves()
  }

  // Correcting a logged move's date REWRITES team attribution either side of
  // that day, so the confirm states how many deals change hands — the same
  // preview the move modal shows, from the same engine.
  async function editChangeDate(c, nextDate) {
    if (!nextDate || nextDate === changeDay(c)) return
    const who = users.find(u => u.id === c.profile_id)?.name || 'them'
    const pv = previewDateChange({ deals: deals ?? [], users, teamChanges, changeId: c.id, effectiveDate: nextDate })
    const bullets = [
      `${who}'s deals closing on or after ${fmtDay(nextDate)} count for ${teamKeyLabel(c.new_manager_id || 'unassigned', users)}; earlier ones for ${teamKeyLabel(c.old_manager_id || 'unassigned', users)}.`,
    ]
    if (deals == null) bullets.push('The deal count could not be checked — the deals had not loaded yet.')
    else bullets.push(pv.movingCount
      ? `${pv.movingCount} deal${pv.movingCount === 1 ? '' : 's'} (${'$' + Math.round(pv.movingRevenue).toLocaleString()}) change teams.`
      : 'No recorded deal changes teams — only future ones are affected.')
    bullets.push('Every team figure on the Dashboard, the Record Book and the competitions shifts to match.')
    if (!await confirmDialog({
      tone: 'warn',
      title: `Change this move to ${fmtDay(nextDate, { year: true })}?`,
      message: 'This is a correction to history, not a new move.',
      bullets,
      confirmLabel: 'Change the date',
    })) return
    const { error } = await setTeamChangeDate(c.id, nextDate, profile?.id)
    if (error) return toast.error(error.message || 'Could not change the date')
    toast.success(`Move re-dated to ${fmtDay(nextDate)}.`)
    await loadAll()
  }

  // Two different actions, deliberately kept apart:
  //   UNDO   — their most recent move: delete the entry AND put their
  //            reports-to back. "I moved the wrong person."
  //   REMOVE — any entry: delete it and leave the roster matching whatever
  //            is now the latest entry. An edit to attribution history.
  async function removeChange(c, isLatest) {
    const who  = users.find(u => u.id === c.profile_id)?.name || 'them'
    const from = teamKeyLabel(c.old_manager_id || 'unassigned', users)
    const to   = teamKeyLabel(c.new_manager_id || 'unassigned', users)
    const how = isLatest
      ? await choiceDialog({
        title: `${who}: ${from} → ${to}`,
        message: `Recorded for ${fmtDay(changeDay(c), { year: true })}. What should happen?`,
        options: [
          { key: 'undo',   label: 'Undo the move', description: `Remove the entry AND put ${who} back on ${from}. Use this if the wrong person was moved.` },
          { key: 'remove', label: 'Remove the entry only', description: `${who} stays on ${to}, but their deals before ${fmtDay(changeDay(c))} no longer switch teams. Use this if the move was real but should never have been recorded.` },
        ],
      })
      : (await confirmDialog({
        tone: 'danger',
        title: 'Remove this log entry?',
        message: `${who}: ${from} → ${to}, ${fmtDay(changeDay(c), { year: true })}.`,
        bullets: [
          'It is not their latest move, so who they report to today does not change.',
          `Their deals around ${fmtDay(changeDay(c))} will attribute to whichever team the remaining entries put them on.`,
          'Every team figure either side of that date shifts.',
        ],
        confirmLabel: 'Remove it',
      })) ? 'remove' : null
    if (!how) return
    const { error } = await deleteTeamChange(c.id, how === 'undo')
    if (error) return toast.error(error.message || 'Could not remove it')
    toast.success(how === 'undo' ? `Move undone — ${who} is back on ${from}.` : 'Log entry removed.')
    await loadAll()
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

      {/* ── PEOPLE — the roster as an org chart ── */}
      {tab === 'People' && (
        <div className="space-y-3">
          <PeopleChart
            users={users} teamChanges={teamChanges} pendingMoves={pendingMoves}
            hasUserAdmin={hasUserAdmin} busyUser={busyUser}
            onAdd={() => { setEditUser(null); setUserModal(true) }}
            onEdit={u => { setEditUser(u); setUserModal(true) }}
            onDelete={handleDeleteUser}
            onToggleActive={toggleActive}
            onResetLogin={resetLogin}
            onCreateLogin={createLogin}
            onMove={moveUser}
            onMovePeople={openMoveModal}
            onRenameTeam={renameTeam}
          />

          {/* Scheduled moves — a reorg set up ahead of time. It changes
              NOTHING until its day, so it needs its own place to be seen and
              cancelled; otherwise it is invisible until it lands. */}
          {pendingMoves.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={card}>
              <div className="px-3 md:px-4 py-2.5 flex items-center gap-2.5" style={{ background: '#1e1e1e' }}>
                <CalendarClock size={14} style={{ color: overdueMoves.length ? '#f59e0b' : '#93c5fd' }} />
                <span className="text-[12px] font-bold text-white">Scheduled moves</span>
                <span className="text-[10px] text-white/25 hidden md:inline">nothing changes until the date — the roster is live as-is</span>
                <span className="ml-auto text-[10px] text-white/30">{pendingMoves.length} upcoming</span>
              </div>
              {/* OVERDUE: the date has arrived and the move still has not been
                  applied. Without this it renders identically to a move that
                  is simply not due yet, so a stuck sweep is invisible. */}
              {overdueMoves.length > 0 && (
                <div className="px-3 md:px-4 py-2.5 flex items-center gap-3 flex-wrap"
                  style={{ background: 'rgba(245,158,11,0.07)', borderBottom: '1px solid #2a2a2a' }}>
                  <AlertTriangle size={13} className="text-amber-400 flex-shrink-0" />
                  <span className="text-[11.5px] text-amber-200 min-w-0 flex-1">
                    {overdueMoves.length === 1 ? 'One of these was' : `${overdueMoves.length} of these were`} due
                    on or before today ({fmtDay(azToday(), { year: true })}) and {overdueMoves.length === 1 ? 'has' : 'have'} not
                    been applied.
                    {sweepError
                      ? <span className="block text-amber-300/80 mt-0.5">The site could not run them: {sweepError}</span>
                      : <span className="block text-amber-200/60 mt-0.5">
                          Usually the database’s own clock has not reached the date yet — Apply now will say which.
                        </span>}
                  </span>
                  <button onClick={applyNow}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold text-dark bg-amber-400 flex-shrink-0">
                    <RefreshCw size={11} /> Apply now
                  </button>
                </div>
              )}
              <div className="divide-y divide-white/5">
                {pendingMoves.map(m => {
                  const who  = users.find(x => x.id === m.profile_id)
                  const from = who?.manager_id ? teamKeyLabel(who.manager_id, users) : 'Unassigned'
                  const to   = m.new_manager_id ? teamKeyLabel(m.new_manager_id, users) : 'Unassigned'
                  const due  = m.effective_date <= azToday()
                  return (
                    <div key={m.id} className="px-3 md:px-4 py-2 flex items-center gap-3 flex-wrap">
                      <span className="text-[11px] font-semibold w-[104px] flex-shrink-0" style={{ color: due ? '#f59e0b' : '#93c5fd' }}>
                        {fmtDay(m.effective_date, { year: true })}
                        {due && <span className="block text-[9px] font-bold uppercase tracking-wide">due — not applied</span>}
                      </span>
                      <span className="text-[12px] text-white/75 min-w-0 flex-1">
                        <span className="font-semibold text-white">{who?.name || '—'}</span>
                        <span className="text-white/40"> — {from} → {to}</span>
                        {m.note && <span className="text-white/25"> · {m.note}</span>}
                      </span>
                      <button onClick={() => cancelScheduled(m)} title="Cancel this scheduled move"
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10.5px] font-semibold text-white/40 hover:text-red-300 hover:bg-red-500/10 transition-colors flex-shrink-0">
                        <X size={11} /> Cancel
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Team change log — trigger-written (029), now CORRECTABLE by an
              admin (058). It was append-only and read-only to the app, which
              meant a mis-dated move was permanent and the only remedy was
              another move stacked on top, leaving two false entries forever.
              The dates here ARE the attribution rule, so being able to fix
              one is the difference between a log and a liability. */}
          {teamChanges.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={card}>
              <button onClick={() => { setShowLog(v => !v); ensureDeals() }}
                className="w-full px-3 md:px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors"
                style={{ background: '#1e1e1e' }}>
                <span className="text-[12px] font-bold text-white">Team change log</span>
                <span className="text-[10px] text-white/25 hidden md:inline">sales &amp; overrides attribute to teams by these dates</span>
                <span className="text-[10px] text-white/30">{teamChanges.length} change{teamChanges.length === 1 ? '' : 's'} · {showLog ? 'hide' : 'show'}</span>
              </button>
              {showLog && (
                <div className="divide-y divide-white/5">
                  {teamChanges.map(c => (
                    <LogRow key={c.id} c={c} users={users} teamChanges={teamChanges}
                      editing={editDate === c.id}
                      onStartEdit={() => { ensureDeals(); setEditDate(c.id) }}
                      onCancelEdit={() => setEditDate(null)}
                      onPickDate={(d) => { setEditDate(null); editChangeDate(c, d) }}
                      onRemove={(isLatest) => removeChange(c, isLatest)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── SETTINGS ── */}
      {tab === 'Settings' && <SettingsPanel />}

      {moveModal && (
        <TeamMoveModal
          users={users} deals={deals ?? []} teamChanges={teamChanges}
          loadingDeals={dealsLoading || deals == null}
          onSubmit={submitMove}
          onClose={() => setMoveModal(false)}
        />
      )}
      {userModal && <UserModal user={editUser} allUsers={users} teamChanges={teamChanges} onSave={saveUser} onClose={() => { setUserModal(false); setEditUser(null) }} />}
      {backfill && <ManagerBackfillModal rep={backfill.rep} manager={backfill.manager}
        onClose={(n) => { setBackfill(null); if (n) toast.success(`Backfilled ${n} deal${n === 1 ? '' : 's'} with ${backfill.manager.name}`); loadAll() }} />}
    </div>
  )
}
