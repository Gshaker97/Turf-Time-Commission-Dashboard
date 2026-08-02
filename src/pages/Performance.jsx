import { useState, useEffect, useMemo } from 'react'
import {
  ComposedChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'
import { ChevronDown, ChevronRight, Plus, Trash2, Target, X, ZoomIn } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import {
  fetchDeals, fetchUsers, fetchTeamChanges, fetchWeeklyStats,
  fetchTargets, saveTarget, deleteTarget, fetchGoal, fetchRepGoals,
} from '../lib/db'
import { dealAmounts, isCanceled } from '../utils/commission'
import { headIdSet, buildChangesByProfile, saleOwnerId, teamOfSale } from '../utils/team'
import {
  GRAINS, METRICS, PERCENT_METRICS, SUB_GRAIN, periodsFor, periodsInRange,
  zoomLabel, bucketize, resolveTarget, fmtMetric, scopeHasEstimates,
  dealInScope, statInScope,
} from '../utils/performance'
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus'
import { toast } from '../lib/toast'

const PALETTE = ['#00b894', '#74b9ff', '#a78bfa', '#fbbf24', '#fb923c', '#f87171', '#34d399', '#60a5fa', '#f472b6', '#facc15']
const CARD = { background: '#242424', border: '1px solid #2e2e2e' }

const estOf = (s) => {
  const split = (Number(s.self_gen_estimates) || 0) + (Number(s.lead_estimates) || 0)
  return split || (Number(s.estimates) || 0)
}

// ── Shared dark tooltip ───────────────────────────────────────
function ChartTip({ active, payload, label, yFmt }) {
  if (!active || !payload?.length) return null
  const fv = (v) => {
    if (v == null) return '—'
    if (yFmt === 'money') return '$' + Math.round(v).toLocaleString()
    if (yFmt === 'percent') return Number(v).toFixed(1) + '%'
    return Math.round(v).toLocaleString()
  }
  return (
    <div style={{ background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: 10, padding: '10px 14px' }}>
      <p style={{ color: '#00b894', fontWeight: 600, fontSize: 12, marginBottom: 4 }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: '#fff', fontSize: 12 }}>
          <span style={{ color: p.color || '#999' }}>{p.name}: </span>
          {p.unit === '%' ? (p.value == null ? '—' : Number(p.value).toFixed(1) + '%') : fv(p.value)}
        </p>
      ))}
    </div>
  )
}

// ── Generic time-series chart: one metric, optional multi-series ─
function MetricChart({ rows, series, type, yFmt, goal, height = 220, onPointClick }) {
  const yTick = (v) => yFmt === 'money' ? `$${(v / 1000).toFixed(0)}k` : yFmt === 'percent' ? `${v}%` : v
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        onClick={onPointClick ? (s) => { if (s?.activeLabel != null) onPointClick(s.activeLabel) } : undefined}
        style={onPointClick ? { cursor: 'pointer' } : undefined}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={`perfGrad${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#2e2e2e" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#666' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#666' }} axisLine={false} tickLine={false} tickFormatter={yTick} width={40} />
        <Tooltip content={<ChartTip yFmt={yFmt} />} cursor={{ fill: '#ffffff08' }} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {goal != null && (
          <ReferenceLine y={goal} stroke="#fbbf24" strokeDasharray="5 4" strokeWidth={1.5}
            label={{ value: 'Goal', position: 'insideTopRight', fill: '#fbbf24', fontSize: 10 }} />
        )}
        {series.map((s, i) => {
          if (type === 'line')
            return <Line key={s.key} type="monotone" dataKey={s.key} name={s.name ?? s.key} stroke={s.color}
              strokeWidth={2} dot={{ fill: s.color, r: 3 }} activeDot={{ r: 5 }} connectNulls />
          if (type === 'area')
            return <Area key={s.key} type="monotone" dataKey={s.key} name={s.name ?? s.key} stroke={s.color}
              strokeWidth={2} fill={`url(#perfGrad${i})`} dot={{ fill: s.color, r: 3 }} connectNulls />
          return <Bar key={s.key} dataKey={s.key} name={s.name ?? s.key} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={38} />
        })}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// Tiny period-over-period readout: relative % for $/counts, percentage-point
// delta for rates. Green = improving (lower is better for cancel rate).
function DeltaTag({ metric, v, pv }) {
  if (v == null || pv == null) return null
  const lower = metric === 'cancel_rate'
  let text, good
  if (PERCENT_METRICS.has(metric)) {
    const d = v - pv
    if (Math.abs(d) < 0.05) return <span className="text-[10px] text-white/20">— even</span>
    good = lower ? d < 0 : d > 0
    text = `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}pt`
  } else {
    if (pv === 0) return null
    const pct = ((v - pv) / pv) * 100
    if (Math.abs(pct) < 0.05) return <span className="text-[10px] text-white/20">— even</span>
    good = lower ? pct < 0 : pct > 0
    text = `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(Math.abs(pct) >= 100 ? 0 : 1)}%`
  }
  return <span className={`text-[10px] font-semibold ${good ? 'text-emerald-400' : 'text-red-400'}`}>{text}</span>
}

// Pill-button group (grain picker, chart-type picker, breakdown picker).
function Pills({ options, value, onChange, small }) {
  return (
    <div className={`flex gap-1 p-1 rounded-xl w-fit ${small ? '' : ''}`} style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)}
          className={`px-2.5 ${small ? 'py-1 text-[10px]' : 'py-1.5 text-[12px]'} rounded-lg font-semibold transition-colors ${value === v ? 'bg-teal text-dark' : 'text-white/50 hover:text-white'}`}>
          {label}
        </button>
      ))}
    </div>
  )
}

