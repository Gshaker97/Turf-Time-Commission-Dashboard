import { useEffect, useMemo, useRef, useState, Fragment, createContext, useContext } from 'react'
import { format } from 'date-fns'
import { Target, Flame, ChevronDown } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchDeals, fetchUsers, fetchWeeklyStats, fetchPersonalGoals, fetchLeads, upsertPersonalGoal, saveRepGoal } from '../lib/db'
import { useSettings } from '../contexts/SettingsContext'
import { fmt } from '../utils/commission'
import { headIdSet, teamKeyFor, teamLabel } from '../utils/team'
import {
  currentPeriods, resolveGoal, goalIsSet, repProduction, periodElapsed,
  metricProgress, suggestFromRevenue, estimateStreak,
} from '../utils/goals'
import { toast } from '../lib/toast'
import { Card, LoadingBlock, PrimaryButton } from '../components/ui'

const todayISO = () => format(new Date(), 'yyyy-MM-dd')
// Phones render RepRow as a card; the desktop table leaves this false.
const PhoneMode = createContext(false)

// Team dots on the palette (no gold — gold is for a met goal's bar).
const PALETTE = ['#ede7da', '#a19e97', '#a9c4b2', '#d2a074', '#d98c80', '#8c8a84']
// Pace: a MET goal fills gold; on pace is sage; behind is amber.
const STATUS_COLOR = { done: '#bfa46c', ahead: '#a9c4b2', behind: '#d2a074' }

