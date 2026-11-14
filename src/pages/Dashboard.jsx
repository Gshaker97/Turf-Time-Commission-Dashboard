import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  format, subMonths, startOfWeek, endOfWeek, addDays, getDaysInMonth,
} from 'date-fns'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Check, X, TrendingUp, TrendingDown, Minus, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, ChevronsUpDown, Copy, AlertCircle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import {
  fetchCompanyDeals, fetchUsers, fetchTeamChanges, fetchLeads,
  fetchGoalsForMonth, fetchRepGoals, saveGoal as saveGoalDb, deleteGoal as deleteGoalDb,
} from '../lib/db'
import { fmt, dealAmounts, activeDeals } from '../utils/commission'
import { headIdSet, buildChangesByProfile } from '../utils/team'
import { buildRecordBook, periodEnd } from '../utils/records'
import { buildPerformance, repFlags } from '../utils/perfSummary'
import {
  COMPANY, isCompany, pickScope, scopeFilter, resolveScopeGoal,
  scopeToParam, scopeFromParam, repDeals as repDealsFor, leaderboard, sortLeaderboard,
} from '../utils/scorecard'
import { onClickUnlessSelecting } from '../utils/selection'
import { copyTable as copyRichTable } from '../lib/clipboard'
import { getPresetRange, getPreviousRange } from '../utils/dateRanges'
import DateRangeFilter from '../components/DateRangeFilter'
import { SURFACE, WARN_BORDER, plural, Card, KpiFigure, Pill, PillGroup, SecondaryButton, Expandable, LoadingBlock, EmptyBlock } from '../components/ui'
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus'

const POS = 'var(--pos)', NEG = 'var(--neg)', WARN = 'var(--warn)'
const goalTone = (pct) => pct == null ? 'var(--fa)' : pct >= 100 ? POS : pct >= 80 ? 'var(--mu)' : WARN

function Trend({ cur, prev, suffix = 'vs prev' }) {
  if (prev === null || prev === undefined) return null
  if (prev === 0 && cur === 0) return null
  const pct = prev > 0 ? ((cur - prev) / prev) * 100 : (cur > 0 ? 100 : 0)
  if (Math.abs(pct) < 0.1 && prev > 0)
    return <div className="flex items-center gap-1 text-[13px] text-bank-fa"><Minus size={12} /> unchanged</div>
  const up = pct >= 0
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <div className="flex items-center gap-1 text-[13px] font-semibold" style={{ color: up ? POS : NEG }}>
      <Icon size={12} /><span>{Math.abs(pct).toFixed(1)}%</span>
      <span className="text-bank-fa font-normal">{suffix}</span>
    </div>
  )
}

// A leaderboard column header you can rank by. Shows the live arrow, or a
// faint hint when it isn't the active sort.
function SortTh({ label, col, sort, onSort, title, first }) {
  const on = sort.key === col
  return (
    <th className={`py-2 ${first ? 'pr-2' : 'px-2'}`} title={title}>
      <button onClick={() => onSort(col)}
        className={`w-full flex items-center gap-0.5 uppercase tracking-wider text-[13px] font-semibold transition-colors ${
          first ? 'justify-start' : 'justify-end'} ${on ? 'text-bank-tx' : 'text-bank-fa hover:text-bank-mu'}`}>
        <span>{label}</span>
        {on ? (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
            : <ChevronsUpDown size={12} className="opacity-50" />}
      </button>
    </th>
  )
}

function Delta({ cur, prev }) {
  if (prev == null) return null
  if (!prev && !cur) return null
  if (!prev) return <span className="block text-[13px] font-normal" style={{ color: POS }}>new</span>
  const pct = ((cur - prev) / Math.abs(prev)) * 100
  if (Math.abs(pct) < 0.5) return <span className="block text-[13px] text-bank-fa font-normal">flat</span>
  const up = pct > 0
  return (
    <span className="block text-[13px] font-semibold" style={{ color: up ? POS : NEG }}>
      {up ? '▲' : '▼'} {Math.abs(pct) >= 999 ? '999+' : Math.abs(pct).toFixed(0)}%
    </span>
  )
}

const TH = 'text-[13px] uppercase tracking-wider text-bank-fa font-semibold py-2'
const TD = 'text-right py-2 px-2 tabular-nums text-[13px]'
const TD_SUB = 'block text-[13px] text-bank-fa font-normal'

// One rep's deals, shown inline under the rep row in the team accordion (no
// page shift). Mirrors the rep-scope deals table. Table on desktop, rows on
// phones so nothing scrolls sideways.
function RepDealsInline({ deals, repId }) {
  return (
    <div className="rounded-xl overflow-hidden" style={SURFACE.well}>
      <table className="hidden md:table w-full text-[13px]">
        <thead>
          <tr>
            <th className={`${TH} text-left px-3`}>Deal</th>
            <th className={`${TH} text-left px-2`}>Sold</th>
            <th className={`${TH} text-right px-2`}>Revenue</th>
            <th className={`${TH} text-left px-2`}>Status</th>
          </tr>
        </thead>
        <tbody>
          {deals.map(d => (
            <tr key={d.id} className="border-t border-bank-line">
              <td className="py-2 px-3 text-bank-tx truncate max-w-[240px]">{d.deal_name}</td>
              <td className="py-2 px-2 text-bank-mu whitespace-nowrap">{d.sale_date}</td>
              <td className="text-right py-2 px-2 tabular-nums text-bank-tx">{fmt(parseFloat(d.baseline_revenue) || 0)}</td>
              <td className="py-2 px-2 text-bank-mu">{d.status}</td>
            </tr>
          ))}
          {deals.length === 0 && (
            <tr><td colSpan={4} className="py-3 text-center text-bank-mu">No deals in this range.</td></tr>
          )}
        </tbody>
      </table>
      <div className="md:hidden">
        {deals.map(d => (
          <div key={d.id} className="flex items-center justify-between gap-3 px-3 py-2.5 border-b border-bank-line last:border-0">
            <div className="min-w-0">
              <p className="text-[13px] text-bank-tx truncate">{d.deal_name}</p>
              <p className="text-[13px] text-bank-mu">{d.sale_date} · {d.status}</p>
            </div>
            <span className="text-[13px] font-semibold text-bank-tx tabular-nums whitespace-nowrap">{fmt(parseFloat(d.baseline_revenue) || 0)}</span>
          </div>
        ))}
        {deals.length === 0 && <p className="py-3 text-center text-[13px] text-bank-mu">No deals in this range.</p>}
      </div>
      <div className="px-3 py-2 border-t border-bank-line">
        <a href={`/deals?scope=all&rep=${repId}`} className="text-[13px] text-bank-gold-tx hover:underline inline-flex items-center min-h-[44px] md:min-h-0">Open in Deals →</a>
      </div>
    </div>
  )
}

// The numeric <td>s shared by a drill-table row and an expanded rep sub-row, so
// the two always line up with the same header. (Optional Set/Ran, then Revenue,
// Deals, Avg deal, Markup, Commission — the Goal cell is rendered by the caller
// since its percentage depends on which goal applies.)
function StatCells({ st, prev, showActivity, flagSet = false, bold = false }) {
  const base = bold ? 'font-bold text-bank-tx' : 'text-bank-mu'
  return (
    <>
      {showActivity && (
        <>
          <td className={`${TD} ${flagSet ? 'font-bold' : base}`} style={flagSet ? { color: NEG } : undefined}>
            {st.set ?? 0}
            {st.showRate != null && <span className={TD_SUB}>{st.showRate.toFixed(0)}% ran</span>}
          </td>
          <td className={`${TD} ${base}`}>
            {st.ran ?? 0}
            {st.dealCloseRate != null && <span className={TD_SUB}>{st.dealCloseRate.toFixed(0)}% closed</span>}
          </td>
        </>
      )}
      <td className={`${TD} text-bank-tx font-semibold`}>{fmt(st.revenue)}<Delta cur={st.revenue} prev={prev?.revenue} /></td>
      <td className={`${TD} ${base}`}>{st.deals}<Delta cur={st.deals} prev={prev?.deals} /></td>
      <td className={`${TD} ${base}`}>{st.avgDeal != null ? fmt(st.avgDeal) : '—'}</td>
      <td className={`${TD} ${base}`}>{st.markupPct != null ? `${st.markupPct.toFixed(1)}%` : '—'}</td>
      <td className={`${TD} ${base}`}>{fmt(st.commission)}</td>
    </>
  )
}

function GoalCell({ pct, bold = false }) {
  return (
    <td className={`${TD} ${bold ? 'font-bold' : ''}`}>
      {pct == null ? <span className="text-bank-fa">—</span>
        : <span style={{ color: goalTone(pct) }} className={pct >= 100 ? 'font-semibold' : ''}>{Math.round(pct)}%</span>}
    </td>
  )
}

// Phone view of one table row: the remaining columns as a small grid.
function MobileStats({ st, prev, showActivity, goalPct, flagSet }) {
  const Item = ({ label, children, style }) => (
    <div className="min-w-0">
      <p className="text-[13px] text-bank-fa">{label}</p>
      <p className="text-[13px] font-semibold text-bank-tx tabular-nums" style={style}>{children}</p>
    </div>
  )
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3" style={{ background: 'var(--bg)' }}>
      {showActivity && (<>
        <Item label="Set" style={flagSet ? { color: NEG } : undefined}>{st.set ?? 0}{st.showRate != null && <span className="text-bank-fa font-normal"> · {st.showRate.toFixed(0)}% ran</span>}</Item>
        <Item label="Ran">{st.ran ?? 0}{st.dealCloseRate != null && <span className="text-bank-fa font-normal"> · {st.dealCloseRate.toFixed(0)}% closed</span>}</Item>
      </>)}
      <Item label="Revenue">{fmt(st.revenue)}<Delta cur={st.revenue} prev={prev?.revenue} /></Item>
      <Item label="Deals">{st.deals}<Delta cur={st.deals} prev={prev?.deals} /></Item>
      <Item label="Avg deal">{st.avgDeal != null ? fmt(st.avgDeal) : '—'}</Item>
      <Item label="Markup">{st.markupPct != null ? `${st.markupPct.toFixed(1)}%` : '—'}</Item>
      <Item label="Commission">{fmt(st.commission)}</Item>
      <Item label="Goal" style={{ color: goalTone(goalPct) }}>{goalPct == null ? '—' : `${Math.round(goalPct)}%`}</Item>
    </div>
  )
}

