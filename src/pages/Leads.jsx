import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { CalendarCheck, Search, Link2, Upload, X, ChevronDown } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchLeads, fetchUsers, updateLead, upsertLeads, fetchLeadHistory, fetchDeals, fetchTeamChanges } from '../lib/db'
import { headIdSet, buildChangesByProfile, teamOfSale, teamLabel } from '../utils/team'
import { repActivity } from '../utils/repActivity'
import RepActivityTable from '../components/RepActivityTable'
import { csvToLeads } from '../utils/leadImport'
import { gapReasons, duplicateIds, needsAttention, nonRepSet, isNonRep } from '../utils/leadGaps'
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus'
import { toast } from '../lib/toast'
import { confirmDialog } from '../lib/dialog'
import { useSettings } from '../contexts/SettingsContext'
import { leadFeedHealth } from '../utils/feedHealth'
import { apptDay } from '../utils/estimates'
import { SURFACE, GOLD_WASH, Card, KpiFigure, Pill, PillGroup, Input, Select, PrimaryButton, SecondaryButton, IconButton, LoadingBlock, EmptyBlock } from '../components/ui'

// The lifecycle the site reasons about (migration 041). RUN = the appointment
// actually happened, which is what counts as an estimate.
// Status tones on the palette; the label is always printed next to the colour.
const STATUSES = [
  { key: 'scheduled', label: 'Scheduled', color: '#a19e97' },
  { key: 'completed', label: 'Ran',       color: '#ede7da' },
  { key: 'sold',      label: 'Sold',      color: '#a9c4b2' },
  { key: 'no_show',   label: 'No Show',   color: '#d2a074' },
  { key: 'canceled',  label: 'Canceled',  color: '#8c8a84' },
]
const stat = (k) => STATUSES.find(s => s.key === k) ?? { label: k || '—', color: '#8c8a84' }

// Appointments look FORWARD, so the usual sales presets (which all stop at
// today) hide the rest of the week. These span whole periods instead.
const iso = (d) => format(d, 'yyyy-MM-dd')
function apptRange(key, now = new Date()) {
  const d = new Date(now)
  const sunday = (x) => { const y = new Date(x); y.setDate(y.getDate() - y.getDay()); return y }
  const addD = (x, n) => { const y = new Date(x); y.setDate(y.getDate() + n); return y }
  switch (key) {
    case 'today':     return { from: iso(d), to: iso(d) }
    case 'week':      { const s0 = sunday(d); return { from: iso(s0), to: iso(addD(s0, 6)) } }
    case 'next_week': { const s0 = addD(sunday(d), 7); return { from: iso(s0), to: iso(addD(s0, 6)) } }
    case 'last_week': { const s0 = addD(sunday(d), -7); return { from: iso(s0), to: iso(addD(s0, 6)) } }
    case 'month':     return { from: iso(new Date(d.getFullYear(), d.getMonth(), 1)),
                               to:   iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }
    case 'all':       return { from: '', to: '' }
    default:          return { from: iso(d), to: iso(d) }
  }
}
const APPT_RANGES = [
  ['today', 'Today'], ['week', 'This Week'], ['next_week', 'Next Week'],
  ['last_week', 'Last Week'], ['month', 'This Month'], ['all', 'All'],
]
const RAN = new Set(['completed', 'sold'])   // an estimate was run

const dt = (iso) => iso ? format(new Date(iso), 'EEE, MMM d · h:mma') : '—'
// Inside a day group the date is already in the header, so rows show the time
// only — it reads like the calendar the appointments came from.
const tm = (iso) => iso ? format(new Date(iso), 'h:mmaaa') : '—'

// A 'yyyy-MM-dd' key → how the day header should read. Built from explicit
// parts because `new Date('2026-08-24')` parses as UTC midnight, which lands
// on the 23rd in Arizona and would label every header with the wrong weekday.
function dayMeta(key, now = new Date()) {
  if (!key) return { label: 'No date set', rel: null, isToday: false }
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0)
  const diff = Math.round((date - midnight) / 86400000)
  return {
    label: format(date, 'EEEE · MMM d'),
    rel: diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : null,
    isToday: diff === 0,
  }
}

const WARN = 'var(--warn)'
const chipStyle = (color) => ({ color, border: `1px solid ${color}66` })

