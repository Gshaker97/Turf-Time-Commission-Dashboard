import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { UserPlus, Handshake, Users, UserRound, ChevronLeft, ChevronDown, ChevronRight, Search } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { fetchCompanyDeals, fetchUsers, fetchTeamChanges, fetchLeads, fetchFieldActivity } from '../lib/db'
import { fmt, activeDeals } from '../utils/commission'
import { headIdSet, buildChangesByProfile, teamKeyFor, teamLabel } from '../utils/team'
import { buildPerformance } from '../utils/perfSummary'
import { repActivity } from '../utils/repActivity'
import { repDeals } from '../utils/scorecard'
import { getPresetRange } from '../utils/dateRanges'
import DateRangeFilter from '../components/DateRangeFilter'
import { RepDealsInline } from './Dashboard'
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus'
import { SURFACE, Card, Eyebrow, KpiFigure, SecondaryButton, LoadingBlock, EmptyBlock, Input } from '../components/ui'

// ============================================================
// Advanced stats (Garrison, Nov 14–15 2026). Four doors in: Setters, Closers,
// Teams, Individual. Each door opens ITS OWN screen — a search box and a pick
// list — and a tap opens one person (or one team, then one of its people).
// Nothing lives on one long page. Every figure comes from the SAME engines
// the Dashboard uses — buildPerformance for the numbers, repActivity for the
// appointment list — so nothing here can disagree with the breakdown table.
//
// Setter view: revenue closed from their sets · doors · appointments set ·
// how many of those sets closed. Closer view: revenue of the deals they
// closed · appointments ran · closed · close rate (closed ÷ assigned) · avg
// markup · commission. A person's page shows the group that fits their
// sales role (both groups for "both" or unset), then every appointment
// involving them with its status, disposition and notes, then their deals.
//
// Door counts come from the RepCard field_activity feed. They never fully
// reconciled with RepCard's own leaderboard (see CLAUDE.md), so they are
// shown as the feed's count, not a verified figure.
// ============================================================

const pct = (v) => (v == null ? '—' : `${v.toFixed(0)}%`)
const pct1 = (v) => (v == null ? '—' : `${v.toFixed(1)}%`)
const SALES_ROLE = { setter: 'Setter', closer: 'Closer', both: 'Setter & closer' }
const OUTCOME = {
  sold:      { label: 'Sold',      color: 'var(--pos)' },
  completed: { label: 'Ran',       color: 'var(--tx)' },
  scheduled: { label: 'Scheduled', color: 'var(--mu)' },
  no_show:   { label: 'No show',   color: 'var(--warn)' },
  canceled:  { label: 'Canceled',  color: 'var(--fa)' },
}
const PART = { self: 'Set & ran', set: 'Set', closer: 'Ran' }
const TH = 'text-[13px] uppercase tracking-wider text-bank-fa font-semibold py-2 px-2'
const TD = 'py-2.5 px-2 text-[13px] tabular-nums'
const whenLabel = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
const isSetter = (role) => role === 'setter' || role === 'both' || !role

// The last load, kept for the life of the tab. Five reads (deals, people, team
// changes, every appointment, every door-knock day) take a few seconds on
// production, and nothing about them is per-visit — so a return to this page
// paints the previous data at once and refreshes underneath. Lost on a full
// reload, which is also how to force a clean read.
let lastLoad = null
const isCloser = (role) => role === 'closer' || role === 'both' || !role

