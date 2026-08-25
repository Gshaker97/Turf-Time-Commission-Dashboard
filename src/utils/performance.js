// Performance-page engine: time-grain bucketing, scoped metric aggregation,
// and target resolution. Pure functions — the page feeds in deals (INCLUDING
// canceled — cancel rate needs them), weekly_stats rows, the roster, and the
// team_changes infrastructure from utils/team.js so attribution here always
// matches the Dashboard (saleOwnerId owner credit + date-effective teams).
import {
  format, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter, startOfYear, endOfYear,
  subWeeks, subMonths, subQuarters, subYears, addDays, addMonths,
} from 'date-fns'
import { dealAmounts, isCanceled } from './commission'
import { saleOwnerId, teamOfSale } from './team'
import { RAN_STATUSES, apptDay } from './estimates'

const WEEK = { weekStartsOn: 0 }   // Sun–Sat, same as all reporting
const f = (d) => format(d, 'yyyy-MM-dd')

export const GRAINS = [
  { key: 'week',    label: 'Weekly',    count: 12 },
  { key: 'month',   label: 'Monthly',   count: 12 },
  { key: 'quarter', label: 'Quarterly', count: 8 },
  { key: 'year',    label: 'Annual',    count: 3 },
]

// How many of grain A fit in grain B — used to scale count/$ targets across
// grains (weekly revenue target ×13 draws the quarterly goal line). Percent
// metrics (close/cancel/markup) never scale — a rate is a rate at any grain.
const WEEKS_PER = { week: 1, month: 52 / 12, quarter: 13, year: 52 }
export const PERCENT_METRICS = new Set(['close_rate', 'cancel_rate', 'markup_pct'])

export const METRICS = [
  { key: 'revenue',     label: 'Revenue',     fmt: 'money'   },
  { key: 'deals',       label: 'Deals',       fmt: 'count'   },
  { key: 'estimates',   label: 'Estimates',   fmt: 'count'   },
  { key: 'close_rate',  label: 'Close Rate',  fmt: 'percent' },
  { key: 'cancel_rate', label: 'Cancel Rate', fmt: 'percent' },
  { key: 'markup_pct',  label: 'Markup %',    fmt: 'percent' },
]

// ── Periods ───────────────────────────────────────────────────

// The last `count` periods of a grain, oldest → newest, ending with the period
// containing `now`. Each: { key, label, from, to } (from/to = ISO dates).
export function periodsFor(grain, count, now = new Date()) {
  const out = []
  for (let i = count - 1; i >= 0; i--) {
    let s, e, key, label
    if (grain === 'week') {
      const d = subWeeks(now, i)
      s = startOfWeek(d, WEEK); e = endOfWeek(d, WEEK)
      key = f(s); label = format(s, 'MMM d')
    } else if (grain === 'month') {
      const d = subMonths(now, i)
      s = startOfMonth(d); e = endOfMonth(d)
      key = format(s, 'yyyy-MM'); label = format(s, 'MMM yy')
    } else if (grain === 'quarter') {
      const d = subQuarters(now, i)
      s = startOfQuarter(d); e = endOfQuarter(d)
      key = `${format(s, 'yyyy')}-Q${Math.floor(s.getMonth() / 3) + 1}`
      label = `Q${Math.floor(s.getMonth() / 3) + 1} ${format(s, 'yy')}`
    } else {
      const d = subYears(now, i)
      s = startOfYear(d); e = endOfYear(d)
      key = format(s, 'yyyy'); label = key
    }
    out.push({ key, label, from: f(s), to: f(e) })
  }
  return out
}

// What a zoomed-in period breaks down into: a week shows days, a month shows
// weeks, a quarter/year shows months.
export const SUB_GRAIN = { week: 'day', month: 'week', quarter: 'month', year: 'month' }