// One appointment. Desktop (lg+) is the single flex row the page always had;
// phones get a compact row (time · customer · status) that opens to the
// address, flags, people and — for admins — the same inline controls.
function LeadRow({ l, s, gaps, isDupe, isAdmin, pickUsers, nonReps, openHistory, setPerson, setStatus, toggleIgnore }) {
  const [open, setOpen] = useState(false)
  const flags = (
    <>
      {l.pinned && (
        <p className="text-[13px] truncate mt-0.5" style={{ color: WARN }}>Edited here — the CRM feed won't change its status or people</p>
      )}
      {gaps.length > 0 && (
        <p className="text-[13px] truncate mt-0.5" style={{ color: WARN }} title={`Missing info: ${gaps.join('; ')}`}>Missing info — {gaps.join(' · ')}</p>
      )}
      {isDupe && (
        <p className="text-[13px] truncate mt-0.5" style={{ color: WARN }}
          title="Another appointment has the same customer at the same time. The CRM makes a new record when one is reassigned, so one of these is probably a leftover — ignore whichever is wrong.">
          Possible duplicate — same customer and time as another appointment
        </p>
      )}
      {l.ignored && <p className="text-[13px] text-bank-mu truncate mt-0.5">Ignored — counts nowhere</p>}
    </>
  )
  const nameBtn = (
    <button onClick={() => openHistory(l)} title="Show this appointment's edit history"
      className="block max-w-full text-[13px] font-semibold text-bank-tx truncate text-left hover:text-bank-gold-tx transition-colors min-h-[44px] lg:min-h-0">
      {l.customer_name || 'Unnamed'}
      {l.deal_id && <Link2 size={11} className="inline ml-1.5 text-bank-mu" title="Linked to a deal" />}
    </button>
  )
  const people = isAdmin ? (
    <div className="flex flex-col gap-1 min-w-[168px]">
      {[['setter_id', 'SET', l.setter_id, l.setter_name], ['closer_id', 'RUN', l.closer_id, l.closer_name]].map(([field, tag, val, named]) => (
        <span key={field} className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <span className="text-[12px] text-bank-fa w-7">{tag}</span>
            <select value={val || ''} onChange={e => setPerson(l, field, e.target.value)}
              style={SURFACE.raise} aria-label={tag === 'SET' ? 'Who booked it' : 'Who runs it'}
              className="h-11 lg:h-7 px-1.5 rounded-lg text-[13px] text-bank-tx focus:outline-none max-w-[160px]"
              title={tag === 'SET' ? 'Who booked it' : 'Who runs it (reassign here)'}>
              <option value="">— none —</option>
              {pickUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </span>
          {/* The feed sent a name but it matched no profile, so the select
              reads "none" and every total ignores this person. Showing the
              name turns a mystery into a one-click fix. */}
          {!val && String(named || '').trim() && (
            isNonRep(named, nonReps) ? (
              <span className="text-[12px] text-bank-fa pl-[34px] truncate max-w-[160px]"
                title={`"${named}" is on the Not Field Reps list, so this appointment credits nobody's Set. Whoever ran it still gets their Leads ran.`}>
                feed: {named}
              </span>
            ) : (
              <span className="text-[12px] pl-[34px] truncate max-w-[160px]" style={{ color: WARN }}
                title={`The feed sent "${named}" but no roster profile matched. Pick the right person above.`}>
                feed: {named}
              </span>
            )
          )}
        </span>
      ))}
    </div>
  ) : (
    <div className="text-[13px] text-bank-mu whitespace-nowrap min-w-[150px]">
      <span className="text-bank-fa">SET</span> {l.setter?.name || l.setter_name || '—'}
      {(l.closer?.name || l.closer_name) && (l.closer_id !== l.setter_id) && (
        <><br /><span className="text-bank-fa">RUN</span> {l.closer?.name || l.closer_name}</>
      )}
    </div>
  )
  const statusCtl = isAdmin ? (
    <span className="flex items-center gap-1.5">
      <select value={l.status} onChange={e => setStatus(l, e.target.value)} aria-label="Status"
        style={{ background: 'var(--raise)', border: `1px solid ${s.color}66`, color: s.color }}
        className="h-11 lg:h-8 px-2.5 rounded-full text-[13px] font-semibold focus:outline-none">
        {STATUSES.map(x => <option key={x.key} value={x.key} style={{ color: 'var(--tx)' }}>{x.label}</option>)}
      </select>
      <button onClick={() => toggleIgnore(l)}
        className={`h-11 lg:h-8 px-2.5 rounded-full text-[13px] font-semibold whitespace-nowrap transition-colors ${l.ignored ? 'text-bank-gold-tx' : 'text-bank-mu hover:text-bank-tx'}`}
        style={l.ignored ? GOLD_WASH : { border: '1px solid var(--line)' }}
        title={l.ignored ? 'Count this appointment again' : 'Take this appointment out of every count — use it on the leftover half of a duplicate'}>
        {l.ignored ? 'Restore' : 'Ignore'}
      </button>
    </span>
  ) : (
    <span className="text-[13px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style={chipStyle(s.color)}>{s.label}</span>
  )
  return (
    <div className={`border-b border-bank-line last:border-0 ${l.ignored ? 'opacity-50' : ''}`}>
      {/* Desktop row */}
      <div className="hidden lg:flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
        <div className="text-[13px] font-semibold text-bank-mu tabular-nums w-[64px] flex-shrink-0">{tm(l.appointment_at)}</div>
        <div className="min-w-0 flex-1">
          {nameBtn}
          <p className="text-[13px] text-bank-mu truncate">{l.address || 'No address'}{l.office ? ` · ${l.office}` : ''}</p>
          {flags}
        </div>
        {people}
        {statusCtl}
      </div>
      {/* Phone row */}
      <div className="lg:hidden">
        <button onClick={() => setOpen(o => !o)} aria-expanded={open}
          className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] text-left hover:bg-bank-raise transition-colors">
          <span className="text-[13px] font-semibold text-bank-mu tabular-nums w-[64px] flex-shrink-0">{tm(l.appointment_at)}</span>
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-bank-tx truncate">{l.customer_name || 'Unnamed'}</span>
          <span className="text-[13px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style={chipStyle(s.color)}>{s.label}</span>
          <ChevronDown size={16} className={`text-bank-fa flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="px-4 pb-3 space-y-3" style={{ background: 'var(--bg)' }}>
            <div className="pt-3">
              {nameBtn}
              <p className="text-[13px] text-bank-mu">{l.address || 'No address'}{l.office ? ` · ${l.office}` : ''}</p>
              {flags}
            </div>
            <div><p className="text-[13px] text-bank-fa mb-1">People</p>{people}</div>
            <div><p className="text-[13px] text-bank-fa mb-1">Status</p>{statusCtl}</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Leads() {
  const { profile, isAdmin } = useAuth()
  const { settings, feedNonReps } = useSettings()
  const role = profile?.role ?? 'rep'
  const [leads, setLeads] = useState([])
  const [users, setUsers] = useState([])
  const [deals, setDeals] = useState([])
  const [teamChanges, setTeamChanges] = useState([])
  // 'byrep' = the appointments grouped per person, the DEFAULT (per Keaton);
  // 'list' = the day-grouped schedule this page used to open on.
  // A switch is remembered per browser, the same way the Deals page remembers
  // its page size — so defaulting to By rep never costs anyone who prefers
  // the schedule a click on every visit. Storage can throw (private window,
  // blocked site data), so the read and the write are both guarded and the
  // page renders correctly without it.
  const [view, setView] = useState(() => {
    try { return localStorage.getItem('tt_leads_view') === 'list' ? 'list' : 'byrep' }
    catch { return 'byrep' }
  })
  const pickView = (v) => {
    setView(v)
    try { localStorage.setItem('tt_leads_view', v) } catch { /* not worth failing over */ }
  }
  const [teamFilter, setTeamFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const initial = apptRange('week')
  const [dateFrom, setDateFrom] = useState(initial.from)
  const [dateTo, setDateTo]     = useState(initial.to)
  const [preset, setPreset]     = useState('week')
  const [search, setSearch]     = useState('')
  const [repFilter, setRepFilter]       = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  // Data-gap filter. The Performance page links here as ?missing=setter when
  // it finds appointments it can't credit — an appointment with no setter
  // counts as a LEAD ran for whoever sat it and toward nobody's Set, so this
  // is the worklist for fixing them at the source.
  const [searchParams] = useSearchParams()
  // Any ?missing=… value turns the single filter on, so older
  // ?missing=setter links still work.
  const [missing, setMissing] = useState(() => (searchParams.get('missing') ? 'info' : ''))
  // Feed names that are not field reps (inside sales, people who have left):
  // a known blank, not a gap to chase. Admin → Settings → Feed: Not Field Reps.
  const nonReps = useMemo(() => nonRepSet(feedNonReps), [feedNonReps])

  const feed = useMemo(
    () => leadFeedHealth(leads, settings?.lead_last_payload?.at),
    [leads, settings?.lead_last_payload?.at])

  // Deals are what CLOSED means here — per Keaton, 'deals should only count
  // for actual signed deals'. fetchDeals() is the RLS-restricted feed on
  // purpose: a rep sees their own, which matches the appointments this page
  // already scopes to them. No new information is exposed.
  const load = () => Promise.all([fetchLeads(), fetchUsers(), fetchDeals(), fetchTeamChanges()])
    .then(([l, u, d, tc]) => {
      setLeads(l.data ?? []); setUsers(u.data ?? [])
      setDeals(d.data ?? []); setTeamChanges(tc.data ?? [])
    })
  useEffect(() => { load().finally(() => setLoading(false)) }, [])
  useRefreshOnFocus(load)

  // A rep only sees appointments they set or are running.
  const mine = (l) => l.setter_id === profile?.id || l.closer_id === profile?.id
  const scoped = useMemo(
    () => (role === 'rep' && !isAdmin) ? leads.filter(mine) : leads,
    [leads, role, isAdmin, profile?.id])

  // Duplicates are found across everything in view, not just the current
  // filter — otherwise filtering to one day would hide a row's own twin.
  const dupes = useMemo(() => duplicateIds(scoped), [scoped])

  // Local calendar day — a 6:30pm appointment is tomorrow in UTC.
  const dayOf = (l) => apptDay(l.appointment_at) || ''
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const nowISO = new Date().toISOString()   // both sides are ISO-8601 UTC, so string compare is exact
    return scoped.filter(l => {
      const d = dayOf(l)
      if (dateFrom && d && d < dateFrom) return false
      if (dateTo && d && d > dateTo) return false
      if (statusFilter && l.status !== statusFilter) return false
      if (repFilter && l.setter_id !== repFilter && l.closer_id !== repFilter) return false
      if (missing && !needsAttention(l, nowISO, dupes, nonReps)) return false
      if (q) {
        const hay = [l.customer_name, l.address, l.setter?.name, l.closer?.name, l.setter_name, l.closer_name]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    // Chronological — the list reads like the calendar it came from.
    }).sort((a, b) => String(a.appointment_at ?? '').localeCompare(String(b.appointment_at ?? '')))
  }, [scoped, dateFrom, dateTo, statusFilter, repFilter, search, missing, dupes])

  const kpis = useMemo(() => {
    // Ignored rows (duplicates) count nowhere — same rule the stats pages use.
    const counted = filtered.filter(l => !l.ignored)
    const set = counted.length
    const ran = counted.filter(l => RAN.has(l.status)).length
    const sold = counted.filter(l => l.status === 'sold').length
    const noShow = counted.filter(l => l.status === 'no_show').length
    const held = set - counted.filter(l => l.status === 'canceled').length
    return {
      set, ran, sold, noShow,
      closeRate: ran > 0 ? (sold / ran) * 100 : null,
      showRate: held > 0 ? (ran / held) * 100 : null,
    }
  }, [filtered])

  // One card per calendar day. `filtered` is already chronological, so a
  // single pass is enough — a long undifferentiated list is hard to read, and
  // days are the unit people actually think in when scanning a schedule.
  const byDay = useMemo(() => {
    const days = []
    let cur = null
    for (const l of filtered) {
      const d = dayOf(l)
      if (!cur || cur.day !== d) { cur = { day: d, rows: [] }; days.push(cur) }
      cur.rows.push(l)
    }
    return days.map(g => ({
      ...g,
      ...dayMeta(g.day),
      ran: g.rows.filter(l => !l.ignored && RAN.has(l.status)).length,
      sold: g.rows.filter(l => !l.ignored && l.status === 'sold').length,
    }))
  }, [filtered])

  // ── CSV backfill ──────────────────────────────────────────
  // The webhook only fires on events from the moment it's configured, so
  // already-scheduled appointments need one import. Keyed on the appointment
  // id like the feed, so re-importing (or overlapping date ranges) updates
  // rather than duplicates.
  const [importOpen, setImportOpen] = useState(false)
  const [csvText, setCsvText] = useState('')
  const [importing, setImporting] = useState(false)
  const profilesByEmail = useMemo(() => Object.fromEntries(
    users.filter(u => u.email).map(u => [String(u.email).toLowerCase(), u.id])), [users])
  // Name fallback: the CRM holds a rep's personal email, not their company
  // one, so names are what actually match. A duplicated name matches nobody.
  const profilesByName = useMemo(() => {
    const m = {}, dupes = new Set()
    for (const u of users) {
      const n = String(u.name || '').trim().toLowerCase().replace(/\s+/g, ' ')
      if (!n) continue
      if (m[n] && m[n] !== u.id) dupes.add(n)
      m[n] = u.id
    }
    for (const n of dupes) delete m[n]
    return m
  }, [users])
  const preview = useMemo(
    () => (csvText.trim() ? csvToLeads(csvText, profilesByEmail, 'repcard', profilesByName) : null),
    [csvText, profilesByEmail, profilesByName])
  const unmatchedEmails = useMemo(() => {
    if (!preview) return []
    const bad = new Set()
    for (const l of preview.leads) {
      if (l._setterWho && !l.setter_id) bad.add(l._setterWho)
      if (l._closerWho && !l.closer_id) bad.add(l._closerWho)
    }
    return [...bad]
  }, [preview])

  async function runImport() {
    if (!preview?.leads.length) return
    setImporting(true)
    const rows = preview.leads.map(l => {
      const r = { ...l }
      delete r._setterWho; delete r._closerWho
      return r
    })
    const res = await upsertLeads(rows)
    setImporting(false)
    if (res?.error) { toast.error('Import failed: ' + (res.error.message || 'unknown error')); return }
    toast.success(`Imported ${rows.length} appointment${rows.length === 1 ? '' : 's'}.`)
    setImportOpen(false); setCsvText('')
    load()
  }

  // ── Edit history (migration 043) ──────────────────────────
  // Clicking a customer name shows who changed what — the CRM feed, the CSV
  // importer, and admin corrections all land in the same log.
  const [histLead, setHistLead] = useState(null)
  const [hist, setHist] = useState(null)   // null = loading
  async function openHistory(l) {
    setHistLead(l); setHist(null)
    const { data } = await fetchLeadHistory(l.id)
    setHist(data ?? [])
  }
  const nameOfUser = (id) => users.find(u => u.id === id)?.name ?? null
  // Field labels + value rendering for the log — ids become names, statuses
  // become their friendly label.
  const FIELD_LABEL = {
    status: 'the status', setter_id: 'the setter', closer_id: 'the closer',
    setter_name: 'the setter', closer_name: 'the closer',
    appointment_at: 'the date', customer_name: 'the customer', address: 'the address',
    phone: 'the phone', email: 'the email', office: 'the office', notes: 'the notes',
    disposition: 'the disposition', pinned: 'feed protection', deal_id: 'the linked deal',
  }
  const histValue = (field, v) => {
    if (v === null || v === undefined || v === '') return '—'
    if (field === 'status') return stat(v).label
    if (field === 'setter_id' || field === 'closer_id') return nameOfUser(v) || 'someone'
    if (field === 'appointment_at') return dt(v)
    if (field === 'pinned') return v ? 'yes' : 'no'
    return String(v)
  }

  // Any admin correction PINS the row so the CRM feed can't revert it (the
  // feed keeps refreshing timing/details; status + people stay ours).
  async function patchLead(l, patch) {
    const withPin = { ...patch, pinned: true }
    setLeads(ls => ls.map(x => x.id === l.id ? { ...x, ...withPin } : x))
    const res = await updateLead(l.id, withPin)
    if (res?.error) { toast.error('Could not update: ' + (res.error.message || 'unknown error')); load() }
  }
  const setStatus = (l, status) => patchLead(l, { status })
  function setPerson(l, field, id) {
    const u = users.find(x => x.id === id)
    patchLead(l, { [field]: id || null, [`${field.replace('_id', '')}_name`]: u?.name ?? null })
  }
  // Ignore/restore is its own thing — no pin. Pinning freezes status and
  // people against the feed; ignoring just takes the row out of the counts.
  async function toggleIgnore(l) {
    const next = !l.ignored
    if (next && !await confirmDialog({
      tone: 'warn',
      title: 'Ignore this appointment?',
      message: l.customer_name || 'Unnamed',
      bullets: [
        'It stays on this page, greyed, but stops counting anywhere.',
        'Use it for the duplicate RepCard creates when an appointment is reassigned.',
      ],
      confirmLabel: 'Ignore it',
    })) return
    setLeads(ls => ls.map(x => x.id === l.id ? { ...x, ignored: next } : x))
    const res = await updateLead(l.id, { ignored: next })
    if (res?.error) { toast.error('Could not update: ' + (res.error.message || 'unknown error')); load() }
  }
  async function unpin(l) {
    setLeads(ls => ls.map(x => x.id === l.id ? { ...x, pinned: false } : x))
    const res = await updateLead(l.id, { pinned: false })
    if (res?.error) { toast.error('Could not unpin: ' + (res.error.message || 'unknown error')); load() }
    else toast.info('Handed back to the CRM feed — it can update this appointment again.')
  }

  const pickUsers = useMemo(
    () => users.filter(u => u.active !== false && (isAdmin || !u.ghost)).sort((a, b) => a.name.localeCompare(b.name)),
    [users, isAdmin])
  // ── By-rep view ───────────────────────────────────────────────────────────
  // Team attribution is DATE-EFFECTIVE, the same rule the Dashboard and Deals
  // pages use, so "Conner's Team" means the same thing on all three.
  const usersById = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users])
  const headsSet  = useMemo(() => headIdSet(users), [users])
  const changesByProfile = useMemo(() => buildChangesByProfile(teamChanges), [teamChanges])
  // As of the END of the range: a rep who moved mid-range is listed under the
  // team they are on now, with everything they did in the window.
  const teamOf = useMemo(
    () => (id) => teamOfSale(id, dateTo, usersById, headsSet, changesByProfile),
    [dateTo, usersById, headsSet, changesByProfile])

  const teamOptions = useMemo(
    () => users.filter(u => headsSet.has(u.id))
      .map(h => ({ id: h.id, label: teamLabel(h) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [users, headsSet])

  // THE TEAM FILTER PICKS THE ROSTER, NOT THE APPOINTMENTS (per Keaton): a
  // closer who ran another team's lead keeps that credit on their OWN team's
  // view. Filtering the appointments first would move them onto the team
  // whose lead they ran — the bug the Dashboard leaderboard already fixed.
  const activity = useMemo(() => {
    if (view !== 'byrep') return null
    const roster = (role === 'rep' && !isAdmin)
      ? [profile?.id].filter(Boolean)                       // a rep sees only themselves
      : teamFilter
        ? users.filter(u => teamOf(u.id) === teamFilter).map(u => u.id)
        : null
    const visible = isAdmin ? users : users.filter(u => !u.ghost)
    return repActivity(scoped, deals, {
      users: visible, from: dateFrom, to: dateTo, onlyIds: roster,
    })
  }, [view, scoped, deals, users, dateFrom, dateTo, teamFilter, teamOf, role, isAdmin, profile?.id])

  if (loading) return <LoadingBlock text="Loading appointments…" />

  const modalShell = 'relative w-full md:max-w-2xl h-[100dvh] md:h-auto md:max-h-[88dvh] rounded-none md:rounded-2xl overflow-y-auto flex flex-col'
  const modalStyle = { ...SURFACE.card, boxShadow: 'var(--card-shadow), 0 24px 60px rgba(0,0,0,0.55)', color: 'var(--tx)' }
  const modalHead = { background: 'var(--card)', borderBottom: '1px solid var(--line)' }
  const selW = 'w-auto'

  return (
    <div className="space-y-4 pb-8 max-w-[1400px] mx-auto" style={{ color: 'var(--tx)' }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-lg md:text-xl font-bold text-bank-tx flex items-center gap-2">
            <CalendarCheck size={18} className="text-bank-mu" /> Leads
          </h1>
          <p className="text-[13px] text-bank-mu mt-0.5">
            Appointments fed in from the field CRM, in calendar order. An appointment that RAN counts as an estimate —
            marking one <span className="text-bank-tx">Sold</span> records the outcome only; deal counts and revenue
            always come from the Deals page.
          </p>
        </div>
        {isAdmin && (
          <SecondaryButton onClick={() => setImportOpen(true)} title="Backfill appointments from a CRM export" className="flex-shrink-0">
            <Upload size={14} /> Import CSV
          </SecondaryButton>
        )}
      </div>

      {/* Edit history for one appointment */}
      {histLead && (
        <div className="fixed inset-0 z-[60] flex items-end md:items-center md:justify-center md:p-4">
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(3px)' }} onClick={() => setHistLead(null)} />
          <div className={modalShell.replace('md:max-w-2xl', 'md:max-w-lg')} style={modalStyle} role="dialog" aria-modal="true" aria-label="Appointment history">
            <div className="flex items-start justify-between gap-3 px-5 py-3 sticky top-0 z-10" style={modalHead}>
              <div className="min-w-0">
                <h2 className="text-[15px] font-bold text-bank-tx truncate">{histLead.customer_name || 'Unnamed'}</h2>
                <p className="text-[13px] text-bank-mu">{dt(histLead.appointment_at)}</p>
              </div>
              <IconButton onClick={() => setHistLead(null)} aria-label="Close"><X size={16} /></IconButton>
            </div>
            <div className="p-5 space-y-3">
              {histLead.pinned && (
                <div className="rounded-xl px-3 py-2.5 flex items-start justify-between gap-3 text-[13px]"
                  style={{ background: 'rgba(210,160,116,0.10)', border: '1px solid rgba(210,160,116,0.4)' }}>
                  <span style={{ color: 'var(--warn)' }}>
                    Corrected here, so the CRM feed can no longer change its status, setter or closer.
                    It still refreshes timing and customer details.
                  </span>
                  {isAdmin && (
                    <button onClick={() => { unpin(histLead); setHistLead({ ...histLead, pinned: false }) }}
                      className="text-[13px] font-semibold text-bank-gold-tx hover:underline whitespace-nowrap flex-shrink-0 min-h-[44px] md:min-h-0">
                      Hand back to feed
                    </button>
                  )}
                </div>
              )}

              {hist === null ? (
                <EmptyBlock className="py-4">Loading history…</EmptyBlock>
              ) : hist.length === 0 ? (
                <EmptyBlock className="py-4">No changes recorded yet. History starts once migration 043 is in place.</EmptyBlock>
              ) : hist.map(h => {
                // One plain sentence per change: who did it, what it became.
                const who = h.editor?.name || nameOfUser(h.changed_by) || 'RepCard'
                const entries = Object.entries(h.changes || {}).filter(([k]) => k !== '_event')
                const created = h.changes?._event === 'created'
                return (
                  <div key={h.id} className="flex items-baseline justify-between gap-3 py-1.5 border-b border-bank-line last:border-0">
                    <div className="min-w-0">
                      {created ? (
                        <p className="text-[13px] text-bank-mu">
                          Added by <span className="font-semibold text-bank-tx">{who}</span>
                        </p>
                      ) : entries.length === 0 ? (
                        <p className="text-[13px] text-bank-fa">Refreshed by {who}</p>
                      ) : entries.map(([field, v]) => (
                        <p key={field} className="text-[13px] text-bank-mu">
                          <span className="font-semibold text-bank-tx">{who}</span>
                          {' '}updated {FIELD_LABEL[field] || field} to{' '}
                          <span className="font-semibold text-bank-tx">{histValue(field, v?.to)}</span>
                        </p>
                      ))}
                    </div>
                    <span className="text-[13px] text-bank-fa whitespace-nowrap flex-shrink-0">
                      {format(new Date(h.changed_at), 'MMM d, h:mma')}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* CSV backfill */}
      {importOpen && (
        <div className="fixed inset-0 z-[60] flex items-end md:items-center md:justify-center md:p-4">
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(3px)' }} onClick={() => setImportOpen(false)} />
          <div className={modalShell} style={modalStyle} role="dialog" aria-modal="true" aria-label="Import appointments">
            <div className="flex items-center justify-between px-5 py-3 sticky top-0 z-10" style={modalHead}>
              <h2 className="text-[15px] font-bold text-bank-tx">Import appointments</h2>
              <IconButton onClick={() => setImportOpen(false)} aria-label="Close"><X size={16} /></IconButton>
            </div>
            <div className="p-5 flex-1 flex flex-col gap-3">
              <p className="text-[13px] text-bank-mu">
                Paste a CSV export from the CRM (or choose the file). Rows are matched on the appointment <b className="text-bank-tx">ID</b>,
                so importing the same range twice updates rather than duplicates — safe to re-run.
              </p>
              <input type="file" accept=".csv,text/csv" aria-label="CSV file"
                onChange={e => { const f = e.target.files?.[0]; if (f) f.text().then(setCsvText) }}
                className="block w-full text-[13px] text-bank-mu file:mr-3 file:px-3 file:py-2 file:min-h-[44px] md:file:min-h-0 file:rounded-lg file:border-0 file:text-[13px] file:font-semibold file:bg-[#bfa46c] file:text-[#191509]" />
              <textarea value={csvText} onChange={e => setCsvText(e.target.value)} rows={6} aria-label="CSV contents"
                placeholder="…or paste the CSV contents here"
                style={SURFACE.well}
                className="w-full px-3 py-2 rounded-lg text-[13px] text-bank-tx placeholder-bank-fa focus:outline-none font-mono resize-none" />

              {preview && (
                <div className="rounded-xl p-3 space-y-2 text-[13px]" style={SURFACE.well}>
                  {preview.missing.length > 0 && (
                    <p style={{ color: 'var(--warn)' }}>⚠ Missing expected column{preview.missing.length > 1 ? 's' : ''}: {preview.missing.join(', ')}</p>
                  )}
                  <p className="text-bank-mu">
                    <b className="text-bank-tx">{preview.leads.length}</b> appointment{preview.leads.length === 1 ? '' : 's'} ready
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-bank-mu">
                    {['scheduled', 'completed', 'sold', 'no_show', 'canceled'].map(s => {
                      const n = preview.leads.filter(l => l.status === s).length
                      return n ? <span key={s}>{stat(s).label}: <b className="text-bank-tx">{n}</b></span> : null
                    })}
                  </div>
                  {unmatchedEmails.length > 0 && (
                    <div className="text-[13px]" style={{ color: 'var(--warn)' }}>
                      <p>{unmatchedEmails.length} rep{unmatchedEmails.length === 1 ? '' : 's'} not matched to the roster — those appointments still import, with the name as text:</p>
                      <p className="break-words mt-0.5 opacity-80">{unmatchedEmails.join(', ')}</p>
                    </div>
                  )}
                </div>
              )}

              <div className="sticky bottom-0 -mx-5 md:mx-0 px-5 md:px-0 pt-3 pb-3 md:pb-0 mt-auto flex gap-3 md:static"
                style={{ background: 'var(--card)', borderTop: '1px solid var(--line)', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
                <PrimaryButton onClick={runImport} disabled={!preview?.leads.length || importing} className="flex-1">
                  {importing ? 'Importing…' : preview?.leads.length ? `Import ${preview.leads.length}` : 'Import'}
                </PrimaryButton>
                <SecondaryButton onClick={() => setImportOpen(false)} className="px-5 min-h-[44px]">Cancel</SecondaryButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Feed health — a push feed has no "last ran", so this answers
          "are appointments actually arriving?" at a glance. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3.5 py-2.5"
        style={{ ...SURFACE.card, border: `1px solid ${feed.level === 'ok' ? 'var(--line)' : feed.color + '66'}` }}>
        <span className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: feed.color }} />
          <span className="text-[13px] text-bank-mu">CRM feed · {feed.text}</span>
        </span>
        {feed.lastAt && (
          <span className="text-[13px] text-bank-fa ml-auto whitespace-nowrap">
            {feed.last7} in the last 7 days
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <PillGroup role="group" aria-label="Date range">
          {APPT_RANGES.map(([k, label]) => (
            <Pill key={k} active={preset === k}
              onClick={() => { const r = apptRange(k); setDateFrom(r.from); setDateTo(r.to); setPreset(k) }}>
              {label}
            </Pill>
          ))}
        </PillGroup>
        <span className="flex items-center gap-1.5">
          <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPreset('custom') }} aria-label="From date" className={`${selW} !w-[150px]`} />
          <span className="text-bank-fa text-[13px]">to</span>
          <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPreset('custom') }} aria-label="To date" className={`${selW} !w-[150px]`} />
        </span>
        <span className="text-[13px] text-bank-mu">{filtered.length} appointments</span>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-bank-fa pointer-events-none" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Customer, address, rep…" aria-label="Search"
            className="!w-[210px] pl-7" />
        </div>
        <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="!w-auto" aria-label="Status filter">
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </Select>
        {(role !== 'rep' || isAdmin) && (
          <Select value={repFilter} onChange={e => setRepFilter(e.target.value)} className="!w-auto max-w-[180px]" aria-label="Rep filter">
            <option value="">All reps</option>
            {pickUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        )}
        {(role !== 'rep' || isAdmin) && teamOptions.length > 0 && (
          <Select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} className="!w-auto max-w-[200px]" aria-label="Team filter"
            title="Picks the TEAM'S PEOPLE, then everything each of them did — including leads they ran for another team.">
            <option value="">All teams</option>
            {teamOptions.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
        )}
        <Select value={missing} onChange={e => setMissing(e.target.value)} className="!w-auto" aria-label="Attention filter"
          title="Anything a human should look at: missing setter, no outcome logged after its time passed, a ran appointment with no closer, or a likely duplicate. Each row says which.">
          <option value="">All appointments</option>
          <option value="info">Needs attention</option>
        </Select>
        {/* The same appointments, read two ways: as a schedule, or per person. */}
        <PillGroup className="ml-auto" role="tablist">
          {[['list', 'List'], ['byrep', 'By rep']].map(([k, label]) => (
            <Pill key={k} active={view === k} onClick={() => pickView(k)}>{label}</Pill>
          ))}
        </PillGroup>
      </div>

      {view === 'list' && (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
        <KpiFigure label="Appointments Set" value={kpis.set} />
        <KpiFigure label="Ran (Estimates)"  value={kpis.ran} sub={kpis.showRate != null ? `${kpis.showRate.toFixed(0)}% show rate` : undefined} />
        {/* "Sold at appt" is an APPOINTMENT OUTCOME, not a sale record — the
            deals table is the only source of deal counts and revenue. */}
        <KpiFigure label="Sold at Appt"     value={kpis.sold} sub="outcome, not a deal record" />
        {/* The one gold number on this page. */}
        <KpiFigure label="Appt Close %"     value={kpis.closeRate == null ? '—' : `${kpis.closeRate.toFixed(0)}%`} sub="sold ÷ ran" color="var(--gold-tx)" />
        <KpiFigure label="No Shows"         value={kpis.noShow} />
      </div>
      )}

      {view === 'byrep' && activity && (
        <RepActivityTable data={activity} usersById={usersById} teamOf={teamOf} isAdmin={isAdmin} />
      )}

      {view === 'list' && filtered.length === 0 && (
        <Card padded={false}><EmptyBlock>No appointments in this range.</EmptyBlock></Card>
      )}

      {view === 'list' && byDay.map(g => (
      <Card key={g.day || 'nodate'} padded={false} style={g.isToday ? { borderColor: 'rgba(191,164,108,0.45)' } : undefined}>
        {/* Day header — the separator that turns one long list into a schedule. */}
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-4 py-2.5 border-b border-bank-line" style={{ background: 'var(--raise)' }}>
          <span className={`text-[13px] font-bold ${g.isToday ? 'text-bank-gold-tx' : 'text-bank-tx'}`}>{g.label}</span>
          {g.rel && (
            <span className="text-[12px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
              style={g.isToday ? { ...GOLD_WASH, color: 'var(--gold-tx)' } : { color: 'var(--mu)', border: '1px solid var(--line)' }}>{g.rel}</span>
          )}
          <span className="text-[13px] text-bank-mu ml-auto whitespace-nowrap">
            {g.rows.length} appt{g.rows.length === 1 ? '' : 's'}
            {g.ran > 0 && <> · <span className="text-bank-tx">{g.ran} ran</span></>}
            {g.sold > 0 && <> · <span style={{ color: 'var(--pos)' }}>{g.sold} sold</span></>}
          </span>
        </div>
        {g.rows.map(l => (
          <LeadRow key={l.id} l={l} s={stat(l.status)}
            gaps={l.ignored ? [] : gapReasons(l, new Date().toISOString(), nonReps)}
            isDupe={!l.ignored && dupes.has(l.id)}
            isAdmin={isAdmin} pickUsers={pickUsers} nonReps={nonReps}
            openHistory={openHistory} setPerson={setPerson} setStatus={setStatus} toggleIgnore={toggleIgnore} />
        ))}
      </Card>
      ))}
    </div>
  )
}