// Scorecard tile: value + trend vs previous period + goal readout.
function ScoreTile({ label, metric, value, prev, goal, lowerIsBetter }) {
  const has = value != null
  const trendPct = has && prev != null && prev !== 0 ? ((value - prev) / Math.abs(prev)) * 100 : null
  const trendGood = trendPct == null ? null : (lowerIsBetter ? trendPct <= 0 : trendPct >= 0)
  let goalPct = null, onTrack = null
  if (has && goal != null && goal > 0) {
    goalPct = (value / goal) * 100
    onTrack = lowerIsBetter ? value <= goal : goalPct >= 100
  }
  return (
    <div className="rounded-xl p-3 md:p-4 min-w-0" style={CARD}>
      <p className="text-[9px] md:text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1.5 leading-tight">{label}</p>
      <p className={`text-[16px] md:text-[20px] font-bold leading-none truncate ${onTrack === true ? 'text-emerald-400' : 'text-teal'}`}>
        {fmtMetric(metric, value)}
      </p>
      <div className="mt-1.5 space-y-0.5">
        {trendPct != null && (
          <p className={`text-[10px] font-semibold ${trendGood ? 'text-emerald-400' : 'text-red-400'}`}>
            {trendPct >= 0 ? '▲' : '▼'} {Math.abs(trendPct).toFixed(1)}% <span className="text-white/25 font-normal">vs prev</span>
          </p>
        )}
        {goal != null ? (
          <p className="text-[10px] text-white/35">
            Goal {fmtMetric(metric, goal)}
            {goalPct != null && !lowerIsBetter && <span className={onTrack ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}> · {goalPct.toFixed(0)}%</span>}
            {lowerIsBetter && onTrack != null && <span className={onTrack ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}> · {onTrack ? 'under' : 'over'}</span>}
          </p>
        ) : (
          <p className="text-[10px] text-white/20">No goal set</p>
        )}
      </div>
      {goal != null && goal > 0 && !lowerIsBetter && (
        <div className="h-1 rounded-full overflow-hidden mt-1.5" style={{ background: '#1a1a1a' }}>
          <div className={`h-full rounded-full ${onTrack ? 'bg-emerald-400' : 'bg-teal'}`}
            style={{ width: `${Math.min(goalPct ?? 0, 100)}%` }} />
        </div>
      )}
    </div>
  )
}

const PREFS_KEY = 'tt_perf_prefs'
const DEFAULT_PREFS = {
  revenue: { type: 'bar', breakdown: 'none' },
  deals:   { type: 'bar', breakdown: 'none' },
  cancel:  { type: 'line' },
  markup:  { type: 'line' },
}

