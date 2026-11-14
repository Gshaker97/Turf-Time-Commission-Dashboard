import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { UserPlus, Handshake, Users, UserRound, ChevronLeft, ChevronDown, DoorOpen } from 'lucide-react'
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
import { PersonPicker } from '../components/DealModal'
import { RepDealsInline } from './Dashboard'
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus'
import { SURFACE, GOLD_WASH, Card, Eyebrow, KpiFigure, SecondaryButton, LoadingBlock, EmptyBlock } from '../components/ui'

// ============================================================
// Advanced stats (Garrison, Nov 14 2026). Four doors in: Setters, Closers,
// Teams, Individual. Every figure comes from the SAME engines the Dashboard
// uses — buildPerformance for the numbers, repActivity for the appointment
// list — so nothing here can disagree with the breakdown table.
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
  { key: 'set',      label: 'Appts set',      value: r => String(r.set ?? 0) },
  // More deals than sets happens (a sale with no appointment logged); the rate
  // blanks above 100% like every cross-source rate, and the line says why.
  { key: 'closed',   label: 'Sets closed',    value: r => `${r.deals ?? 0}`, sub: r => r.setCloseRate != null ? `${r.setCloseRate.toFixed(0)}% of ${r.set} set` : (r.set ? `${r.deals} deals from ${r.set} set · over 100%, rate blanked` : 'nothing set') },
]
const CLOSER_COLS = [
  { key: 'closesRevenue', label: 'Revenue closed', value: r => fmt(r.closesRevenue ?? 0), sub: () => 'deals they closed' },
  { key: 'ran',           label: 'Appts ran',      value: r => String(r.ran ?? 0), sub: r => (r.assigned ?? 0) > 0 ? `of ${r.assigned} assigned` : null },
  { key: 'closes',        label: 'Closed',         value: r => String(r.closes ?? 0) },
  { key: 'closeRate',     label: 'Close rate',     value: r => pct(r.closerCloseRate), sub: r => (r.assigned ?? 0) > 0 ? `${r.closes ?? 0} of ${r.assigned} assigned` : (r.closes ? `${r.closes} closed, none assigned` : 'nothing assigned') },
  { key: 'markup',        label: 'Avg markup',     value: r => pct1(r.closeMarkupPct) },
  { key: 'commission',    label: 'Commission',     value: r => fmt(r.commission) },
]
const TEAM_COLS = [
  { key: 'revenue', label: 'Revenue',     value: r => fmt(r.revenue) },
  { key: 'deals',   label: 'Deals',       value: r => String(r.deals) },
  { key: 'doors',   label: 'Doors',       value: r => (r.doors ?? 0).toLocaleString() },
  { key: 'set',     label: 'Appts set',   value: r => String(r.set ?? 0) },
  { key: 'close',   label: 'Close ratio', value: r => pct(r.setCloseRate), sub: r => r.set ? `${r.deals} of ${r.set} set` : 'nothing set' },
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
function Door({ icon: Icon, title, sub, onClick, active }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className="rounded-2xl p-5 md:p-6 text-left min-h-[44px] transition-colors hover:bg-bank-raise flex flex-col gap-3"
      style={active ? GOLD_WASH : SURFACE.card}>
      <span className="w-12 h-12 rounded-full flex items-center justify-center" style={active ? { background: 'var(--gold)', color: 'var(--gold-ink)' } : SURFACE.raise}>
        <Icon size={22} aria-hidden="true" />
      </span>
      <span>
        <span className={`block text-[15px] font-bold ${active ? 'text-bank-gold-tx' : 'text-bank-tx'}`}>{title}</span>
        <span className="block text-[13px] text-bank-mu mt-0.5">{sub}</span>
      </span>
    </button>
  )
}

