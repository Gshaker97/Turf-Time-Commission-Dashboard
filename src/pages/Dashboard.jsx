import { useState, useEffect, useMemo, useRef } from 'react'
import {
  format, subMonths, subYears, startOfMonth, endOfMonth,
  startOfYear, startOfWeek, endOfWeek, addDays,
} from 'date-fns'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts'
import { Check, X, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchDeals, fetchUsers } from '../lib/db'
import { supabase } from '../lib/supabase'
import { fmt } from '../utils/commission'

const MEDAL = {
  1: { bg: '#fbbf2420', color: '#fbbf24' },
  2: { bg: '#94a3b820', color: '#94a3b8' },
  3: { bg: '#fb923c20', color: '#fb923c' },
}
function RankBadge({ n }) {
  const s = MEDAL[n] ?? { bg: 'transparent', color: '#ffffff30' }
  return (
    <span
      className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
      style={{ background: s.bg, color: s.color }}
    >
      {n}
    </span>
  )
}

function buildPresets() {
  const now = new Date()
  const lm  = subMonths(now, 1)
  return [
    { label: 'MTD',        from: format(startOfMonth(now), 'yyyy-MM-dd'), to: '' },
    { label: 'Last Month', from: format(startOfMonth(lm),  'yyyy-MM-dd'), to: format(endOfMonth(lm), 'yyyy-MM-dd') },
    { label: 'YTD',        from: format(startOfYear(now),  'yyyy-MM-dd'), to: '' },
    { label: 'All Time',   from: '', to: '' },
  ]
}

function Trend({ cur, prev, suffix = 'vs prev' }) {
  if (prev === null || prev === undefined) return null
  if (prev === 0 && cur === 0) return null
  const pct = prev > 0 ? ((cur - prev) / prev) * 100 : (cur > 0 ? 100 : 0)
  if (Math.abs(pct) < 0.1 && prev > 0) {
    return (
      <div className="flex items-center gap-1 text-[10px] text-white/25">
        <Minus size={10} /> unchanged
      </div>
    )
  }
  const up = pct >= 0
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <div className={`flex items-center gap-1 text-[10px] font-semibold ${up ? 'text-emerald-400' : 'text-red-400'}`}>
      <Icon size={10} />
      <span>{Math.abs(pct).toFixed(1)}%</span>
      <span className="text-white/25 font-normal">{suffix}</span>
    </div>
  )
}

function StatCard({ label, value, sub, trend }) {
  return (
    <div className="flex-1 rounded-xl p-4 min-w-0" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
      <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1.5">{label}</p>
      <p className="text-[20px] font-bold text-teal leading-none mb-1.5 truncate">{value}</p>
      {trend}
      {sub && <p className="text-[10px] text-white/25 mt-1">{sub}</p>}
    </div>
  )
}