// Right-hand summary on a phone row: revenue over deal count.
function RowRight({ revenue, deals }) {
  return (
    <div className="text-right flex-shrink-0">
      <p className="text-[14px] font-bold text-bank-tx tabular-nums">{fmt(revenue)}</p>
      <p className="text-[13px] text-bank-mu">{plural(deals ?? 0, 'deal')}</p>
    </div>
  )
}

// Goal editor (monthly and weekly share it): the amount is a button for
// admins, an input while editing, with ✓ / ✕ / reset.
function GoalEditor({ editing, value, onChange, onBlur, onSave, onCancel, onReset, canEdit, startEdit, isCustom, amount, status, size = 'lg' }) {
  const amtCls = size === 'lg' ? 'text-[18px] md:text-[20px]' : 'text-[15px] md:text-[17px]'
  if (editing) return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-bank-mu">$</span>
      <input autoFocus type="number" value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur}
        onKeyDown={e => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancel() }}
        style={SURFACE.raise} aria-label="Goal amount"
        className="w-28 rounded-lg px-2 py-1 min-h-[44px] md:min-h-0 text-[16px] font-bold text-bank-tx focus:outline-none" />
      <button onMouseDown={e => e.preventDefault()} onClick={onSave} aria-label="Save goal"
        className="p-2 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 md:p-1.5 rounded-lg hover:bg-bank-raise flex items-center justify-center" style={{ color: POS }}><Check size={15} /></button>
      <button onMouseDown={e => e.preventDefault()} onClick={onCancel} aria-label="Cancel"
        className="p-2 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 md:p-1.5 rounded-lg text-bank-mu hover:bg-bank-raise flex items-center justify-center"><X size={15} /></button>
      {isCustom && (
        <button onMouseDown={e => e.preventDefault()} onClick={onReset}
          className="text-[13px] text-bank-mu hover:text-bank-tx underline ml-1 min-h-[44px] md:min-h-0">reset</button>
      )}
    </div>
  )
  return (
    <div className="flex items-center gap-2">
      {canEdit ? (
        <button onClick={startEdit} title="Edit goal"
          className={`${amtCls} font-bold text-bank-tx hover:bg-bank-raise rounded px-2 -mx-2 py-0.5 min-h-[44px] md:min-h-0 transition-colors tabular-nums`}>
          {fmt(amount)}
        </button>
      ) : (
        <p className={`${amtCls} font-bold text-bank-tx tabular-nums`}>{fmt(amount)}</p>
      )}
      {status === 'saved' && <span className="text-[13px] font-semibold" style={{ color: POS }}>Saved</span>}
      {status === 'error' && <span className="text-[13px] font-semibold" style={{ color: NEG }}>Save failed</span>}
    </div>
  )
}

function Bar({ pct, height = 'h-3', gold = false }) {
  return (
    <div className={`${height} rounded-full overflow-hidden`} style={{ background: 'var(--raise)' }}>
      <div className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, background: pct >= 100 ? POS : gold ? 'var(--gold)' : 'var(--tx)' }} />
    </div>
  )
}