// Sub-periods covering [fromISO, toISO], CLAMPED to the range so partial edge
// weeks/months never pull in neighboring days — the zoomed view always sums
// exactly to the parent period. grain: 'day' | 'week' | 'month'.
export function periodsInRange(grain, fromISO, toISO) {
  const out = []
  const from = new Date(fromISO + 'T12:00:00')
  if (grain === 'day') {
    for (let d = from; f(d) <= toISO; d = addDays(d, 1))
      out.push({ key: f(d), label: format(d, 'EEE d'), from: f(d), to: f(d) })
    return out
  }
  let ptr = grain === 'week' ? startOfWeek(from, WEEK) : startOfMonth(from)
  while (f(ptr) <= toISO) {
    const end = grain === 'week' ? f(endOfWeek(ptr, WEEK)) : f(endOfMonth(ptr))
    const s = f(ptr) < fromISO ? fromISO : f(ptr)
    const e = end > toISO ? toISO : end
    out.push({
      key: s,
      label: grain === 'week' ? format(new Date(s + 'T12:00:00'), 'MMM d') : format(ptr, 'MMM yy'),
      from: s, to: e,
    })
    ptr = grain === 'week' ? addDays(ptr, 7) : addMonths(ptr, 1)
  }
  return out
}

// Human label for a zoomed period ("June 2026", "Week of Jul 27", "Q3 2026").
export function zoomLabel(grain, fromISO) {
  const d = new Date(fromISO + 'T12:00:00')
  if (grain === 'week')    return `Week of ${format(startOfWeek(d, WEEK), 'MMM d, yyyy')}`
  if (grain === 'month')   return format(d, 'MMMM yyyy')
  if (grain === 'quarter') return `Q${Math.floor(d.getMonth() / 3) + 1} ${format(d, 'yyyy')}`
  return format(d, 'yyyy')
}

// While a period is still IN PROGRESS, vs-previous comparisons should be
// pace-based — against the SAME elapsed point of the previous period ("Aug
// 1–2 vs Jul 1–2"), not the previous period's whole run. Returns prevP
// clamped to the current period's elapsed length; unchanged once the current
// period is complete, so finished periods still compare full-to-full.
export function pacePrevPeriod(prevP, curP, todayISO = format(new Date(), 'yyyy-MM-dd')) {
  if (!prevP || !curP || curP.to < todayISO) return prevP
  const elapsed = Math.max(0, Math.round(
    (new Date(todayISO + 'T12:00:00') - new Date(curP.from + 'T12:00:00')) / 86400000))
  const pTo = f(addDays(new Date(prevP.from + 'T12:00:00'), elapsed))
  return pTo < prevP.to ? { ...prevP, to: pTo } : prevP
}

// ── Scope filters ─────────────────────────────────────────────
// scope = { type: 'org' } | { type: 'team', id } | { type: 'office', name }
//       | { type: 'rep', id }

export function dealInScope(d, scope, teamCtx) {
  if (!scope || scope.type === 'org') return true
  if (scope.type === 'office') return (d.office || '').toLowerCase() === scope.name
  const owner = saleOwnerId(d)
  if (scope.type === 'rep') return owner === scope.id
  const { usersById, heads, changesByProfile } = teamCtx
  return teamOfSale(owner, d.sale_date, usersById, heads, changesByProfile) === scope.id
}

// Weekly-stats rows carry no office, so estimates (and close rate) are
// unavailable at office scope — callers should show "—" there.
export function statInScope(s, scope, teamCtx) {
  if (!scope || scope.type === 'org') return true
  if (scope.type === 'office') return false
  if (scope.type === 'rep') return s.rep_id === scope.id
  const { usersById, heads, changesByProfile } = teamCtx
  return teamOfSale(s.rep_id, s.week_start, usersById, heads, changesByProfile) === scope.id
}

export const scopeHasEstimates = (scope) => !scope || scope.type !== 'office'

// ── Aggregation ───────────────────────────────────────────────

// The "Estimates" metric counts SELF-GEN estimates only (per Keaton) — leads
// ran are tracked separately in the Rep Breakdown and never inflate the
// estimate totals. Legacy unsplit weeks fall back to their combined number.
const estOf = (s) => {
  const sg = Number(s.self_gen_estimates) || 0
  const ld = Number(s.lead_estimates) || 0
  if (sg || ld) return sg
  return Number(s.estimates) || 0
}

function newBucket() {
  return { revenue: 0, job: 0, deals: 0, canceled: 0, estimates: 0 }
}

// Derived rates computed once at the end so partial sums never leak out.
function finishBucket(b, hasEstimates) {
  const total = b.deals + b.canceled
  return {
    ...b,
    close_rate:  hasEstimates && b.estimates > 0 ? (b.deals / b.estimates) * 100 : null,
    cancel_rate: total > 0 ? (b.canceled / total) * 100 : null,
    markup_pct:  b.revenue > 0 ? ((b.job - b.revenue) / b.revenue) * 100 : null,
    estimates:   hasEstimates ? b.estimates : null,
  }
}