export default function Performance() {
  const { profile, isAdmin } = useAuth()
  const { settings, offices } = useSettings()

  const [deals,       setDeals]       = useState([])
  const [users,       setUsers]       = useState([])
  const [teamChanges, setTeamChanges] = useState([])
  const [weeklyStats, setWeeklyStats] = useState([])
  const [targets,     setTargets]     = useState([])
  const [companyGoal, setCompanyGoal] = useState(null)   // monthly_goals fallback (current month)
  const [repGoals,    setRepGoals]    = useState([])     // rep_goals fallback (current month)
  const [loading,     setLoading]     = useState(true)

  const [grain,    setGrain]    = useState('month')
  const [scopeSel, setScopeSel] = useState('org')
  const [prefs,    setPrefs]    = useState(() => {
    try { return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(PREFS_KEY)) || {}) } }
    catch { return DEFAULT_PREFS }
  })
  useEffect(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* ignore */ } }, [prefs])
  const setPref = (block, patch) => setPrefs(p => ({ ...p, [block]: { ...p[block], ...patch } }))

  const now = new Date()
  const loadData = () =>
    Promise.all([
      fetchDeals(), fetchUsers(), fetchTeamChanges(), fetchWeeklyStats(), fetchTargets(),
      fetchGoal(now.getFullYear(), now.getMonth() + 1),
      fetchRepGoals(now.getFullYear(), now.getMonth() + 1),
    ]).then(([d, u, tc, ws, tg, g, rg]) => {
      setDeals(d.data ?? [])              // includes canceled — cancel rate needs them
      setUsers(u.data ?? [])
      setTeamChanges(tc.data ?? [])
      setWeeklyStats(ws.data ?? [])
      setTargets(tg.data ?? [])
      setCompanyGoal(g.data ?? null)
      setRepGoals(rg.data ?? [])
    })
  useEffect(() => { loadData().finally(() => setLoading(false)) }, [])
  useRefreshOnFocus(loadData)

  // Attribution machinery — identical to the Dashboard so numbers always match.
  const usersById = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users])
  const headsSet  = useMemo(() => headIdSet(users), [users])
  const changesByProfile = useMemo(() => buildChangesByProfile(teamChanges), [teamChanges])
  const teamCtx = useMemo(() => ({ usersById, heads: headsSet, changesByProfile }), [usersById, headsSet, changesByProfile])

  const heads = useMemo(() => users.filter(u => headsSet.has(u.id)).sort((a, b) => a.name.localeCompare(b.name)), [users, headsSet])
  const activeReps = useMemo(() =>
    users.filter(u => u.active !== false && (isAdmin || !u.ghost)).sort((a, b) => a.name.localeCompare(b.name)),
    [users, isAdmin])

  // scope: 'org' | 'team:<id>' | 'office:<name lc>' | 'rep:<id>'
  const scope = useMemo(() => {
    if (scopeSel === 'org') return { type: 'org' }
    const [type, ...rest] = scopeSel.split(':')
    const v = rest.join(':')
    return type === 'office' ? { type, name: v } : { type, id: v }
  }, [scopeSel])
  const scopeSubject = scope.type === 'org' ? null : scope.type === 'office' ? scope.name : scope.id
  const scopeName = scope.type === 'org' ? 'Entire Company'
    : scope.type === 'office' ? (offices.find(o => o.toLowerCase() === scope.name) ?? scope.name)
    : scope.id === 'unassigned' ? 'Unassigned'
    : (usersById[scope.id]?.name ? (scope.type === 'team' ? `${usersById[scope.id].name}'s Team` : usersById[scope.id].name) : '—')

  const grainDef = GRAINS.find(g => g.key === grain) ?? GRAINS[1]

  // Zoom: clicking a period on any chart (or MTD/QTD/YTD) focuses that single
  // period — the whole page narrows to it, broken into sub-periods (month →
  // weeks, quarter/year → months, week → days). X clears back to normal.
  const [focus, setFocus] = useState(null)   // { key, label, from, to, grain }
  const changeGrain = (g) => { setFocus(null); setGrain(g) }
  const focusOn = (periodGrain, p) => setFocus({ ...p, grain: periodGrain, label: zoomLabel(periodGrain, p.from) })
  const focusNow = (g) => focusOn(g, periodsFor(g, 1)[0])

  const displayGrain = focus ? SUB_GRAIN[focus.grain] : grain
  const periods = useMemo(
    () => focus ? periodsInRange(displayGrain, focus.from, focus.to) : periodsFor(grain, grainDef.count),
    [focus, displayGrain, grain, grainDef.count])

  // Weekly estimates can't be split into days, so a week-zoom hides them.
  const dayView = displayGrain === 'day'
  const statsForBuckets = dayView ? [] : weeklyStats

  const buckets = useMemo(
    () => bucketize(deals, statsForBuckets, periods, scope, teamCtx),
    [deals, statsForBuckets, periods, scope, teamCtx])

  // Scorecard period: the focused period itself (vs the one before it at the
  // SAME grain), or the newest period of the picked grain.
  const headerGrain = focus ? focus.grain : grain
  const headerBuckets = useMemo(() => {
    const ps = focus
      ? periodsFor(focus.grain, 2, new Date(focus.from + 'T12:00:00'))
      : periodsFor(grain, 2)
    return { ps, b: bucketize(deals, weeklyStats, ps, scope, teamCtx) }
  }, [focus, grain, deals, weeklyStats, scope, teamCtx])
  const curPeriod = focus ?? headerBuckets.ps[1]
  const cur  = headerBuckets.b[headerBuckets.ps[1].key]
  const prev = headerBuckets.b[headerBuckets.ps[0].key]

  // Goal for a metric at the current scope+grain: targets table first, then the
  // legacy goal stores for revenue (company monthly goal, weekly_goal setting,
  // rep/team monthly goals) so goal lines work before any targets are entered.
  const goalFor = (metric, g = headerGrain, periodStart = curPeriod.from) => {
    const t = resolveTarget(targets, { scopeType: scope.type, subject: scopeSubject, metric, grain: g, periodStart })
    if (t != null) return t
    if (metric !== 'revenue') return null
    if (g === 'month') {
      if (scope.type === 'org')  return companyGoal
      if (scope.type === 'team') return repGoals.find(x => x.scope === 'team' && x.subject_id === scope.id)?.target ?? null
      if (scope.type === 'rep')  return repGoals.find(x => x.scope === 'rep'  && x.subject_id === scope.id)?.target ?? null
    }
    if (g === 'week' && scope.type === 'org') {
      const wg = parseFloat(settings.weekly_goal)
      if (Number.isFinite(wg) && wg > 0) return wg
    }
    return null
  }
  // Goal lines on charts follow the DISPLAYED grain (a month zoom shows the
  // weekly goal line against its weeks).
  const chartGoal = (metric) => goalFor(metric, displayGrain, periods[0]?.from ?? curPeriod.from)

  const seriesRows = useMemo(() => periods.map(p => ({ label: p.label, ...buckets[p.key] })), [periods, buckets])
  const hasEstimates = scopeHasEstimates(scope)

  // Unassigned is EXCLUDED from every team view on this page (per Keaton) —
  // but silently dropping data hides problems, so flag the FIXABLE cases:
  // a rep who currently HAS a lead whose deals still resolve to no team
  // (broken attribution — stale reports-to, lead missing the manager role),
  // and deals with no setter or closer at all. Genuinely unmanaged reps
  // (no reports-to) are expected and not alerted.
  const unassignedIssues = useMemo(() => {
    const byOwner = {}
    let ownerless = 0
    for (const d of deals) {
      if (isCanceled(d) || !d.sale_date) continue
      const owner = saleOwnerId(d)
      if (!owner) { ownerless += 1; continue }
      if (teamOfSale(owner, d.sale_date, usersById, headsSet, changesByProfile) !== 'unassigned') continue
      const u = usersById[owner]
      if (!u?.manager_id) continue                 // unmanaged by design — expected
      if (!isAdmin && u.ghost) continue
      const e = (byOwner[owner] ??= { id: owner, name: u.name, lead: usersById[u.manager_id]?.name ?? 'someone', count: 0 })
      e.count += 1
    }
    return { reps: Object.values(byOwner).sort((a, b) => b.count - a.count), ownerless }
  }, [deals, usersById, headsSet, changesByProfile, isAdmin])

  // Team/office breakdown for the revenue + deals charts (org scope only).
  // Grouped in ONE pass by the same date-effective team key as the Dashboard so
  // the stacked series always sum exactly to the company totals.
  function breakdownData(field, mode) {
    const entKey = (d) => mode === 'team'
      ? teamOfSale(saleOwnerId(d), d.sale_date, usersById, headsSet, changesByProfile)
      : ((d.office || '').toLowerCase() || '_none')
    const byEnt = {}
    const rowByPeriod = Object.fromEntries(periods.map(p => [p.key, { label: p.label }]))
    for (const d of deals) {
      if (isCanceled(d) || !d.sale_date) continue
      const p = periods.find(x => d.sale_date >= x.from && d.sale_date <= x.to)
      if (!p) continue
      const k = entKey(d)
      if (mode === 'team' && k === 'unassigned') continue   // excluded from team views
      byEnt[k] = true
      const v = field === 'revenue' ? dealAmounts(d).baseline : 1
      rowByPeriod[p.key][k] = (rowByPeriod[p.key][k] || 0) + v
    }
    const entName = (k) => {
      if (mode === 'office') return k === '_none' ? 'No office' : (offices.find(o => o.toLowerCase() === k) ?? k)
      if (k === 'unassigned') return 'Unassigned'
      const u = usersById[k]
      return u ? `${u.name.split(' ')[0]}'s Team${headsSet.has(k) ? '' : ' (former)'}` : 'Former team'
    }
    const series = Object.keys(byEnt).map((k, i) => ({ key: k, name: entName(k), color: PALETTE[i % PALETTE.length] }))
    return { rows: periods.map(p => rowByPeriod[p.key]), series }
  }

  function chartFor(block, field, yFmt, metricKey) {
    const p = prefs[block] ?? {}
    const useBreakdown = scope.type === 'org' && p.breakdown && p.breakdown !== 'none'
    // No goal line on a breakdown view — the company goal against per-team
    // bars reads as if every team should hit the whole company number.
    if (useBreakdown) return { ...breakdownData(field, p.breakdown), type: p.type ?? 'bar', yFmt, goal: null }
    return {
      rows: seriesRows,
      series: [{ key: field, name: METRICS.find(m => m.key === metricKey)?.label ?? field, color: '#00b894' }],
      type: p.type ?? 'bar', yFmt, goal: chartGoal(metricKey),
    }
  }

  // Click-to-zoom from any chart x-position (day view is the floor).
  const zoomFromChart = dayView ? undefined : (label) => {
    const p = periods.find(x => x.label === label)
    if (p) focusOn(displayGrain, p)
  }

  // ── Leaderboard: reps ranked within the current period + scope ──
  const leaderboard = useMemo(() => {
    const map = {}
    const row = (id) => (map[id] ??= { id, revenue: 0, job: 0, deals: 0, canceled: 0, estimates: 0 })
    for (const d of deals) {
      if (!d.sale_date || d.sale_date < curPeriod.from || d.sale_date > curPeriod.to) continue
      if (!dealInScope(d, scope, teamCtx)) continue
      const owner = saleOwnerId(d)
      if (!owner) continue   // no setter/closer — excluded here, flagged in the banner
      const r = row(owner)
      if (isCanceled(d)) { r.canceled += 1; continue }
      const a = dealAmounts(d)
      r.revenue += a.baseline; r.job += a.job; r.deals += 1
    }
    if (hasEstimates) {
      for (const s of weeklyStats) {
        if (!s.week_start || s.week_start < curPeriod.from || s.week_start > curPeriod.to) continue
        if (!statInScope(s, scope, teamCtx)) continue
        row(s.rep_id).estimates += estOf(s)
      }
    }
    return Object.values(map)
      .filter(r => r.revenue || r.deals || r.canceled || r.estimates)
      .filter(r => isAdmin || !usersById[r.id]?.ghost)
      .map(r => ({
        ...r,
        name: usersById[r.id]?.name ?? 'Unknown',
        closeRate: r.estimates > 0 ? (r.deals / r.estimates) * 100 : null,
        markup: r.revenue > 0 ? ((r.job - r.revenue) / r.revenue) * 100 : null,
      }))
      .sort((a, b) => b.revenue - a.revenue || b.deals - a.deals)
  }, [deals, weeklyStats, curPeriod, scope, teamCtx, usersById, isAdmin, hasEstimates])

  // ── Team comparison: every team vs its goal, current period (org scope) ──
  const teamCompare = useMemo(() => {
    if (scope.type !== 'org') return []
    const keys = new Set(heads.map(h => h.id))
    for (const d of deals) {
      if (!d.sale_date || d.sale_date < curPeriod.from || d.sale_date > curPeriod.to) continue
      const k = teamOfSale(saleOwnerId(d), d.sale_date, usersById, headsSet, changesByProfile)
      if (k !== 'unassigned') keys.add(k)
    }
    return [...keys].map(k => {
      const tScope = { type: 'team', id: k }
      const b = bucketize(deals, weeklyStats, [curPeriod], tScope, teamCtx)[curPeriod.key]
      let goal = resolveTarget(targets, { scopeType: 'team', subject: k, metric: 'revenue', grain: headerGrain, periodStart: curPeriod.from })
      if (goal == null && headerGrain === 'month') goal = repGoals.find(g => g.scope === 'team' && g.subject_id === k)?.target ?? null
      const u = usersById[k]
      const name = k === 'unassigned' ? 'Unassigned' : u ? `${u.name}${headsSet.has(k) ? '' : ' (former)'}` : 'Former team'
      return { key: k, name, ...b, goal, goalPct: goal > 0 ? (b.revenue / goal) * 100 : null }
    })
      .filter(t => t.revenue || t.deals || t.canceled || t.estimates || t.goal)
      .sort((a, b) => b.revenue - a.revenue)
  }, [scope.type, deals, weeklyStats, curPeriod, teamCtx, heads, targets, repGoals, headerGrain, usersById, headsSet, changesByProfile])

  // ── Targets editor (admin) ──
  const [showTargets, setShowTargets] = useState(false)
  const emptyTarget = { scope: 'org', subject: '', metric: 'revenue', period: 'month', value: '', effective: new Date().toISOString().slice(0, 10) }
  const [tForm, setTForm] = useState(emptyTarget)
  async function addTarget() {
    const v = parseFloat(tForm.value)
    if (!(v > 0)) { toast.error('Enter a target value greater than 0.'); return }
    if (tForm.scope !== 'org' && !tForm.subject) { toast.error('Pick who/where this target is for.'); return }
    const row = {
      scope: tForm.scope,
      subject: tForm.scope === 'org' ? null : tForm.subject,
      metric: tForm.metric, period: tForm.period, value: v, effective: tForm.effective,
    }
    const res = await saveTarget(row, profile?.id)
    if (res?.error) { toast.error('Could not save the target: ' + (res.error.message || 'unknown error')); return }
    setTForm(emptyTarget)
    const { data } = await fetchTargets(); setTargets(data ?? [])
    toast.success('Target saved.')
  }
  async function removeTarget(id) {
    const res = await deleteTarget(id)
    if (res?.error) { toast.error('Could not delete the target.'); return }
    setTargets(ts => ts.filter(t => t.id !== id))
  }
  const targetSubjectName = (t) => {
    if (t.scope === 'org') return 'Company'
    if (t.scope === 'office') return offices.find(o => o.toLowerCase() === t.subject) ?? t.subject
    const u = usersById[t.subject]
    return u ? (t.scope === 'team' ? `${u.name}'s Team` : u.name) : t.subject === 'unassigned' ? 'Unassigned' : '—'
  }

  if (loading) return <div className="p-8 text-white/40 text-sm">Loading…</div>

  const CHART_TYPES = [['bar', 'Bar'], ['line', 'Line'], ['area', 'Area']]
  const BREAKDOWNS  = [['none', 'Total'], ['team', 'By Team'], ['office', 'By Office']]
  const pctBlock = (block, metricKey, title, sub) => (
    <div className="rounded-xl p-4 md:p-5" style={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="text-[13px] md:text-[14px] font-semibold text-white">{title}</h3>
          {sub && <p className="text-[10px] text-white/30 mt-0.5">{sub}</p>}
        </div>
        <Pills small options={[['line', 'Line'], ['bar', 'Bar']]} value={prefs[block]?.type ?? 'line'} onChange={v => setPref(block, { type: v })} />
      </div>
      <MetricChart rows={seriesRows}
        series={[{ key: metricKey, name: METRICS.find(m => m.key === metricKey)?.label ?? metricKey, color: metricKey === 'cancel_rate' ? '#f87171' : '#00b894' }]}
        type={prefs[block]?.type ?? 'line'} yFmt="percent" goal={chartGoal(metricKey)} onPointClick={zoomFromChart} />
    </div>
  )

  const rev  = chartFor('revenue', 'revenue', 'money', 'revenue')
  const dls  = chartFor('deals', 'deals', 'count', 'deals')
  const closeGoal = chartGoal('close_rate')

  return (
    <div className="space-y-4 pb-6">

      {/* ── Controls ── */}
      <div className="flex flex-col md:flex-row md:items-center gap-2 md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <select value={scopeSel} onChange={e => setScopeSel(e.target.value)}
            style={{ background: '#242424', border: '1px solid #333' }}
            className="h-9 px-2 rounded-lg text-[12px] text-white focus:outline-none max-w-[240px]">
            <option value="org">Entire Company</option>
            <optgroup label="Teams">
              {heads.map(h => <option key={h.id} value={`team:${h.id}`}>{h.name}'s Team</option>)}
            </optgroup>
            <optgroup label="Offices">
              {offices.map(o => <option key={o} value={`office:${o.toLowerCase()}`}>{o}</option>)}
            </optgroup>
            <optgroup label="Reps">
              {activeReps.map(u => <option key={u.id} value={`rep:${u.id}`}>{u.name}</option>)}
            </optgroup>
          </select>
          <Pills options={GRAINS.map(g => [g.key, g.label])} value={focus ? '' : grain} onChange={changeGrain} />
          <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
            {[['month', 'MTD'], ['quarter', 'QTD'], ['year', 'YTD']].map(([g, l]) => {
              const active = focus && focus.grain === g && focus.key === periodsFor(g, 1)[0].key
              return (
                <button key={g} onClick={() => focusNow(g)} title={`Zoom into the current ${g}`}
                  className={`px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${active ? 'bg-teal text-dark' : 'text-white/50 hover:text-white'}`}>
                  {l}
                </button>
              )
            })}
          </div>
        </div>
        {isAdmin && (
          <button onClick={() => setShowTargets(s => !s)}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12px] font-semibold text-amber-300 hover:bg-amber-400/10 transition-colors self-start"
            style={{ border: '1px solid rgba(251,191,36,0.35)' }}>
            <Target size={14} /> Targets {showTargets ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        )}
      </div>

      {/* ── Targets editor (admin) ── */}
      {isAdmin && showTargets && (
        <div className="rounded-xl p-4 md:p-5 space-y-3" style={CARD}>
          <div>
            <h3 className="text-[13px] font-semibold text-white">Performance Targets</h3>
            <p className="text-[11px] text-white/35 mt-0.5">
              "What we should be doing" — targets draw the goal lines and vs-goal readouts everywhere on this page.
              A weekly $ or count target automatically scales to monthly/quarterly/annual views; percent targets apply
              as-is at every view. Percents are typed as human numbers (40 = 40%). Adding a new target with a later
              effective date never re-judges older periods.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {[['scope', [['org', 'Company'], ['team', 'Team'], ['office', 'Office'], ['rep', 'Rep']]],
              ['metric', METRICS.map(m => [m.key, m.label])],
              ['period', [['week', 'Weekly'], ['month', 'Monthly'], ['quarter', 'Quarterly'], ['year', 'Annual']]]].map(([field, opts]) => (
              <div key={field}>
                <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest mb-1">{field}</p>
                <select value={tForm[field]} onChange={e => setTForm(f => ({ ...f, [field]: e.target.value, ...(field === 'scope' ? { subject: '' } : {}) }))}
                  style={{ background: '#2a2a2a', border: '1px solid #333' }}
                  className="h-9 px-2 rounded-lg text-[12px] text-white focus:outline-none">
                  {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            ))}
            {tForm.scope !== 'org' && (
              <div>
                <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest mb-1">For</p>
                <select value={tForm.subject} onChange={e => setTForm(f => ({ ...f, subject: e.target.value }))}
                  style={{ background: '#2a2a2a', border: '1px solid #333' }}
                  className="h-9 px-2 rounded-lg text-[12px] text-white focus:outline-none max-w-[180px]">
                  <option value="">Select…</option>
                  {tForm.scope === 'team' && heads.map(h => <option key={h.id} value={h.id}>{h.name}'s Team</option>)}
                  {tForm.scope === 'office' && offices.map(o => <option key={o} value={o.toLowerCase()}>{o}</option>)}
                  {tForm.scope === 'rep' && activeReps.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest mb-1">
                Value{PERCENT_METRICS.has(tForm.metric) ? ' (%)' : tForm.metric === 'revenue' ? ' ($)' : ''}
              </p>
              <input type="number" step="any" value={tForm.value} onChange={e => setTForm(f => ({ ...f, value: e.target.value }))}
                style={{ background: '#2a2a2a', border: '1px solid #333' }}
                className="h-9 w-28 px-2 rounded-lg text-[12px] text-white focus:outline-none" />
            </div>
            <div>
              <p className="text-[9px] font-semibold text-white/30 uppercase tracking-widest mb-1">Effective</p>
              <input type="date" value={tForm.effective} onChange={e => setTForm(f => ({ ...f, effective: e.target.value }))}
                style={{ background: '#2a2a2a', border: '1px solid #333' }}
                className="h-9 px-2 rounded-lg text-[12px] text-white focus:outline-none" />
            </div>
            <button onClick={addTarget}
              className="flex items-center gap-1 h-9 px-3 rounded-lg bg-teal text-dark text-[12px] font-bold hover:opacity-90">
              <Plus size={14} /> Add
            </button>
          </div>
          {targets.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[9px] uppercase tracking-widest text-white/30">
                    <th className="pb-2 pr-3">For</th><th className="pb-2 pr-3">Metric</th><th className="pb-2 pr-3">Per</th>
                    <th className="pb-2 pr-3 text-right">Target</th><th className="pb-2 pr-3">Effective</th><th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {targets.map(t => (
                    <tr key={t.id} className="border-t" style={{ borderColor: '#2e2e2e' }}>
                      <td className="py-2 pr-3 text-white">{targetSubjectName(t)}</td>
                      <td className="py-2 pr-3 text-white/70">{METRICS.find(m => m.key === t.metric)?.label ?? t.metric}</td>
                      <td className="py-2 pr-3 text-white/50 capitalize">{t.period}</td>
                      <td className="py-2 pr-3 text-right text-teal font-semibold">{fmtMetric(t.metric, Number(t.value))}</td>
                      <td className="py-2 pr-3 text-white/50">{String(t.effective).slice(0, 10)}</td>
                      <td className="py-2 text-right">
                        <button onClick={() => removeTarget(t.id)} className="p-1 rounded text-white/25 hover:text-red-400"><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[11px] text-white/25">No targets yet — revenue goals from the Dashboard/Team pages are used as a fallback until you add some.</p>
          )}
        </div>
      )}

      {/* ── Data-quality alert: fixable attribution problems ── */}
      {(unassignedIssues.reps.length > 0 || unassignedIssues.ownerless > 0) && (
        <div className="rounded-xl p-3.5 md:p-4 space-y-1.5"
          style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.35)' }}>
          <p className="text-[12px] font-semibold text-amber-300">⚠ Some deals aren't counting toward any team</p>
          {unassignedIssues.reps.map(r => (
            <p key={r.id} className="text-[11px] text-amber-200/80">
              <span className="font-semibold text-amber-200">{r.name}</span> — {r.count} deal{r.count === 1 ? '' : 's'} outside
              any team, but they currently report to <span className="font-semibold text-amber-200">{r.lead}</span>. Their lead
              may be missing the manager role, or their Team History (Admin → Users → Edit) doesn't cover those sale dates.
            </p>
          ))}
          {unassignedIssues.ownerless > 0 && (
            <p className="text-[11px] text-amber-200/80">
              {unassignedIssues.ownerless} deal{unassignedIssues.ownerless === 1 ? ' has' : 's have'} no setter or closer —
              assign people on the Deals page so they count toward a rep and team.
            </p>
          )}
          <p className="text-[10px] text-amber-200/50">These deals still count in company totals — they're just missing from team breakdowns until fixed.</p>
        </div>
      )}

      {/* ── Zoom banner ── */}
      {focus && (
        <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-2.5"
          style={{ background: 'rgba(0,184,148,0.08)', border: '1px solid rgba(0,184,148,0.35)' }}>
          <p className="text-[12px] text-white/80 flex items-center gap-2 min-w-0">
            <ZoomIn size={14} className="text-teal flex-shrink-0" />
            <span className="truncate">Zoomed into <span className="font-bold text-teal">{focus.label}</span>
              <span className="text-white/40"> — shown by {displayGrain}{dayView ? '' : ', click again to go deeper'}</span></span>
          </p>
          <button onClick={() => setFocus(null)} title="Back to the full view"
            className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 flex-shrink-0">
            <X size={15} />
          </button>
        </div>
      )}

      {/* ── Scorecard header ── */}
      <div>
        <div className="flex items-baseline gap-2 mb-2">
          <h2 className="text-[14px] md:text-[15px] font-semibold text-white">{scopeName}</h2>
          <p className="text-[11px] text-white/35">
            {focus ? focus.label
              : `${grain === 'week' ? 'This week' : grain === 'month' ? 'This month' : grain === 'quarter' ? 'This quarter' : 'This year'} · ${curPeriod.label}`}
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 md:gap-3">
          <ScoreTile label="Revenue"     metric="revenue"     value={cur.revenue}     prev={prev?.revenue}     goal={goalFor('revenue')} />
          <ScoreTile label="Deals"       metric="deals"       value={cur.deals}       prev={prev?.deals}       goal={goalFor('deals')} />
          <ScoreTile label="Estimates"   metric="estimates"   value={cur.estimates}   prev={prev?.estimates}   goal={goalFor('estimates')} />
          <ScoreTile label="Close Rate"  metric="close_rate"  value={cur.close_rate}  prev={prev?.close_rate}  goal={goalFor('close_rate')} />
          <ScoreTile label="Cancel Rate" metric="cancel_rate" value={cur.cancel_rate} prev={prev?.cancel_rate} goal={goalFor('cancel_rate')} lowerIsBetter />
          <ScoreTile label="Markup %"    metric="markup_pct"  value={cur.markup_pct}  prev={prev?.markup_pct}  goal={goalFor('markup_pct')} />
        </div>
        {!hasEstimates && (
          <p className="text-[10px] text-white/25 mt-1.5">Estimates aren't tracked per office, so estimate + close-rate figures show "—" at office scope.</p>
        )}
        {(grain === 'quarter' || grain === 'year') && (
          <p className="text-[10px] text-white/25 mt-1.5">Heads up: data starts June 2026, so early {grain === 'quarter' ? 'quarters' : 'years'} are partial.</p>
        )}
      </div>

      {/* ── Revenue ── */}
      <div className="rounded-xl p-4 md:p-5" style={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h3 className="text-[13px] md:text-[14px] font-semibold text-white">Revenue</h3>
            <p className="text-[10px] text-white/30 mt-0.5">Baseline revenue by {displayGrain}{rev.goal != null ? ' · goal line in amber' : ''}{dayView ? '' : ' · click a bar to zoom in'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {scope.type === 'org' && <Pills small options={BREAKDOWNS} value={prefs.revenue?.breakdown ?? 'none'} onChange={v => setPref('revenue', { breakdown: v })} />}
            <Pills small options={CHART_TYPES} value={prefs.revenue?.type ?? 'bar'} onChange={v => setPref('revenue', { type: v })} />
          </div>
        </div>
        <MetricChart rows={rev.rows} series={rev.series} type={rev.type} yFmt="money" goal={rev.goal} height={260} onPointClick={zoomFromChart} />
      </div>

      {/* ── Deals ── */}
      <div className="rounded-xl p-4 md:p-5" style={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h3 className="text-[13px] md:text-[14px] font-semibold text-white">Deals</h3>
            <p className="text-[10px] text-white/30 mt-0.5">Net deals closed (canceled excluded)</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {scope.type === 'org' && <Pills small options={BREAKDOWNS} value={prefs.deals?.breakdown ?? 'none'} onChange={v => setPref('deals', { breakdown: v })} />}
            <Pills small options={CHART_TYPES} value={prefs.deals?.type ?? 'bar'} onChange={v => setPref('deals', { type: v })} />
          </div>
        </div>
        <MetricChart rows={dls.rows} series={dls.series} type={dls.type} yFmt="count" goal={dls.goal} onPointClick={zoomFromChart} />
      </div>

      {/* ── Activity funnel: estimates → closes + close rate ── */}
      {hasEstimates && !dayView && (
        <div className="rounded-xl p-4 md:p-5" style={CARD}>
          <div className="mb-3">
            <h3 className="text-[13px] md:text-[14px] font-semibold text-white">Activity — Estimates → Closes</h3>
            <p className="text-[10px] text-white/30 mt-0.5">Estimates from the Team page's Weekly Stats inputs · close rate = closes ÷ estimates</p>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={seriesRows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              onClick={zoomFromChart ? (s) => { if (s?.activeLabel != null) zoomFromChart(s.activeLabel) } : undefined}
              style={zoomFromChart ? { cursor: 'pointer' } : undefined}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2e2e2e" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#666' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#666' }} axisLine={false} tickLine={false} width={32} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#666' }} axisLine={false} tickLine={false}
                tickFormatter={v => `${v}%`} width={40} />
              <Tooltip content={<ChartTip yFmt="count" />} cursor={{ fill: '#ffffff08' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {closeGoal != null && (
                <ReferenceLine yAxisId="right" y={closeGoal} stroke="#fbbf24" strokeDasharray="5 4" strokeWidth={1.5}
                  label={{ value: 'CR Goal', position: 'insideTopRight', fill: '#fbbf24', fontSize: 10 }} />
              )}
              <Bar yAxisId="left" dataKey="estimates" name="Estimates" fill="#74b9ff" radius={[4, 4, 0, 0]} maxBarSize={30} />
              <Bar yAxisId="left" dataKey="deals" name="Closes" fill="#00b894" radius={[4, 4, 0, 0]} maxBarSize={30} />
              <Line yAxisId="right" type="monotone" dataKey="close_rate" name="Close Rate" unit="%" stroke="#a78bfa"
                strokeWidth={2} dot={{ fill: '#a78bfa', r: 3 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Cancel rate + Markup — side by side on desktop ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5">
        {pctBlock('cancel', 'cancel_rate', 'Cancel Rate', 'Canceled ÷ all deals sold that period')}
        {pctBlock('markup', 'markup_pct', 'Markup %', '(Job price − baseline) ÷ baseline')}
      </div>

      {/* ── Change over time: each period vs the one before it ── */}
      <div className="rounded-xl p-4 md:p-5" style={CARD}>
        <div className="mb-3">
          <h3 className="text-[13px] md:text-[14px] font-semibold text-white">Change Over Time — {scopeName}</h3>
          <p className="text-[10px] text-white/30 mt-0.5">
            Each period vs the one before it · green = improving, red = declining{dayView ? '' : ' · click a row to zoom in'}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] min-w-[760px]">
            <thead>
              <tr className="text-left text-[9px] uppercase tracking-widest text-white/30">
                <th className="pb-2 pr-3">Period</th>
                <th className="pb-2 pr-3 text-right">Revenue</th>
                <th className="pb-2 pr-3 text-right">Deals</th>
                <th className="pb-2 pr-3 text-right">Estimates</th>
                <th className="pb-2 pr-3 text-right">Close %</th>
                <th className="pb-2 pr-3 text-right">Cancel %</th>
                <th className="pb-2 text-right">Markup %</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p, i) => ({ p, i })).reverse().map(({ p, i }) => {
                const b  = buckets[p.key]
                const pb = i > 0 ? buckets[periods[i - 1].key] : null
                const inProgress = i === periods.length - 1 && p.to >= new Date().toISOString().slice(0, 10)
                const cell = (metric, v, pv) => (
                  <td className="py-2 pr-3 text-right whitespace-nowrap">
                    <span className={metric === 'revenue' ? 'text-teal font-semibold' : 'text-white/80'}>{fmtMetric(metric, v)}</span>
                    <div className="h-[13px]"><DeltaTag metric={metric} v={v} pv={pv} /></div>
                  </td>
                )
                return (
                  <tr key={p.key} onClick={dayView ? undefined : () => focusOn(displayGrain, p)}
                    className={`border-t ${dayView ? '' : 'cursor-pointer hover:bg-white/[0.03]'}`} style={{ borderColor: '#2e2e2e' }}>
                    <td className="py-2 pr-3 font-semibold text-white whitespace-nowrap">
                      {p.label}{inProgress && <span className="text-[9px] text-white/30 font-normal"> (so far)</span>}
                    </td>
                    {cell('revenue',     b.revenue,     pb?.revenue)}
                    {cell('deals',       b.deals,       pb?.deals)}
                    {cell('estimates',   dayView ? null : b.estimates, dayView ? null : pb?.estimates)}
                    {cell('close_rate',  b.close_rate,  pb?.close_rate)}
                    {cell('cancel_rate', b.cancel_rate, pb?.cancel_rate)}
                    {cell('markup_pct',  b.markup_pct,  pb?.markup_pct)}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Team comparison vs goals (org scope) ── */}
      {scope.type === 'org' && teamCompare.length > 0 && (
        <div className="rounded-xl p-4 md:p-5" style={CARD}>
          <div className="mb-3">
            <h3 className="text-[13px] md:text-[14px] font-semibold text-white">Teams vs Goal — {curPeriod.label}</h3>
            <p className="text-[10px] text-white/30 mt-0.5">Set team revenue targets (or Team-page goals) to fill the Goal column</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] min-w-[720px]">
              <thead>
                <tr className="text-left text-[9px] uppercase tracking-widest text-white/30">
                  <th className="pb-2 pr-3">Team</th>
                  <th className="pb-2 pr-3 text-right">Revenue</th>
                  <th className="pb-2 pr-3 text-right">Goal</th>
                  <th className="pb-2 pr-3 w-[140px]">Progress</th>
                  <th className="pb-2 pr-3 text-right">Deals</th>
                  <th className="pb-2 pr-3 text-right">Estimates</th>
                  <th className="pb-2 pr-3 text-right">Close %</th>
                  <th className="pb-2 pr-3 text-right">Cancel %</th>
                  <th className="pb-2 text-right">Markup %</th>
                </tr>
              </thead>
              <tbody>
                {teamCompare.map(t => (
                  <tr key={t.key} className="border-t" style={{ borderColor: '#2e2e2e' }}>
                    <td className="py-2.5 pr-3 font-semibold text-white whitespace-nowrap">{t.name}</td>
                    <td className="py-2.5 pr-3 text-right text-teal font-semibold">{fmtMetric('revenue', t.revenue)}</td>
                    <td className="py-2.5 pr-3 text-right text-white/50">{t.goal != null ? fmtMetric('revenue', t.goal) : '—'}</td>
                    <td className="py-2.5 pr-3">
                      {t.goalPct != null ? (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 rounded-full overflow-hidden flex-1" style={{ background: '#1a1a1a' }}>
                            <div className={`h-full rounded-full ${t.goalPct >= 100 ? 'bg-emerald-400' : 'bg-teal'}`}
                              style={{ width: `${Math.min(t.goalPct, 100)}%` }} />
                          </div>
                          <span className={`text-[10px] font-semibold ${t.goalPct >= 100 ? 'text-emerald-400' : 'text-white/40'}`}>{t.goalPct.toFixed(0)}%</span>
                        </div>
                      ) : <span className="text-white/20 text-[10px]">no goal</span>}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-white">{t.deals}</td>
                    <td className="py-2.5 pr-3 text-right text-white/60">{t.estimates ?? '—'}</td>
                    <td className="py-2.5 pr-3 text-right text-white/60">{t.close_rate != null ? t.close_rate.toFixed(0) + '%' : '—'}</td>
                    <td className="py-2.5 pr-3 text-right text-white/60">{t.cancel_rate != null ? t.cancel_rate.toFixed(0) + '%' : '—'}</td>
                    <td className="py-2.5 text-right text-white/60">{t.markup_pct != null ? t.markup_pct.toFixed(1) + '%' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Rep leaderboard for the current period ── */}
      <div className="rounded-xl p-4 md:p-5" style={CARD}>
        <div className="mb-3">
          <h3 className="text-[13px] md:text-[14px] font-semibold text-white">Rep Breakdown — {curPeriod.label}</h3>
          <p className="text-[10px] text-white/30 mt-0.5">Deal + revenue credit to the setter (closer when no setter), same as the Dashboard</p>
        </div>
        {leaderboard.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] min-w-[640px]">
              <thead>
                <tr className="text-left text-[9px] uppercase tracking-widest text-white/30">
                  <th className="pb-2 pr-2 w-8">#</th>
                  <th className="pb-2 pr-3">Rep</th>
                  <th className="pb-2 pr-3 text-right">Revenue</th>
                  <th className="pb-2 pr-3 text-right">Deals</th>
                  <th className="pb-2 pr-3 text-right">Estimates</th>
                  <th className="pb-2 pr-3 text-right">Close %</th>
                  <th className="pb-2 pr-3 text-right">Cancels</th>
                  <th className="pb-2 text-right">Markup %</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((r, i) => (
                  <tr key={r.id} className="border-t" style={{ borderColor: '#2e2e2e' }}>
                    <td className="py-2.5 pr-2 text-white/30 font-semibold">{i + 1}</td>
                    <td className="py-2.5 pr-3 font-semibold text-white whitespace-nowrap">{r.name}</td>
                    <td className="py-2.5 pr-3 text-right text-teal font-semibold">{fmtMetric('revenue', r.revenue)}</td>
                    <td className="py-2.5 pr-3 text-right text-white">{r.deals}</td>
                    <td className="py-2.5 pr-3 text-right text-white/60">{hasEstimates ? r.estimates || '—' : '—'}</td>
                    <td className="py-2.5 pr-3 text-right text-white/60">{r.closeRate != null ? r.closeRate.toFixed(0) + '%' : '—'}</td>
                    <td className={`py-2.5 pr-3 text-right ${r.canceled ? 'text-red-400/80' : 'text-white/25'}`}>{r.canceled || '—'}</td>
                    <td className="py-2.5 text-right text-white/60">{r.markup != null ? r.markup.toFixed(1) + '%' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[12px] text-white/25">No activity in this period.</p>
        )}
      </div>
    </div>
  )
}
