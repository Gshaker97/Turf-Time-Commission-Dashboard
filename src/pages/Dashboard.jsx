import { useState, useEffect, useMemo, useRef } from 'react'
import {
  format, subMonths, startOfWeek, endOfWeek, addDays, getDaysInMonth,
} from 'date-fns'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Check, X, TrendingUp, TrendingDown, Minus, ChevronUp, ChevronDown, ChevronsUpDown, Copy } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { fetchDeals, fetchUsers, fetchGoal, saveGoal as saveGoalDb, deleteGoal as deleteGoalDb, fetchTeamChanges } from '../lib/db'
import { fmt, dealAmounts, activeDeals } from '../utils/commission'
import { headIdSet, saleOwnerId, buildChangesByProfile, teamOfSale } from '../utils/team'
import { buildRecordBook, periodEnd } from '../utils/records'
import { onClickUnlessSelecting } from '../utils/selection'
import { getPresetRange, getPreviousRange } from '../utils/dateRanges'
import DateRangeFilter from '../components/DateRangeFilter'
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus'

const MEDAL = {
  1: { bg: '#fbbf2420', color: '#fbbf24' },
  2: { bg: '#94a3b820', color: '#94a3b8' },
  3: { bg: '#fb923c20', color: '#fb923c' },
}
function RankBadge({ n }) {
  const s = MEDAL[n] ?? { bg: 'transparent', color: '#ffffff30' }
  return (
    <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
      style={{ background: s.bg, color: s.color }}>{n}</span>
  )
}

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

// Clickable, sortable leaderboard column header. Shows the active sort arrow,
// or a faint up/down hint when inactive.
function SortTh({ label, active, dir, onClick, align = 'center', className = '', title }) {
  const justify = align === 'right' ? 'justify-end' : align === 'left' ? 'justify-start' : 'justify-center'
  return (
    <th className={`pb-2 ${className}`} title={title}>
      <button onClick={onClick}
        className={`w-full flex items-center gap-0.5 uppercase tracking-wider transition-colors ${justify} ${active ? 'text-teal' : 'text-white/30 hover:text-white/60'}`}>
        <span>{label}</span>
        {active
          ? (dir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)
          : <ChevronsUpDown size={10} className="opacity-40" />}
      </button>
    </th>
  )
}