export default function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { isAdmin } = useAuth()
  const { settings, save: saveSettingCtx, dataStartDate, perfFloors, perfDefaultTeam, feedNonReps } = useSettings()
  // Setting the monthly revenue goal is a data change — admin-only.
  const canEditGoal = isAdmin

  const [deals,        setDeals]        = useState([])
  const [users,        setUsers]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [dateFrom,     setDateFrom]     = useState(getPresetRange('mtd').from)
  const [dateTo,       setDateTo]       = useState(getPresetRange('mtd').to)
  const [activePreset, setActivePreset] = useState('mtd')
  const [teamChanges,  setTeamChanges]  = useState([])
  const [copied,       setCopied]       = useState(false)
  // WHO am I looking at: company | team | office | office-team | rep. One
  // control replaces the old team dropdown AND the Performance page's team
  // sections, and it drives every block below — tiles, goal, funnel, table,
  // both charts.
  const [scope,        setScope]        = useState(() => scopeFromParam(searchParams.get('scope')))
  const [groupBy,      setGroupBy]      = useState('team')     // company level: team | office
  // Inside an OFFICE: team | rep. Kept separate from `groupBy` rather than
  // overloading it — they share the value 'team' but mean different things,
  // and clicking into an office from the Offices view would otherwise land on
  // a grouping that level does not have.
  const [officeGroup,  setOfficeGroup]  = useState('team')
  // Which team rows are expanded in the company-level Teams breakdown. Clicking
  // a team drops its reps in underneath, in place, instead of re-scoping the
  // whole page to that team (per Keaton — the full-page shift was jarring).
  const [expandedTeams, setExpandedTeams] = useState(() => new Set())
  const toggleTeam = (key) => setExpandedTeams(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  // A rep inside an expanded team can expand again to show its own deals, in
  // place, without scoping the page to that rep (per Keaton).
  const [expandedReps, setExpandedReps] = useState(() => new Set())
  const toggleRep = (id) => setExpandedReps(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const [showActivity, setShowActivity] = useState(false)      // extra door/appointment columns
  const [leads,        setLeads]        = useState([])
  const [officeGoals,  setOfficeGoals]  = useState({})   // { '': company, Phoenix: n, … }
  const [repGoalMap,   setRepGoalMap]   = useState({})
  const [teamGoalMap,  setTeamGoalMap]  = useState({})
  const [editingGoal,  setEditingGoal]  = useState(false)
  const [goalInput,    setGoalInput]    = useState('')
  // The stored target for the CURRENT scope — company/office rows come from
  // monthly_goals, team/rep from rep_goals (read-only here; they are set on
  // the Goals page). null = fall back to the auto 3-month-average goal.
  const [saveStatus,   setSaveStatus]   = useState('idle')
  const [saveError,    setSaveError]    = useState(null)
  const skipBlurSaveRef = useRef(false)
  const [editingWeekGoal, setEditingWeekGoal] = useState(false)
  const [weekGoalInput,   setWeekGoalInput]   = useState('')
  const [weekSaveStatus,  setWeekSaveStatus]  = useState('idle')
  const skipWeekBlurRef = useRef(false)

  const goalDate  = useMemo(() => dateFrom ? new Date(dateFrom + 'T12:00:00') : new Date(), [dateFrom])
  const goalYear  = goalDate.getFullYear()
  const goalMonth = goalDate.getMonth() + 1

  const loadData = () =>
    // NOTE no fetchFieldActivity: DOOR KNOCKS ARE NOT SHOWN ANYWHERE (per
    // Keaton — RepCard's own door count never reconciled with ours and the
    // number was not worth chasing). The feed still records them, so turning
    // it back on is re-adding the fetch and the tiles; see CLAUDE.md.
    // COMPANY-WIDE on purpose: fetchCompanyDeals, never fetchDeals. The
    // restricted read made a rep's Dashboard report their own two deals as
    // the company's revenue, goal progress and records.
    Promise.all([fetchCompanyDeals(), fetchUsers(), fetchTeamChanges(), fetchLeads()])
      .then(([{ data: d }, { data: u }, { data: tc }, { data: l }]) => {
        setDeals(activeDeals(d ?? []))   // canceled AND hidden jobs never count
        setUsers(u ?? [])
        setTeamChanges(tc ?? [])
        setLeads(l ?? [])                // appointments, for the funnel
      })

  useEffect(() => { loadData().finally(() => setLoading(false)) }, [])
  useRefreshOnFocus(loadData)   // repull when returning to the tab so stats stay current

  // Company + per-office goals (monthly_goals, migration 053) and the
  // rep/team goals (rep_goals) — all four levels the scope bar can reach.
  useEffect(() => {
    let alive = true
    setOfficeGoals({}); setRepGoalMap({}); setTeamGoalMap({})
    fetchGoalsForMonth(goalYear, goalMonth).then(({ data }) => { if (alive) setOfficeGoals(data || {}) })
    fetchRepGoals(goalYear, goalMonth).then(({ data }) => {
      if (!alive) return
      const r = {}, t = {}
      for (const g of data || []) (g.scope === 'team' ? t : r)[g.subject_id] = g.target
      setRepGoalMap(r); setTeamGoalMap(t)
    })
    return () => { alive = false }
  }, [goalYear, goalMonth])

  // Keep the scope in the URL so a team lead can be sent straight to their team.
  useEffect(() => {
    const cur = searchParams.get('scope') || ''
    const next = scopeToParam(scope)
    if (cur === next) return
    const sp = new URLSearchParams(searchParams)
    if (next) sp.set('scope', next); else sp.delete('scope')
    setSearchParams(sp, { replace: true })
  }, [scope, searchParams, setSearchParams])

  function handleRangeChange({ from, to, preset }) {
    setDateFrom(from); setDateTo(to); setActivePreset(preset)
  }

  const prevPeriod = useMemo(
    () => getPreviousRange(activePreset, dateFrom, dateTo),
    [dateFrom, dateTo, activePreset]
  )

  // Date-effective team attribution: a sale belongs to the team its owner was
  // on AS OF THE SALE DATE (team_changes log) — moving a rep never rewrites
  // history. Shared by the team filter, team breakdown, and monthly goal.
  const usersById = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users])
  const headsSet  = useMemo(() => headIdSet(users), [users])
  const changesByProfile = useMemo(() => buildChangesByProfile(teamChanges), [teamChanges])

  // THE chokepoint. `filtered`, `prevFiltered`, the KPI tiles, the goal card
  // and both charts all run through this, so pointing it at the scope is what
  // makes the whole page re-scope on a drill rather than just the table.
  const teamCtx = useMemo(() => ({ usersById, heads: headsSet, changesByProfile }),
    [usersById, headsSet, changesByProfile])
  function applyScopeFilters(rows) {
    if (isCompany(scope)) return rows
    return rows.filter(scopeFilter(scope, teamCtx))
  }

  // Every deal in the date range with the team filter NOT applied. The Rep
  // Leaderboard credits each rep from ALL of their deals and then keeps only
  // the filtered team's MEMBERS — see repData for why that isn't the same as
  // filtering the deals first.
  const dateFiltered = useMemo(() => {
    let r = deals
    if (dateFrom) r = r.filter(d => d.sale_date >= dateFrom)
    if (dateTo)   r = r.filter(d => d.sale_date <= dateTo)
    return r
  }, [deals, dateFrom, dateTo])

  const filtered = useMemo(() => applyScopeFilters(dateFiltered), [dateFiltered, scope, teamCtx])

  const prevFiltered = useMemo(() => {
    if (!prevPeriod) return []
    return applyScopeFilters(deals).filter(d => d.sale_date >= prevPeriod.from && d.sale_date <= prevPeriod.to)
  }, [deals, scope, teamCtx, prevPeriod])

  function computeTotals(rows) {
    let baseline = 0, commission = 0
    for (const d of rows) {
      const a = dealAmounts(d)
      baseline   += a.baseline
      commission += a.repCommission   // rep (setter+closer) take — matches the Deals tab + leaderboard, excludes overrides
    }
    const totalPrice = rows.reduce((s, d) => s + (parseFloat(d.job_price) || 0), 0)
    const count      = rows.length
    return { totalPrice, baseline, commission, avgCommPct: baseline > 0 ? (commission / baseline) * 100 : 0, deals: count, avgDeal: count ? baseline / count : 0, avgJob: count ? totalPrice / count : 0 }
  }
  const totals     = useMemo(() => computeTotals(filtered),     [filtered])
  const prevTotals = useMemo(() => computeTotals(prevFiltered), [prevFiltered])

  // ── The scope tree ───────────────────────────────────────────────────
  // buildPerformance already computes org + offices[] + teams[] with rep rows
  // for the window, so nothing is recomputed here: `pickScope` just selects
  // the node the scope bar points at, and its children become the table.
  const perf = useMemo(() => buildPerformance({
    deals, leads, activity: [], users, teamCtx,
    range: { from: dateFrom, to: dateTo },
    prev: prevPeriod,
    defaultTeamId: perfDefaultTeam || null,
    nonRepNames: feedNonReps,
    // NOT passing excludedIds. On the old Performance page that list removed a
    // person's production from the page's totals, which was tolerable there
    // and is not here: this page is the company's revenue number. Hiding a job
    // that should not count is now `deals.hidden` (migration 052).
  }), [deals, leads, users, teamCtx, dateFrom, dateTo, prevPeriod, perfDefaultTeam, feedNonReps])

  // A scope can go stale — a team with no sales this range, a rep who left.
  // Fall back to company rather than render an empty page.
  // Which grouping applies depends only on the SCOPE's level, which is known
  // without the node — so there is no chicken-and-egg with pickScope.
  const grouping = scope?.level === 'office' ? officeGroup : groupBy
  const node = useMemo(() => pickScope(perf, scope, grouping) || pickScope(perf, COMPANY, groupBy),
    [perf, scope, grouping, groupBy])
  useEffect(() => {
    // GUARD ON `loading`, not just on `perf`: buildPerformance always returns
    // an object, so during the first render — before the deals arrive — every
    // scope resolves to null and this reset fired instantly, wiping `?scope`
    // from the URL. That silently broke EVERY shared scope link ("send a team
    // lead a link that opens on their own team"), not only the new one.
    if (loading) return
    if (!isCompany(scope) && perf && !pickScope(perf, scope, grouping)) setScope(COMPANY)
  }, [loading, perf, scope, grouping])

  const goalInfo = useMemo(() => resolveScopeGoal(node, {
    companyGoal: officeGoals[''] ?? null, officeGoals,
    repGoals: repGoalMap, teamGoals: teamGoalMap,
  }), [node, officeGoals, repGoalMap, teamGoalMap])
  // What monthlyGoal treats as "a target was set for this scope" — null makes
  // it fall back to the auto 3-month-average.
  const savedGoal = goalInfo.target

  // Which office key this scope saves a goal against ('' = company).
  const goalOfficeKey = node?.level === 'office' ? node.title : ''
  const canEditThisGoal = canEditGoal && (node?.level === 'company' || node?.level === 'office')

  // Breadcrumb trail — Company › Team › Rep, or Company › Office › Team,
  // each step clickable.
  const trail = useMemo(() => {
    const t = [{ label: 'Company', scope: COMPANY }]
    if (!node || node.level === 'company') return t
    if (node.level === 'rep' && node.parentTeam) {
      t.push({ label: node.parentTeam.label, scope: { level: 'team', key: node.parentTeam.key } })
    }
    if (node.level === 'office-team' && node.parentOffice) {
      t.push({ label: node.parentOffice.label, scope: { level: 'office', key: node.parentOffice.key } })
    }
    t.push({ label: node.title, scope: null })
    return t
  }, [node])

  // One level up from the current node (the breadcrumb's second-to-last step),
  // so a drilled-in rep / office-team can back out from inside its own section
  // without scrolling up to the breadcrumb.
  const backStep   = node && node.level !== 'company' ? trail[trail.length - 2] : null
  const backScope  = backStep ? backStep.scope : undefined
  const backLabel  = backStep ? backStep.label : null

  const flagFloors = perfFloors || undefined

  // The deals behind a rep — the rep scope has no children to list.
  const repDealRows = useMemo(
    () => (node?.level === 'rep' ? repDealsFor(deals, node.key, { from: dateFrom, to: dateTo }) : []),
    [node, deals, dateFrom, dateTo])

  // Every individual in the current scope, ranked. The drill table shows
  // TEAMS at company level, so this is the only at-a-glance view of people.
  const repBoardRaw = useMemo(() => leaderboard(perf, scope, { isAdmin }), [perf, scope, isAdmin])
  const [boardSort, setBoardSort] = useState({ key: 'revenue', dir: 'desc' })
  const toggleBoardSort = (key) =>
    setBoardSort(v => (v.key === key ? { key, dir: v.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))
  const repBoard = useMemo(() => sortLeaderboard(repBoardRaw, boardSort.key, boardSort.dir),
    [repBoardRaw, boardSort])

  // A team's own rep rows (for the inline accordion) — those with activity in
  // range, ghosts hidden from non-admins, ranked by revenue.
  const teamRepRows = (key) => {
    const t = perf?.teams.find(x => x.key === key)
    return (t?.rows || [])
      .filter(r => r.deals || r.leadCloses || r.revenue || r.commission)
      .filter(r => isAdmin || !r.ghost)
      .sort((a, b) => b.revenue - a.revenue)
  }

  // Copy the leaderboard as a REAL TABLE (text/html) with a tab-separated
  // fallback, so it pastes formatted into Canva / Sheets / Docs — Keaton
  // pastes this straight into a meeting he runs, which is the whole point of
  // the button. Ghost reps are always dropped from the EXPORT even for an
  // admin who can see them on screen: it leaves the building.
  const [copiedBoard, setCopiedBoard] = useState(false)
  async function copyLeaderboard() {
    const cols = ['#', 'Rep', 'Revenue', 'Total Revenue', 'Set Deals', 'Self-Gen', 'Leads Closed', 'Commission']
    const rows = repBoard.filter(r => !r.ghost).map((r, i) =>
      [i + 1, r.name, fmt(r.revenue), fmt(r.totalRevenue), r.setForOthers, r.selfGen, r.leadCloses, fmt(r.commission)])
    if (await copyRichTable(cols, rows, { rightFrom: 2 })) {
      setCopiedBoard(true); setTimeout(() => setCopiedBoard(false), 1800)
    }
  }

  // Copy the visible table for pasting into a text or a slide — the reason
  // this page exists, per Keaton: pulling numbers for team leaders.
  async function copyTable() {
    if (!node) return
    const cols = ['Name', ...(showActivity ? ['Set','Ran'] : []),
                  'Revenue','Deals','Avg deal','Markup','Commission']
    const line = (label, st) => [label,
      ...(showActivity ? [st.set ?? 0, st.ran ?? 0] : []),
      fmt(st.revenue), st.deals,
      st.avgDeal != null ? fmt(st.avgDeal) : '',
      st.markupPct != null ? st.markupPct.toFixed(1) + '%' : '',
      fmt(st.commission)]
    const rows = [
      { section: `${node.fullTitle || node.title} · ${dateFrom} to ${dateTo}` },
      ...(node.children.length ? node.children.map(c => line(c.label, c.stats)) : []),
      line('TOTAL', node.stats),
    ]
    if (await copyRichTable(cols, rows, { rightFrom: 1 })) {
      setCopied(true); setTimeout(() => setCopied(false), 1800)
    }
  }

  // ── Record moments: every record currently falling, in one card ──
  // Fires while a record is being beaten in progress, and for up to 7 days
  // after a completed period sets a new all-time best.
  //
  // These used to be full-width banners capped at three, each with its own ✕.
  // Six record types across company/team/rep means up to EIGHTEEN can be live
  // at once, so the cap silently threw most of them away — and because company
  // records sort first, team and rep records essentially never surfaced. The
  // cap is gone: the card shows all of them, grouped by scope so company still
  // reads first, and the whole section collapses instead of being dismissed
  // record-by-record (same pattern as the Leads rep board).
  // COLLAPSED by default. Six record types across company/team/rep means a
  // dozen-plus can be live at once, and expanded they filled the whole first
  // screen before a single figure — the opposite of what this page is for.
  // The header still reads "N records falling right now", so nothing is lost;
  // opening it is one click and the choice sticks.
  const [recsOpen, setRecsOpen] = useState(() => {
    try { return localStorage.getItem('tt_records_open') === 'on' } catch { return false }
  })
  const toggleRecs = () => setRecsOpen(v => {
    const next = !v
    try { localStorage.setItem('tt_records_open', next ? 'on' : 'off') } catch { /* ignore */ }
    return next
  })
  const recordMoments = useMemo(() => {
    if (!deals.length) return []
    const today = format(new Date(), 'yyyy-MM-dd')
    const { company, reps, teams } = buildRecordBook(deals, {
      users, isAdmin, dataStartDate, todayISO: today,
      teamCtx: { usersById, heads: headsSet, changesByProfile },
    })
    const NAMES = {
      revMonth: ['month', 'Biggest month'], revWeek: ['week', 'Biggest week'], revDay: ['day', 'Biggest day'],
      dealsMonth: ['month', 'Most deals in a month'], dealsWeek: ['week', 'Most deals in a week'], dealsDay: ['day', 'Most deals in a day'],
    }
    const cutoff = new Date(today + 'T12:00:00'); cutoff.setDate(cutoff.getDate() - 7)
    const cutISO = format(cutoff, 'yyyy-MM-dd')
    const val = (key, v) => key.startsWith('deals') ? `${v} deals` : fmt(v)
    // "was $88,140 · Jordan Bagwell, May 2026" — the mark that's being beaten,
    // and who held it. A record without that context is just a number.
    const wasLine = (key, rec) =>
      `was ${val(key, rec.value)}${[rec.holderName, rec.label].filter(Boolean).join(', ') ? ` · ${[rec.holderName, rec.label].filter(Boolean).join(', ')}` : ''}`

    const scan = (book, scope) => {
      const out = []
      if (!book) return out
      for (const [key, rec] of Object.entries(book)) {
        if (!NAMES[key] || !rec || typeof rec !== 'object' || !('status' in rec)) continue
        const [grain, label] = NAMES[key]
        if (rec.status === 'new' && rec.best) {
          out.push({
            id: `rec-${scope}-${key}-${rec.current.key}`, scope,
            who: rec.current.holderName || null, kind: label, live: true,
            value: val(key, rec.current.value), was: wasLine(key, rec.best),
          })
        } else if (rec.best && rec.prev && periodEnd(grain, rec.best.key) >= cutISO) {
          out.push({
            id: `rec-${scope}-${key}-${rec.best.key}`, scope,
            who: rec.best.holderName || null, kind: label, live: false,
            value: val(key, rec.best.value), was: wasLine(key, rec.prev),
          })
        }
      }
      return out
    }
    // Company first, then team, then rep — biggest news at the top.
    return [...scan(company, 'company'), ...scan(teams, 'team'), ...scan(reps, 'rep')]
  }, [deals, users, isAdmin, dataStartDate, usersById, headsSet, changesByProfile])

  // Grouped for display, keeping the company → team → rep order.
  const recordGroups = useMemo(() => {
    const meta = { company: ['Company', '#fbbf24'], team: ['Team', '#a78bfa'], rep: ['Rep', '#00b894'] }
    return ['company', 'team', 'rep']
      .map(s => ({ scope: s, label: meta[s][0], color: meta[s][1], rows: recordMoments.filter(m => m.scope === s) }))
      .filter(g => g.rows.length)
  }, [recordMoments])

  const monthlyGoal = useMemo(() => {
    const curKey = `${String(goalYear).padStart(4,'0')}-${String(goalMonth).padStart(2,'0')}`
    function monthTotal(mk) {
      return applyScopeFilters(deals.filter(d => d.sale_date?.startsWith(mk)))
        .reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0)
    }
    const curRevenue = monthTotal(curKey)
    const trailing   = [1,2,3].map(i => monthTotal(format(subMonths(goalDate, i), 'yyyy-MM')))
    const autoGoal   = Math.max((trailing.reduce((s,v) => s+v,0)/3)*1.1, 10000)
    const goal       = savedGoal != null ? savedGoal : autoGoal
    const pct        = Math.min((curRevenue/goal)*100, 100)
    return { curRevenue, goal, pct, isCustom: savedGoal != null, month: format(goalDate, 'MMMM yyyy') }
  }, [deals, scope, teamCtx, savedGoal, goalYear, goalMonth, goalDate])

  // Weekly goal: always tracks the CURRENT week (Sun–Sat, same week rule as the
  // rest of reporting), regardless of the selected date range. A custom $ lives
  // in app_settings.weekly_goal (admin-set, applies every week until changed);
  // otherwise auto = monthly goal ÷ weeks in the month.
  const weeklyGoal = useMemo(() => {
    const now = new Date()
    const wkStart = startOfWeek(now, { weekStartsOn: 0 })
    const wkEnd   = endOfWeek(now,   { weekStartsOn: 0 })
    const ws = format(wkStart, 'yyyy-MM-dd'), we = format(wkEnd, 'yyyy-MM-dd')
    const rows = applyScopeFilters(deals.filter(d => d.sale_date >= ws && d.sale_date <= we))
    const curRevenue = rows.reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0)
    const saved    = parseFloat(settings.weekly_goal)
    const isCustom = Number.isFinite(saved) && saved > 0
    const autoGoal = monthlyGoal.goal / (getDaysInMonth(goalDate) / 7)
    const goal     = isCustom ? saved : autoGoal
    const pct      = Math.min((curRevenue / goal) * 100, 100)
    return { curRevenue, goal, pct, isCustom, label: `${format(wkStart, 'MMM d')} – ${format(wkEnd, 'MMM d')}` }
  }, [deals, scope, teamCtx, settings.weekly_goal, monthlyGoal.goal, goalDate])

  function startEditWeekGoal() { setWeekGoalInput(weeklyGoal.goal.toFixed(0)); setWeekSaveStatus('idle'); setEditingWeekGoal(true) }
  function cancelWeekGoalEdit() { skipWeekBlurRef.current = true; setEditingWeekGoal(false) }
  function handleWeekGoalBlur() { if (skipWeekBlurRef.current) { skipWeekBlurRef.current = false; return } saveWeekGoal() }
  async function saveWeekGoal() {
    const v = parseFloat(weekGoalInput)
    if (!(v > 0)) { setEditingWeekGoal(false); return }
    setEditingWeekGoal(false)
    const { error } = await saveSettingCtx('weekly_goal', v)
    if (error) { setWeekSaveStatus('error'); return }
    setWeekSaveStatus('saved'); setTimeout(() => setWeekSaveStatus('idle'), 2000)
  }
  async function resetWeekGoal() {
    skipWeekBlurRef.current = true; setEditingWeekGoal(false)
    const { error } = await saveSettingCtx('weekly_goal', null)
    if (error) { setWeekSaveStatus('error'); return }
    setWeekSaveStatus('saved'); setTimeout(() => setWeekSaveStatus('idle'), 2000)
  }

  function startEditGoal() { setGoalInput(monthlyGoal.goal.toFixed(0)); setSaveStatus('idle'); setSaveError(null); setEditingGoal(true) }
  function cancelGoalEdit() { skipBlurSaveRef.current = true; setEditingGoal(false) }
  function handleGoalBlur() { if (skipBlurSaveRef.current) { skipBlurSaveRef.current = false; return } saveGoal() }
  async function saveGoal() {
    const v = parseFloat(goalInput)
    if (!(v > 0)) { setEditingGoal(false); return }
    setEditingGoal(false)
    const { error } = await saveGoalDb(goalYear, goalMonth, v, goalOfficeKey)
    if (error) { setSaveError(error.message); setSaveStatus('error'); return }
    setOfficeGoals(g => ({ ...g, [goalOfficeKey]: v }))
    setSaveStatus('saved'); setTimeout(() => setSaveStatus('idle'), 2000)
  }
  async function resetGoal() {
    skipBlurSaveRef.current = true; setEditingGoal(false)
    const { error } = await deleteGoalDb(goalYear, goalMonth, goalOfficeKey)
    if (error) { setSaveError(error.message); setSaveStatus('error'); return }
    setOfficeGoals(g => { const n = { ...g }; delete n[goalOfficeKey]; return n })
    setSaveStatus('saved'); setTimeout(() => setSaveStatus('idle'), 2000)
  }

  // Rolling last 8 FULL weeks + the current (partial) week, newest first —
  // independent of the page's date filter so the trend is always visible
  // (the team filter still applies). Average is over the full weeks only, so
  // a Tuesday doesn't drag the number down.
  const weeklyData = useMemo(() => {
    const scoped   = applyScopeFilters(deals)
    const curStart = startOfWeek(new Date(), { weekStartsOn: 0 })
    const weeks = []
    for (let i = 0; i <= 8; i++) {
      const ws = addDays(curStart, -7 * i)
      const from = format(ws, 'yyyy-MM-dd')
      const to   = format(endOfWeek(ws, { weekStartsOn: 0 }), 'yyyy-MM-dd')
      const wDls = scoped.filter(d => d.sale_date >= from && d.sale_date <= to)
      weeks.push({
        label: format(ws, 'MMM d'),
        deals: wDls.length,
        revenue: wDls.reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0),
        current: i === 0,
      })
    }
    return weeks   // newest first
  }, [deals, scope, teamCtx])

  const weeklyAvg = useMemo(() => {
    const full = weeklyData.filter(w => !w.current)
    if (!full.length) return null
    return {
      revenue: full.reduce((s, w) => s + w.revenue, 0) / full.length,
      deals:   full.reduce((s, w) => s + w.deals, 0) / full.length,
      weeks:   full.length,
    }
  }, [weeklyData])

  const maxWeekRev = useMemo(() => weeklyData.reduce((m, w) => Math.max(m, w.revenue), 0) || 1, [weeklyData])

  const annualData = useMemo(() => {
    const now = new Date()
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = subMonths(now, 11 - i)
      return { key: format(d, 'yyyy-MM'), label: format(d, 'MMM'), revenue: 0, deals: 0 }
    })
    for (const deal of applyScopeFilters(deals)) {
      if (!deal.sale_date) continue
      const slot = months.find(m => m.key === deal.sale_date.slice(0, 7))
      if (slot) { slot.revenue += parseFloat(deal.baseline_revenue) || 0; slot.deals += 1 }
    }
    return months
  }, [deals, scope, teamCtx])

  if (loading) return <LoadingBlock text="Loading the dashboard…" />

  const maxWeekRevLocal  = maxWeekRev
  // The name used AWAY from the breadcrumb (card headers, the copied
  // table): office-team qualifies itself with the office, since nothing
  // else next to those is saying which one.
  const scopeName = node && node.level !== 'company' ? (node.fullTitle || node.title) : null
  const label = 'text-[13px] font-semibold text-bank-fa uppercase tracking-wider mb-1'
  const groupTone = { company: WARN, team: 'var(--tx)', rep: 'var(--mu)' }
  const BOARD_COLS = [['revenue', 'Revenue'], ['totalRevenue', 'Total Revenue'], ['setForOthers', 'Set Deals'], ['selfGen', 'Self-Gen'], ['leadCloses', 'Leads Closed'], ['commission', 'Commission'], ['name', 'Rep']]
  const isBoard = grouping === 'rep' && (node?.level === 'company' || node?.level === 'office')
  const childGoalPct = (c) => {
    const g = c.kind === 'rep' ? repGoalMap[c.key] : c.kind === 'office' ? officeGoals[c.label] : (teamGoalMap[c.key] ?? null)
    return g ? (c.stats.revenue / g) * 100 : null
  }
  const nodeGoalPct = goalInfo.target ? (node.stats.revenue / goalInfo.target) * 100 : null

  return (
    <div className="space-y-4 pb-6 max-w-[1400px] mx-auto" style={{ color: 'var(--tx)' }}>

      {/* ── Filter row ── */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-2">
        <DateRangeFilter
          from={dateFrom}
          to={dateTo}
          preset={activePreset}
          onChange={handleRangeChange}
          count={filtered.length}
          countLabel="deals"
        />
        {/* Scope trail — replaces the old "All Teams" dropdown. Each step is a
            button back up the drill; the last one is where you are. */}
        <div className="flex items-center gap-2 flex-wrap self-start">
          <nav className="flex items-center gap-1 flex-wrap text-[13px]" aria-label="Scope">
            {trail.map((t, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={12} className="text-bank-fa" />}
                {t.scope
                  ? <button onClick={() => setScope(t.scope)}
                      className="text-bank-gold-tx hover:underline font-medium min-h-[44px] md:min-h-0 px-1">{t.label}</button>
                  : <span className="text-bank-tx font-bold px-1">{t.label}</span>}
              </span>
            ))}
          </nav>
          <SecondaryButton onClick={copyTable} title="Copy this table for a text or a slide" active={copied}>
            {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy'}
          </SecondaryButton>
        </div>
      </div>

      {/* ── Records falling right now — every one of them, collapsible ── */}
      {recordMoments.length > 0 && (
        <Card padded={false} style={{ borderColor: WARN_BORDER }}>
          {/* The header is the toggle, and carries the count — so a collapsed
              card still tells you something is happening. */}
          <button onClick={toggleRecs} aria-expanded={recsOpen}
            className="w-full flex items-center gap-2 px-4 py-3 min-h-[44px] text-left hover:bg-bank-raise transition-colors"
            style={{ borderBottom: recsOpen ? '1px solid var(--line)' : 'none' }}>
            <ChevronDown size={14} className={`flex-shrink-0 transition-transform ${recsOpen ? '' : '-rotate-90'}`} style={{ color: WARN }} />
            <span className="text-[13px] font-bold" style={{ color: WARN }}>
              🔥 {plural(recordMoments.length, 'record')} falling right now
            </span>
            <span className="ml-auto text-[13px] text-bank-mu whitespace-nowrap hidden sm:block">
              {recordGroups.map(g => `${g.rows.length} ${g.scope}`).join(' · ')}
            </span>
          </button>

          {recsOpen && recordGroups.map(g => (
            <div key={g.scope}>
              <div className="flex items-center gap-1.5 px-4 pt-2.5 pb-1 text-[13px] font-bold uppercase tracking-wider" style={{ color: groupTone[g.scope] }}>
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: groupTone[g.scope] }} />
                {g.label}
              </div>
              {g.rows.map(m => (
                <div key={m.id} className="px-4 pt-1.5 pb-2 border-t border-bank-line">
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="text-[13px] text-bank-tx min-w-0">
                      {m.who && <b className="font-bold">{m.who}</b>}
                      <span className="text-bank-mu">{m.who ? ` — ${m.kind.toLowerCase()}` : m.kind}</span>
                      {!m.live && <span className="text-bank-fa"> · just set</span>}
                    </p>
                    <span className="text-[13px] font-bold tabular-nums whitespace-nowrap text-bank-tx">{m.value}</span>
                  </div>
                  <p className="text-[13px] text-bank-fa tabular-nums">{m.was}</p>
                </div>
              ))}
            </div>
          ))}
        </Card>
      )}

      {/* ── KPI cards — 1-col on phones, row on md+ ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
        <KpiFigure label="Revenue"
          value={fmt(totals.baseline)}    valueLabel="Baseline"
          value2={fmt(totals.totalPrice)} value2Label="Job Price"
          sub="Baseline = company's cost basis"
          trend={<Trend cur={totals.baseline} prev={prevPeriod ? prevTotals.baseline : null} suffix="baseline vs prev" />} />
        {/* The caption used to read "Total price − baseline", which is the
            GROSS rep pool — but the figure is `repCommission`, already NET of
            deductions (manual + financing dealer fee) and including any rep
            bonus. The two differ on every deal that carries a deduction, so
            the caption was describing a number the tile does not show. It
            also excludes overrides by design (same as the Deals tab and the
            leaderboard), which the caption now says out loud. */}
        <KpiFigure label="Commissions" value={fmt(totals.commission)} sub="Setter + closer, after deductions"
          trend={<Trend cur={totals.commission} prev={prevPeriod ? prevTotals.commission : null} />} />
        <KpiFigure label="Avg Comm %" value={`${totals.avgCommPct.toFixed(1)}%`} sub="Of baseline, after deductions"
          trend={<Trend cur={totals.avgCommPct} prev={prevPeriod ? prevTotals.avgCommPct : null} />} />
        <KpiFigure label="Total Deals" value={totals.deals.toString()}
          trend={<Trend cur={totals.deals} prev={prevPeriod ? prevTotals.deals : null} />} />
        <KpiFigure label="Avg Deal Size" className="sm:col-span-2 md:col-span-1"
          value={fmt(totals.avgDeal)} valueLabel="Baseline"
          value2={fmt(totals.avgJob)} value2Label="Job Price"
          trend={<Trend cur={totals.avgDeal} prev={prevPeriod ? prevTotals.avgDeal : null} suffix="baseline vs prev" />} />
      </div>

      {/* ── Monthly Goal ── */}
      <Card>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold text-bank-tx">
              {monthlyGoal.month} Revenue Goal
              {scopeName && ` — ${scopeName}`}
            </h3>
            <p className="text-[13px] text-bank-mu mt-0.5">
              {monthlyGoal.isCustom ? 'Custom goal' : 'Auto: 3-month avg ×1.1'}
            </p>
          </div>
          <div className="text-[28px] md:text-[32px] font-bold leading-none tabular-nums" style={{ color: monthlyGoal.pct >= 100 ? POS : 'var(--tx)' }}>
            {monthlyGoal.pct.toFixed(1)}%
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4 md:gap-8 mb-4">
          <div>
            <p className={label}>Month Revenue</p>
            {/* The one gold number on this page. */}
            <p className="text-[28px] md:text-[34px] font-bold leading-none tabular-nums" style={{ color: 'var(--gold-tx)' }}>{fmt(monthlyGoal.curRevenue)}</p>
          </div>
          <div className="text-bank-line text-xl mb-1" aria-hidden="true">/</div>
          <div>
            <p className={label}>Goal</p>
            <GoalEditor editing={editingGoal} value={goalInput} onChange={setGoalInput} onBlur={handleGoalBlur}
              onSave={saveGoal} onCancel={cancelGoalEdit} onReset={resetGoal} canEdit={canEditThisGoal} startEdit={startEditGoal}
              isCustom={monthlyGoal.isCustom} amount={monthlyGoal.goal} status={saveStatus} />
          </div>
          <div className="ml-auto text-right">
            <p className={label}>Remaining</p>
            <p className="text-[16px] font-bold text-bank-mu tabular-nums">
              {monthlyGoal.pct >= 100 ? 'Goal Hit! 🎉' : fmt(Math.max(0, monthlyGoal.goal - monthlyGoal.curRevenue))}
            </p>
          </div>
        </div>

        <Bar pct={monthlyGoal.pct} gold />

        {/* ── Weekly Goal (always the current week, Sun–Sat) ──
            COMPANY SCOPE ONLY. `app_settings.weekly_goal` is a single
            company-wide number, so once the page scopes to a team the revenue
            bar would be that team's while the target stayed the company's —
            a comparison that looks precise and means nothing. */}
        {isCompany(scope) && (
        <div className="mt-4 pt-4 border-t border-bank-line">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="min-w-0">
              <h4 className="text-[13px] md:text-[14px] font-semibold text-bank-tx">
                This Week ({weeklyGoal.label})
                {scopeName && ` — ${scopeName}`}
              </h4>
              <p className="text-[13px] text-bank-mu mt-0.5">
                {weeklyGoal.isCustom ? 'Custom weekly goal' : 'Auto: monthly goal ÷ weeks'}
              </p>
            </div>
            <div className="text-[20px] md:text-[24px] font-bold leading-none tabular-nums" style={{ color: weeklyGoal.pct >= 100 ? POS : 'var(--tx)' }}>
              {weeklyGoal.pct.toFixed(1)}%
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-4 md:gap-8 mb-3">
            <div>
              <p className={label}>Week Revenue</p>
              <p className="text-[18px] md:text-[20px] font-bold text-bank-tx tabular-nums">{fmt(weeklyGoal.curRevenue)}</p>
            </div>
            <div className="text-bank-line text-lg mb-0.5" aria-hidden="true">/</div>
            <div>
              <p className={label}>Goal</p>
              <GoalEditor size="sm" editing={editingWeekGoal} value={weekGoalInput} onChange={setWeekGoalInput} onBlur={handleWeekGoalBlur}
                onSave={saveWeekGoal} onCancel={cancelWeekGoalEdit} onReset={resetWeekGoal} canEdit={canEditGoal} startEdit={startEditWeekGoal}
                isCustom={weeklyGoal.isCustom} amount={weeklyGoal.goal} status={weekSaveStatus} />
            </div>
            <div className="ml-auto text-right">
              <p className={label}>Remaining</p>
              <p className="text-[14px] font-bold text-bank-mu tabular-nums">
                {weeklyGoal.pct >= 100 ? 'Goal Hit! 🎉' : fmt(Math.max(0, weeklyGoal.goal - weeklyGoal.curRevenue))}
              </p>
            </div>
          </div>

          <Bar pct={weeklyGoal.pct} height="h-2" />
        </div>
        )}
      </Card>

      {/* ── Appointments & field ────────────────────────────────────────
          Appointment COUNTS, never deals — the label says so because "Set"
          meaning two different things across two pages is what made the old
          Dashboard and Performance page impossible to read together. */}
      {node && (
        <Card>
          <h3 className="text-[15px] font-bold text-bank-tx mb-0.5">
            {node.level === 'rep' ? `${node.title}'s appointments` : 'Appointments'}
          </h3>
          <p className="text-[13px] text-bank-mu mb-3">Appointment counts, never deals</p>
          {node.showFunnel ? (
            <div className="grid grid-cols-3 gap-2">
              {[
                ['Set',   node.stats.set,  node.stats.showRate != null ? `${node.stats.showRate.toFixed(0)}% have run` : null],
                ['Ran',   node.stats.ran,  node.stats.dealCloseRate != null ? `${node.stats.dealCloseRate.toFixed(0)}% closed` : null],
                // SOLD IS THE DEAL COUNT, not RepCard's "sold" disposition —
                // reps don't reliably update their leads, so the CRM's own
                // outcome always undercounts. Same figure as the Deals tile
                // above, on purpose: one number per thing.
                ['Sold',  node.stats.deals, node.stats.setCloseRate != null ? `${node.stats.setCloseRate.toFixed(0)}% of set` : null],
              ].map(([k, v, sub]) => (
                <div key={k} className="rounded-xl px-3 py-2.5 min-w-0" style={SURFACE.well}>
                  <p className={label}>{k}</p>
                  <p className="text-[20px] font-bold text-bank-tx tabular-nums">{(v ?? 0).toLocaleString()}</p>
                  {sub && <p className="text-[13px] text-bank-mu mt-0.5 truncate">{sub}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-bank-mu leading-relaxed">{node.funnelNote}</p>
          )}
          {node.showFunnel && node.stats.pastDue > 0 && (
            <a href="/leads?missing=info"
              className="mt-2.5 inline-flex items-start gap-1.5 text-[13px] hover:underline min-h-[44px] md:min-h-0" style={{ color: WARN }}>
              <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
              <span>{node.stats.pastDue} appointment{node.stats.pastDue === 1 ? '' : 's'} past their date with no outcome logged — they count as neither ran nor cancelled. Fix in Leads →</span>
            </a>
          )}
          {node.level === 'rep' && node.showFunnel && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
              {[
                ['Self-gen ran', node.stats.sgRan, null],
                ['Leads ran',    node.stats.leadRan, null],
                ['Self-gen deals', node.stats.deals, node.stats.sgCloseRate != null ? `${node.stats.sgCloseRate.toFixed(0)}% close` : null],
                ['Lead closes',  node.stats.leadCloses, node.stats.leadCloseRate != null ? `${node.stats.leadCloseRate.toFixed(0)}% close` : null],
              ].map(([k, v, sub]) => (
                <div key={k} className="rounded-xl px-3 py-2 min-w-0" style={SURFACE.well}>
                  <p className={label}>{k}</p>
                  <p className="text-[16px] font-bold text-bank-tx tabular-nums">{v ?? 0}</p>
                  {sub && <p className="text-[13px] text-bank-mu">{sub}</p>}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── The drill table ─────────────────────────────────────────────
          Company → Teams or Offices → reps, then a rep's own deals. Six
          columns by default; the activity toggle adds four. Desktop keeps
          real tables; phones get compact rows that expand. */}
      {node && (
        <Card>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              {node.level === 'company' || node.level === 'office' ? (
                <>
                  <span className="text-[13px] font-semibold text-bank-fa uppercase tracking-wider mr-1">Break down by</span>
                  {/* Inside an OFFICE the choice is Teams or Reps — the two
                      axes never crossed before, so picking Tucson dropped you
                      straight into a flat rep list with no way back to teams
                      (per Keaton). */}
                  <PillGroup>
                    {(node.level === 'company' ? ['team', 'office', 'rep'] : ['team', 'rep']).map(g => {
                      const set = node.level === 'company' ? setGroupBy : setOfficeGroup
                      return (
                        <Pill key={g} onClick={() => set(g)} active={grouping === g}>
                          {g === 'team' ? 'Teams' : g === 'office' ? 'Offices' : 'Reps'}
                        </Pill>
                      )
                    })}
                  </PillGroup>
                  {node.level === 'office' && (
                    <span className="text-[13px] text-bank-fa ml-1">in {node.title}</span>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2 min-w-0">
                  {backScope !== undefined && (
                    <SecondaryButton onClick={() => setScope(backScope)} title={backLabel ? `Back to ${backLabel}` : 'Back'} className="flex-shrink-0">
                      <ChevronLeft size={13} /> Back{backLabel ? ` to ${backLabel}` : ''}
                    </SecondaryButton>
                  )}
                  <h3 className="text-[15px] font-bold text-bank-tx truncate">
                    {node.childKind || `${node.title} · deals`}
                  </h3>
                </div>
              )}
            </div>
            {isBoard ? (
              <SecondaryButton onClick={copyLeaderboard} active={copiedBoard}
                title="Copy as a table — pastes formatted into Canva, Sheets or Docs">
                {copiedBoard ? <Check size={12} /> : <Copy size={12} />}{copiedBoard ? 'Copied' : 'Copy table'}
              </SecondaryButton>
            ) : (
              <Pill onClick={() => setShowActivity(v => !v)} active={showActivity} className={showActivity ? '' : 'border-bank-line'}>
                {showActivity ? '✓' : '+'} Appointments
              </Pill>
            )}
          </div>

          {isBoard ? (
            repBoard.length > 0 ? (
              <>
                <p className="text-[13px] text-bank-mu mb-2">
                  {repBoard.length} {repBoard.length === 1 ? 'rep' : 'reps'} with activity · tap a column to rank by it ·
                  Set Deals + Self-Gen are the deals they own · Leads Closed is what Total Revenue adds on top
                </p>

                {/* Desktop: the sortable table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr>
                        <th className={`${TH} text-left pr-1 w-8`}>#</th>
                        <SortTh first label="Rep" col="name" sort={boardSort} onSort={toggleBoardSort} />
                        <SortTh label="Revenue" col="revenue" sort={boardSort} onSort={toggleBoardSort}
                          title="Revenue on the deals they OWN — what they set, or closed with no setter recorded" />
                        <SortTh label="Total Revenue" col="totalRevenue" sort={boardSort} onSort={toggleBoardSort}
                          title="Every deal they were involved in: their own, plus the ones they closed for another setter. A self-gen counts once." />
                        <SortTh label="Set Deals" col="setForOthers" sort={boardSort} onSort={toggleBoardSort}
                          title="They set it, another rep closed it — the setter keeps the deal and its revenue" />
                        <SortTh label="Self-Gen" col="selfGen" sort={boardSort} onSort={toggleBoardSort}
                          title="They set AND closed it themselves" />
                        <SortTh label="Leads Closed" col="leadCloses" sort={boardSort} onSort={toggleBoardSort}
                          title="Another rep set it, they closed it — the setter still owns the deal" />
                        <SortTh label="Commission" col="commission" sort={boardSort} onSort={toggleBoardSort} />
                      </tr>
                    </thead>
                    <tbody>
                      {repBoard.map((r, i) => (
                        <tr key={r.id}
                          onClick={onClickUnlessSelecting(() => setScope({ level: 'rep', key: r.id }))}
                          className="border-t border-bank-line cursor-pointer hover:bg-bank-raise">
                          <td className="py-2 pr-1 text-bank-fa tabular-nums">{i + 1}</td>
                          <td className="py-2 pr-2">
                            <span className="font-semibold text-bank-tx">{r.ghost && !isAdmin ? 'Hidden' : r.name} <span className="text-bank-gold-tx">›</span></span>
                            {isCompany(scope) && r.team && <span className={TD_SUB}>{r.team}</span>}
                          </td>
                          <td className={`${TD} text-bank-tx font-semibold`}>
                            {fmt(r.revenue)}<Delta cur={r.revenue} prev={r.prev?.revenue} />
                          </td>
                          <td className={`${TD} text-bank-mu`}>
                            {fmt(r.totalRevenue)}
                            {r.leadRevenue > 0 && <span className={TD_SUB}>+{fmt(r.leadRevenue)} closed</span>}
                          </td>
                          <td className={`${TD} text-bank-mu`}>{r.setForOthers}</td>
                          <td className={`${TD} text-bank-mu`}>{r.selfGen}</td>
                          <td className={`${TD} text-bank-mu`}>{r.leadCloses}</td>
                          <td className={`${TD} text-bank-mu`}>{fmt(r.commission)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Phones: rank picker + compact rows that expand to the other columns */}
                <div className="md:hidden">
                  <div className="flex items-center gap-2 mb-2">
                    <label className="text-[13px] text-bank-fa" htmlFor="board-sort">Rank by</label>
                    <select id="board-sort" value={boardSort.key} onChange={e => toggleBoardSort(e.target.value)}
                      className="text-[13px] px-2 py-2 min-h-[44px] rounded-lg text-bank-tx focus:outline-none flex-1" style={SURFACE.raise}>
                      {BOARD_COLS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                    <SecondaryButton onClick={() => toggleBoardSort(boardSort.key)} aria-label="Flip sort direction">
                      {boardSort.dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </SecondaryButton>
                  </div>
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--line)' }}>
                    {repBoard.map((r, i) => (
                      <Expandable key={r.id}
                        title={<><span className="text-bank-fa tabular-nums mr-1.5">{i + 1}.</span>{r.ghost && !isAdmin ? 'Hidden' : r.name}</>}
                        meta={isCompany(scope) && r.team ? r.team : null}
                        right={<RowRight revenue={r.revenue} deals={r.setForOthers + r.selfGen} />}>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3" style={{ background: 'var(--bg)' }}>
                          {[['Revenue', fmt(r.revenue)], ['Total Revenue', fmt(r.totalRevenue) + (r.leadRevenue > 0 ? ` (+${fmt(r.leadRevenue)} closed)` : '')],
                            ['Set Deals', r.setForOthers], ['Self-Gen', r.selfGen], ['Leads Closed', r.leadCloses], ['Commission', fmt(r.commission)]].map(([l, v]) => (
                            <div key={l} className="min-w-0"><p className="text-[13px] text-bank-fa">{l}</p><p className="text-[13px] font-semibold text-bank-tx tabular-nums">{v}</p></div>
                          ))}
                          <div className="col-span-2">
                            <SecondaryButton onClick={() => setScope({ level: 'rep', key: r.id })} className="w-full">
                              See {r.ghost && !isAdmin ? 'this rep' : r.name.split(' ')[0]}’s dashboard ›
                            </SecondaryButton>
                          </div>
                        </div>
                      </Expandable>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <EmptyBlock className="py-3 text-left px-0">No reps with activity in this range.</EmptyBlock>
            )
          ) : node.children.length > 0 ? (
            <>
              {/* Desktop: the breakdown table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr>
                      <th className={`${TH} text-left pr-2`}>{node.childKind}</th>
                      {showActivity && ['Set','Ran'].map(h =>
                        <th key={h} className={`${TH} text-right px-2`}>{h}</th>)}
                      {['Revenue','Deals','Avg deal','Markup','Commission','Goal'].map(h =>
                        <th key={h} className={`${TH} text-right px-2`}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {node.children.map(c => {
                      const st = c.stats
                      const gp = childGoalPct(c)
                      const fl = c.kind === 'rep' ? repFlags(st, flagFloors) : {}
                      // Company-level team rows expand IN PLACE to show their reps,
                      // instead of re-scoping the whole page (per Keaton).
                      const isTeamAcc = node.level === 'company' && c.kind === 'team'
                      const expanded = isTeamAcc && expandedTeams.has(c.key)
                      const clickable = isTeamAcc || c.drillable
                      return (
                        <Fragment key={`${c.kind}-${c.key}`}>
                        <tr
                          onClick={isTeamAcc
                            ? onClickUnlessSelecting(() => toggleTeam(c.key))
                            : (c.drillable ? onClickUnlessSelecting(() => setScope({ level: c.kind, key: c.key })) : undefined)}
                          className={`border-t border-bank-line ${clickable ? 'cursor-pointer hover:bg-bank-raise' : ''}`}>
                          <td className="py-2 pr-2">
                            <span className={`font-semibold ${clickable ? 'text-bank-tx' : 'text-bank-mu'}`}>
                              {c.ghost && !isAdmin ? 'Hidden' : c.label}
                              {clickable && <span className="text-bank-gold-tx">{isTeamAcc ? (expanded ? ' ⌄' : ' ›') : ' ›'}</span>}
                            </span>
                            {c.sub && <span className={TD_SUB}>{c.sub}</span>}
                          </td>
                          <StatCells st={st} prev={c.prev} showActivity={showActivity} flagSet={!!fl.set} />
                          <GoalCell pct={gp} />
                        </tr>
                        {isTeamAcc && expanded && teamRepRows(c.key).map(r => {
                          const rg = repGoalMap[r.id]
                          const rgp = rg ? (r.revenue / rg) * 100 : null
                          const repOpen = expandedReps.has(r.id)
                          const drillColCount = 1 + (showActivity ? 2 : 0) + 6
                          return (
                            <Fragment key={`rep-${c.key}-${r.id}`}>
                            <tr
                              onClick={onClickUnlessSelecting(() => toggleRep(r.id))}
                              className="border-t border-bank-line cursor-pointer hover:bg-bank-raise"
                              style={{ background: 'var(--bg)' }}>
                              <td className="py-2 pr-2 pl-7">
                                <span className="text-bank-mu text-[13px]">{r.ghost && !isAdmin ? 'Hidden' : r.name}<span className="text-bank-gold-tx">{repOpen ? ' ⌄' : ' ›'}</span></span>
                              </td>
                              <StatCells st={r} prev={r.prev} showActivity={showActivity} />
                              <GoalCell pct={rgp} />
                            </tr>
                            {repOpen && (
                              <tr style={{ background: 'var(--bg)' }}>
                                <td colSpan={drillColCount} className="py-2 pl-10 pr-3">
                                  <RepDealsInline deals={repDealsFor(deals, r.id, { from: dateFrom, to: dateTo })} repId={r.id} />
                                </td>
                              </tr>
                            )}
                            </Fragment>
                          )
                        })}
                        </Fragment>
                      )
                    })}
                    <tr className="border-t border-bank-line" style={{ background: 'var(--raise)' }}>
                      <td className="py-2 pr-2 font-bold text-bank-tx">{node.title}</td>
                      <StatCells st={node.stats} prev={node.prev} showActivity={showActivity} bold />
                      <GoalCell pct={nodeGoalPct} bold />
                    </tr>
                  </tbody>
                </table>
                <p className="text-[13px] text-bank-fa mt-2">
                  {node.level === 'company' && grouping === 'team'
                    ? 'Click a team to drop its reps in below; click a rep to see their deals.'
                    : 'Click a row to scope the whole page to it.'}
                </p>
              </div>

              {/* Phones: one compact row per team / office / rep, expanding to the rest */}
              <div className="md:hidden rounded-xl overflow-hidden" style={{ border: '1px solid var(--line)' }}>
                {node.children.map(c => {
                  const st = c.stats
                  const gp = childGoalPct(c)
                  const fl = c.kind === 'rep' ? repFlags(st, flagFloors) : {}
                  const isTeamAcc = node.level === 'company' && c.kind === 'team'
                  return (
                    <Expandable key={`m-${c.kind}-${c.key}`}
                      title={c.ghost && !isAdmin ? 'Hidden' : c.label} meta={c.sub || null}
                      right={<RowRight revenue={st.revenue} deals={st.deals} />}>
                      <MobileStats st={st} prev={c.prev} showActivity={showActivity} goalPct={gp} flagSet={!!fl.set} />
                      {isTeamAcc && (
                        <div className="border-t border-bank-line">
                          <p className="px-4 pt-2 pb-1 text-[13px] text-bank-fa uppercase tracking-wider font-semibold">Reps</p>
                          {teamRepRows(c.key).length === 0 && <p className="px-4 pb-3 text-[13px] text-bank-mu">No rep activity in this range.</p>}
                          {teamRepRows(c.key).map(r => {
                            const rg = repGoalMap[r.id]
                            const rgp = rg ? (r.revenue / rg) * 100 : null
                            return (
                              <Expandable key={`m-rep-${c.key}-${r.id}`} className="pl-3"
                                title={r.ghost && !isAdmin ? 'Hidden' : r.name}
                                right={<RowRight revenue={r.revenue} deals={r.deals} />}>
                                <MobileStats st={r} prev={r.prev} showActivity={showActivity} goalPct={rgp} />
                                <div className="px-4 pb-3" style={{ background: 'var(--bg)' }}>
                                  <RepDealsInline deals={repDealsFor(deals, r.id, { from: dateFrom, to: dateTo })} repId={r.id} />
                                </div>
                              </Expandable>
                            )
                          })}
                        </div>
                      )}
                      {!isTeamAcc && c.drillable && (
                        <div className="px-4 pb-3" style={{ background: 'var(--bg)' }}>
                          <SecondaryButton onClick={() => setScope({ level: c.kind, key: c.key })} className="w-full">
                            Scope the page to {c.ghost && !isAdmin ? 'this row' : c.label} ›
                          </SecondaryButton>
                        </div>
                      )}
                    </Expandable>
                  )
                })}
                <div className="px-4 py-3 flex items-center justify-between gap-3" style={{ background: 'var(--raise)' }}>
                  <span className="text-[13px] font-bold text-bank-tx truncate">{node.title}</span>
                  <RowRight revenue={node.stats.revenue} deals={node.stats.deals} />
                </div>
                <MobileStats st={node.stats} prev={node.prev} showActivity={showActivity} goalPct={nodeGoalPct} />
              </div>
            </>
          ) : node.level === 'rep' ? (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr>
                      <th className={`${TH} text-left pr-2`}>Deal</th>
                      <th className={`${TH} text-left px-2`}>Sold</th>
                      <th className={`${TH} text-right px-2`}>Revenue</th>
                      <th className={`${TH} text-left px-2`}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repDealRows.map(d => (
                      <tr key={d.id} className="border-t border-bank-line">
                        <td className="py-2 pr-2 text-bank-tx font-medium truncate max-w-[220px]">{d.deal_name}</td>
                        <td className="py-2 px-2 text-bank-mu whitespace-nowrap">{d.sale_date}</td>
                        <td className="text-right py-2 px-2 tabular-nums text-bank-tx">{fmt(parseFloat(d.baseline_revenue) || 0)}</td>
                        <td className="py-2 px-2 text-bank-mu">{d.status}</td>
                      </tr>
                    ))}
                    {repDealRows.length === 0 && (
                      <tr><td colSpan={4} className="py-4 text-center text-bank-mu text-[13px]">No deals in this range.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden rounded-xl overflow-hidden" style={{ border: '1px solid var(--line)' }}>
                {repDealRows.map(d => (
                  <div key={d.id} className="flex items-center justify-between gap-3 px-4 py-3 border-b border-bank-line last:border-0">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-bank-tx truncate">{d.deal_name}</p>
                      <p className="text-[13px] text-bank-mu">{d.sale_date} · {d.status}</p>
                    </div>
                    <span className="text-[13px] font-semibold text-bank-tx tabular-nums whitespace-nowrap">{fmt(parseFloat(d.baseline_revenue) || 0)}</span>
                  </div>
                ))}
                {repDealRows.length === 0 && <EmptyBlock className="py-4">No deals in this range.</EmptyBlock>}
              </div>
              <a href={`/deals?scope=all&rep=${node.key}`}
                className="inline-flex items-center mt-2 text-[13px] text-bank-gold-tx hover:underline min-h-[44px] md:min-h-0">Open in Deals for filtering and edits →</a>
            </>
          ) : (
            <EmptyBlock className="py-3 text-left px-0">Nothing to break down here.</EmptyBlock>
          )}
        </Card>
      )}

      {/* ── Weekly + Annual — stack on mobile ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5">

        {/* Weekly Performance — ivory bars, gold only for the current week */}
        <Card>
          <div className="mb-4">
            <h3 className="text-[15px] font-bold text-bank-tx">Weekly Performance</h3>
            <p className="text-[13px] text-bank-mu mt-0.5">
              Sun–Sat · last {weeklyData.length - 1} full weeks + this week
              {weeklyAvg && (
                <span> · avg <span className="font-semibold text-bank-tx">{fmt(weeklyAvg.revenue)}</span> & {weeklyAvg.deals.toFixed(1)} deals / week</span>
              )}
            </p>
          </div>
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {weeklyData.map((w, i) => (
              <div key={i} className="rounded-xl px-3 py-2.5 flex items-center gap-3"
                style={{ ...SURFACE.well, border: w.current ? '1px solid rgba(191,164,108,0.45)' : SURFACE.well.border }}>
                <div className="w-16 md:w-20 flex-shrink-0">
                  <p className="text-[13px] font-semibold uppercase tracking-wide" style={{ color: w.current ? 'var(--gold-tx)' : 'var(--fa)' }}>{w.current ? 'This wk' : 'Week'}</p>
                  <p className="text-[13px] font-bold text-bank-tx">{w.label}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--raise)' }}>
                    <div className="h-full rounded-full" style={{ width: `${(w.revenue / maxWeekRevLocal) * 100}%`, background: w.current ? 'var(--gold)' : 'var(--mu)' }} />
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[13px] font-bold whitespace-nowrap tabular-nums" style={{ color: w.current ? 'var(--gold-tx)' : 'var(--tx)' }}>{fmt(w.revenue)}</p>
                  <p className="text-[13px] text-bank-mu">{plural(w.deals, 'deal')}</p>
                </div>
              </div>
            ))}
            {weeklyData.length === 0 && <EmptyBlock>No data</EmptyBlock>}
          </div>
        </Card>

        {/* Annual Chart — ivory line, gold dot on the current month */}
        <Card>
          <div className="mb-4">
            <h3 className="text-[15px] font-bold text-bank-tx">Annual Trend</h3>
            <p className="text-[13px] text-bank-mu mt-0.5">Trailing 12 months</p>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={annualData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="annualGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ede7da" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="#ede7da" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2c2f33" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 13, fill: '#8c8a84' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 13, fill: '#8c8a84' }} axisLine={false} tickLine={false}
                tickFormatter={v => `$${(v/1000).toFixed(0)}k`} width={40} />
              <Tooltip
                cursor={{ stroke: '#bfa46c', strokeWidth: 1, strokeOpacity: 0.5 }}
                content={({ active, payload, label: lbl }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0]?.payload
                  return (
                    <div style={{ ...SURFACE.card, borderRadius: 12, padding: '10px 14px' }}>
                      <p style={{ color: '#cdb684', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{lbl}</p>
                      <p style={{ color: '#ede7da', fontSize: 13 }}>Revenue: ${d?.revenue?.toLocaleString()}</p>
                      <p style={{ color: '#a19e97', fontSize: 13 }}>Deals: {d?.deals ?? 0}</p>
                    </div>
                  )
                }}
              />
              <Area type="monotone" dataKey="revenue" stroke="#ede7da" strokeWidth={2}
                fill="url(#annualGrad)" activeDot={{ r: 5, fill: '#bfa46c', stroke: '#131416' }}
                dot={(props) => {
                  const { cx, cy, index, key } = props
                  const current = index === annualData.length - 1
                  return <circle key={key ?? index} cx={cx} cy={cy} r={current ? 4.5 : 3} fill={current ? '#bfa46c' : '#a19e97'} stroke={current ? '#131416' : 'none'} strokeWidth={1.5} />
                }} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  )
}
