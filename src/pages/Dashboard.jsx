import { useState, useEffect, useMemo, useRef } from 'react'
import {
  format, subMonths, startOfMonth, startOfWeek, endOfWeek, addDays,
} from 'date-fns'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Check, X, TrendingUp, TrendingDown, Minus, ChevronUp, ChevronDown, ChevronsUpDown, Copy } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchDeals, fetchUsers, fetchGoal, saveGoal as saveGoalDb, deleteGoal as deleteGoalDb } from '../lib/db'
import { fmt, dealAmounts, activeDeals } from '../utils/commission'
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

function StatCard({ label, value, sub, trend }) {
  return (
    <div className="rounded-xl p-3 md:p-4 min-w-0 flex-1" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
      <p className="text-[9px] md:text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1.5 leading-tight">{label}</p>
      <p className="text-[16px] md:text-[20px] font-bold text-teal leading-none mb-1.5 truncate">{value}</p>
      {trend}
      {sub && <p className="hidden md:block text-[10px] text-white/25 mt-1">{sub}</p>}
    </div>
  )
}

export default function Dashboard() {
  const { profile, isAdmin } = useAuth()
  const canEditGoal = ['admin', 'vp', 'director'].includes(profile?.role)

  const [deals,        setDeals]        = useState([])
  const [users,        setUsers]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [dateFrom,     setDateFrom]     = useState(getPresetRange('mtd').from)
  const [dateTo,       setDateTo]       = useState(getPresetRange('mtd').to)
  const [activePreset, setActivePreset] = useState('mtd')
  const [teamFilter,   setTeamFilter]   = useState('')
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

  const goalDate  = useMemo(() => dateFrom ? new Date(dateFrom + 'T12:00:00') : new Date(), [dateFrom])
  const goalYear  = goalDate.getFullYear()
  const goalMonth = goalDate.getMonth() + 1

  const loadData = () =>
    Promise.all([fetchDeals(), fetchUsers()]).then(([{ data: d }, { data: u }]) => {
      setDeals(activeDeals(d ?? []))   // canceled jobs never count toward stats
      setUsers(u ?? [])
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

  function applyScopeFilters(rows) {
    if (!teamFilter) return rows
    // A manager's team = their reps + the manager's own sales.
    const repIds = new Set([...users.filter(u => u.manager_id === teamFilter).map(u => u.id), teamFilter])
    return rows.filter(d => repIds.has(d.setter_id))
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
      commission += a.totalCommission
    }
    const totalPrice = rows.reduce((s, d) => s + (parseFloat(d.job_price) || 0), 0)
    const count      = rows.length
    return { totalPrice, baseline, commission, avgCommPct: baseline > 0 ? (commission / baseline) * 100 : 0, deals: count, avgDeal: count ? baseline / count : 0 }
  }
  const totals     = useMemo(() => computeTotals(filtered),     [filtered])
  const prevTotals = useMemo(() => computeTotals(prevFiltered), [prevFiltered])

  const companyTotalRev = useMemo(() => {
    let r = deals
    if (dateFrom) r = r.filter(d => d.sale_date >= dateFrom)
    if (dateTo)   r = r.filter(d => d.sale_date <= dateTo)
    return r.reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0) || 1
  }, [deals, dateFrom, dateTo])

  const monthlyGoal = useMemo(() => {
    const curKey = `${String(goalYear).padStart(4,'0')}-${String(goalMonth).padStart(2,'0')}`
    function monthTotal(mk) {
      let rows = deals.filter(d => d.sale_date?.startsWith(mk))
      if (teamFilter) {
        const repIds = new Set([...users.filter(u => u.manager_id === teamFilter).map(u => u.id), teamFilter])
        rows = rows.filter(d => repIds.has(d.setter_id))
      }
      return rows.reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0)
    }
    const curRevenue = monthTotal(curKey)
    const trailing   = [1,2,3].map(i => monthTotal(format(subMonths(goalDate, i), 'yyyy-MM')))
    const autoGoal   = Math.max((trailing.reduce((s,v) => s+v,0)/3)*1.1, 10000)
    const goal       = savedGoal != null ? savedGoal : autoGoal
    const pct        = Math.min((curRevenue/goal)*100, 100)
    return { curRevenue, goal, pct, isCustom: savedGoal != null, month: format(goalDate, 'MMMM yyyy') }
  }, [deals, users, teamFilter, savedGoal, goalYear, goalMonth, goalDate])

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
    const mgrs = teamFilter ? users.filter(u => u.id === teamFilter) : users.filter(u => u.role === 'manager')
    return mgrs.map(mgr => {
      const members = [mgr, ...users.filter(u => u.manager_id === mgr.id)]
      const repIds  = new Set(members.map(m => m.id))   // include the manager's own sales
      const mDeals  = filtered.filter(d => repIds.has(d.setter_id))
      const revenue = mDeals.reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0)
      const prevRev = prevFiltered.filter(d => repIds.has(d.setter_id)).reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0)
      // Per-member breakdown (setter-based, so the rows sum to the team total).
      const reps = members.map(m => {
        const md = filtered.filter(d => d.setter_id === m.id)
        return {
          id: m.id, name: m.name, ghost: m.ghost === true, isManager: m.id === mgr.id,
          deals: md.length,
          revenue: md.reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0),
        }
      }).sort((a, b) => b.revenue - a.revenue)
      return { id: mgr.id, name: mgr.name, repCount: members.length - 1, deals: mDeals.length, revenue, prevRev, reps, pct: (revenue / companyTotalRev) * 100 }
    }).sort((a, b) => b.revenue - a.revenue)
  }, [users, filtered, prevFiltered, companyTotalRev, teamFilter])

  const repData = useMemo(() => {
    const map = {}
    const ensure = (id) => {
      if (!map[id]) {
        const u   = users.find(u => u.id === id)
        const mgr = u ? users.find(m => m.id === u.manager_id) : null
        map[id]   = { id, name: u?.name ?? '—', team: mgr?.name ?? '—',
          deals: 0, revenue: 0, leads: 0, leadRevenue: 0, commission: 0 }
      }
      return map[id]
    }
    for (const deal of filtered) {
      const sid = deal.setter_id
      const cid = deal.closer_id
      const bl  = parseFloat(deal.baseline_revenue) || 0
      const a   = dealAmounts(deal)
      // Deals + revenue credit the SETTER — the rep who generated the deal.
      // (Solo deals: setter is also the closer, still credited here.)
      if (sid) {
        const s = ensure(sid)
        s.deals      += 1
        s.revenue    += bl
        s.commission += a.setter
      }
      // Leads + lead revenue credit the CLOSER when they aren't the setter —
      // they closed someone else's lead, and earn their closer share.
      if (cid && cid !== sid) {
        const c = ensure(cid)
        c.leads       += 1
        c.leadRevenue += bl
        c.commission  += a.closer
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
    const cols = ['#', 'Rep', 'Deals', 'Revenue', 'Leads', 'Lead Rev', 'Comm']
    const rows = rankedReps.map((r, i) => [i + 1, r.name, r.deals, fmt(r.revenue), r.leads, fmt(r.leadRevenue), fmt(r.commission)])
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

  const weeklyData = useMemo(() => {
    const now    = new Date()
    const toDate = dateTo ? new Date(dateTo + 'T23:59:59') : now
    let fromDate = dateFrom ? new Date(dateFrom + 'T00:00:00') : new Date(startOfMonth(now))
    const maxFrom = addDays(toDate, -(8*7-1))
    if (fromDate < maxFrom) fromDate = maxFrom
    const weeks = []
    let ptr = startOfWeek(fromDate, { weekStartsOn: 1 })
    while (ptr <= toDate) {
      const wEnd  = endOfWeek(ptr, { weekStartsOn: 1 })
      const wFrom = format(ptr  < fromDate ? fromDate : ptr,  'yyyy-MM-dd')
      const wTo   = format(wEnd > toDate   ? toDate   : wEnd, 'yyyy-MM-dd')
      const wDls  = filtered.filter(d => d.sale_date >= wFrom && d.sale_date <= wTo)
      weeks.push({ label: format(new Date(wFrom + 'T12:00:00'), 'MMM d'), deals: wDls.length, revenue: wDls.reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0) })
      ptr = addDays(ptr, 7)
    }
    return weeks
  }, [filtered, dateFrom, dateTo])

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

  const managers         = users.filter(u => u.role === 'manager')
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

      {/* ── KPI cards — 2-col on mobile, row on md+ ── */}
      <div className="grid grid-cols-2 gap-2 md:flex md:gap-3">
        <StatCard label="Baseline Revenue" value={fmt(totals.baseline)} sub="Company's cost basis"
          trend={<Trend cur={totals.baseline} prev={prevPeriod ? prevTotals.baseline : null} />} />
        <StatCard label="Commissions" value={fmt(totals.commission)} sub="Total price − baseline"
          trend={<Trend cur={totals.commission} prev={prevPeriod ? prevTotals.commission : null} />} />
        <StatCard label="Avg Comm %" value={`${totals.avgCommPct.toFixed(1)}%`}
          trend={<Trend cur={totals.avgCommPct} prev={prevPeriod ? prevTotals.avgCommPct : null} />} />
        <StatCard label="Total Deals" value={totals.deals.toString()}
          trend={<Trend cur={totals.deals} prev={prevPeriod ? prevTotals.deals : null} />} />
        <div className="col-span-2 md:flex-1">
          <StatCard label="Avg Deal Size" value={fmt(totals.avgDeal)}
            trend={<Trend cur={totals.avgDeal} prev={prevPeriod ? prevTotals.avgDeal : null} />} />
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
          <div className="max-h-[460px] overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 z-10" style={{ background: '#242424' }}>
              <tr className="text-[9px] md:text-[10px] font-bold text-white/30 uppercase tracking-wider">
                <th className="text-left pb-2 w-6">#</th>
                <th className="text-left pb-2">Rep</th>
                <SortTh label="Deals" align="center" className="hidden sm:table-cell" title="Deals they set (generated)"
                  active={repSort.key === 'deals'} dir={repSort.dir} onClick={() => toggleRepSort('deals')} />
                <SortTh label="Revenue" align="right" title="Baseline revenue of deals they set"
                  active={repSort.key === 'revenue'} dir={repSort.dir} onClick={() => toggleRepSort('revenue')} />
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
                    <td className="py-2 text-right whitespace-nowrap">
                      <p className="text-[12px] font-bold text-teal">{fmt(rep.revenue)}</p>
                      <p className="text-[10px] text-white/30 hidden sm:block">{rep.pct.toFixed(1)}%</p>
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
                <tr><td colSpan={7} className="py-8 text-center text-white/30 text-[13px]">No data for this period</td></tr>
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
                  <button onClick={() => toggleTeam(team.id)} className="w-full text-left">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <RankBadge n={i + 1} />
                      <ChevronDown size={13} className={`text-white/30 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      <div className="min-w-0">
                        <span className="text-[12px] md:text-[13px] font-semibold text-white">{team.name}'s Team</span>
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
            <p className="text-[11px] text-white/30 mt-0.5">Mon–Sun weeks</p>
          </div>
          <div className="space-y-2">
            {weeklyData.map((w, i) => (
              <div key={i} className="rounded-lg px-3 py-2.5 flex items-center gap-3"
                style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
                <div className="w-14 md:w-20 flex-shrink-0">
                  <p className="text-[9px] font-semibold text-white/40 uppercase tracking-wider">Week</p>
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