export default function Dashboard() {
  const { profile } = useAuth()
  const canEditGoal = ['admin', 'vp', 'director'].includes(profile?.role)

  const [deals,        setDeals]        = useState([])
  const [users,        setUsers]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [dateFrom,     setDateFrom]     = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [dateTo,       setDateTo]       = useState('')
  const [activePreset, setActivePreset] = useState('MTD')
  const [teamFilter,   setTeamFilter]   = useState('')
  const [editingGoal,  setEditingGoal]  = useState(false)
  const [goalInput,    setGoalInput]    = useState('')
  const [savedGoal,    setSavedGoal]    = useState(null)
  const [saveStatus,   setSaveStatus]   = useState('idle')
  const [saveError,    setSaveError]    = useState(null)
  const skipBlurSaveRef = useRef(false)

  useEffect(() => {
    const now   = new Date()
    const year  = now.getFullYear()
    const month = now.getMonth() + 1
    Promise.all([
      fetchDeals(),
      fetchUsers(),
      supabase.from('monthly_goals')
        .select('baseline_target')
        .eq('year', year).eq('month', month)
        .maybeSingle(),
    ]).then(([{ data: d }, { data: u }, { data: g }]) => {
      setDeals(d ?? [])
      setUsers(u ?? [])
      setSavedGoal(g?.baseline_target != null ? parseFloat(g.baseline_target) : null)
      setLoading(false)
    })
  }, [])

  function applyPreset(p) {
    setDateFrom(p.from); setDateTo(p.to); setActivePreset(p.label)
  }

  // Previous period (preset-aware): MTD → same days last month, etc.
  const prevPeriod = useMemo(() => {
    if (!dateFrom) return null
    const now      = new Date()
    const toDate   = dateTo   ? new Date(dateTo   + 'T12:00:00') : now
    const fromDate = new Date(dateFrom + 'T12:00:00')

    if (activePreset === 'MTD') {
      const prevMonth = subMonths(toDate, 1)
      const dayN      = toDate.getDate()
      const maxDay    = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0).getDate()
      const prevTo    = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), Math.min(dayN, maxDay))
      return { from: format(startOfMonth(prevMonth), 'yyyy-MM-dd'), to: format(prevTo, 'yyyy-MM-dd') }
    }
    if (activePreset === 'Last Month') {
      const twoBack = subMonths(fromDate, 1)
      return { from: format(startOfMonth(twoBack), 'yyyy-MM-dd'), to: format(endOfMonth(twoBack), 'yyyy-MM-dd') }
    }
    if (activePreset === 'YTD') {
      const ly = subYears(toDate, 1)
      return { from: format(startOfYear(ly), 'yyyy-MM-dd'), to: format(ly, 'yyyy-MM-dd') }
    }
    const durMs  = toDate.getTime() - fromDate.getTime()
    const prevTo = new Date(fromDate.getTime() - 86400000)
    return {
      from: format(new Date(prevTo.getTime() - durMs), 'yyyy-MM-dd'),
      to:   format(prevTo, 'yyyy-MM-dd'),
    }
  }, [dateFrom, dateTo, activePreset])

  // Filter helpers
  function applyScopeFilters(rows) {
    let r = rows
    if (teamFilter) {
      const repIds = new Set(users.filter(u => u.manager_id === teamFilter).map(u => u.id))
      r = r.filter(d => repIds.has(d.setter_id))
    }
    return r
  }

  const filtered = useMemo(() => {
    let r = applyScopeFilters(deals)
    if (dateFrom) r = r.filter(d => d.sale_date >= dateFrom)
    if (dateTo)   r = r.filter(d => d.sale_date <= dateTo)
    return r
  }, [deals, profile, teamFilter, users, dateFrom, dateTo])

  const prevFiltered = useMemo(() => {
    if (!prevPeriod) return []
    const r = applyScopeFilters(deals)
    return r.filter(d => d.sale_date >= prevPeriod.from && d.sale_date <= prevPeriod.to)
  }, [deals, profile, teamFilter, users, prevPeriod])

  function computeTotals(rows) {
    const totalPrice = rows.reduce((s, d) => s + (parseFloat(d.job_price)        || 0), 0)
    const baseline   = rows.reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0)
    const commission = totalPrice - baseline
    const count      = rows.length
    return {
      totalPrice, baseline, commission,
      avgCommPct: baseline > 0 ? (commission / baseline) * 100 : 0,
      deals:      count,
      avgDeal:    count ? baseline / count : 0,
    }
  }
  const totals     = useMemo(() => computeTotals(filtered),     [filtered])
  const prevTotals = useMemo(() => computeTotals(prevFiltered), [prevFiltered])

  // Company-wide revenue for selected dates (ignores team filter) — used as % denominator
  const companyTotalRev = useMemo(() => {
    let r = deals
    if (dateFrom) r = r.filter(d => d.sale_date >= dateFrom)
    if (dateTo)   r = r.filter(d => d.sale_date <= dateTo)
    return r.reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0) || 1
  }, [deals, dateFrom, dateTo])

  // Monthly goal — always current calendar month, respects team filter
  const monthlyGoal = useMemo(() => {
    const now = new Date()
    const curKey = format(now, 'yyyy-MM')
    function monthTotal(mk) {
      let rows = deals.filter(d => d.sale_date?.startsWith(mk))
      if (teamFilter) {
        const repIds = new Set(users.filter(u => u.manager_id === teamFilter).map(u => u.id))
        rows = rows.filter(d => repIds.has(d.setter_id))
      }
      return rows.reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0)
    }
    const curRevenue = monthTotal(curKey)
    const trailing   = [1, 2, 3].map(i => monthTotal(format(subMonths(now, i), 'yyyy-MM')))
    const autoGoal   = Math.max((trailing.reduce((s, v) => s + v, 0) / 3) * 1.1, 10000)
    const goal       = savedGoal != null ? savedGoal : autoGoal
    const pct        = Math.min((curRevenue / goal) * 100, 100)
    return { curRevenue, goal, pct, isCustom: savedGoal != null, month: format(now, 'MMMM yyyy') }
  }, [deals, users, teamFilter, savedGoal])

  function startEditGoal() {
    setGoalInput(monthlyGoal.goal.toFixed(0))
    setSaveStatus('idle')
    setSaveError(null)
    setEditingGoal(true)
  }
  function cancelGoalEdit() {
    skipBlurSaveRef.current = true
    setEditingGoal(false)
  }
  function handleGoalBlur() {
    if (skipBlurSaveRef.current) {
      skipBlurSaveRef.current = false
      return
    }
    saveGoal()
  }
  async function saveGoal() {
    const v = parseFloat(goalInput)
    if (!(v > 0)) {
      setEditingGoal(false)
      return
    }
    const now   = new Date()
    const year  = now.getFullYear()
    const month = now.getMonth() + 1
    setEditingGoal(false)
    const { error } = await supabase.from('monthly_goals').upsert(
      { year, month, baseline_target: v },
      { onConflict: 'year,month' },
    )
    if (error) {
      setSaveError(error.message)
      setSaveStatus('error')
      return
    }
    setSavedGoal(v)
    setSaveError(null)
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus('idle'), 2000)
  }
  async function resetGoal() {
    skipBlurSaveRef.current = true
    const now   = new Date()
    const year  = now.getFullYear()
    const month = now.getMonth() + 1
    setEditingGoal(false)
    const { error } = await supabase.from('monthly_goals')
      .delete().eq('year', year).eq('month', month)
    if (error) {
      setSaveError(error.message)
      setSaveStatus('error')
      return
    }
    setSavedGoal(null)
    setSaveError(null)
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus('idle'), 2000)
  }

  // Team breakdown — setter gets revenue credit
  const teamData = useMemo(() => {
    const totalRev = companyTotalRev
    const mgrs = teamFilter
      ? users.filter(u => u.id === teamFilter)
      : users.filter(u => u.role === 'manager')
    return mgrs.map(mgr => {
      const repIds     = new Set(users.filter(u => u.manager_id === mgr.id).map(u => u.id))
      const mDeals     = filtered.filter(d => repIds.has(d.setter_id))
      const revenue    = mDeals.reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0)
      const prevRev    = prevFiltered.filter(d => repIds.has(d.setter_id))
        .reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0)
      return {
        id: mgr.id, name: mgr.name, repCount: repIds.size, deals: mDeals.length,
        revenue, prevRev, pct: (revenue / totalRev) * 100,
      }
    }).sort((a, b) => b.revenue - a.revenue)
  }, [users, filtered, prevFiltered, totals.totalPrice, teamFilter])

  // Rep leaderboard — setter gets revenue credit
  const repData = useMemo(() => {
    const totalRev = companyTotalRev
    const map = {}
    for (const deal of filtered) {
      const sid = deal.setter_id; if (!sid) continue
      if (!map[sid]) {
        const u   = users.find(u => u.id === sid)
        const mgr = u ? users.find(m => m.id === u.manager_id) : null
        map[sid]  = { id: sid, name: u?.name ?? '—', team: mgr?.name ?? '—', deals: 0, revenue: 0, commission: 0, prevRev: 0 }
      }
      const price    = parseFloat(deal.job_price)        || 0
      const baseline = parseFloat(deal.baseline_revenue) || 0
      map[sid].revenue    += baseline
      map[sid].commission += (price - baseline)
      map[sid].deals      += 1
    }
    for (const deal of prevFiltered) {
      const sid = deal.setter_id
      if (sid && map[sid]) map[sid].prevRev += parseFloat(deal.baseline_revenue) || 0
    }
    return Object.values(map)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
      .map(r => ({ ...r, pct: (r.revenue / totalRev) * 100 }))
  }, [filtered, prevFiltered, users, totals.totalPrice])

  // Weekly breakdown — last 8 weeks of the filtered period
  const weeklyData = useMemo(() => {
    const now    = new Date()
    const toDate = dateTo ? new Date(dateTo + 'T23:59:59') : now
    let fromDate = dateFrom ? new Date(dateFrom + 'T00:00:00') : new Date(startOfMonth(now))
    const maxFrom = addDays(toDate, -(8 * 7 - 1))
    if (fromDate < maxFrom) fromDate = maxFrom

    const weeks = []
    let ptr = startOfWeek(fromDate, { weekStartsOn: 1 })
    while (ptr <= toDate) {
      const wEnd  = endOfWeek(ptr, { weekStartsOn: 1 })
      const wFrom = format(ptr  < fromDate ? fromDate : ptr,  'yyyy-MM-dd')
      const wTo   = format(wEnd > toDate   ? toDate   : wEnd, 'yyyy-MM-dd')
      const wDls  = filtered.filter(d => d.sale_date >= wFrom && d.sale_date <= wTo)
      weeks.push({
        label:   format(new Date(wFrom + 'T12:00:00'), 'MMM d'),
        deals:   wDls.length,
        revenue: wDls.reduce((s, d) => s + (parseFloat(d.baseline_revenue) || 0), 0),
      })
      ptr = addDays(ptr, 7)
    }
    return weeks
  }, [filtered, dateFrom, dateTo])

  // Max weekly revenue for per-row bars
  const maxWeekRev = useMemo(
    () => weeklyData.reduce((m, w) => Math.max(m, w.revenue), 0) || 1,
    [weeklyData],
  )

  // Annual monthly data — last 12 months, respects team + rep scope (not date filter)
  const annualData = useMemo(() => {
    const now = new Date()
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = subMonths(now, 11 - i)
      return { key: format(d, 'yyyy-MM'), label: format(d, 'MMM'), revenue: 0, deals: 0 }
    })
    const scoped = applyScopeFilters(deals)
    for (const deal of scoped) {
      if (!deal.sale_date) continue
      const slot = months.find(m => m.key === deal.sale_date.slice(0, 7))
      if (slot) {
        slot.revenue += parseFloat(deal.baseline_revenue) || 0
        slot.deals   += 1
      }
    }
    return months
  }, [deals, profile, teamFilter, users])

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-white/30 text-[13px]">Loading…</div>
  )

  const presets   = buildPresets()
  const managers  = users.filter(u => u.role === 'manager')
  const maxRepRev = repData[0]?.revenue || 1
  const selectedTeamName = teamFilter ? managers.find(m => m.id === teamFilter)?.name : null

  return (
    <div className="space-y-5 pb-6">

      {/* ── Filter row ───────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        {presets.map(p => (
          <button key={p.label} onClick={() => applyPreset(p)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
              activePreset === p.label
                ? 'bg-teal/15 text-teal border border-teal/25'
                : 'text-white/40 hover:text-white hover:bg-white/5 border border-transparent'
            }`}
          >{p.label}</button>
        ))}
        <div className="w-px h-5 bg-white/10 mx-1" />
        <input type="date" value={dateFrom}
          onChange={e => { setDateFrom(e.target.value); setActivePreset('') }}
          style={{ background: '#242424', border: '1px solid #333' }}
          className="h-8 px-2.5 rounded-lg text-[12px] text-white focus:outline-none w-[130px]" />
        <span className="text-white/30 text-xs">→</span>
        <input type="date" value={dateTo}
          onChange={e => { setDateTo(e.target.value); setActivePreset('') }}
          style={{ background: '#242424', border: '1px solid #333' }}
          className="h-8 px-2.5 rounded-lg text-[12px] text-white focus:outline-none w-[130px]" />
        <div className="w-px h-5 bg-white/10 mx-1" />
        <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)}
          style={{ background: '#242424', border: '1px solid #333' }}
          className="h-8 px-2.5 rounded-lg text-[12px] text-white focus:outline-none">
          <option value="">All Teams</option>
          {managers.map(m => <option key={m.id} value={m.id}>{m.name}'s Team</option>)}
        </select>
        <span className="text-[12px] text-white/30 ml-1">{filtered.length} deals</span>
      </div>

      {/* ── KPI cards ────────────────────────────────────── */}
      <div className="flex gap-3">
        <StatCard
          label="Baseline Revenue"
          value={fmt(totals.baseline)}
          sub="Company's cost basis"
          trend={<Trend cur={totals.baseline} prev={prevPeriod ? prevTotals.baseline : null} />}
        />
        <StatCard
          label="Commissions Earned"
          value={fmt(totals.commission)}
          sub="Total price − baseline"
          trend={<Trend cur={totals.commission} prev={prevPeriod ? prevTotals.commission : null} />}
        />
        <StatCard
          label="Avg Commission %"
          value={`${totals.avgCommPct.toFixed(1)}%`}
          trend={<Trend cur={totals.avgCommPct} prev={prevPeriod ? prevTotals.avgCommPct : null} />}
        />
        <StatCard
          label="Total Deals"
          value={totals.deals.toString()}
          trend={<Trend cur={totals.deals} prev={prevPeriod ? prevTotals.deals : null} />}
        />
        <StatCard
          label="Avg Deal Size"
          value={fmt(totals.avgDeal)}
          trend={<Trend cur={totals.avgDeal} prev={prevPeriod ? prevTotals.avgDeal : null} />}
        />
      </div>

      {/* ── Monthly Goal ─────────────────────────────────── */}
      <div className="rounded-xl p-5" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-[14px] font-semibold text-white">
              {monthlyGoal.month} Revenue Goal
              {selectedTeamName && ` — ${selectedTeamName}'s Team`}
            </h3>
            <p className="text-[11px] text-white/30 mt-0.5">
              {monthlyGoal.isCustom ? 'Custom goal set by admin' : 'Auto-calculated from 3-month trailing avg ×1.1'}
            </p>
          </div>
          <div className={`text-[32px] font-bold leading-none ${monthlyGoal.pct >= 100 ? 'text-emerald-400' : 'text-teal'}`}>
            {monthlyGoal.pct.toFixed(1)}%
          </div>
        </div>

        <div className="flex items-end gap-8 mb-4 flex-wrap">
          <div>
            <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1">Month-to-Date</p>
            <p className="text-[26px] font-bold text-white">{fmt(monthlyGoal.curRevenue)}</p>
          </div>
          <div className="text-white/20 text-xl mb-1.5">/</div>
          <div>
            <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1">Goal</p>
            {editingGoal ? (
              <div className="flex items-center gap-2">
                <span className="text-white/40 text-lg">$</span>
                <input
                  autoFocus type="number" value={goalInput}
                  onChange={e => setGoalInput(e.target.value)}
                  onBlur={handleGoalBlur}
                  onKeyDown={e => {
                    if (e.key === 'Enter')  saveGoal()
                    if (e.key === 'Escape') cancelGoalEdit()
                  }}
                  style={{ background: '#2a2a2a', border: '1px solid rgba(0,184,148,0.4)' }}
                  className="w-32 rounded-lg px-2 py-1 text-[18px] font-bold text-teal focus:outline-none"
                />
                <button onMouseDown={e => e.preventDefault()} onClick={saveGoal}
                  className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-400/10 transition-colors">
                  <Check size={15} />
                </button>
                <button onMouseDown={e => e.preventDefault()} onClick={cancelGoalEdit}
                  className="p-1.5 rounded-lg text-white/30 hover:bg-white/5 transition-colors">
                  <X size={15} />
                </button>
                {monthlyGoal.isCustom && (
                  <button onMouseDown={e => e.preventDefault()} onClick={resetGoal}
                    className="text-[11px] text-white/30 hover:text-white/60 underline ml-1">
                    reset
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {canEditGoal ? (
                  <button
                    onClick={startEditGoal}
                    className="text-[20px] font-bold text-teal hover:bg-teal/5 rounded px-2 -mx-2 py-0.5 transition-colors cursor-pointer"
                    title="Edit goal"
                  >
                    {fmt(monthlyGoal.goal)}
                  </button>
                ) : (
                  <p className="text-[20px] font-bold text-teal">{fmt(monthlyGoal.goal)}</p>
                )}
                {saveStatus === 'saved' && (
                  <span className="text-[11px] font-semibold text-teal">Saved</span>
                )}
                {saveStatus === 'error' && (
                  <span className="text-[11px] font-semibold text-red-400" title={saveError ?? 'Save error'}>
                    Save failed
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="ml-auto text-right">
            <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1">Remaining</p>
            <p className="text-[18px] font-bold text-white/50">
              {monthlyGoal.pct >= 100 ? 'Goal Hit!' : fmt(Math.max(0, monthlyGoal.goal - monthlyGoal.curRevenue))}
            </p>
          </div>
        </div>

        <div className="h-3 rounded-full overflow-hidden" style={{ background: '#1a1a1a' }}>
          <div
            className={`h-full rounded-full transition-all duration-700 ${monthlyGoal.pct >= 100 ? 'bg-emerald-400' : 'bg-teal'}`}
            style={{ width: `${monthlyGoal.pct}%` }}
          />
        </div>
      </div>

      {/* ── Two-column: Rep Leaderboard + Team Breakdown ── */}
      <div className="grid grid-cols-2 gap-5">

        {/* Rep Leaderboard (replacing chart) */}
        <div className="rounded-xl p-5" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
          <div className="flex items-baseline gap-3 mb-4">
            <h3 className="text-[14px] font-semibold text-white">Rep Leaderboard</h3>
            <p className="text-[11px] text-white/30">Setter gets revenue credit</p>
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-[10px] font-bold text-white/30 uppercase tracking-wider">
                <th className="text-left pb-2 w-6">#</th>
                <th className="text-left pb-2">Rep</th>
                <th className="text-center pb-2">Deals</th>
                <th className="text-right pb-2">Revenue</th>
                <th className="text-right pb-2">Commission</th>
                <th className="text-right pb-2 w-16">Trend</th>
              </tr>
            </thead>
            <tbody>
              {repData.map((rep, i) => {
                const hasPrev  = prevPeriod && rep.prevRev > 0
                const trendPct = hasPrev ? ((rep.revenue - rep.prevRev) / rep.prevRev) * 100 : null
                return (
                  <tr key={rep.id} className="border-t border-white/[0.04]">
                    <td className="py-2"><RankBadge n={i + 1} /></td>
                    <td className="py-2 text-[12px] font-medium text-white/80 truncate max-w-[120px]">{rep.name}</td>
                    <td className="py-2 text-[12px] text-white/60 text-center">{rep.deals}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <p className="text-[12px] font-bold text-teal">{fmt(rep.revenue)}</p>
                      <p className="text-[10px] text-white/30">{rep.pct.toFixed(1)}%</p>
                    </td>
                    <td className="py-2 text-[12px] font-semibold text-emerald-400 text-right whitespace-nowrap">{fmt(rep.commission)}</td>
                    <td className="py-2 text-right">
                      {trendPct !== null ? (
                        <span className={`text-[10px] font-semibold inline-flex items-center gap-0.5 ${trendPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {trendPct >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                          {Math.abs(trendPct).toFixed(0)}%
                        </span>
                      ) : prevPeriod ? (
                        <span className="text-[10px] text-white/20">new</span>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
              {repData.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-white/30 text-[13px]">No data for this period</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Team Breakdown */}
        <div className="rounded-xl p-5" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
          <div className="flex items-baseline gap-3 mb-4">
            <h3 className="text-[14px] font-semibold text-white">Team Breakdown</h3>
            <p className="text-[11px] text-white/30">Setter revenue · % of company total</p>
          </div>
          <div className="space-y-4">
            {teamData.map((team, i) => {
              const hasPrev  = prevPeriod && team.prevRev > 0
              const trendPct = hasPrev ? ((team.revenue - team.prevRev) / team.prevRev) * 100 : null
              return (
                <div key={team.id}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <RankBadge n={i + 1} />
                      <div className="min-w-0">
                        <span className="text-[13px] font-semibold text-white">{team.name}'s Team</span>
                        <span className="text-[11px] text-white/30 ml-2">{team.repCount} reps · {team.deals} deals</span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-3">
                      <div>
                        <span className="text-[13px] font-bold text-teal">{fmt(team.revenue)}</span>
                        <span className="text-[11px] text-white/30 ml-1.5">{team.pct.toFixed(1)}%</span>
                      </div>
                      {trendPct !== null && (
                        <div className={`flex items-center justify-end gap-0.5 text-[10px] font-semibold ${trendPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {trendPct >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                          {Math.abs(trendPct).toFixed(1)}% vs prev
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden ml-6" style={{ background: '#1a1a1a' }}>
                    <div className="h-full rounded-full bg-teal" style={{ width: `${team.pct}%` }} />
                  </div>
                </div>
              )
            })}
            {teamData.length === 0 && (
              <p className="text-[13px] text-white/30 text-center py-8">No data for this period</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Weekly Performance + Annual Chart ────────────── */}
      <div className="grid grid-cols-2 gap-5">

        {/* Weekly Performance — row list */}
        <div className="rounded-xl p-5" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
          <div className="mb-4">
            <h3 className="text-[14px] font-semibold text-white">Weekly Performance</h3>
            <p className="text-[11px] text-white/30 mt-0.5">Mon–Sun weeks for the selected period</p>
          </div>
          <div className="space-y-2">
            {weeklyData.map((w, i) => (
              <div key={i} className="rounded-lg px-3 py-2.5 flex items-center gap-3"
                style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
                <div className="w-20 flex-shrink-0">
                  <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">Week of</p>
                  <p className="text-[13px] font-bold text-white">{w.label}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#2a2a2a' }}>
                    <div className="h-full rounded-full bg-teal transition-all"
                      style={{ width: `${(w.revenue / maxWeekRev) * 100}%` }} />
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[13px] font-bold text-teal whitespace-nowrap">{fmt(w.revenue)}</p>
                  <p className="text-[11px] text-white/40">{w.deals} {w.deals === 1 ? 'deal' : 'deals'}</p>
                </div>
              </div>
            ))}
            {weeklyData.length === 0 && (
              <p className="text-[13px] text-white/30 text-center py-8">No data for this period</p>
            )}
          </div>
        </div>

        {/* Annual Monthly Revenue */}
        <div className="rounded-xl p-5" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
          <div className="mb-4">
            <h3 className="text-[14px] font-semibold text-white">Annual Trend</h3>
            <p className="text-[11px] text-white/30 mt-0.5">Monthly revenue · trailing 12 months</p>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={annualData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="annualGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00b894" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#00b894" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2e2e2e" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#666' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#666' }} axisLine={false} tickLine={false}
                tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
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