// ── Column sets ─────────────────────────────────────────────────────────────
// Each column: label, value(row) → string, and `sub` for the small line under it.
const SETTER_COLS = [
  { key: 'revenue',  label: 'Revenue closed', value: r => fmt(r.revenue), sub: () => 'from their sets' },
  { key: 'doors',    label: 'Doors',          value: r => (r.doors ?? 0).toLocaleString(), sub: r => r.knockDays ? `${r.knockDays} day${r.knockDays === 1 ? '' : 's'}` : null },
  { key: 'doorsPerSet', label: 'Doors per set', value: r => r.doorsPerSet != null ? Math.round(r.doorsPerSet).toLocaleString() : '—', sub: r => r.doorsPerSet != null ? 'doors to book one' : (r.set ? 'no doors logged' : null) },
  { key: 'set',      label: 'Appts set',      value: r => String(r.set ?? 0) },
  // Kept apart from every rate: a full calendar is not a bad close rate.
  { key: 'upcoming', label: 'Upcoming',       value: r => String(r.upcoming ?? 0), sub: () => 'booked, not run yet' },
  // More deals than sets happens (a sale with no appointment logged); the rate
  // blanks above 100% like every cross-source rate, and the line says why.
  { key: 'closed',   label: 'Sets closed',    value: r => `${r.deals ?? 0}`, sub: r => r.setRanCloseRate != null ? `${r.setRanCloseRate.toFixed(0)}% of ${r.setRan} ran` : ((r.setRan ?? 0) > 0 ? `${r.deals} deals from ${r.setRan} ran · over 100%, rate blanked` : (r.set ? `${r.set} set, none ran yet` : 'nothing set')) },
]
const CLOSER_COLS = [
  { key: 'closesRevenue', label: 'Revenue closed', value: r => fmt(r.closesRevenue ?? 0), sub: () => 'deals they closed' },
  { key: 'ran',           label: 'Appts ran',      value: r => String(r.ran ?? 0), sub: r => (r.assigned ?? 0) > 0 ? `of ${r.assigned} assigned` : null },
  { key: 'closes',        label: 'Closed',         value: r => String(r.closes ?? 0) },
  { key: 'closeRate',     label: 'Close rate',     value: r => pct(r.ranCloseRate), sub: r => (r.ran ?? 0) > 0 ? `${r.closes ?? 0} of ${r.ran} ran` : (r.closes ? `${r.closes} closed, none ran` : 'nothing ran') },
  { key: 'markup',        label: 'Avg markup',     value: r => pct1(r.closeMarkupPct) },
  { key: 'commission',    label: 'Commission',     value: r => fmt(r.commission) },
  { key: 'upcoming',      label: 'Upcoming',       value: r => String(r.upcomingAssigned ?? 0), sub: () => 'assigned, not run yet' },
]

// Count appointments by what RepCard says happened. Disposition text first,
// the status word when there is none, so "Follow up" and "Canceled" each get
// their own line instead of all reading "Ran".
function dispositionCounts(appts) {
  const m = new Map()
  for (const a of appts) {
    const key = (a.disposition || a.lead?.disposition || OUTCOME[a.status]?.label || a.status || 'Unknown').trim()
    m.set(key, (m.get(key) || 0) + 1)
  }
  return [...m.entries()].sort((x, y) => y[1] - x[1])
}
function DispositionList({ title, appts }) {
  const rows = dispositionCounts(appts)
  const total = appts.length
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="text-[15px] font-bold text-bank-tx">{title}</h3>
        <span className="text-[13px] text-bank-mu">{total} in range</span>
      </div>
      {rows.length === 0 && <p className="text-[13px] text-bank-mu">Nothing in this range.</p>}
      {rows.map(([label, n]) => (
        <div key={label} className="mb-2 last:mb-0">
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-bank-tx min-w-0 truncate">{label}</span>
            <span className="text-bank-mu tabular-nums whitespace-nowrap">{n} · {Math.round((n / total) * 100)}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden mt-1" style={{ background: 'var(--raise)' }}>
            <div className="h-full rounded-full" style={{ width: `${(n / total) * 100}%`, background: 'var(--tx)' }} />
          </div>
        </div>
      ))}
    </Card>
  )
}
const TEAM_COLS = [
  { key: 'revenue', label: 'Revenue',     value: r => fmt(r.revenue) },
  { key: 'deals',   label: 'Deals',       value: r => String(r.deals) },
  { key: 'doors',   label: 'Doors',       value: r => (r.doors ?? 0).toLocaleString() },
  { key: 'set',     label: 'Appts set',   value: r => String(r.set ?? 0) },
  { key: 'close',   label: 'Close ratio', value: r => pct(r.setRanCloseRate), sub: r => (r.setRan ?? 0) > 0 ? `${r.deals} of ${r.setRan} ran` : 'nothing ran' },
  { key: 'commission', label: 'Commission', value: r => fmt(r.commission) },
]

