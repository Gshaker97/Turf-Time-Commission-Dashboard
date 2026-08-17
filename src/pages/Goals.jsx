import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Target, Flame, Pencil, Check } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchDeals, fetchUsers, fetchWeeklyStats, fetchPersonalGoals, upsertPersonalGoal, saveRepGoal } from '../lib/db'
import { fmt } from '../utils/commission'
import { headIdSet, teamKeyFor } from '../utils/team'
import {
  currentPeriods, resolveGoal, goalIsSet, repProduction, periodElapsed,
  metricProgress, suggestFromRevenue, estimateStreak,
} from '../utils/goals'
import { toast } from '../lib/toast'

const todayISO = () => format(new Date(), 'yyyy-MM-dd')
const PALETTE = ['#00b894', '#74b9ff', '#a78bfa', '#fbbf24', '#fb923c', '#f87171', '#34d399', '#60a5fa']
const STATUS_COLOR = { done: '#4ade80', ahead: '#00b894', behind: '#fbbf24' }

// One metric line. View mode: "value / goal" over a slim bar, pace shown as a
// small colored word. Edit mode: the goal number becomes an input in place.
function MetricRow({ label, value, prog, editing, inputValue, onSave, money, inputKey }) {
  const color = prog ? STATUS_COLOR[prog.status] : 'rgba(255,255,255,0.14)'
  const fmtV = (v) => money ? fmt(v) : String(v)
  const pace = !prog ? null
    : prog.status === 'done' ? '✓ hit'
    : prog.status === 'ahead' ? 'on pace'
    : money ? `−${fmt(prog.gap)}` : `−${Math.ceil(prog.gap)}`
  return (
    <div className="py-[7px]">
      <div className="flex items-baseline gap-2 text-[12px] leading-none">
        <span className="text-white/40">{label}</span>
        {prog && (
          <span className="text-[10px] font-semibold" style={{ color }} title={prog.status === 'behind' ? 'behind pace' : undefined}>{pace}</span>
        )}
        <span className="ml-auto whitespace-nowrap">
          <span className="font-bold text-white">{money ? fmt(value) : value}</span>
          {editing ? (
            <>
              <span className="text-white/25 mx-1">/</span>
              <input type="number" min="0" step={money ? 'any' : 1} key={inputKey}
                defaultValue={inputValue ?? ''} placeholder="goal"
                onBlur={e => onSave(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                className="w-[70px] rounded-md px-1.5 py-0.5 text-[12px] font-semibold text-teal text-right focus:outline-none"
                style={{ background: '#1a1a1a', border: '1px solid rgba(0,184,148,0.4)' }} />
            </>
          ) : (
            <span className="text-white/35"> / {inputValue != null ? fmtV(inputValue) : '—'}</span>
          )}
        </span>
      </div>
      <div className="h-[5px] rounded-full overflow-hidden mt-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(prog?.frac ?? 0) * 100}%`, background: color }} />
      </div>
    </div>
  )
}

export default function Goals() {
  const { profile, isAdmin } = useAuth()
  const [deals, setDeals] = useState([])
  const [users, setUsers] = useState([])
  const [weeklyStats, setWeeklyStats] = useState([])
  const [goals, setGoals] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([fetchDeals(), fetchUsers(), fetchWeeklyStats(), fetchPersonalGoals()])
      .then(([d, u, ws, g]) => {
        setDeals(d.data ?? []); setUsers(u.data ?? []); setWeeklyStats(ws.data ?? []); setGoals(g.data ?? [])
      })
      .finally(() => setLoading(false))
  }, [])

  const today = todayISO()
  const periods = useMemo(() => currentPeriods(today), [today])
  const headsSet = useMemo(() => headIdSet(users), [users])

  // Roster grouped by current team — active reps, managers, and team heads
  // (same seeding rule as the Performance breakdown); ghosts admin-only.
  const teams = useMemo(() => {
    const people = users.filter(u =>
      u.active !== false &&
      (u.role === 'rep' || u.role === 'manager' || headsSet.has(u.id)) &&
      (isAdmin || !u.ghost))
    const groups = {}
    for (const u of people) (groups[teamKeyFor(u, headsSet)] ??= []).push(u)
    return Object.entries(groups).map(([tk, rows], i) => {
      const lead = users.find(u => u.id === tk)
      rows.sort((a, b) => a.name.localeCompare(b.name))
      return {
        key: tk,
        name: tk === 'unassigned' ? 'No Team' : lead ? `${lead.name}'s Team` : 'Former Team',
        color: PALETTE[i % PALETTE.length],
        rows,
      }
    }).sort((a, b) => (a.key === 'unassigned') - (b.key === 'unassigned') || a.name.localeCompare(b.name))
  }, [users, headsSet, isAdmin])

  const canEditRep = (rep) => isAdmin || rep.id === profile?.id || rep.manager_id === profile?.id

  // Save one field of one rep's goal for the CURRENT period. The write
  // materializes the full row (carried values included), so carry-forward
  // becomes explicit the moment anyone touches a goal.
  async function saveGoalField(rep, periodKey, field, raw) {
    const p = periods[periodKey]
    const g = resolveGoal(goals, rep.id, p.period, p.start)
    const v = raw === '' ? null : Math.max(0, Number(raw) || 0)
    const cur = {
      est_target: g?.est_target ?? null,
      deals_target: g?.deals_target ?? null,
      revenue_target: g?.revenue_target ?? null,
    }
    if (cur[field] === v) return
    const row = { rep_id: rep.id, period: p.period, period_start: p.start, ...cur, [field]: v }
    setGoals(gs => [
      ...gs.filter(x => !(x.rep_id === rep.id && x.period === p.period && String(x.period_start).slice(0, 10) === p.start)),
      row,
    ])
    const res = await upsertPersonalGoal(row, profile?.id)
    if (res?.error) { toast.error("Couldn't save the goal: " + (res.error.message || 'unknown error')); return }
    // Monthly revenue also mirrors into rep_goals so the Performance page's
    // rep goal fallback (and anything else on that store) stays in sync.
    if (periodKey === 'month' && field === 'revenue_target' && v != null) {
      const d = new Date(p.start + 'T12:00:00')
      saveRepGoal(rep.id, 'rep', d.getFullYear(), d.getMonth() + 1, v)
    }
  }

  // Apply the goal-math suggestion to week + month activity targets.
  async function applySuggestion(rep, sug, monthGoal) {
    const rows = [
      { rep_id: rep.id, period: 'month', period_start: periods.month.start,
        est_target: sug.month.est, deals_target: sug.month.deals, revenue_target: monthGoal?.revenue_target ?? null },
      { rep_id: rep.id, period: 'week', period_start: periods.week.start,
        est_target: sug.week.est, deals_target: sug.week.deals, revenue_target: sug.week.revenue },
    ]
    setGoals(gs => [
      ...gs.filter(x => !(x.rep_id === rep.id && (
        (x.period === 'month' && String(x.period_start).slice(0, 10) === periods.month.start) ||
        (x.period === 'week' && String(x.period_start).slice(0, 10) === periods.week.start)))),
      ...rows,
    ])
    for (const r of rows) {
      const res = await upsertPersonalGoal(r, profile?.id)
      if (res?.error) { toast.error("Couldn't save the goals: " + (res.error.message || 'unknown error')); return }
    }
    toast.success('Weekly + monthly targets set.')
  }

  function RepCard({ rep }) {
    const editable = canEditRep(rep)
    const [editing, setEditing] = useState(false)
    const wGoal = resolveGoal(goals, rep.id, 'week', periods.week.start)
    const mGoal = resolveGoal(goals, rep.id, 'month', periods.month.start)
    const wProd = repProduction(deals, weeklyStats, rep.id, periods.week)
    const mProd = repProduction(deals, weeklyStats, rep.id, periods.month)
    const wEl = periodElapsed(periods.week, today)
    const mEl = periodElapsed(periods.month, today)
    const streak = estimateStreak(goals, deals, weeklyStats, rep.id, today)
    const noGoals = !goalIsSet(wGoal) && !goalIsSet(mGoal)
    const sug = editing && mGoal?.revenue_target > 0
      ? suggestFromRevenue(deals, weeklyStats, rep.id, Number(mGoal.revenue_target), today) : null

    const block = (title, p, prod, goal, elapsed, periodKey) => (
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2 mb-0.5">
          <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/35">{title}</p>
          <p className="text-[9px] text-white/20">{goal?.carried ? 'carried · ' : ''}{p.sub}</p>
        </div>
        <MetricRow label="SG Est" value={prod.sgEst}
          prog={metricProgress(prod.sgEst, goal?.est_target, elapsed)}
          editing={editing} inputValue={goal?.est_target}
          inputKey={`${rep.id}-${periodKey}-est-${goal?.est_target ?? ''}`}
          onSave={v => saveGoalField(rep, periodKey, 'est_target', v)} />
        <MetricRow label="Deals" value={prod.deals}
          prog={metricProgress(prod.deals, goal?.deals_target, elapsed)}
          editing={editing} inputValue={goal?.deals_target}
          inputKey={`${rep.id}-${periodKey}-deals-${goal?.deals_target ?? ''}`}
          onSave={v => saveGoalField(rep, periodKey, 'deals_target', v)} />
        <MetricRow label="Revenue" money value={prod.revenue}
          prog={metricProgress(prod.revenue, goal?.revenue_target, elapsed)}
          editing={editing} inputValue={goal?.revenue_target}
          inputKey={`${rep.id}-${periodKey}-rev-${goal?.revenue_target ?? ''}`}
          onSave={v => saveGoalField(rep, periodKey, 'revenue_target', v)} />
        <p className="text-[10px] text-white/25 mt-1">
          Leads: {prod.leadsRan} ran · {prod.leadsClosed} closed{prod.leadRevenue > 0 ? ` (${fmt(prod.leadRevenue)})` : ''}
        </p>
      </div>
    )

    return (
      <div className="rounded-xl px-4 py-3.5 transition-colors"
        style={{ background: '#1e1e1e', border: editing ? '1px solid rgba(0,184,148,0.45)' : '1px solid #282828' }}>
        <div className="flex items-center gap-2 mb-2.5">
          <p className="text-[13px] font-semibold text-white truncate">{rep.name}</p>
          {streak > 1 && (
            <span className="flex items-center gap-0.5 text-[10px] font-bold text-amber-300 whitespace-nowrap"
              title={`${streak} straight weeks hitting the estimate goal`}>
              <Flame size={11} /> {streak}
            </span>
          )}
          {noGoals && !editing && (
            <span className="text-[10px] font-semibold text-amber-400/80 whitespace-nowrap">· no goals set</span>
          )}
          {editable && (
            <button onClick={() => setEditing(e => !e)}
              title={editing ? 'Done editing' : 'Edit goals'}
              className={`ml-auto p-1.5 rounded-lg transition-colors ${editing ? 'text-teal bg-teal/10' : 'text-white/25 hover:text-teal hover:bg-teal/10'}`}>
              {editing ? <Check size={13} /> : <Pencil size={12} />}
            </button>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-x-7 gap-y-3">
          {block('Week', periods.week, wProd, wGoal, wEl, 'week')}
          <div className="hidden sm:block w-px self-stretch" style={{ background: '#2a2a2a' }} />
          {block('Month', periods.month, mProd, mGoal, mEl, 'month')}
        </div>
        {sug && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3 rounded-lg px-3 py-2 text-[11px]"
            style={{ background: 'rgba(0,184,148,0.06)', border: '1px solid rgba(0,184,148,0.22)' }}>
            <span className="text-white/50">
              {fmt(Number(mGoal.revenue_target))}/mo ≈ <b className="text-white/80">{sug.month.deals} deals · {sug.month.est} est</b>
              <span className="text-white/30"> ({Math.round(sug.closeRate * 100)}% close · {fmt(sug.avgDeal)} avg)</span>
              {' '}→ <b className="text-white/80">{sug.week.est} est / wk</b>
            </span>
            <button onClick={() => applySuggestion(rep, sug, mGoal)}
              className="ml-auto px-2.5 py-1 rounded-lg text-[11px] font-bold text-dark bg-teal hover:opacity-90 whitespace-nowrap">
              Use as targets
            </button>
          </div>
        )}
      </div>
    )
  }

  // Team rollups: summed goals vs summed production for the month.
  function teamRollup(rows) {
    let rev = 0, revGoal = 0, dealsN = 0, dealsGoal = 0
    for (const rep of rows) {
      const g = resolveGoal(goals, rep.id, 'month', periods.month.start)
      const p = repProduction(deals, weeklyStats, rep.id, periods.month)
      rev += p.revenue; dealsN += p.deals
      if (g?.revenue_target > 0) revGoal += Number(g.revenue_target)
      if (g?.deals_target > 0) dealsGoal += Number(g.deals_target)
    }
    return { rev, revGoal, dealsN, dealsGoal }
  }

  if (loading) return <div className="p-8 text-white/40 text-sm">Loading…</div>

  return (
    <div className="space-y-4 pb-8">
      <div>
        <h1 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
          <Target size={18} className="text-teal" /> Goals
        </h1>
        <p className="text-[12px] text-white/40 mt-0.5">
          Weekly + monthly commitments per rep — estimate goals are self-gen; leads ran count toward overall production.
          Goals carry forward until changed. Reps edit their own; managers edit their team's.
        </p>
      </div>

      {teams.map(t => {
        const r = teamRollup(t.rows)
        return (
          <div key={t.key}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: t.color }} />
                <span className="text-[13px] font-bold text-white">{t.name}</span>
              </span>
              <span className="text-[11px] text-white/35 num">
                {periods.month.sub}: {fmt(r.rev)}{r.revGoal > 0 ? ` / ${fmt(r.revGoal)} goal` : ''} · {r.dealsN}{r.dealsGoal > 0 ? `/${r.dealsGoal}` : ''} deals
              </span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {t.rows.map(rep => <RepCard key={rep.id} rep={rep} />)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