// One pass over deals + stats → { [periodKey]: finishedBucket } for a scope.
// Deals bucket by sale_date; stats by week_start. Revenue/deals/markup come
// from non-canceled deals only (house rule); cancel rate uses all of them.
//
// opts.leads + opts.estimatesFrom switch the ESTIMATE source over to the CRM
// feed on/after the cutover date (see utils/estimates.js) — appointments that
// ran replace hand-entered weekly counts, while earlier periods keep theirs.
export function bucketize(deals, weeklyStats, periods, scope, teamCtx, opts = {}) {
  const byKey = {}
  for (const p of periods) byKey[p.key] = newBucket()
  const lookup = (dateISO) => {
    if (!dateISO) return null
    for (const p of periods) if (dateISO >= p.from && dateISO <= p.to) return p.key
    return null
  }
  for (const d of deals) {
    const k = lookup(d.sale_date)
    if (!k || !dealInScope(d, scope, teamCtx)) continue
    const b = byKey[k]
    if (isCanceled(d)) { b.canceled += 1; continue }
    const a = dealAmounts(d)
    b.revenue += a.baseline
    b.job     += a.job
    b.deals   += 1
  }
  const hasEst = scopeHasEstimates(scope)
  if (hasEst) {
    const from = opts.estimatesFrom || null
    // Manual weekly entries — only for weeks the feed doesn't own yet.
    for (const s of weeklyStats) {
      const k = lookup(s.week_start)
      if (!k || !statInScope(s, scope, teamCtx)) continue
      if (from && String(s.week_start) >= String(from)) continue
      byKey[k].estimates += estOf(s)
    }
    // CRM feed — an appointment that RAN is an estimate, credited to whoever
    // ran it. Self-gen only, matching the metric's definition everywhere.
    if (from) {
      for (const l of opts.leads || []) {
        const day = apptDay(l.appointment_at)
        if (!day || day < from) continue
        if (!RAN_STATUSES.has(l.status)) continue
        const ranBy = l.closer_id || l.setter_id
        if (!ranBy || (l.setter_id && l.setter_id !== ranBy)) continue   // lead, not self-gen
        const k = lookup(day)
        if (!k) continue
        if (!statInScope({ rep_id: ranBy, week_start: day }, scope, teamCtx)) continue
        byKey[k].estimates += 1
      }
    }
  }
  const out = {}
  for (const p of periods) out[p.key] = finishBucket(byKey[p.key], hasEst)
  return out
}

// ── Target resolution ─────────────────────────────────────────

// Latest target row effective on/before periodStart, preferring the exact
// grain; count/$ targets stored at another grain scale via weeks-per-grain.
// Returns a number or null. `subject` must already be normalized (office
// lowercased, ids as-is).
export function resolveTarget(targets, { scopeType, subject, metric, grain, periodStart }) {
  const mine = (targets || []).filter(t =>
    t.scope === scopeType && t.metric === metric &&
    ((t.subject ?? null) === (subject ?? null)) &&
    String(t.effective) <= periodStart
  )
  if (!mine.length) return null
  const pick = (rows) => rows.reduce((best, t) =>
    !best || String(t.effective) > String(best.effective) ? t : best, null)
  const exact = pick(mine.filter(t => t.period === grain))
  if (exact) return Number(exact.value)
  if (PERCENT_METRICS.has(metric)) {
    const any = pick(mine)
    return any ? Number(any.value) : null
  }
  // Scale a count/$ target from its stored grain to the requested one.
  // (No scaling to 'day' — a daily goal line would just be noise.)
  const any = pick(mine)
  if (!any || !WEEKS_PER[grain]) return null
  return Number(any.value) * (WEEKS_PER[grain] / WEEKS_PER[any.period])
}

// ── Formatting ────────────────────────────────────────────────

export function fmtMetric(metric, v) {
  if (v == null) return '—'
  const m = METRICS.find(x => x.key === metric)
  if (m?.fmt === 'money')   return '$' + Math.round(v).toLocaleString()
  if (m?.fmt === 'percent') return v.toFixed(1) + '%'
  return Math.round(v).toLocaleString()
}