// Pass value2 (+ valueLabel/value2Label) to show two figures side by side in
// one card — e.g. Avg Deal Size's baseline + job price.
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
  const { isAdmin } = useAuth()
  const { settings, save: saveSettingCtx, dataStartDate } = useSettings()
  // Setting the monthly revenue goal is a data change — admin-only.
  const canEditGoal = isAdmin

  const [deals,        setDeals]        = useState([])
  const [users,        setUsers]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [dateFrom,     setDateFrom]     = useState(getPresetRange('mtd').from)
  const [dateTo,       setDateTo]       = useState(getPresetRange('mtd').to)
  const [activePreset, setActivePreset] = useState('mtd')
  const [teamFilter,   setTeamFilter]   = useState('')
  const [teamChanges,  setTeamChanges]  = useState([])
  const [repSort,      setRepSort]      = useState({ key: 'revenue', dir: 'desc' })  // leaderboard ranking
  const [copied,       setCopied]       = useState(false)
  const [openTeams,    setOpenTeams]    = useState(() => new Set())
  const toggleTeam = (id) => setOpenTeams(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const [editingGoal,  setEditingGoal]  = useState(false)
  const [goalInput,    setGoalInput]    = useState('')
  const [savedGoal,    setSavedGoal]    = useState(null)
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
    Promise.all([fetchDeals(), fetchUsers(), fetchTeamChanges()]).then(([{ data: d }, { data: u }, { data: tc }]) => {
      setDeals(activeDeals(d ?? []))   // canceled jobs never count toward stats
      setUsers(u ?? [])
      setTeamChanges(tc ?? [])
    })

  useEffect(() => { loadData().finally(() => setLoading(false)) }, [])
  useRefreshOnFocus(loadData)   // repull when returning to the tab so stats stay current

  useEffect(() => {
    setSavedGoal(null)
    fetchGoal(goalYear, goalMonth).then(({ data }) => setSavedGoal(data))
  }, [goalYear, goalMonth])

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
  const saleTeam = (d) => teamOfSale(saleOwnerId(d), d.sale_date, usersById, headsSet, changesByProfile)

  function applyScopeFilters(rows) {
    if (!teamFilter) return rows
    return rows.filter(d => saleTeam(d) === teamFilter)
  }

  const filtered = useMemo(() => {
    let r = applyScopeFilters(deals)
    if (dateFrom) r = r.filter(d => d.sale_date >= dateFrom)
    if (dateTo)   r = r.filter(d => d.sale_date <= dateTo)
    return r
  }, [deals, teamFilter, users, dateFrom, dateTo])

  const prevFiltered = useMemo(() => {
    if (!prevPeriod) return []
    return applyScopeFilters(deals).filter(d => d.sale_date >= prevPeriod.from && d.sale_date <= prevPeriod.to)
  }, [deals, teamFilter, users, prevPeriod])

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

  const companyTotalRev = useMemo(() => {
    let r = deals
    if (dateFrom) r = r.filter(d => d.sale_date >= dateFrom)
    if (dateTo)   r = r.filter(d => d.sale_date <= dateTo)
    return r.reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0) || 1
  }, [deals, dateFrom, dateTo])

  // ── Record moments: banner when a company record breaks ──
  // Fires while a record is being beaten in progress, and for up to 7 days
  // after a completed period sets a new all-time best. Dismissals stick per
  // record per period (localStorage).
  const [dismissedRecs, setDismissedRecs] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('tt_rec_dismissed') || '[]')) } catch { return new Set() }
  })
  const dismissRec = (id) => {
    setDismissedRecs(prev => {
      const next = new Set(prev); next.add(id)
      try { localStorage.setItem('tt_rec_dismissed', JSON.stringify([...next].slice(-40))) } catch { /* ignore */ }
      return next
    })
  }
  const recordMoments = useMemo(() => {
    if (!deals.length) return []
    const today = format(new Date(), 'yyyy-MM-dd')
    const { company, reps, teams } = buildRecordBook(deals, {
      users, isAdmin, dataStartDate, todayISO: today,
      teamCtx: { usersById, heads: headsSet, changesByProfile },
    })
    const NAMES = {
      revMonth: ['month', 'biggest month'], revWeek: ['week', 'biggest week'], revDay: ['day', 'biggest day'],
      dealsMonth: ['month', 'most deals in a month'], dealsWeek: ['week', 'most deals in a week'], dealsDay: ['day', 'most deals in a day'],
    }
    const cutoff = new Date(today + 'T12:00:00'); cutoff.setDate(cutoff.getDate() - 7)
    const cutISO = format(cutoff, 'yyyy-MM-dd')
    const val = (key, v) => key.startsWith('deals') ? `${v} deals` : fmt(v)

    // Company / rep / team all banner the same two ways: a record being
    // passed RIGHT NOW, or one set within the last 7 days. `prev` is required
    // on completed ones so a first-ever period never banners.
    const scan = (book, scope) => {
      const out = []
      if (!book) return out
      for (const [key, rec] of Object.entries(book)) {
        if (!NAMES[key] || !rec || typeof rec !== 'object' || !('status' in rec)) continue
        const [grain, label] = NAMES[key]
        const who = (r) => r?.holderName ? <b>{r.holderName}</b> : null
        if (rec.status === 'new' && rec.best) {
          out.push({
            id: `rec-${scope}-${key}-${rec.current.key}`,
            text: scope === 'company'
              ? <>🔥 <b>NEW COMPANY RECORD in progress</b> — {label}: <b>{val(key, rec.current.value)}</b> and counting (previous best: {val(key, rec.best.value)}, {rec.best.label})</>
              : <>🔥 {who(rec.current)} is breaking the {scope} record — {label}: <b>{val(key, rec.current.value)}</b> and counting (previous: {val(key, rec.best.value)}{rec.best.holderName ? `, ${rec.best.holderName}` : ''})</>,
          })
        } else if (rec.best && rec.prev && periodEnd(grain, rec.best.key) >= cutISO) {
          out.push({
            id: `rec-${scope}-${key}-${rec.best.key}`,
            text: scope === 'company'
              ? <>🔥 <b>NEW COMPANY RECORD</b> — {label}: <b>{val(key, rec.best.value)}</b> ({rec.best.label}; previous: {val(key, rec.prev.value)})</>
              : <>🔥 <b>NEW {scope.toUpperCase()} RECORD</b> — {who(rec.best)}, {label}: <b>{val(key, rec.best.value)}</b> ({rec.best.label}; previous: {val(key, rec.prev.value)})</>,
          })
        }
      }
      return out
    }
    // Company first, then team, then rep — biggest news at the top.
    const out = [...scan(company, 'company'), ...scan(teams, 'team'), ...scan(reps, 'rep')]
    return out.filter(m => !dismissedRecs.has(m.id)).slice(0, 3)
  }, [deals, users, isAdmin, dataStartDate, dismissedRecs, usersById, headsSet, changesByProfile])

  const monthlyGoal = useMemo(() => {
    const curKey = `${String(goalYear).padStart(4,'0')}-${String(goalMonth).padStart(2,'0')}`
    function monthTotal(mk) {
      let rows = deals.filter(d => d.sale_date?.startsWith(mk))
      if (teamFilter) rows = rows.filter(d => saleTeam(d) === teamFilter)
      return rows.reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0)
    }
    const curRevenue = monthTotal(curKey)
    const trailing   = [1,2,3].map(i => monthTotal(format(subMonths(goalDate, i), 'yyyy-MM')))
    const autoGoal   = Math.max((trailing.reduce((s,v) => s+v,0)/3)*1.1, 10000)
    const goal       = savedGoal != null ? savedGoal : autoGoal
    const pct        = Math.min((curRevenue/goal)*100, 100)
    return { curRevenue, goal, pct, isCustom: savedGoal != null, month: format(goalDate, 'MMMM yyyy') }
  }, [deals, users, teamFilter, savedGoal, goalYear, goalMonth, goalDate])

  // Weekly goal: always tracks the CURRENT week (Sun–Sat, same week rule as the
  // rest of reporting), regardless of the selected date range. A custom $ lives
  // in app_settings.weekly_goal (admin-set, applies every week until changed);
  // otherwise auto = monthly goal ÷ weeks in the month.
  const weeklyGoal = useMemo(() => {
    const now = new Date()
    const wkStart = startOfWeek(now, { weekStartsOn: 0 })
    const wkEnd   = endOfWeek(now,   { weekStartsOn: 0 })
    const ws = format(wkStart, 'yyyy-MM-dd'), we = format(wkEnd, 'yyyy-MM-dd')
    let rows = deals.filter(d => d.sale_date >= ws && d.sale_date <= we)
    if (teamFilter) rows = rows.filter(d => saleTeam(d) === teamFilter)
    const curRevenue = rows.reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0)
    const saved    = parseFloat(settings.weekly_goal)
    const isCustom = Number.isFinite(saved) && saved > 0
    const autoGoal = monthlyGoal.goal / (getDaysInMonth(goalDate) / 7)
    const goal     = isCustom ? saved : autoGoal
    const pct      = Math.min((curRevenue / goal) * 100, 100)
    return { curRevenue, goal, pct, isCustom, label: `${format(wkStart, 'MMM d')} – ${format(wkEnd, 'MMM d')}` }
  }, [deals, users, teamFilter, settings.weekly_goal, monthlyGoal.goal, goalDate])

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
    const { error } = await saveGoalDb(goalYear, goalMonth, v)
    if (error) { setSaveError(error.message); setSaveStatus('error'); return }
    setSavedGoal(v); setSaveStatus('saved'); setTimeout(() => setSaveStatus('idle'), 2000)
  }
  async function resetGoal() {
    skipBlurSaveRef.current = true; setEditingGoal(false)
    const { error } = await deleteGoalDb(goalYear, goalMonth)
    if (error) { setSaveError(error.message); setSaveStatus('error'); return }
    setSavedGoal(null); setSaveStatus('saved'); setTimeout(() => setSaveStatus('idle'), 2000)
  }

  const teamData = useMemo(() => {
    // Team heads via the shared rule (utils/team.js) — an absorbed manager
    // (reports to another lead, no directs) is a member, not their own team.
    const heads = headIdSet(users)
    const mgrs = teamFilter ? users.filter(u => u.id === teamFilter) : users.filter(u => heads.has(u.id))
    // Group every deal by its DATE-EFFECTIVE team once (owner's team as of the
    // sale date — team_changes log), then build each team row from its deals.
    const byTeam = {}, prevByTeam = {}
    for (const d of filtered)     (byTeam[saleTeam(d)] ||= []).push(d)
    for (const d of prevFiltered) (prevByTeam[saleTeam(d)] ||= []).push(d)
    const teamRow = (key, name, ghost, repCount) => {
      const mDeals  = byTeam[key] || []
      const revenue = mDeals.reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0)
      const prevRev = (prevByTeam[key] || []).reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0)
      // Drill-down rows come from the DEALS, so a moved rep's old sales still
      // show inside the team they were on when they sold them.
      const byOwner = {}
      for (const d of mDeals) {
        const oid = saleOwnerId(d) || 'none'
        if (!byOwner[oid]) {
          const u = users.find(x => x.id === oid)
          byOwner[oid] = { id: oid, name: u?.name ?? 'No rep assigned', ghost: u?.ghost === true, isManager: oid === key, deals: 0, revenue: 0 }
        }
        byOwner[oid].deals += 1
        byOwner[oid].revenue += parseFloat(d.baseline_revenue) || 0
      }
      return { id: key, name, ghost, repCount, deals: mDeals.length, revenue, prevRev,
        reps: Object.values(byOwner).sort((a, b) => b.revenue - a.revenue), pct: (revenue / companyTotalRev) * 100 }
    }
    const rows = mgrs.map(mgr => teamRow(mgr.id, mgr.name, mgr.ghost === true,
      users.filter(u => u.manager_id === mgr.id && u.id !== mgr.id && u.active !== false).length
    ))
    // HISTORICAL teams: sale keys that aren't a current head (a lead whose
    // team has since dissolved without being absorbed) still get their own
    // row, so old deals never dump into Unassigned just because the team
    // disbanded later.
    if (!teamFilter) {
      const known = new Set(mgrs.map(m => m.id))
      for (const key of Object.keys(byTeam)) {
        if (key === 'unassigned' || known.has(key)) continue
        const u = users.find(x => x.id === key)
        rows.push(teamRow(key, u?.name ?? 'Former team', u?.ghost === true, 0))
      }
    }
    rows.sort((a, b) => b.revenue - a.revenue)
    if (!teamFilter && (byTeam.unassigned?.length || prevByTeam.unassigned?.length)) {
      rows.push(teamRow('unassigned', 'Unassigned', false, 0))
    }
    return rows
  }, [users, filtered, prevFiltered, companyTotalRev, teamFilter, usersById, headsSet, changesByProfile])

  const repData = useMemo(() => {
    const map = {}
    const ensure = (id) => {
      if (!map[id]) {
        const u   = users.find(u => u.id === id)
        const mgr = u ? users.find(m => m.id === u.manager_id) : null
        map[id]   = { id, name: u?.name ?? '—', team: mgr?.name ?? '—',
          deals: 0, revenue: 0, leads: 0, leadRevenue: 0, commission: 0,
          closed: 0, closedRevenue: 0, selfGens: 0 }
      }
      return map[id]
    }
    for (const deal of filtered) {
      // Deals + revenue credit the sale owner — the SETTER, falling back to
      // the closer when no setter was recorded (so no deal vanishes from the
      // leaderboard while still counting in the totals).
      const sid = saleOwnerId(deal)
      const cid = deal.closer_id
      const bl  = parseFloat(deal.baseline_revenue) || 0
      const a   = dealAmounts(deal)
      if (sid) {
        const s = ensure(sid)
        s.deals      += 1
        s.revenue    += bl
        s.commission += deal.setter_id ? a.setter : a.closer
      }
      // Leads + lead revenue credit the CLOSER when they aren't the setter —
      // they closed someone else's lead, and earn their closer share.
      if (cid && cid !== sid) {
        const c = ensure(cid)
        c.leads       += 1
        c.leadRevenue += bl
        c.commission  += a.closer
      }
      // Closed + closed revenue credit whoever RAN the appointment, self-gen
      // or not. A deal with a setter but no closer_id was closed by the setter
      // themselves — the same rule dealAmounts() uses to pay them the full rep
      // pool — so fall back to the setter rather than crediting nobody.
      // By construction: closed === selfGens + leads.
      const closerOwn = deal.closer_id || deal.setter_id || null
      if (closerOwn) {
        const c = ensure(closerOwn)
        c.closed        += 1
        c.closedRevenue += bl
        if (closerOwn === sid) c.selfGens += 1
      }
    }
    return Object.values(map).map(r => ({ ...r, pct: (r.revenue / companyTotalRev) * 100 }))
  }, [filtered, users, companyTotalRev])

  // Rank by the chosen column (defaults to set-revenue). All sortable columns
  // are numeric. Revenue breaks ties.
  const toggleRepSort = (key) =>
    setRepSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))
  const ghostIds = useMemo(() => new Set(users.filter(u => u.ghost).map(u => u.id)), [users])
  const rankedReps = useMemo(() => {
    const { key, dir } = repSort
    // Show every rep with any activity — ranked, scrollable. (No top-N cut, so
    // setter-only reps who hand deals off to a closer still appear.) Ghost reps
    // are hidden from non-admins, but their deals still feed every total above.
    return [...repData]
      .filter(r => (r.deals || r.leads || r.revenue || r.leadRevenue || r.commission) && (isAdmin || !ghostIds.has(r.id)))
      .sort((a, b) => (dir === 'asc' ? (a[key] - b[key]) : (b[key] - a[key])) || (b.revenue - a.revenue))
  }, [repData, repSort, ghostIds, isAdmin])

  // Copy the current leaderboard to the clipboard as a real table (HTML) with a
  // tab-separated fallback — pastes cleanly into Canva, Sheets, Docs, etc.
  async function copyLeaderboard() {
    const cols = ['#', 'Rep', 'Deals', 'Closed', 'Revenue', 'Closed Rev', 'Self Gen', 'Leads', 'Lead Rev', 'Comm']
    // The export is a shareable artifact, so ghost reps are always dropped —
    // even for an admin, who sees them on-screen. (Re-rank after filtering.)
    const rows = rankedReps
      .filter(r => !ghostIds.has(r.id))
      .map((r, i) => [i + 1, r.name, r.deals, r.closed, fmt(r.revenue), fmt(r.closedRevenue), r.selfGens, r.leads, fmt(r.leadRevenue), fmt(r.commission)])
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const tsv = [cols, ...rows].map(r => r.join('\t')).join('\n')
    const html =
      `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">` +
      `<thead><tr style="background:#00b894;color:#0b0b0b">` +
      cols.map((c, i) => `<th style="padding:6px 12px;text-align:${i >= 2 ? 'right' : 'left'};border:1px solid #d1d5db">${esc(c)}</th>`).join('') +
      `</tr></thead><tbody>` +
      rows.map((r, ri) => `<tr style="background:${ri % 2 ? '#f3f4f6' : '#ffffff'};color:#111">` +
        r.map((c, ci) => `<td style="padding:6px 12px;text-align:${ci >= 2 ? 'right' : 'left'};border:1px solid #d1d5db">${esc(c)}</td>`).join('') +
        `</tr>`).join('') +
      `</tbody></table>`
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new window.ClipboardItem({
          'text/html':  new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([tsv],  { type: 'text/plain' }),
        })])
      } else {
        await navigator.clipboard.writeText(tsv)
      }
      setCopied(true); setTimeout(() => setCopied(false), 1800)
    } catch {
      try { await navigator.clipboard.writeText(tsv); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch {}
    }
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
  }, [deals, teamFilter, users])

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
  }, [deals, teamFilter, users])

  if (loading) return <div className="flex items-center justify-center py-24 text-white/30 text-[13px]">Loading…</div>

  const managers         = users.filter(u => headIdSet(users).has(u.id))   // team heads for the filter dropdown
  const maxWeekRevLocal  = maxWeekRev
  const selectedTeamName = teamFilter ? managers.find(m => m.id === teamFilter)?.name : null

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
        <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)}
          style={{ background: '#242424', border: '1px solid #333' }}
          className="h-8 px-2 rounded-lg text-[11px] md:text-[12px] text-white focus:outline-none self-start">
          <option value="">All Teams</option>
          {managers.map(m => <option key={m.id} value={m.id}>{m.name}'s Team</option>)}
        </select>
      </div>

      {/* ── Record moments — a company record is falling (or just fell) ── */}
      {recordMoments.map(m => (
        <div key={m.id} className="flex items-center gap-3 rounded-xl px-4 py-3"
          style={{ background: 'linear-gradient(90deg, rgba(251,191,36,0.12), rgba(251,191,36,0.03))', border: '1px solid rgba(251,191,36,0.45)' }}>
          <p className="text-[13px] text-white/85 min-w-0">{m.text}</p>
          <button onClick={() => dismissRec(m.id)} title="Dismiss"
            className="ml-auto p-1 rounded text-white/40 hover:text-white flex-shrink-0"><X size={14} /></button>
        </div>
      ))}

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
              {selectedTeamName && ` — ${selectedTeamName}`}
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
                {canEditGoal ? (
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

        {/* ── Weekly Goal (always the current week, Sun–Sat) ── */}
        <div className="mt-4 pt-4" style={{ borderTop: '1px solid #2e2e2e' }}>
          <div className="flex items-start justify-between mb-2">
            <div>
              <h4 className="text-[12px] md:text-[13px] font-semibold text-white">
                This Week ({weeklyGoal.label})
                {selectedTeamName && ` — ${selectedTeamName}`}
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
      </div>

      {/* ── Rep Leaderboard + Team Breakdown — stack on mobile ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5">

        {/* Rep Leaderboard */}
        <div className="rounded-xl p-4 md:p-5" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-baseline gap-3 min-w-0">
              <h3 className="text-[13px] md:text-[14px] font-semibold text-white">Rep Leaderboard</h3>
              <p className="text-[11px] text-white/30 hidden sm:block">Tap a column to rank by it</p>
            </div>
            {isAdmin && (
              <button onClick={copyLeaderboard}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold flex-shrink-0 transition-colors"
                style={{ background: copied ? '#00b89420' : '#1a1a1a', border: `1px solid ${copied ? '#00b89455' : '#2e2e2e'}`, color: copied ? '#00b894' : 'rgba(255,255,255,0.6)' }}
                title="Copy the leaderboard as a table (paste into Canva, Sheets, etc.)">
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Export'}
              </button>
            )}
          </div>
          {/* Scrolls both ways: vertically through the rankings, and
              horizontally on a phone to reach Closed Rev / Self Gen. */}
          <div className="max-h-[460px] overflow-y-auto overflow-x-auto">
          <table className="w-full min-w-[540px]">
            <thead className="sticky top-0 z-10" style={{ background: '#242424' }}>
              <tr className="text-[9px] md:text-[10px] font-bold text-white/30 uppercase tracking-wider">
                <th className="text-left pb-2 w-6">#</th>
                <th className="text-left pb-2">Rep</th>
                <SortTh label="Deals" align="center" className="hidden sm:table-cell" title="Deals they set (generated)"
                  active={repSort.key === 'deals'} dir={repSort.dir} onClick={() => toggleRepSort('deals')} />
                <SortTh label="Closed" align="center" title="Total deals they closed — self-gens plus other reps' leads"
                  active={repSort.key === 'closed'} dir={repSort.dir} onClick={() => toggleRepSort('closed')} />
                <SortTh label="Revenue" align="right" title="Baseline revenue of deals they set"
                  active={repSort.key === 'revenue'} dir={repSort.dir} onClick={() => toggleRepSort('revenue')} />
                <SortTh label="Closed Rev" align="right" title="Baseline revenue of every deal they closed"
                  active={repSort.key === 'closedRevenue'} dir={repSort.dir} onClick={() => toggleRepSort('closedRevenue')} />
                <SortTh label="Self Gen" align="center" title="Deals they both set and closed themselves"
                  active={repSort.key === 'selfGens'} dir={repSort.dir} onClick={() => toggleRepSort('selfGens')} />
                <SortTh label="Leads" align="center" className="hidden md:table-cell" title="Deals they closed for another setter"
                  active={repSort.key === 'leads'} dir={repSort.dir} onClick={() => toggleRepSort('leads')} />
                <SortTh label="Lead Rev" align="right" className="hidden md:table-cell" title="Revenue from deals closed for other setters"
                  active={repSort.key === 'leadRevenue'} dir={repSort.dir} onClick={() => toggleRepSort('leadRevenue')} />
                <SortTh label="Comm" align="right"
                  active={repSort.key === 'commission'} dir={repSort.dir} onClick={() => toggleRepSort('commission')} />
              </tr>
            </thead>
            <tbody>
              {rankedReps.map((rep, i) => {
                return (
                  <tr key={rep.id} className="border-t border-white/[0.04]">
                    <td className="py-2"><RankBadge n={i + 1} /></td>
                    <td className="py-2 text-[12px] font-medium text-white/80 truncate max-w-[100px]">{rep.name}</td>
                    <td className="py-2 text-[12px] text-white/60 text-center hidden sm:table-cell">{rep.deals}</td>
                    <td className="py-2 text-[12px] text-center">
                      {rep.closed > 0 ? <span className="text-white/80 font-semibold">{rep.closed}</span> : <span className="text-white/20">—</span>}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <p className="text-[12px] font-bold text-teal">{fmt(rep.revenue)}</p>
                      <p className="text-[10px] text-white/30 hidden sm:block">{rep.pct.toFixed(1)}%</p>
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {rep.closedRevenue > 0
                        ? <span className="text-[12px] font-semibold text-white/70">{fmt(rep.closedRevenue)}</span>
                        : <span className="text-[12px] text-white/20">—</span>}
                    </td>
                    <td className="py-2 text-[12px] text-center">
                      {rep.selfGens > 0 ? <span className="text-white/60">{rep.selfGens}</span> : <span className="text-white/20">—</span>}
                    </td>
                    <td className="py-2 text-[12px] text-center hidden md:table-cell">
                      {rep.leads > 0 ? <span className="text-white/60">{rep.leads}</span> : <span className="text-white/20">—</span>}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap hidden md:table-cell">
                      {rep.leadRevenue > 0
                        ? <span className="text-[12px] text-white/70">{fmt(rep.leadRevenue)}</span>
                        : <span className="text-[12px] text-white/20">—</span>}
                    </td>
                    <td className="py-2 text-[12px] font-semibold text-emerald-400 text-right whitespace-nowrap">{fmt(rep.commission)}</td>
                  </tr>
                )
              })}
              {rankedReps.length === 0 && (
                <tr><td colSpan={10} className="py-8 text-center text-white/30 text-[13px]">No data for this period</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>

        {/* Team Breakdown */}
        <div className="rounded-xl p-4 md:p-5" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
          <div className="flex items-baseline gap-3 mb-4">
            <h3 className="text-[13px] md:text-[14px] font-semibold text-white">Team Breakdown</h3>
            <p className="text-[11px] text-white/30 hidden sm:block">Tap a team to see reps</p>
          </div>
          <div className="space-y-4">
            {teamData.map((team, i) => {
              const hasPrev  = prevPeriod && team.prevRev > 0
              const trendPct = hasPrev ? ((team.revenue - team.prevRev) / team.prevRev) * 100 : null
              const isOpen   = openTeams.has(team.id)
              const reps     = team.reps.filter(r => isAdmin || !r.ghost)
              return (
                <div key={team.id}>
                  <button onClick={onClickUnlessSelecting(() => toggleTeam(team.id))} className="w-full text-left">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <RankBadge n={i + 1} />
                      <ChevronDown size={13} className={`text-white/30 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      <div className="min-w-0">
                        <span className="text-[12px] md:text-[13px] font-semibold text-white">{(isAdmin || !team.ghost) ? `${team.name}'s Team` : 'Team'}</span>
                        <span className="text-[10px] text-white/30 ml-2 hidden sm:inline">{team.repCount} reps · {team.deals} deals</span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-3">
                      <div>
                        <span className="text-[12px] md:text-[13px] font-bold text-teal">{fmt(team.revenue)}</span>
                        <span className="text-[10px] text-white/30 ml-1">{team.pct.toFixed(1)}%</span>
                      </div>
                      {trendPct !== null && (
                        <div className={`flex items-center justify-end gap-0.5 text-[10px] font-semibold ${trendPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {trendPct >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                          {Math.abs(trendPct).toFixed(1)}%
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden ml-8" style={{ background: '#1a1a1a' }}>
                    <div className="h-full rounded-full bg-teal" style={{ width: `${team.pct}%` }} />
                  </div>
                  </button>
                  {isOpen && (
                    <div className="ml-8 mt-2 rounded-lg overflow-hidden" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
                      {reps.length === 0 ? (
                        <p className="px-3 py-2 text-[11px] text-white/30">No reps on this team.</p>
                      ) : reps.map(r => (
                        <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-[12px] border-b border-white/5 last:border-0">
                          <span className="flex-1 min-w-0 truncate text-white/75">
                            {r.name}{r.isManager && <span className="text-[9px] uppercase tracking-wide text-amber-400/80 ml-1.5">mgr</span>}
                          </span>
                          <span className="text-white/40 whitespace-nowrap w-12 text-right">{r.deals} {r.deals === 1 ? 'deal' : 'deals'}</span>
                          <span className="font-semibold text-teal whitespace-nowrap w-24 text-right">{fmt(r.revenue)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            {teamData.length === 0 && <p className="text-[13px] text-white/30 text-center py-8">No data</p>}
          </div>
        </div>
      </div>

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
