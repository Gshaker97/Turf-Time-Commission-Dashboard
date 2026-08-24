// ============================================================
// Personal goals engine — weekly + monthly commitments per rep, tracked
// against real production. Pure functions shared by the Goals page and the
// Home card mirror.
//
// Conventions (match the rest of the site):
//   • Estimate goals are SELF-GEN only (leads ran display alongside, ungoaled)
//   • Deals + revenue are owner-credited (setter, closer fallback); lead
//     closes/revenue display as supplemental production
//   • Weeks are Sun–Sat; months are calendar months
//   • A period with no saved goal INHERITS the most recent earlier goal of
//     the same period type ("carried") — a new week never starts blank
// ============================================================
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { isCanceled } from './commission'
import { saleOwnerId } from './team'
import { weekStartOf } from './dateRanges'
import { estimatesFor } from './estimates'

const f = (d) => format(d, 'yyyy-MM-dd')

// Current week + month period descriptors.
export function currentPeriods(todayISO) {
  const d = new Date(todayISO + 'T12:00:00')
  return {
    week: {
      period: 'week', start: f(startOfWeek(d, { weekStartsOn: 0 })), end: f(endOfWeek(d, { weekStartsOn: 0 })),
      label: 'This Week', sub: `${format(startOfWeek(d, { weekStartsOn: 0 }), 'MMM d')} – ${format(endOfWeek(d, { weekStartsOn: 0 }), 'MMM d')}`,
    },
    month: {
      period: 'month', start: f(startOfMonth(d)), end: f(endOfMonth(d)),
      label: 'This Month', sub: format(d, 'MMMM yyyy'),
    },
  }
}

// The goal row governing a period: exact match, else the most recent EARLIER
// row of the same period type (carried forward). rows = all personal_goals.
export function resolveGoal(rows, repId, period, periodStart) {
  let exact = null, carried = null
  for (const g of rows) {
    if (g.rep_id !== repId || g.period !== period) continue
    const ps = String(g.period_start).slice(0, 10)
    if (ps === periodStart) exact = g
    else if (ps < periodStart && (!carried || ps > String(carried.period_start).slice(0, 10))) carried = g
  }
  if (exact) return { ...exact, carried: false }
  if (carried) return { ...carried, period_start: periodStart, carried: true }
  return null
}

const hasTargets = (g) => g && (g.est_target != null || g.deals_target != null || g.revenue_target != null)
export const goalIsSet = hasTargets

// A rep's production inside [start, end]: owner-credited deals/revenue,
// self-gen estimates + leads ran from weekly_stats, lead closes/revenue.
// opts.leads + opts.estimatesFrom hand estimate counting to the CRM feed on
// and after the cutover date (see utils/estimates.js); earlier weeks keep
// their hand-entered numbers so history stays intact.
export function repProduction(deals, weeklyStats, repId, { start, end }, opts = {}) {
  let revenue = 0, dealsN = 0, leadsClosed = 0, leadRevenue = 0
  for (const d of deals) {
    if (!d.sale_date || d.sale_date < start || d.sale_date > end || isCanceled(d)) continue
    const v = Number(d.baseline_revenue) || 0
    if (saleOwnerId(d) === repId) { revenue += v; dealsN += 1 }
    if (d.closer_id === repId && d.setter_id && d.setter_id !== d.closer_id) { leadsClosed += 1; leadRevenue += v }
  }
  const { sgEst, leadEst } = estimatesFor({
    leads: opts.leads || [], weeklyStats, repId, start, end, from: opts.estimatesFrom || null,
  })
  return { revenue, deals: dealsN, leadsClosed, leadRevenue, sgEst, leadsRan: leadEst }
}

// Fraction of the period elapsed (0..1) — drives the pace marker.
export function periodElapsed({ start, end }, todayISO) {
  if (todayISO >= end) return 1
  if (todayISO < start) return 0
  const ms = (a, b) => new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')
  return (ms(start, todayISO) + 86400000) / (ms(start, end) + 86400000)
}

// value-vs-goal with pace: status 'done' | 'ahead' | 'behind' | null (no goal).
export function metricProgress(value, target, elapsed) {
  if (!(target > 0)) return null
  const frac = value / target
  const paceNeeded = target * elapsed
  return {
    target, value, frac: Math.min(frac, 1),
    status: frac >= 1 ? 'done' : value >= paceNeeded - 1e-9 ? 'ahead' : 'behind',
    gap: Math.max(0, Math.ceil((paceNeeded - value) * 100) / 100),
  }
}

// Goal math: suggest weekly + monthly activity from a monthly revenue target,
// using the rep's own trailing 3 FULL months (fallbacks when history is thin).
export function suggestFromRevenue(deals, weeklyStats, repId, monthlyRevenue, todayISO, opts = {}) {
  if (!(monthlyRevenue > 0)) return null
  const now = new Date(todayISO + 'T12:00:00')
  const start = f(startOfMonth(subMonths(now, 3)))
  const end = f(endOfMonth(subMonths(now, 1)))
  const p = repProduction(deals, weeklyStats, repId, { start, end }, opts)
  const avgDeal = p.deals > 0 ? p.revenue / p.deals : 6000
  const closeRate = p.sgEst > 0 && p.deals > 0 ? Math.min(p.deals / p.sgEst, 1) : 0.35
  const dealsMo = Math.max(1, Math.ceil(monthlyRevenue / avgDeal))
  const estMo = Math.max(dealsMo, Math.ceil(dealsMo / closeRate))
  return {
    avgDeal, closeRate,
    month: { deals: dealsMo, est: estMo },
    week: { deals: Math.max(1, Math.ceil(dealsMo / 4.33)), est: Math.max(1, Math.ceil(estMo / 4.33)), revenue: Math.ceil(monthlyRevenue / 4.33) },
  }
}

// Consecutive completed weeks (ending last week) where the rep hit their
// self-gen estimate goal. Weeks with no goal in force break the streak.
export function estimateStreak(rows, deals, weeklyStats, repId, todayISO, maxWeeks = 26, opts = {}) {
  let streak = 0
  let ws = weekStartOf(todayISO)
  for (let i = 0; i < maxWeeks; i++) {
    const d = new Date(ws + 'T12:00:00'); d.setDate(d.getDate() - 7)
    ws = f(d)
    const g = resolveGoal(rows, repId, 'week', ws)
    if (!g || !(g.est_target > 0)) break
    const end = f(endOfWeek(new Date(ws + 'T12:00:00'), { weekStartsOn: 0 }))
    const p = repProduction(deals, weeklyStats, repId, { start: ws, end }, opts)
    if (p.sgEst >= g.est_target) streak += 1
    else break
  }
  return streak
}
