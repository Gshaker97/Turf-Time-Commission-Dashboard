import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  format, subMonths, startOfWeek, endOfWeek, addDays, getDaysInMonth,
} from 'date-fns'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Check, X, TrendingUp, TrendingDown, Minus, ChevronRight, ChevronDown, ChevronUp, ChevronsUpDown, Copy, AlertCircle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import {
  fetchDeals, fetchUsers, fetchTeamChanges, fetchLeads,
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
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus'

function Trend({ cur, prev, suffix = 'vs prev' }) {
  if (prev === null || prev === undefined) return null
  if (prev === 0 && cur === 0) return null
  const pct = prev > 0 ? ((cur - prev) / prev) * 100 : (cur > 0 ? 100 : 0)
  if (Math.abs(pct) < 0.1 && prev > 0)
    return <div className="flex items-center gap-1 text-[10px] text-white/25"><Minus size={10} /> unchanged</div>
  const up = pct >= 0
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <div className={`flex items-center gap-1 text-[10px] font-semibold ${up ? 'text-emerald-400' : 'text-red-400'}`}>
      <Icon size={10} /><span>{Math.abs(pct).toFixed(1)}%</span>
      <span className="text-white/25 font-normal">{suffix}</span>
    </div>
  )
}

// A leaderboard column header you can rank by. Shows the live arrow, or a
// faint hint when it isn't the active sort.
function SortTh({ label, col, sort, onSort, title, first }) {
  const on = sort.key === col
  return (
    <th className={`py-1.5 ${first ? 'pr-2' : 'px-2'}`} title={title}>
      <button onClick={() => onSort(col)}
        className={`w-full flex items-center gap-0.5 uppercase tracking-widest text-[9px] font-semibold transition-colors ${
          first ? 'justify-start' : 'justify-end'} ${on ? 'text-teal' : 'text-white/30 hover:text-white/60'}`}>
        <span>{label}</span>
        {on ? (sort.dir === 'asc' ? <ChevronUp size={9} /> : <ChevronDown size={9} />)
            : <ChevronsUpDown size={9} className="opacity-40" />}
      </button>
    </th>
  )
}