// One metric: "value / goal" over a slim bar colored by pace. Clicking the
// goal number (when you can edit this rep) turns it into an input in place —
// blur/Enter saves, Escape cancels. MetricBody is the shared content; the
// desktop table wraps it in a <td>, the phone card in a labelled block.
function MetricBody({ value, prog, editable, isEditing, onStartEdit, onDoneEdit, inputValue, onSave, money, inputKey }) {
  const skipRef = useRef(false)
  const color = prog ? STATUS_COLOR[prog.status] : 'var(--line)'
  const goalText = inputValue != null ? (money ? fmt(inputValue) : String(inputValue)) : null
  return (
    <>
      <div className="text-[13px] leading-none whitespace-nowrap flex items-center">
        <span className="font-bold text-bank-tx tabular-nums">{money ? fmt(value) : value}</span>
        {isEditing ? (
          <>
            <span className="text-bank-fa"> / </span>
            <input autoFocus type="number" min="0" step={money ? 'any' : 1} key={inputKey} aria-label="Goal"
              defaultValue={inputValue ?? ''} placeholder="—"
              onFocus={e => e.target.select()}
              onBlur={e => { if (skipRef.current) { skipRef.current = false; onDoneEdit(); return } onSave(e.target.value) }}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') { skipRef.current = true; e.currentTarget.blur() }
              }}
              className="w-[72px] rounded px-1 py-0.5 min-h-[44px] lg:min-h-0 text-[13px] font-semibold text-bank-gold-tx text-right focus:outline-none"
              style={{ background: 'var(--bg)', border: '1px solid rgba(191,164,108,0.5)' }} />
          </>
        ) : editable ? (
          <button onClick={onStartEdit} title="Click to type this goal"
            className="text-bank-mu hover:text-bank-gold-tx rounded px-1 -mx-0.5 min-h-[44px] lg:min-h-0 lg:py-0.5 hover:bg-bank-raise transition-colors">
            / {goalText ?? <span className="underline decoration-dotted decoration-bank-fa">set</span>}
          </button>
        ) : (
          <span className="text-bank-mu"> / {goalText ?? '—'}</span>
        )}
      </div>
      <div className="h-[4px] rounded-full overflow-hidden mt-1.5 max-w-[140px]" style={{ background: 'var(--raise)' }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(prog?.frac ?? 0) * 100}%`, background: color }} />
      </div>
    </>
  )
}
const metricTitle = (prog, editable, money) => !prog ? (editable ? 'Click to set a goal' : 'No goal set')
  : prog.status === 'done' ? 'Goal hit'
  : prog.status === 'ahead' ? 'On pace'
  : `Behind pace by ${money ? fmt(prog.gap) : Math.ceil(prog.gap)}`
function MetricCell(props) {
  return <td className="px-2.5 py-2.5 align-middle" title={metricTitle(props.prog, props.editable, props.money)}><MetricBody {...props} /></td>
}
function MetricField({ label, ...props }) {
  return (
    <div title={metricTitle(props.prog, props.editable, props.money)}>
      <p className="text-[13px] text-bank-fa mb-1">{label}</p>
      <MetricBody {...props} />
    </div>
  )
}

export default function Goals() {
  const { profile, isAdmin } = useAuth()
  const { estimatesFrom } = useSettings()
  const [leads, setLeads] = useState([])
  const [deals, setDeals] = useState([])
  const [users, setUsers] = useState([])
  const [weeklyStats, setWeeklyStats] = useState([])
  const [goals, setGoals] = useState([])
  const [loading, setLoading] = useState(true)
  const [editCell, setEditCell] = useState(null)   // "repId|period|field" being typed
  const [openRep, setOpenRep] = useState(null)     // phone: which rep's card is open

  useEffect(() => {
    Promise.all([fetchDeals(), fetchUsers(), fetchWeeklyStats(), fetchPersonalGoals(), fetchLeads()])
      .then(([d, u, ws, g, l]) => {
        setDeals(d.data ?? []); setUsers(u.data ?? []); setWeeklyStats(ws.data ?? []); setGoals(g.data ?? []); setLeads(l.data ?? [])
      })
      .finally(() => setLoading(false))
  }, [])

  const today = todayISO()
  const periods = useMemo(() => currentPeriods(today), [today])
  const headsSet = useMemo(() => headIdSet(users), [users])
  const estOpts = useMemo(() => ({ leads, estimatesFrom }), [leads, estimatesFrom])

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
        name: tk === 'unassigned' ? 'No Team' : lead ? teamLabel(lead) : 'Former Team',
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

  // Team rollup for the header row: month production vs summed month goals.
  function teamRollup(rows) {
    let rev = 0, revGoal = 0, dealsN = 0, dealsGoal = 0
    for (const rep of rows) {
      const g = resolveGoal(goals, rep.id, 'month', periods.month.start)
      const p = repProduction(deals, weeklyStats, rep.id, periods.month, estOpts)
      rev += p.revenue; dealsN += p.deals
      if (g?.revenue_target > 0) revGoal += Number(g.revenue_target)
      if (g?.deals_target > 0) dealsGoal += Number(g.deals_target)
    }
    return { rev, revGoal, dealsN, dealsGoal }
  }

  function RepRow({ rep }) {
    // mode 'table' renders the desktop <tr>s; 'card' the phone row (name ·
    // month revenue) that opens to all six metrics. Same data, editors, saves.
    const mode = useContext(PhoneMode) ? 'card' : 'table'
    const editable = canEditRep(rep)
    const wGoal = resolveGoal(goals, rep.id, 'week', periods.week.start)
    const mGoal = resolveGoal(goals, rep.id, 'month', periods.month.start)
    const wProd = repProduction(deals, weeklyStats, rep.id, periods.week, estOpts)
    const mProd = repProduction(deals, weeklyStats, rep.id, periods.month, estOpts)
    const wEl = periodElapsed(periods.week, today)
    const mEl = periodElapsed(periods.month, today)
    const streak = estimateStreak(goals, deals, weeklyStats, rep.id, today, 26, estOpts)
    const noGoals = !goalIsSet(wGoal) && !goalIsSet(mGoal)
    // The goal-math helper shows while a monthly revenue goal exists but the
    // activity targets that should follow from it are still blank.
    const sug = editable && mGoal?.revenue_target > 0 && (mGoal.est_target == null || mGoal.deals_target == null)
      ? suggestFromRevenue(deals, weeklyStats, rep.id, Number(mGoal.revenue_target), today, estOpts) : null

    const metricProps = (goal, prod, elapsed, periodKey) =>
      [['est_target', prod.sgEst, false, 'SG Est'], ['deals_target', prod.deals, false, 'Deals'], ['revenue_target', prod.revenue, true, 'Revenue']].map(([field, value, money, label]) => {
        const cellId = `${rep.id}|${periodKey}|${field}`
        return {
          key: cellId, label, value, money,
          prog: metricProgress(value, goal?.[field], elapsed),
          editable, isEditing: editCell === cellId,
          onStartEdit: () => setEditCell(cellId),
          onDoneEdit: () => setEditCell(null),
          inputValue: goal?.[field],
          inputKey: `${cellId}-${goal?.[field] ?? ''}`,
          onSave: (v) => { setEditCell(null); saveGoalField(rep, periodKey, field, v) },
        }
      })
    const weekCells = metricProps(wGoal, wProd, wEl, 'week')
    const monthCells = metricProps(mGoal, mProd, mEl, 'month')

    const nameBlock = (
      <>
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-semibold text-bank-tx whitespace-nowrap">{rep.name}</span>
          {streak > 1 && (
            <span className="flex items-center text-[13px] font-bold whitespace-nowrap" style={{ color: 'var(--warn)' }}
              title={`${streak} straight weeks hitting the estimate goal`}>
              <Flame size={11} />{streak}
            </span>
          )}
        </div>
        <p className="text-[13px] text-bank-fa mt-0.5 whitespace-nowrap">
          {noGoals ? <span className="font-semibold" style={{ color: 'var(--warn)' }}>no goals set</span>
            : <>Leads: {mProd.leadsRan} ran · {mProd.leadsClosed} closed</>}
        </p>
      </>
    )
    const suggestion = sug && (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <span className="text-bank-mu">
          {fmt(Number(mGoal.revenue_target))}/mo ≈ <b className="text-bank-tx">{sug.month.deals} deals · {sug.month.est} est</b>
          <span className="text-bank-fa"> ({Math.round(sug.closeRate * 100)}% close · {fmt(sug.avgDeal)} avg)</span>
          {' '}→ <b className="text-bank-tx">{sug.week.est} est / wk</b>
        </span>
        <PrimaryButton onClick={() => applySuggestion(rep, sug, mGoal)} className="px-3 py-1.5 whitespace-nowrap">Use as targets</PrimaryButton>
      </div>
    )

    if (mode === 'card') {
      const isOpen = openRep === rep.id
      const monthRev = monthCells[2]
      return (
        <div className="border-t border-bank-line">
          <button onClick={() => setOpenRep(isOpen ? null : rep.id)} aria-expanded={isOpen}
            className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] text-left hover:bg-bank-raise transition-colors">
            <div className="min-w-0 flex-1">{nameBlock}</div>
            <div className="text-right flex-shrink-0">
              <p className="text-[12px] text-bank-fa uppercase">Month revenue</p>
              <p className="text-[13px] font-bold text-bank-tx tabular-nums">{fmt(monthRev.value)}<span className="text-bank-mu font-normal"> / {monthRev.inputValue != null ? fmt(monthRev.inputValue) : '—'}</span></p>
            </div>
            <ChevronDown size={16} className={`text-bank-fa flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
          {isOpen && (
            <div className="px-4 pb-4 space-y-4" style={{ background: 'var(--bg)' }}>
              <div className="pt-3">
                <p className="text-[13px] font-semibold text-bank-mu uppercase tracking-wide mb-2">This Week <span className="text-bank-fa normal-case tracking-normal font-normal">{periods.week.sub}</span></p>
                <div className="grid grid-cols-3 gap-3">{weekCells.map(({ key, ...c }) => <MetricField key={key} {...c} />)}</div>
              </div>
              <div>
                <p className="text-[13px] font-semibold text-bank-mu uppercase tracking-wide mb-2">This Month <span className="text-bank-fa normal-case tracking-normal font-normal">{periods.month.sub}</span></p>
                <div className="grid grid-cols-3 gap-3">{monthCells.map(({ key, ...c }) => <MetricField key={key} {...c} />)}</div>
              </div>
              {suggestion}
            </div>
          )}
        </div>
      )
    }

    return (
      <Fragment>
        <tr className="border-t border-bank-line">
          <td className="px-3 py-2.5 align-middle">{nameBlock}</td>
          {weekCells.map(({ key, ...c }) => <MetricCell key={key} {...c} />)}
          {monthCells.map(({ key, ...c }) => <MetricCell key={key} {...c} />)}
        </tr>
        {sug && (
          <tr style={{ background: 'rgba(191,164,108,0.06)' }}>
            <td colSpan={7} className="px-3 pb-2.5 pt-1">{suggestion}</td>
          </tr>
        )}
      </Fragment>
    )
  }

  if (loading) return <LoadingBlock text="Loading goals…" />

  const th = 'px-2.5 pb-2 text-left text-[13px] font-semibold uppercase tracking-wide text-bank-fa'
  const teamHead = (t, r) => (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: t.color }} />
        <span className="text-[13px] font-bold text-bank-tx">{t.name}</span>
      </span>
      <span className="text-[13px] text-bank-mu">
        {fmt(r.rev)}{r.revGoal > 0 ? ` / ${fmt(r.revGoal)}` : ''} · {r.dealsN}{r.dealsGoal > 0 ? `/${r.dealsGoal}` : ''} deals this month
      </span>
    </div>
  )

  return (
    <div className="space-y-4 pb-8 max-w-[1400px] mx-auto" style={{ color: 'var(--tx)' }}>
      <div>
        <h1 className="text-lg md:text-xl font-bold text-bank-tx flex items-center gap-2">
          <Target size={18} className="text-bank-mu" /> Goals
        </h1>
        <p className="text-[13px] text-bank-mu mt-0.5">
          Weekly + monthly commitments per rep — click any goal number to type it. Estimate goals are self-gen;
          leads count toward overall production. Goals carry forward until changed. Reps edit their own; managers edit their team's.
        </p>
      </div>

      <Card padded={false}>
        {/* Desktop table */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full min-w-[920px]">
            <thead>
              <tr>
                <th className={`${th} px-3 pt-3`} rowSpan={2} style={{ verticalAlign: 'bottom' }}>Rep</th>
                <th className="px-2.5 pt-3 pb-1 text-left" colSpan={3}>
                  <span className="text-[13px] font-bold uppercase tracking-wide text-bank-mu">This Week</span>
                  <span className="text-[13px] text-bank-fa ml-2 normal-case tracking-normal font-normal">{periods.week.sub}</span>
                </th>
                <th className="px-2.5 pt-3 pb-1 text-left border-l border-bank-line" colSpan={3}>
                  <span className="text-[13px] font-bold uppercase tracking-wide text-bank-mu">This Month</span>
                  <span className="text-[13px] text-bank-fa ml-2 normal-case tracking-normal font-normal">{periods.month.sub}</span>
                </th>
              </tr>
              <tr>
                <th className={th}>SG Est</th>
                <th className={th}>Deals</th>
                <th className={th}>Revenue</th>
                <th className={`${th} border-l border-bank-line`}>SG Est</th>
                <th className={th}>Deals</th>
                <th className={th}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {teams.map(t => {
                const r = teamRollup(t.rows)
                return (
                  <Fragment key={t.key}>
                    <tr className="border-t border-bank-line" style={{ background: 'var(--raise)' }}>
                      <td colSpan={7} className="px-3 py-2">{teamHead(t, r)}</td>
                    </tr>
                    {t.rows.map(rep => <RepRow key={rep.id} rep={rep} />)}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        {/* Phones: team header + compact rep rows that open to all six metrics */}
        <div className="lg:hidden">
          {teams.map(t => {
            const r = teamRollup(t.rows)
            return (
              <div key={t.key}>
                <div className="px-4 py-2.5 border-t border-bank-line first:border-0" style={{ background: 'var(--raise)' }}>{teamHead(t, r)}</div>
                <PhoneMode.Provider value={true}>{t.rows.map(rep => <RepRow key={rep.id} rep={rep} />)}</PhoneMode.Provider>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