export default function AdvancedStats() {
  const { isAdmin } = useAuth()
  const { perfDefaultTeam, feedNonReps } = useSettings()
  const [searchParams, setSearchParams] = useSearchParams()
  const view   = searchParams.get('view') || ''          // '' | setters | closers | teams | person
  const person = searchParams.get('person') || ''
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
  const [openTeam, setOpenTeam] = useState(null)
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
  const viewable = useMemo(() => users.filter(u => ['rep', 'manager', 'director', 'vp'].includes(u.role) && (isAdmin || !u.ghost)), [users, isAdmin])

  if (loading) return <LoadingBlock text="Loading advanced stats…" />

  const openPerson = (r) => go({ view: 'person', person: r.id })
  const title = view === 'setters' ? 'Setters' : view === 'closers' ? 'Closers' : view === 'teams' ? 'Teams' : view === 'person' ? (me?.name || 'Individual') : 'Advanced stats'

  return (
    <div className="space-y-4 pb-6 max-w-[1400px] mx-auto" style={{ color: 'var(--tx)' }}>
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-2">
        <DateRangeFilter from={dateFrom} to={dateTo} preset={preset}
          onChange={({ from, to, preset: p }) => { setDateFrom(from); setDateTo(to); setPreset(p) }}
          count={myAppts.length && view === 'person' ? myAppts.length : leads.filter(l => !l.ignored).length} countLabel="appointments" />
        {view && (
          <SecondaryButton onClick={() => go({ view: '', person: '' })} className="self-start">
            <ChevronLeft size={13} /> All views
          </SecondaryButton>
        )}
      </div>

      {/* The four doors. Stay visible as a strip once a view is open. */}
      <div className={`grid grid-cols-2 md:grid-cols-4 gap-3`}>
        <Door icon={UserPlus}  title="Setters" sub="Revenue, doors, sets and what closed" active={view === 'setters'} onClick={() => go({ view: 'setters', person: '' })} />
        <Door icon={Handshake} title="Closers" sub="Revenue, ran, closed, close rate, markup" active={view === 'closers'} onClick={() => go({ view: 'closers', person: '' })} />
        <Door icon={Users}     title="Teams"   sub="Every team, then its people" active={view === 'teams'} onClick={() => go({ view: 'teams', person: '' })} />
        <Door icon={UserRound} title="Individual" sub="Pick one person" active={view === 'person'} onClick={() => go({ view: 'person' })} />
      </div>

      {view === 'setters' && (
        <Card padded={false}>
          <div className="px-4 py-3 border-b border-bank-line">
            <h2 className="text-[15px] font-bold text-bank-tx">{title}</h2>
            <p className="text-[13px] text-bank-mu">Revenue is the baseline of deals they set. Doors are the RepCard feed's count. Tap a name for their page.</p>
          </div>
          <StatTable rows={setters} cols={SETTER_COLS} onOpen={openPerson} nameLabel="Setter" emptyText="No setters with activity in this range." />
        </Card>
      )}

      {view === 'closers' && (
        <Card padded={false}>
          <div className="px-4 py-3 border-b border-bank-line">
            <h2 className="text-[15px] font-bold text-bank-tx">{title}</h2>
            <p className="text-[13px] text-bank-mu">Revenue is the baseline of deals they closed. Close rate is closed ÷ every appointment assigned to them. Tap a name for their page.</p>
          </div>
          <StatTable rows={closers} cols={CLOSER_COLS} onOpen={openPerson} nameLabel="Closer" emptyText="No closers with activity in this range." />
        </Card>
      )}

      {view === 'teams' && (
        <Card padded={false}>
          <div className="px-4 py-3 border-b border-bank-line">
            <h2 className="text-[15px] font-bold text-bank-tx">Teams</h2>
            <p className="text-[13px] text-bank-mu">Tap a team to see its people, then a person for their page.</p>
          </div>
          {teams.map(t => (
            <div key={t.id} className="border-t border-bank-line">
              <button onClick={() => setOpenTeam(openTeam === t.id ? null : t.id)} aria-expanded={openTeam === t.id}
                className="w-full flex items-center gap-2 px-4 py-3 min-h-[44px] text-left hover:bg-bank-raise">
                <ChevronDown size={14} className={`text-bank-fa transition-transform ${openTeam === t.id ? '' : '-rotate-90'}`} />
                <span className="text-[13px] font-bold text-bank-tx">{t.name}</span>
                <span className="text-[13px] text-bank-mu">· {t.rows.length} {t.rows.length === 1 ? 'person' : 'people'}</span>
                <span className="ml-auto text-[13px] text-bank-tx tabular-nums hidden sm:block">{fmt(t.revenue)} · {t.deals} deals · {t.set ?? 0} set · {pct(t.setCloseRate)}</span>
              </button>
              {openTeam === t.id && (
                <div className="px-2 pb-3" style={{ background: 'var(--bg)' }}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3 px-2 py-3">
                    {TEAM_COLS.map(c => <KpiFigure key={c.key} label={c.label} value={c.value(t)} sub={c.sub ? c.sub(t) : undefined} size="sm" />)}
                  </div>
                  <StatTable rows={t.rows.map(r => ({ ...r, badge: usersById[r.id]?.sales_role || null }))}
                    cols={SETTER_COLS.slice(0, 1).concat([
                      { key: 'deals', label: 'Deals', value: r => String(r.deals) },
                      SETTER_COLS[1], SETTER_COLS[2],
                      { key: 'ratio', label: 'Close ratio', value: r => isCloser(usersById[r.id]?.sales_role) && !isSetter(usersById[r.id]?.sales_role) ? pct(r.closerCloseRate) : pct(r.setCloseRate),
                        sub: r => isCloser(usersById[r.id]?.sales_role) && !isSetter(usersById[r.id]?.sales_role) ? ((r.assigned ?? 0) > 0 ? `${r.closes ?? 0} of ${r.assigned} assigned` : 'nothing assigned') : (r.set ? `${r.deals} of ${r.set} set` : 'nothing set') },
                      { key: 'commission', label: 'Commission', value: r => fmt(r.commission) },
                    ])}
                    onOpen={openPerson} nameLabel="Person" emptyText="Nobody on this team in this range." />
                </div>
              )}
            </div>
          ))}
          {teams.length === 0 && <EmptyBlock>No teams in this range.</EmptyBlock>}
        </Card>
      )}

      {view === 'person' && (
        <>
          <Card>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <Eyebrow>Individual</Eyebrow>
                {me ? (
                  <>
                    <h2 className="text-[20px] font-bold text-bank-tx mt-1">{me.name}</h2>
                    <p className="text-[13px] text-bank-mu">{[meTeam, SALES_ROLE[me.sales_role] || 'No sales role set'].filter(Boolean).join(' · ')}</p>
                  </>
                ) : <p className="text-[13px] text-bank-mu mt-1">Pick a person to see their page.</p>}
              </div>
              <div className="w-full sm:w-[260px]">
                <PersonPicker value={person || ''} users={viewable} onChange={(id) => go({ view: 'person', person: id })} placeholder="Search a person…" />
              </div>
            </div>
          </Card>

          {me && meRow && (
            <>
              {isSetter(me.sales_role) && (
                <Card>
                  <Eyebrow className="mb-3">As a setter</Eyebrow>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
                    {SETTER_COLS.map(c => <KpiFigure key={c.key} label={c.label} value={c.value(meRow)} sub={c.sub ? c.sub(meRow) : undefined} />)}
                    <KpiFigure label="Commission" value={fmt(meRow.commission)} />
                  </div>
                </Card>
              )}
              {isCloser(me.sales_role) && (
                <Card>
                  <Eyebrow className="mb-3">As a closer</Eyebrow>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3">
                    {CLOSER_COLS.map(c => <KpiFigure key={c.key} label={c.label} value={c.value(meRow)} sub={c.sub ? c.sub(meRow) : undefined} />)}
                  </div>
                </Card>
              )}

              <Card padded={false}>
                <div className="px-4 py-3 border-b border-bank-line flex items-baseline justify-between gap-3">
                  <h3 className="text-[15px] font-bold text-bank-tx">Appointments</h3>
                  <span className="text-[13px] text-bank-mu">{myAppts.length} in range · tap one for its disposition and notes</span>
                </div>
                {myAppts.length === 0 && <EmptyBlock>No appointments involving {me.name.split(' ')[0]} in this range.</EmptyBlock>}
                {myAppts.map(a => {
                  const o = OUTCOME[a.status] || { label: a.status || '—', color: 'var(--mu)' }
                  const open = openAppt === a.id
                  const l = a.lead
                  return (
                    <div key={a.id} className="border-t border-bank-line">
                      <button onClick={() => setOpenAppt(open ? null : a.id)} aria-expanded={open}
                        className="w-full text-left px-4 py-2.5 min-h-[44px] hover:bg-bank-raise flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] text-bank-tx truncate">{a.customer}{l?.address ? <span className="text-bank-mu"> · {l.address}</span> : null}</p>
                          <p className="text-[13px] text-bank-mu">{whenLabel(a.at)} · {PART[a.role] || a.role}{a.role === 'set' && a.closerName ? ` · ran by ${a.closerName}` : ''}{a.role === 'closer' && a.setterName ? ` · set by ${a.setterName}` : ''}</p>
                        </div>
                        <span className="text-[13px] font-semibold whitespace-nowrap" style={{ color: o.color }}>{o.label}</span>
                        <ChevronDown size={14} className={`text-bank-fa flex-shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
                      </button>
                      {open && (
                        <div className="px-4 pb-3 grid grid-cols-1 md:grid-cols-2 gap-3" style={{ background: 'var(--bg)' }}>
                          <div className="pt-3">
                            <p className="text-[13px] text-bank-fa uppercase tracking-wider font-semibold">Disposition</p>
                            <p className="text-[13px] text-bank-tx mt-0.5">{a.disposition || l?.disposition || <span className="text-bank-fa">none recorded</span>}</p>
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
        </>
      )}

      {!view && (
        <p className="text-[13px] text-bank-mu flex items-center gap-1.5"><DoorOpen size={13} aria-hidden="true" /> Pick a view above. Numbers follow the date range and match the Dashboard breakdown.</p>
      )}
    </div>
  )
}