function Delta({ cur, prev }) {
  if (prev == null) return null
  if (!prev && !cur) return null
  if (!prev) return <span className="block text-[10px] text-emerald-400/70 font-normal">new</span>
  const pct = ((cur - prev) / Math.abs(prev)) * 100
  if (Math.abs(pct) < 0.5) return <span className="block text-[10px] text-white/25 font-normal">flat</span>
  const up = pct > 0
  return (
    <span className={`block text-[10px] font-semibold ${up ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
      {up ? '▲' : '▼'} {Math.abs(pct) >= 999 ? '999+' : Math.abs(pct).toFixed(0)}%
    </span>
  )
}

function StatCard({ label, value, sub, trend, value2, valueLabel, value2Label }) {
  return (
    <div className="rounded-xl p-3 md:p-4 min-w-0 flex-1" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
      <p className="text-[9px] md:text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1.5 leading-tight">{label}</p>
      {value2 != null ? (
        <div className="flex flex-wrap items-start gap-x-4 md:gap-x-6 gap-y-1 min-w-0 mb-1.5">
          <div className="min-w-0">
            <p className="text-[16px] md:text-[20px] font-bold text-teal leading-none truncate">{value}</p>
            {valueLabel && <p className="text-[8px] md:text-[9px] text-white/30 uppercase tracking-wider mt-1 truncate">{valueLabel}</p>}
          </div>
          <div className="min-w-0">
            <p className="text-[16px] md:text-[20px] font-bold text-white/80 leading-none truncate">{value2}</p>
            {value2Label && <p className="text-[8px] md:text-[9px] text-white/30 uppercase tracking-wider mt-1 truncate">{value2Label}</p>}
          </div>
        </div>
      ) : (
        <p className="text-[16px] md:text-[20px] font-bold text-teal leading-none mb-1.5 truncate">{value}</p>
      )}
      {trend}
      {sub && <p className="hidden md:block text-[10px] text-white/25 mt-1">{sub}</p>}
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
  // WHO am I looking at: company | team | office | rep. One control replaces
  // the old team dropdown AND the Performance page's team sections, and it
  // drives every block below — tiles, goal, funnel, table, both charts.
  const [scope,        setScope]        = useState(() => scopeFromParam(searchParams.get('scope')))
  const [groupBy,      setGroupBy]      = useState('team')     // company level only
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
    Promise.all([fetchDeals(), fetchUsers(), fetchTeamChanges(), fetchLeads()])
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
  const node = useMemo(() => pickScope(perf, scope, groupBy) || pickScope(perf, COMPANY, groupBy),
    [perf, scope, groupBy])
  useEffect(() => {
    if (!isCompany(scope) && perf && !pickScope(perf, scope, groupBy)) setScope(COMPANY)
  }, [perf, scope, groupBy])

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

  // Breadcrumb trail — Company › Team › Rep, each step clickable.
  const trail = useMemo(() => {
    const t = [{ label: 'Company', scope: COMPANY }]
    if (!node || node.level === 'company') return t
    if (node.level === 'rep' && node.parentTeam) {
      t.push({ label: node.parentTeam.label, scope: { level: 'team', key: node.parentTeam.key } })
    }
    t.push({ label: node.title, scope: null })
    return t
  }, [node])

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

  // Copy the leaderboard as a REAL TABLE (text/html) with a tab-separated
  // fallback, so it pastes formatted into Canva / Sheets / Docs — Keaton
  // pastes this straight into a meeting he runs, which is the whole point of
  // the button. Ghost reps are always dropped from the EXPORT even for an
  // admin who can see them on screen: it leaves the building.
  const [copiedBoard, setCopiedBoard] = useState(false)
  async function copyLeaderboard() {
    const cols = ['#', 'Rep', 'Revenue', 'Total Revenue', 'Deals', 'Self-Gen', 'Lead Closes', 'Commission']
    const rows = repBoard.filter(r => !r.ghost).map((r, i) =>
      [i + 1, r.name, fmt(r.revenue), fmt(r.totalRevenue), r.deals, r.selfGen, r.leadCloses, fmt(r.commission)])
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
      { section: `${node.title} · ${dateFrom} to ${dateTo}` },
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

  if (loading) return <div className="flex items-center justify-center py-24 text-white/30 text-[13px]">Loading…</div>


  const maxWeekRevLocal  = maxWeekRev
  const scopeName = node && node.level !== 'company' ? node.title : null

  return (
    <div className="space-y-4 pb-6">

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
          <div className="flex items-center gap-1 flex-wrap text-[12px] md:text-[13px]">
            {trail.map((t, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={12} className="text-white/25" />}
                {t.scope
                  ? <button onClick={() => setScope(t.scope)}
                      className="text-teal hover:underline font-medium">{t.label}</button>
                  : <span className="text-white font-bold">{t.label}</span>}
              </span>
            ))}
          </div>
          <button onClick={copyTable} title="Copy this table for a text or a slide"
            className={`h-8 px-2.5 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors ${
              copied ? 'text-emerald-400' : 'text-white/45 hover:text-teal'}`}
            style={{ background: '#242424', border: '1px solid #333' }}>
            {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* ── Records falling right now — every one of them, collapsible ── */}
      {recordMoments.length > 0 && (
        <div className="rounded-xl overflow-hidden"
          style={{ background: '#1e1e1e', border: '1px solid rgba(251,191,36,0.45)' }}>
          {/* The header is the toggle, and carries the count — so a collapsed
              card still tells you something is happening. */}
          <button onClick={toggleRecs} aria-expanded={recsOpen}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:opacity-90 transition-opacity"
            style={{ background: 'linear-gradient(90deg, rgba(251,191,36,0.12), rgba(251,191,36,0.03))',
                     borderBottom: recsOpen ? '1px solid #2a2a2a' : 'none' }}>
            <ChevronDown size={13} className={`flex-shrink-0 transition-transform ${recsOpen ? '' : '-rotate-90'}`}
              style={{ color: 'rgba(251,191,36,0.7)' }} />
            <span className="text-[13px] font-bold" style={{ color: '#fbbf24' }}>
              🔥 {recordMoments.length} record{recordMoments.length === 1 ? '' : 's'} falling right now
            </span>
            <span className="ml-auto text-[11px] text-white/30 whitespace-nowrap hidden sm:block">
              {recordGroups.map(g => `${g.rows.length} ${g.scope}`).join(' · ')}
            </span>
          </button>

          {recsOpen && recordGroups.map(g => (
            <div key={g.scope}>
              <div className="flex items-center gap-1.5 px-4 pt-2.5 pb-1 text-[9.5px] font-bold uppercase tracking-widest"
                style={{ color: g.color }}>
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: g.color }} />
                {g.label}
              </div>
              {g.rows.map(m => (
                <div key={m.id} className="px-4 pt-1.5 pb-2" style={{ borderTop: '1px solid #262626' }}>
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="text-[12.5px] text-white/85 min-w-0">
                      {m.who && <b className="font-bold">{m.who}</b>}
                      <span className="text-white/55">{m.who ? ` — ${m.kind.toLowerCase()}` : m.kind}</span>
                      {!m.live && <span className="text-white/30"> · just set</span>}
                    </p>
                    <span className="text-[13px] font-bold tabular-nums whitespace-nowrap" style={{ color: g.color }}>
                      {m.value}
                    </span>
                  </div>
                  <p className="text-[10.5px] text-white/30 tabular-nums">{m.was}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── KPI cards — 2-col on mobile, row on md+ ── */}
      <div className="grid grid-cols-2 gap-2 md:flex md:gap-3">
        <StatCard label="Revenue"
          value={fmt(totals.baseline)}    valueLabel="Baseline"
          value2={fmt(totals.totalPrice)} value2Label="Job Price"
          sub="Baseline = company's cost basis"
          trend={<Trend cur={totals.baseline} prev={prevPeriod ? prevTotals.baseline : null} suffix="baseline vs prev" />} />
        <StatCard label="Commissions" value={fmt(totals.commission)} sub="Total price − baseline"
          trend={<Trend cur={totals.commission} prev={prevPeriod ? prevTotals.commission : null} />} />
        <StatCard label="Avg Comm %" value={`${totals.avgCommPct.toFixed(1)}%`}
          trend={<Trend cur={totals.avgCommPct} prev={prevPeriod ? prevTotals.avgCommPct : null} />} />
        <StatCard label="Total Deals" value={totals.deals.toString()}
          trend={<Trend cur={totals.deals} prev={prevPeriod ? prevTotals.deals : null} />} />
        <div className="col-span-2 md:flex-1">
          <StatCard label="Avg Deal Size"
            value={fmt(totals.avgDeal)} valueLabel="Baseline"
            value2={fmt(totals.avgJob)} value2Label="Job Price"
            trend={<Trend cur={totals.avgDeal} prev={prevPeriod ? prevTotals.avgDeal : null} suffix="baseline vs prev" />} />
        </div>
      </div>

      {/* ── Monthly Goal ── */}
      <div className="rounded-xl p-4 md:p-5" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-[13px] md:text-[14px] font-semibold text-white">
              {monthlyGoal.month} Revenue Goal
              {scopeName && ` — ${scopeName}`}
            </h3>
            <p className="text-[10px] text-white/30 mt-0.5">
              {monthlyGoal.isCustom ? 'Custom goal' : 'Auto: 3-month avg ×1.1'}
            </p>
          </div>
          <div className={`text-[28px] md:text-[32px] font-bold leading-none ${monthlyGoal.pct >= 100 ? 'text-emerald-400' : 'text-teal'}`}>
            {monthlyGoal.pct.toFixed(1)}%
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4 md:gap-8 mb-4">
          <div>
            <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest mb-1">Month Revenue</p>
            <p className="text-[22px] md:text-[26px] font-bold text-white">{fmt(monthlyGoal.curRevenue)}</p>
          </div>
          <div className="text-white/20 text-xl mb-1">/</div>
          <div>
            <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest mb-1">Goal</p>
            {editingGoal ? (
              <div className="flex items-center gap-2">
                <span className="text-white/40">$</span>
                <input autoFocus type="number" value={goalInput}
                  onChange={e => setGoalInput(e.target.value)}
                  onBlur={handleGoalBlur}
                  onKeyDown={e => { if (e.key === 'Enter') saveGoal(); if (e.key === 'Escape') cancelGoalEdit() }}
                  style={{ background: '#2a2a2a', border: '1px solid rgba(0,184,148,0.4)' }}
                  className="w-28 rounded-lg px-2 py-1 text-[16px] font-bold text-teal focus:outline-none" />
                <button onMouseDown={e => e.preventDefault()} onClick={saveGoal}
                  className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-400/10"><Check size={15} /></button>
                <button onMouseDown={e => e.preventDefault()} onClick={cancelGoalEdit}
                  className="p-1.5 rounded-lg text-white/30 hover:bg-white/5"><X size={15} /></button>
                {monthlyGoal.isCustom && (
                  <button onMouseDown={e => e.preventDefault()} onClick={resetGoal}
                    className="text-[11px] text-white/30 hover:text-white/60 underline ml-1">reset</button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {canEditThisGoal ? (
                  <button onClick={startEditGoal}
                    className="text-[18px] md:text-[20px] font-bold text-teal hover:bg-teal/5 rounded px-2 -mx-2 py-0.5 transition-colors">
                    {fmt(monthlyGoal.goal)}
                  </button>
                ) : (
                  <p className="text-[18px] font-bold text-teal">{fmt(monthlyGoal.goal)}</p>
                )}
                {saveStatus === 'saved' && <span className="text-[11px] font-semibold text-teal">Saved</span>}
                {saveStatus === 'error' && <span className="text-[11px] font-semibold text-red-400">Save failed</span>}
              </div>
            )}
          </div>
          <div className="ml-auto text-right">
            <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest mb-1">Remaining</p>
            <p className="text-[16px] font-bold text-white/50">
              {monthlyGoal.pct >= 100 ? 'Goal Hit! 🎉' : fmt(Math.max(0, monthlyGoal.goal - monthlyGoal.curRevenue))}
            </p>
          </div>
        </div>

        <div className="h-3 rounded-full overflow-hidden" style={{ background: '#1a1a1a' }}>
          <div className={`h-full rounded-full transition-all duration-700 ${monthlyGoal.pct >= 100 ? 'bg-emerald-400' : 'bg-teal'}`}
            style={{ width: `${monthlyGoal.pct}%` }} />
        </div>

        {/* ── Weekly Goal (always the current week, Sun–Sat) ──
            COMPANY SCOPE ONLY. `app_settings.weekly_goal` is a single
            company-wide number, so once the page scopes to a team the revenue
            bar would be that team's while the target stayed the company's —
            a comparison that looks precise and means nothing. */}
        {isCompany(scope) && (
        <div className="mt-4 pt-4" style={{ borderTop: '1px solid #2e2e2e' }}>
          <div className="flex items-start justify-between mb-2">
            <div>
              <h4 className="text-[12px] md:text-[13px] font-semibold text-white">
                This Week ({weeklyGoal.label})
                {scopeName && ` — ${scopeName}`}
              </h4>
              <p className="text-[10px] text-white/30 mt-0.5">
                {weeklyGoal.isCustom ? 'Custom weekly goal' : 'Auto: monthly goal ÷ weeks'}
              </p>
            </div>
            <div className={`text-[20px] md:text-[24px] font-bold leading-none ${weeklyGoal.pct >= 100 ? 'text-emerald-400' : 'text-teal'}`}>
              {weeklyGoal.pct.toFixed(1)}%
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-4 md:gap-8 mb-3">
            <div>
              <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest mb-1">Week Revenue</p>
              <p className="text-[17px] md:text-[20px] font-bold text-white">{fmt(weeklyGoal.curRevenue)}</p>
            </div>
            <div className="text-white/20 text-lg mb-0.5">/</div>
            <div>
              <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest mb-1">Goal</p>
              {editingWeekGoal ? (
                <div className="flex items-center gap-2">
                  <span className="text-white/40">$</span>
                  <input autoFocus type="number" value={weekGoalInput}
                    onChange={e => setWeekGoalInput(e.target.value)}
                    onBlur={handleWeekGoalBlur}
                    onKeyDown={e => { if (e.key === 'Enter') saveWeekGoal(); if (e.key === 'Escape') cancelWeekGoalEdit() }}
                    style={{ background: '#2a2a2a', border: '1px solid rgba(0,184,148,0.4)' }}
                    className="w-28 rounded-lg px-2 py-1 text-[14px] font-bold text-teal focus:outline-none" />
                  <button onMouseDown={e => e.preventDefault()} onClick={saveWeekGoal}
                    className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-400/10"><Check size={14} /></button>
                  <button onMouseDown={e => e.preventDefault()} onClick={cancelWeekGoalEdit}
                    className="p-1.5 rounded-lg text-white/30 hover:bg-white/5"><X size={14} /></button>
                  {weeklyGoal.isCustom && (
                    <button onMouseDown={e => e.preventDefault()} onClick={resetWeekGoal}
                      className="text-[11px] text-white/30 hover:text-white/60 underline ml-1">reset</button>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {canEditGoal ? (
                    <button onClick={startEditWeekGoal}
                      className="text-[15px] md:text-[17px] font-bold text-teal hover:bg-teal/5 rounded px-2 -mx-2 py-0.5 transition-colors">
                      {fmt(weeklyGoal.goal)}
                    </button>
                  ) : (
                    <p className="text-[15px] font-bold text-teal">{fmt(weeklyGoal.goal)}</p>
                  )}
                  {weekSaveStatus === 'saved' && <span className="text-[11px] font-semibold text-teal">Saved</span>}
                  {weekSaveStatus === 'error' && <span className="text-[11px] font-semibold text-red-400">Save failed</span>}
                </div>
              )}
            </div>
            <div className="ml-auto text-right">
              <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest mb-1">Remaining</p>
              <p className="text-[14px] font-bold text-white/50">
                {weeklyGoal.pct >= 100 ? 'Goal Hit! 🎉' : fmt(Math.max(0, weeklyGoal.goal - weeklyGoal.curRevenue))}
              </p>
            </div>
          </div>

          <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1a1a1a' }}>
            <div className={`h-full rounded-full transition-all duration-700 ${weeklyGoal.pct >= 100 ? 'bg-emerald-400' : 'bg-teal'}`}
              style={{ width: `${weeklyGoal.pct}%` }} />
          </div>
        </div>
        )}
      </div>

      {/* ── Appointments & field ────────────────────────────────────────
          Appointment COUNTS, never deals — the label says so because "Set"
          meaning two different things across two pages is what made the old
          Dashboard and Performance page impossible to read together. */}
      {node && (
        <div className="rounded-xl p-4 md:p-5" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
          <h3 className="text-[13px] md:text-[14px] font-semibold text-white mb-0.5">
            {node.level === 'rep' ? `${node.title}'s appointments` : 'Appointments'}
          </h3>
          <p className="text-[11px] text-white/30 mb-3">Appointment counts, never deals</p>
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
                <div key={k} className="rounded-lg px-3 py-2.5" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
                  <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest mb-1">{k}</p>
                  <p className="text-[18px] font-bold text-white tabular-nums">{(v ?? 0).toLocaleString()}</p>
                  {sub && <p className="text-[10px] text-teal mt-0.5">{sub}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-white/35 leading-relaxed">{node.funnelNote}</p>
          )}
          {node.showFunnel && node.stats.pastDue > 0 && (
            <a href="/leads?missing=info"
              className="mt-2.5 inline-flex items-center gap-1.5 text-[11.5px] text-amber-300/80 hover:text-amber-300 transition-colors">
              <AlertCircle size={12} />
              {node.stats.pastDue} appointment{node.stats.pastDue === 1 ? '' : 's'} past their date with no outcome logged — they count as neither ran nor cancelled. Fix in Leads →
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
                <div key={k} className="rounded-lg px-3 py-2" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
                  <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest mb-0.5">{k}</p>
                  <p className="text-[15px] font-bold text-white tabular-nums">{v ?? 0}</p>
                  {sub && <p className="text-[10px] text-white/35">{sub}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── The drill table ─────────────────────────────────────────────
          Company → Teams or Offices → reps, then a rep's own deals. Six
          columns by default; the activity toggle adds four. Today's
          Performance table is thirteen, always. */}
      {node && (
        <div className="rounded-xl p-4 md:p-5" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              {node.level === 'company' ? (
                <>
                  <span className="text-[9px] font-semibold text-white/30 uppercase tracking-widest mr-1">Break down by</span>
                  {['team', 'office'].map(g => (
                    <button key={g} onClick={() => setGroupBy(g)}
                      className={`px-2.5 py-1 rounded-full text-[11px] transition-colors ${groupBy === g
                        ? 'bg-teal text-dark font-semibold' : 'text-white/45 hover:text-white'}`}
                      style={groupBy === g ? undefined : { border: '1px solid #3a3a3a' }}>
                      {g === 'team' ? 'Teams' : 'Offices'}
                    </button>
                  ))}
                </>
              ) : (
                <h3 className="text-[13px] md:text-[14px] font-semibold text-white">
                  {node.childKind || `${node.title} · deals`}
                </h3>
              )}
            </div>
            <button onClick={() => setShowActivity(v => !v)}
              className={`px-2.5 py-1 rounded-full text-[11px] transition-colors ${showActivity
                ? 'bg-teal text-dark font-semibold' : 'text-white/45 hover:text-white'}`}
              style={showActivity ? undefined : { border: '1px solid #3a3a3a' }}>
              {showActivity ? '✓' : '+'} Appointments
            </button>
          </div>

          {node.children.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-[9px] uppercase tracking-widest text-white/30">
                    <th className="text-left font-semibold py-1.5 pr-2">{node.childKind}</th>
                    {showActivity && ['Set','Ran'].map(h =>
                      <th key={h} className="text-right font-semibold py-1.5 px-2 text-teal/60">{h}</th>)}
                    {['Revenue','Deals','Avg deal','Markup','Commission','Goal'].map(h =>
                      <th key={h} className="text-right font-semibold py-1.5 px-2">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {node.children.map(c => {
                    const st = c.stats
                    const g = c.kind === 'rep' ? repGoalMap[c.key]
                            : c.kind === 'office' ? officeGoals[c.label]
                            : (teamGoalMap[c.key] ?? null)
                    const gp = g ? (st.revenue / g) * 100 : null
                    const fl = c.kind === 'rep' ? repFlags(st, flagFloors) : {}
                    return (
                      <tr key={`${c.kind}-${c.key}`}
                        onClick={c.drillable ? onClickUnlessSelecting(() => setScope({ level: c.kind, key: c.key })) : undefined}
                        className={`border-t border-white/5 ${c.drillable ? 'cursor-pointer hover:bg-white/[0.03]' : ''}`}>
                        <td className="py-2 pr-2">
                          <span className={`font-semibold ${c.drillable ? 'text-teal' : 'text-white/70'}`}>
                            {c.ghost && !isAdmin ? 'Hidden' : c.label}{c.drillable ? ' ›' : ''}
                          </span>
                          {c.sub && <span className="block text-[10px] text-white/30 font-normal">{c.sub}</span>}
                        </td>
                        {showActivity && (
                          <>
                            {/* The conversion rate rides UNDER the count it
                                describes (per Keaton, "a little nod") rather
                                than taking a column of its own. */}
                            <td className={`text-right py-2 px-2 tabular-nums ${fl.set ? 'text-red-400 font-bold' : 'text-white/60'}`}>
                              {st.set ?? 0}
                              {st.showRate != null && <span className="block text-[10px] text-white/30 font-normal">{st.showRate.toFixed(0)}% ran</span>}
                            </td>
                            <td className="text-right py-2 px-2 tabular-nums text-white/60">
                              {st.ran ?? 0}
                              {st.dealCloseRate != null && <span className="block text-[10px] text-teal/60 font-normal">{st.dealCloseRate.toFixed(0)}% closed</span>}
                            </td>
                          </>
                        )}
                        <td className="text-right py-2 px-2 tabular-nums text-white font-semibold">
                          {fmt(st.revenue)}
                          <Delta cur={st.revenue} prev={c.prev?.revenue} />
                        </td>
                        <td className="text-right py-2 px-2 tabular-nums text-white/60">
                          {st.deals}
                          <Delta cur={st.deals} prev={c.prev?.deals} />
                        </td>
                        <td className="text-right py-2 px-2 tabular-nums text-white/60">{st.avgDeal != null ? fmt(st.avgDeal) : '—'}</td>
                        <td className="text-right py-2 px-2 tabular-nums text-white/60">{st.markupPct != null ? `${st.markupPct.toFixed(1)}%` : '—'}</td>
                        <td className="text-right py-2 px-2 tabular-nums text-white/60">{fmt(st.commission)}</td>
                        <td className="text-right py-2 px-2 tabular-nums">
                          {gp == null ? <span className="text-white/20">—</span> : (
                            <span className={gp >= 100 ? 'text-emerald-400 font-semibold' : gp >= 80 ? 'text-white/60' : 'text-amber-400'}>
                              {Math.round(gp)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  <tr className="border-t border-white/10" style={{ background: '#1f1f1f' }}>
                    <td className="py-2 pr-2 font-bold text-white">{node.title}</td>
                    {showActivity && (
                      <>
                        <td className="text-right py-2 px-2 tabular-nums font-bold text-white/80">
                          {node.stats.set ?? 0}
                          {node.stats.showRate != null && <span className="block text-[10px] text-white/30 font-normal">{node.stats.showRate.toFixed(0)}% ran</span>}
                        </td>
                        <td className="text-right py-2 px-2 tabular-nums font-bold text-white/80">
                          {node.stats.ran ?? 0}
                          {node.stats.dealCloseRate != null && <span className="block text-[10px] text-teal/60 font-normal">{node.stats.dealCloseRate.toFixed(0)}% closed</span>}
                        </td>
                      </>
                    )}
                    <td className="text-right py-2 px-2 tabular-nums font-bold text-white">
                      {fmt(node.stats.revenue)}
                      <Delta cur={node.stats.revenue} prev={node.prev?.revenue} />
                    </td>
                    <td className="text-right py-2 px-2 tabular-nums font-bold text-white/80">
                      {node.stats.deals}
                      <Delta cur={node.stats.deals} prev={node.prev?.deals} />
                    </td>
                    <td className="text-right py-2 px-2 tabular-nums font-bold text-white/80">{node.stats.avgDeal != null ? fmt(node.stats.avgDeal) : '—'}</td>
                    <td className="text-right py-2 px-2 tabular-nums font-bold text-white/80">{node.stats.markupPct != null ? `${node.stats.markupPct.toFixed(1)}%` : '—'}</td>
                    <td className="text-right py-2 px-2 tabular-nums font-bold text-white/80">{fmt(node.stats.commission)}</td>
                    <td className="text-right py-2 px-2 tabular-nums font-bold text-white/60">
                      {goalInfo.target ? `${Math.round((node.stats.revenue / goalInfo.target) * 100)}%` : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="text-[10.5px] text-white/25 mt-2">Click a row to scope the whole page to it.</p>
            </div>
          ) : node.level === 'rep' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-[9px] uppercase tracking-widest text-white/30">
                    <th className="text-left font-semibold py-1.5 pr-2">Deal</th>
                    <th className="text-left font-semibold py-1.5 px-2">Sold</th>
                    <th className="text-right font-semibold py-1.5 px-2">Revenue</th>
                    <th className="text-left font-semibold py-1.5 px-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {repDealRows.map(d => (
                    <tr key={d.id} className="border-t border-white/5">
                      <td className="py-2 pr-2 text-white font-medium truncate max-w-[220px]">{d.deal_name}</td>
                      <td className="py-2 px-2 text-white/50 whitespace-nowrap">{d.sale_date}</td>
                      <td className="text-right py-2 px-2 tabular-nums text-white/70">{fmt(parseFloat(d.baseline_revenue) || 0)}</td>
                      <td className="py-2 px-2 text-white/50">{d.status}</td>
                    </tr>
                  ))}
                  {repDealRows.length === 0 && (
                    <tr><td colSpan={4} className="py-4 text-center text-white/30 text-[12px]">No deals in this range.</td></tr>
                  )}
                </tbody>
              </table>
              <a href={`/deals?scope=all&rep=${node.key}`}
                className="inline-block mt-2 text-[11px] text-teal hover:underline">Open in Deals for filtering and edits →</a>
            </div>
          ) : (
            <p className="text-[12px] text-white/30 py-3">Nothing to break down here.</p>
          )}
        </div>
      )}


      {/* ── Rep leaderboard — FULL WIDTH, under the teams table ──────────
          Brought back after the merge removed it (per Keaton, who uses it
          constantly and pastes it into a meeting). The drill table shows
          TEAMS at company level, so this is the only place individuals are
          visible at a glance. It follows the scope like everything else.

          NOTE the column is "Set (passed)", never bare "Set": on this same
          page "Set" already means APPOINTMENTS in the funnel above, and two
          meanings for one word is the exact problem the merge existed to
          kill. Here it is a DEAL they set that another rep closed. */}
      {repBoard.length > 0 && (
        <div className="rounded-xl p-4 md:p-5" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
          <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
            <div>
              <h3 className="text-[13px] md:text-[14px] font-semibold text-white">
                Rep Leaderboard{node && node.level !== 'company' ? ` — ${node.title}` : ''}
              </h3>
              <p className="text-[11px] text-white/30 mt-0.5">
                {repBoard.length} {repBoard.length === 1 ? 'rep' : 'reps'} with activity · tap a column to rank by it ·
                Total Revenue includes deals they closed for another setter
              </p>
            </div>
            <button onClick={copyLeaderboard}
              title="Copy as a table — pastes formatted into Canva, Sheets or Docs"
              className={`px-2.5 py-1.5 rounded-lg text-[11.5px] font-semibold inline-flex items-center gap-1.5 transition-colors ${
                copiedBoard ? 'text-emerald-400' : 'text-white/45 hover:text-teal'}`}
              style={{ background: '#1a1a1a', border: '1px solid #333' }}>
              {copiedBoard ? <Check size={12} /> : <Copy size={12} />}{copiedBoard ? 'Copied' : 'Copy table'}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr>
                  <th className="text-left font-semibold py-1.5 pr-1 w-8 text-[9px] uppercase tracking-widest text-white/30">#</th>
                  <SortTh first label="Rep" col="name" sort={boardSort} onSort={toggleBoardSort} />
                  <SortTh label="Revenue" col="revenue" sort={boardSort} onSort={toggleBoardSort}
                    title="Revenue on the deals they OWN — what they set, or closed with no setter recorded" />
                  <SortTh label="Total Revenue" col="totalRevenue" sort={boardSort} onSort={toggleBoardSort}
                    title="Every deal they were involved in: their own, plus the ones they closed for another setter. A self-gen counts once. Per-person — do not add these up across a team, since a deal whose setter AND closer are both on it would count twice." />
                  <SortTh label="Deals" col="deals" sort={boardSort} onSort={toggleBoardSort}
                    title="Deals they own = Self-Gen + the ones they set and passed to a closer" />
                  <SortTh label="Self-Gen" col="selfGen" sort={boardSort} onSort={toggleBoardSort}
                    title="Deals they set AND closed themselves" />
                  <SortTh label="Lead Closes" col="leadCloses" sort={boardSort} onSort={toggleBoardSort}
                    title="Deals another rep set that they closed — the setter still owns the deal" />
                  <SortTh label="Commission" col="commission" sort={boardSort} onSort={toggleBoardSort} />
                </tr>
              </thead>
              <tbody>
                {repBoard.map((r, i) => (
                  <tr key={r.id}
                    onClick={onClickUnlessSelecting(() => setScope({ level: 'rep', key: r.id }))}
                    className="border-t border-white/5 cursor-pointer hover:bg-white/[0.03]">
                    <td className="py-2 pr-1 text-white/25 tabular-nums">{i + 1}</td>
                    <td className="py-2 pr-2">
                      <span className="font-semibold text-teal">{r.name} ›</span>
                      {isCompany(scope) && r.team && (
                        <span className="block text-[10px] text-white/30 font-normal">{r.team}</span>
                      )}
                    </td>
                    <td className="text-right py-2 px-2 tabular-nums text-white font-semibold">
                      {fmt(r.revenue)}
                      <Delta cur={r.revenue} prev={r.prev?.revenue} />
                    </td>
                    <td className="text-right py-2 px-2 tabular-nums text-white/75">
                      {fmt(r.totalRevenue)}
                      {r.leadRevenue > 0 && (
                        <span className="block text-[10px] text-white/30 font-normal">+{fmt(r.leadRevenue)} closed</span>
                      )}
                    </td>
                    <td className="text-right py-2 px-2 tabular-nums text-white/70">{r.deals}</td>
                    <td className="text-right py-2 px-2 tabular-nums text-white/50">{r.selfGen}</td>
                    <td className="text-right py-2 px-2 tabular-nums text-white/50">{r.leadCloses}</td>
                    <td className="text-right py-2 px-2 tabular-nums text-white/70">{fmt(r.commission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Weekly + Annual — stack on mobile ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5">

        {/* Weekly Performance */}
        <div className="rounded-xl p-4 md:p-5" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
          <div className="mb-4">
            <h3 className="text-[13px] md:text-[14px] font-semibold text-white">Weekly Performance</h3>
            <p className="text-[11px] text-white/30 mt-0.5">
              Sun–Sat · last {weeklyData.length - 1} full weeks + this week
              {weeklyAvg && (
                <span className="text-white/50"> · avg <span className="font-semibold text-teal/80">{fmt(weeklyAvg.revenue)}</span> & {weeklyAvg.deals.toFixed(1)} deals / week</span>
              )}
            </p>
          </div>
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {weeklyData.map((w, i) => (
              <div key={i} className="rounded-lg px-3 py-2.5 flex items-center gap-3"
                style={{ background: '#1a1a1a', border: w.current ? '1px solid #00b89440' : '1px solid #2a2a2a' }}>
                <div className="w-14 md:w-20 flex-shrink-0">
                  <p className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: w.current ? '#00b894' : 'rgba(255,255,255,0.4)' }}>{w.current ? 'This wk' : 'Week'}</p>
                  <p className="text-[12px] md:text-[13px] font-bold text-white">{w.label}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#2a2a2a' }}>
                    <div className="h-full rounded-full bg-teal" style={{ width: `${(w.revenue / maxWeekRevLocal) * 100}%` }} />
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[12px] md:text-[13px] font-bold text-teal whitespace-nowrap">{fmt(w.revenue)}</p>
                  <p className="text-[10px] text-white/40">{w.deals} {w.deals === 1 ? 'deal' : 'deals'}</p>
                </div>
              </div>
            ))}
            {weeklyData.length === 0 && <p className="text-[13px] text-white/30 text-center py-8">No data</p>}
          </div>
        </div>

        {/* Annual Chart */}
        <div className="rounded-xl p-4 md:p-5" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
          <div className="mb-4">
            <h3 className="text-[13px] md:text-[14px] font-semibold text-white">Annual Trend</h3>
            <p className="text-[11px] text-white/30 mt-0.5">Trailing 12 months</p>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={annualData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="annualGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00b894" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#00b894" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2e2e2e" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#666' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#666' }} axisLine={false} tickLine={false}
                tickFormatter={v => `$${(v/1000).toFixed(0)}k`} width={36} />
              <Tooltip
                cursor={{ stroke: '#00b894', strokeWidth: 1, strokeOpacity: 0.3 }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0]?.payload
                  return (
                    <div style={{ background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: 10, padding: '10px 14px' }}>
                      <p style={{ color: '#00b894', fontWeight: 600, fontSize: 12, marginBottom: 4 }}>{label}</p>
                      <p style={{ color: '#fff', fontSize: 12 }}>Revenue: ${d?.revenue?.toLocaleString()}</p>
                      <p style={{ color: '#999', fontSize: 11 }}>Deals: {d?.deals ?? 0}</p>
                    </div>
                  )
                }}
              />
              <Area type="monotone" dataKey="revenue" stroke="#00b894" strokeWidth={2}
                fill="url(#annualGrad)" dot={{ fill: '#00b894', r: 3 }} activeDot={{ r: 5 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