// A people/teams table: real table on desktop, stacked rows on phones. The
// first column is a button that opens the row (a person's page, or a team).
function StatTable({ rows, cols, onOpen, nameLabel = 'Name', emptyText = 'Nothing in this range.' }) {
  if (!rows.length) return <EmptyBlock>{emptyText}</EmptyBlock>
  return (
    <>
      <div className="hidden md:block">
        <table className="w-full">
          <thead>
            <tr>
              <th className={`${TH} text-left`}>{nameLabel}</th>
              {cols.map(c => <th key={c.key} className={`${TH} text-right`}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="border-t border-bank-line hover:bg-bank-raise cursor-pointer" onClick={() => onOpen(r)}>
                <td className={`${TD} text-left`}>
                  <span className="text-bank-fa mr-2">{i + 1}</span>
                  <span className="font-semibold text-bank-tx">{r.name}</span>
                  {r.badge && <span className="ml-2 text-[12px] uppercase tracking-wide text-bank-fa">{r.badge}</span>}
                </td>
                {cols.map(c => {
                  const sub = c.sub ? c.sub(r) : null
                  return (
                    <td key={c.key} className={`${TD} text-right text-bank-tx`}>
                      {c.value(r)}
                      {sub && <span className="block text-[13px] text-bank-fa font-normal">{sub}</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="md:hidden">
        {rows.map((r, i) => (
          <button key={r.id} onClick={() => onOpen(r)} className="w-full text-left px-4 py-3 border-t border-bank-line min-h-[44px] hover:bg-bank-raise">
            <p className="text-[13px] font-semibold text-bank-tx"><span className="text-bank-fa mr-2">{i + 1}</span>{r.name}{r.badge && <span className="ml-2 text-[12px] uppercase tracking-wide text-bank-fa font-normal">{r.badge}</span>}</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-1.5">
              {cols.map(c => (
                <div key={c.key} className="min-w-0">
                  <p className="text-[13px] text-bank-fa">{c.label}</p>
                  <p className="text-[13px] text-bank-tx tabular-nums">{c.value(r)}{c.sub && c.sub(r) ? <span className="text-bank-fa"> · {c.sub(r)}</span> : null}</p>
                </div>
              ))}
            </div>
          </button>
        ))}
      </div>
    </>
  )
}

// One big door in.
function Door({ icon: Icon, title, sub, onClick }) {
  return (
    <button onClick={onClick}
      className="rounded-2xl p-6 md:p-8 text-left min-h-[44px] transition-colors hover:bg-bank-raise flex flex-col gap-4"
      style={SURFACE.card}>
      <span className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'var(--gold)', color: 'var(--gold-ink)' }}>
        <Icon size={26} aria-hidden="true" />
      </span>
      <span>
        <span className="block text-[17px] font-bold text-bank-tx">{title}</span>
        <span className="block text-[13px] text-bank-mu mt-0.5">{sub}</span>
      </span>
    </button>
  )
}

export default function AdvancedStats() {
  const { isAdmin } = useAuth()
  const { perfDefaultTeam, feedNonReps } = useSettings()
  const [searchParams, setSearchParams] = useSearchParams()
  const view   = searchParams.get('view') || ''          // '' | setters | closers | teams | team | people | person
  const person = searchParams.get('person') || ''
  const teamKey = searchParams.get('team') || ''
  const from   = searchParams.get('from') || ''          // where a person page goes Back to
  const [search, setSearch] = useState('')
  const go = (next) => {
    const sp = new URLSearchParams(searchParams)
    for (const [k, v] of Object.entries(next)) { if (v) sp.set(k, v); else sp.delete(k) }
    setSearchParams(sp)
  }

  const [deals, setDeals] = useState(() => lastLoad?.deals ?? [])
  const [users, setUsers] = useState(() => lastLoad?.users ?? [])
  const [teamChanges, setTeamChanges] = useState(() => lastLoad?.teamChanges ?? [])
  const [leads, setLeads] = useState(() => lastLoad?.leads ?? [])
  const [activity, setActivity] = useState(() => lastLoad?.activity ?? [])
  const [loading, setLoading] = useState(!lastLoad)
  const [dateFrom, setDateFrom] = useState(getPresetRange('mtd').from)
  const [dateTo, setDateTo] = useState(getPresetRange('mtd').to)
  const [preset, setPreset] = useState('mtd')
  const [openAppt, setOpenAppt] = useState(null)

  const loadData = () =>
    Promise.all([fetchCompanyDeals(), fetchUsers(), fetchTeamChanges(), fetchLeads(), fetchFieldActivity()])
      .then(([{ data: d }, { data: u }, { data: tc }, { data: l }, { data: fa }]) => {
        const next = { deals: activeDeals(d ?? []), users: u ?? [], teamChanges: tc ?? [], leads: l ?? [], activity: fa ?? [] }
        lastLoad = next
        setDeals(next.deals); setUsers(next.users); setTeamChanges(next.teamChanges); setLeads(next.leads); setActivity(next.activity)
      })
  useEffect(() => { loadData().finally(() => setLoading(false)) }, [])
  useRefreshOnFocus(loadData)

  const usersById = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users])
  const teamCtx = useMemo(() => ({ usersById, heads: headIdSet(users), changesByProfile: buildChangesByProfile(teamChanges) }), [usersById, users, teamChanges])
  const perf = useMemo(() => buildPerformance({
    deals, leads, activity, users, teamCtx, range: { from: dateFrom, to: dateTo },
    defaultTeamId: perfDefaultTeam || null, nonRepNames: feedNonReps,
  }), [deals, leads, activity, users, teamCtx, dateFrom, dateTo, perfDefaultTeam, feedNonReps])

  // Every person's row, across all teams. Ghosts stay hidden from non-admins,
  // exactly as on the Dashboard leaderboard.
  const people = useMemo(() => {
    const seen = new Map()
    for (const t of perf.teams) for (const r of t.rows) {
      if (r.ghost && !isAdmin) continue
      if (!seen.has(r.id)) seen.set(r.id, { ...r, teamLabel: t.label, salesRole: usersById[r.id]?.sales_role ?? null })
    }
    return [...seen.values()]
  }, [perf, isAdmin, usersById])
  const setters = useMemo(() => people.filter(p => isSetter(p.salesRole) && (p.salesRole || p.set > 0 || p.doors > 0))
    .map(p => ({ ...p, badge: p.salesRole === 'both' ? 'both' : null }))
    .sort((a, b) => b.revenue - a.revenue || b.set - a.set || a.name.localeCompare(b.name)), [people])
  const closers = useMemo(() => people.filter(p => isCloser(p.salesRole) && (p.salesRole || p.assigned > 0 || p.closes > 0))
    .map(p => ({ ...p, badge: p.salesRole === 'both' ? 'both' : null }))
    .sort((a, b) => (b.closesRevenue ?? 0) - (a.closesRevenue ?? 0) || b.closes - a.closes || a.name.localeCompare(b.name)), [people])
  const teams = useMemo(() => perf.teams.filter(t => !t.unassigned || t.rows.length)
    .map(t => ({ id: t.key, name: t.label, ...t.totals, rows: t.rows.filter(r => !r.ghost || isAdmin) })), [perf, isAdmin])
  // Everyone who sells, for the Individual door — with or without activity.
  const everyone = useMemo(() => users
    .filter(u => ['rep', 'manager', 'director', 'vp'].includes(u.role) && u.active !== false && (isAdmin || !u.ghost))
    .map(u => { const head = usersById[teamKeyFor(u, teamCtx.heads)]; return { ...u, teamLabel: head ? teamLabel(head) : null } })
    .sort((a, b) => a.name.localeCompare(b.name)), [users, usersById, teamCtx, isAdmin])

  // ── One person ────────────────────────────────────────────────────────────
  const me = person ? usersById[person] : null
  const meRow = useMemo(() => people.find(p => p.id === person) || null, [people, person])
  const meTeam = useMemo(() => {
    if (!me) return null
    const head = usersById[teamKeyFor(me, teamCtx.heads)]
    return head ? teamLabel(head) : null
  }, [me, usersById, teamCtx])
  const leadsById = useMemo(() => Object.fromEntries(leads.map(l => [l.id, l])), [leads])
  const myAppts = useMemo(() => {
    if (!person) return []
    const { rows } = repActivity(leads, deals, { users, from: dateFrom || null, to: dateTo || null, onlyIds: [person] })
    const row = rows.find(r => r.id === person)
    const out = new Map()
    for (const a of row?.appts ?? []) if (!out.has(a.id)) out.set(a.id, { ...a, lead: leadsById[a.id] || null })
    return [...out.values()].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
  }, [person, leads, deals, users, dateFrom, dateTo, leadsById])
  const myDeals = useMemo(() => person ? repDeals(deals, person, { from: dateFrom, to: dateTo }) : [], [deals, person, dateFrom, dateTo])
  const team = useMemo(() => teams.find(t => t.id === teamKey) || null, [teams, teamKey])

  if (loading) return <LoadingBlock text="Loading advanced stats…" />

  // Search is per screen: it clears when the screen changes.
  const q = search.trim().toLowerCase()
  const hit = (...parts) => !q || parts.filter(Boolean).join(' ').toLowerCase().includes(q)
  const open = (next) => { setSearch(''); go(next) }
  const openPerson = (r, origin) => open({ view: 'person', person: r.id, from: origin, team: origin === 'team' ? teamKey : '' })
  const back = () => {
    if (view === 'person') return open(from === 'team' ? { view: 'team', person: '', from: '' } : { view: from || '', person: '', from: '', team: '' })
    if (view === 'team') return open({ view: 'teams', team: '' })
    return open({ view: '', team: '', person: '', from: '' })
  }
  const roleRatio = (r) => {
    const role = usersById[r.id]?.sales_role
    const closerOnly = isCloser(role) && !isSetter(role)
    return closerOnly
      ? { v: pct(r.ranCloseRate), sub: (r.ran ?? 0) > 0 ? `${r.closes ?? 0} of ${r.ran} ran` : 'nothing ran' }
      : { v: pct(r.setRanCloseRate), sub: (r.setRan ?? 0) > 0 ? `${r.deals} of ${r.setRan} ran` : 'nothing ran' }
  }
  const MEMBER_COLS = [
    SETTER_COLS[0],
    { key: 'deals', label: 'Deals', value: r => String(r.deals) },
    SETTER_COLS[1], SETTER_COLS[2],
    { key: 'ratio', label: 'Close ratio', value: r => roleRatio(r).v, sub: r => roleRatio(r).sub },
    { key: 'commission', label: 'Commission', value: r => fmt(r.commission) },
  ]

  const SCREEN = {
    setters: { title: 'Setters', hint: 'Revenue is the baseline of deals they set. Sets closed is out of the sets that ran. Doors are the RepCard feed\'s count. Tap a setter for their page.' },
    closers: { title: 'Closers', hint: 'Revenue is the baseline of deals they closed. Close rate is closed ÷ appointments they ran. Tap a closer for their page.' },
    teams:   { title: 'Teams',   hint: 'Tap a team for its numbers and its people.' },
    people:  { title: 'Individual', hint: 'Everyone who sells. Tap a name for their page.' },
    team:    { title: team?.name || 'Team', hint: 'Tap a person for their page.' },
    person:  { title: me?.name || 'Individual', hint: null },
  }
  const screen = SCREEN[view]

  // A screen header: Back, the title, and (on pick lists) a search box. A plain
  // render helper on purpose — a component defined inside render remounts on
  // every keystroke and the search box loses focus.
  const screenHead = ({ withSearch, placeholder, count } = {}) => (
    <div className="px-4 py-3 border-b border-bank-line flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <SecondaryButton onClick={back}><ChevronLeft size={13} /> Back</SecondaryButton>
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold text-bank-tx">{screen.title}</h2>
          {screen.hint && <p className="text-[13px] text-bank-mu">{screen.hint}</p>}
        </div>
        {count != null && <span className="ml-auto text-[13px] text-bank-mu">{count} {count === 1 ? 'match' : 'matches'}</span>}
      </div>
      {withSearch && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-bank-fa pointer-events-none" aria-hidden="true" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={placeholder} className="pl-9" aria-label={placeholder} />
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-4 pb-6 max-w-[1400px] mx-auto" style={{ color: 'var(--tx)' }}>
      <DateRangeFilter from={dateFrom} to={dateTo} preset={preset}
        onChange={({ from: f, to: t, preset: p }) => { setDateFrom(f); setDateTo(t); setPreset(p) }}
        count={view === 'person' ? myAppts.length : leads.filter(l => !l.ignored).length} countLabel="appointments" />

      {/* ── The four doors (landing only) ── */}
      {!view && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Door icon={UserPlus}  title="Setters"    sub="Pick a setter: revenue, doors, sets and what closed" onClick={() => open({ view: 'setters' })} />
          <Door icon={Handshake} title="Closers"    sub="Pick a closer: revenue, ran, closed, close rate, markup" onClick={() => open({ view: 'closers' })} />
          <Door icon={Users}     title="Teams"      sub="Pick a team, then one of its people" onClick={() => open({ view: 'teams' })} />
          <Door icon={UserRound} title="Individual" sub="Search anyone who sells" onClick={() => open({ view: 'people' })} />
        </div>
      )}

      {/* ── Setters / Closers: searchable pick list with their figures ── */}
      {(view === 'setters' || view === 'closers') && (() => {
        const rows = (view === 'setters' ? setters : closers).filter(r => hit(r.name, r.teamLabel))
        return (
          <Card padded={false}>
            {screenHead({ withSearch: true, placeholder: view === 'setters' ? 'Search setters…' : 'Search closers…', count: q ? rows.length : null })}
            <StatTable rows={rows} cols={view === 'setters' ? SETTER_COLS : CLOSER_COLS} onOpen={r => openPerson(r, view)}
              nameLabel={view === 'setters' ? 'Setter' : 'Closer'} emptyText={q ? 'No one matches that.' : `No ${view} with activity in this range.`} />
          </Card>
        )
      })()}

      {/* ── Individual: everyone who sells, searchable ── */}
      {view === 'people' && (() => {
        const rows = everyone.filter(u => hit(u.name, u.teamLabel, SALES_ROLE[u.sales_role]))
        return (
          <Card padded={false}>
            {screenHead({ withSearch: true, placeholder: 'Search by name or team…', count: q ? rows.length : null })}
            {rows.length === 0 && <EmptyBlock>No one matches that.</EmptyBlock>}
            {rows.map(u => (
              <button key={u.id} onClick={() => openPerson(u, 'people')}
                className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] border-t border-bank-line text-left hover:bg-bank-raise">
                <span className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold text-bank-mu flex-shrink-0" style={SURFACE.well}>
                  {(u.name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-bank-tx truncate">{u.name}</span>
                  <span className="block text-[13px] text-bank-mu truncate">{[u.teamLabel, SALES_ROLE[u.sales_role] || 'No sales role set'].filter(Boolean).join(' · ')}</span>
                </span>
                <ChevronRight size={14} className="text-bank-fa flex-shrink-0" />
              </button>
            ))}
          </Card>
        )
      })()}

      {/* ── Teams: searchable list → one team ── */}
      {view === 'teams' && (() => {
        const rows = teams.filter(t => hit(t.name))
        return (
          <Card padded={false}>
            {screenHead({ withSearch: true, placeholder: 'Search teams…', count: q ? rows.length : null })}
            {rows.length === 0 && <EmptyBlock>No team matches that.</EmptyBlock>}
            {rows.map(t => (
              <button key={t.id} onClick={() => open({ view: 'team', team: t.id })}
                className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] border-t border-bank-line text-left hover:bg-bank-raise">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-bold text-bank-tx">{t.name} <span className="font-normal text-bank-mu">· {t.rows.length} {t.rows.length === 1 ? 'person' : 'people'}</span></span>
                  <span className="block text-[13px] text-bank-mu tabular-nums">{fmt(t.revenue)} · {t.deals} deals · {t.set ?? 0} set · {pct(t.setRanCloseRate)} close</span>
                </span>
                <ChevronRight size={14} className="text-bank-fa flex-shrink-0" />
              </button>
            ))}
          </Card>
        )
      })()}

      {/* ── One team: its numbers, then its people (searchable) ── */}
      {view === 'team' && team && (() => {
        const rows = team.rows.map(r => ({ ...r, badge: usersById[r.id]?.sales_role || null })).filter(r => hit(r.name))
        return (
          <Card padded={false}>
            {screenHead({ withSearch: true, placeholder: 'Search this team…', count: q ? rows.length : null })}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3 px-4 py-4 border-b border-bank-line">
              {TEAM_COLS.map(c => <KpiFigure key={c.key} label={c.label} value={c.value(team)} sub={c.sub ? c.sub(team) : undefined} />)}
            </div>
            <StatTable rows={rows} cols={MEMBER_COLS} onOpen={r => openPerson(r, 'team')} nameLabel="Person" emptyText={q ? 'No one on this team matches that.' : 'Nobody on this team in this range.'} />
          </Card>
        )
      })()}
      {view === 'team' && !team && <Card><EmptyBlock>That team has nothing in this range. <button className="text-bank-gold-tx hover:underline" onClick={back}>Back to teams</button></EmptyBlock></Card>}

      {/* ── One person ── */}
      {view === 'person' && (
        <>
          <Card padded={false}>
            {screenHead()}
            {me ? (
              <div className="px-4 py-3">
                <Eyebrow>Individual</Eyebrow>
                <p className="text-[13px] text-bank-mu mt-1">{[meTeam, SALES_ROLE[me.sales_role] || 'No sales role set'].filter(Boolean).join(' · ')}</p>
              </div>
            ) : <EmptyBlock>That person is not on the roster.</EmptyBlock>}
          </Card>

          {me && meRow && (
            <>
              {isSetter(me.sales_role) && (
                <Card>
                  <Eyebrow className="mb-3">As a setter</Eyebrow>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                    {SETTER_COLS.map(c => <KpiFigure key={c.key} label={c.label} value={c.value(meRow)} sub={c.sub ? c.sub(meRow) : undefined} />)}
                    <KpiFigure label="Commission" value={fmt(meRow.commission)} />
                  </div>
                </Card>
              )}
              {isSetter(me.sales_role) && <DispositionList title="What happened to their sets" appts={myAppts.filter(a => a.role === 'set' || a.role === 'self')} />}
              {isCloser(me.sales_role) && (
                <Card>
                  <Eyebrow className="mb-3">As a closer</Eyebrow>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                    {CLOSER_COLS.map(c => <KpiFigure key={c.key} label={c.label} value={c.value(meRow)} sub={c.sub ? c.sub(meRow) : undefined} />)}
                  </div>
                </Card>
              )}
              {isCloser(me.sales_role) && <DispositionList title="What happened to the appointments they ran" appts={myAppts.filter(a => a.role === 'closer' || a.role === 'self')} />}

              <Card padded={false}>
                <div className="px-4 py-3 border-b border-bank-line flex items-baseline justify-between gap-3">
                  <h3 className="text-[15px] font-bold text-bank-tx">Appointments</h3>
                  <span className="text-[13px] text-bank-mu">{myAppts.length} in range · tap one for its notes</span>
                </div>
                {myAppts.length === 0 && <EmptyBlock>No appointments involving {me.name.split(' ')[0]} in this range.</EmptyBlock>}
                {myAppts.map(a => {
                  const o = OUTCOME[a.status] || { label: a.status || '—', color: 'var(--mu)' }
                  const isOpen = openAppt === a.id
                  const l = a.lead
                  return (
                    <div key={a.id} className="border-t border-bank-line">
                      <button onClick={() => setOpenAppt(isOpen ? null : a.id)} aria-expanded={isOpen}
                        className="w-full text-left px-4 py-2.5 min-h-[44px] hover:bg-bank-raise flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] text-bank-tx truncate">{a.customer}{l?.address ? <span className="text-bank-mu"> · {l.address}</span> : null}</p>
                          <p className="text-[13px] text-bank-mu">{whenLabel(a.at)} · {PART[a.role] || a.role}{a.role === 'set' && a.closerName ? ` · ran by ${a.closerName}` : ''}{a.role === 'closer' && a.setterName ? ` · set by ${a.setterName}` : ''}</p>
                        </div>
                        {/* The right column is the DISPOSITION — what RepCard says
                            happened — not the status word (Garrison, Nov 16 2026:
                            "it just shows Ran"). Status only when there is none. */}
                        <span className="text-[13px] font-semibold text-right max-w-[45%] md:max-w-[260px] truncate" style={{ color: o.color }} title={a.disposition || l?.disposition || o.label}>
                          {a.disposition || l?.disposition || o.label}
                        </span>
                        <ChevronDown size={14} className={`text-bank-fa flex-shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                      </button>
                      {isOpen && (
                        <div className="px-4 pb-3 grid grid-cols-1 md:grid-cols-2 gap-3" style={{ background: 'var(--bg)' }}>
                          <div className="pt-3">
                            <p className="text-[13px] text-bank-fa uppercase tracking-wider font-semibold">Status · disposition</p>
                            <p className="text-[13px] text-bank-tx mt-0.5">{o.label}{(a.disposition || l?.disposition) ? ` · ${a.disposition || l?.disposition}` : <span className="text-bank-fa"> · no disposition recorded</span>}</p>
                          </div>
                          <div className="pt-3">
                            <p className="text-[13px] text-bank-fa uppercase tracking-wider font-semibold">Notes</p>
                            <p className="text-[13px] text-bank-tx mt-0.5 whitespace-pre-wrap break-words">{l?.notes || <span className="text-bank-fa">no notes</span>}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </Card>

              <Card>
                <h3 className="text-[15px] font-bold text-bank-tx mb-3">Deals</h3>
                <RepDealsInline deals={myDeals} repId={person} />
              </Card>
            </>
          )}
          {me && !meRow && <Card><EmptyBlock>No activity for {me.name} in this range.</EmptyBlock></Card>}
        </>
      )}
    </div>
  )
}
