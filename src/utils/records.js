// ============================================================
// Record Book — all-time bests computed straight from deals (no storage).
// Canceled deals never count; rep credit follows saleOwnerId (setter, closer
// fallback) like every leaderboard; periods are calendar months, Sun–Sat
// weeks, and single days on sale_date. Records come from COMPLETED periods
// only — the current period rides alongside as a "record watch" (or an
// in-progress NEW RECORD once it passes the best). Deals before the
// data-start cutoff are excluded (pre-June-2026 data isn't atomized).
// ============================================================
import { format } from 'date-fns'
import { countsInTotals } from './commission'
import { saleOwnerId, teamOfSale, teamLabel } from './team'
import { weekStartOf } from './dateRanges'

const monthLabel = (mk) => format(new Date(mk + '-15T12:00:00'), 'MMMM yyyy')
const weekLabel  = (wk) => 'Week of ' + format(new Date(wk + 'T12:00:00'), 'MMM d, yyyy')
const dayLabel   = (dk) => format(new Date(dk + 'T12:00:00'), 'MMM d, yyyy')
export const RECORD_LABELS = { month: monthLabel, week: weekLabel, day: dayLabel }

// Last calendar day of a period key — for "recently broken" checks.
export function periodEnd(grain, key) {
  if (grain === 'day') return key
  if (grain === 'week') {
    const d = new Date(key + 'T12:00:00'); d.setDate(d.getDate() + 6)
    return format(d, 'yyyy-MM-dd')
  }
  const d = new Date(key + '-01T12:00:00')
  d.setMonth(d.getMonth() + 1); d.setDate(0)
  return format(d, 'yyyy-MM-dd')
}

// Best + runner-up over completed periods, plus the current period's running
// value. status: 'new' (current beats the best), 'watch' (within 85%), null.
function pickRecord(map, metric, curKey, labelFn) {
  let best = null, prev = null, current = null
  for (const k of Object.keys(map)) {
    const v = map[k][metric]
    if (k === curKey) { current = { key: k, value: v, label: labelFn(k) }; continue }
    if (!best || v > best.value) { prev = best; best = { key: k, value: v, label: labelFn(k) } }
    else if (!prev || v > prev.value) prev = { key: k, value: v, label: labelFn(k) }
  }
  let status = null
  if (current && current.value > 0) {
    if (!best) status = 'new'
    else if (current.value > best.value) status = 'new'
    else if (current.value >= best.value * 0.85) status = 'watch'
  }
  return { best, prev, current, status }
}

const bump = (map, k, v) => { const t = (map[k] ||= { revenue: 0, deals: 0 }); t.revenue += v; t.deals += 1 }

// Same as pickRecord, but for maps keyed `${entityId}|${periodKey}` (reps,
// teams): best + runner-up over COMPLETED periods, plus the current period's
// LEADER — so a banner can fire the moment somebody passes the all-time mark.
function pickEntityRecord(map, metric, curKey, labelFn, nameOf) {
  let best = null, prev = null, current = null
  for (const k of Object.keys(map)) {
    const i = k.indexOf('|')
    const id = k.slice(0, i), pk = k.slice(i + 1)
    const v = map[k][metric]
    if (!(v > 0)) continue
    const row = { id, key: pk, value: v, label: labelFn(pk), holderName: nameOf(id) }
    if (pk === curKey) { if (!current || v > current.value) current = row; continue }
    if (!best || v > best.value) { prev = best; best = row }
    else if (!prev || v > prev.value) prev = row
  }
  let status = null
  if (current) {
    if (!best) status = 'new'
    else if (current.value > best.value) status = 'new'
    else if (current.value >= best.value * 0.85) status = 'watch'
  }
  return { best, prev, current, status }
}

// Full record book: company records (with watch/new status) + rep records.
// Ghost reps' deals still count for company; their NAMES only hold rep
// records for admins (hidden elsewhere, like every leaderboard).
// teamCtx ({ usersById, heads, changesByProfile }) enables TEAM records —
// date-effective attribution, same rule as every other team breakdown.
export function buildRecordBook(deals = [], { users = [], isAdmin = false, dataStartDate = '', todayISO, teamCtx = null }) {
  const curMonth = todayISO.slice(0, 7)
  const curWeek  = weekStartOf(todayISO)
  const ghosts = new Set(users.filter(u => u.ghost).map(u => u.id))
  const nameOf = (id) => users.find(u => u.id === id)?.name ?? '—'
  const teamNameOf = (id) => (id === 'unassigned' ? 'Unassigned' : teamLabel(users.find(u => u.id === id)))

  const cm = {}, cw = {}, cd = {}
  const rm = {}, rw = {}, rd = {}
  const tm = {}, tw = {}, td = {}
  let biggestDeal = null
  for (const d of deals) {
    if (!d.sale_date || !countsInTotals(d)) continue
    if (dataStartDate && d.sale_date < dataStartDate) continue
    const v = Number(d.baseline_revenue) || 0
    const mk = d.sale_date.slice(0, 7), wk = weekStartOf(d.sale_date), dk = d.sale_date
    bump(cm, mk, v); bump(cw, wk, v); bump(cd, dk, v)
    const o = saleOwnerId(d)
    if (o && (isAdmin || !ghosts.has(o))) {
      bump(rm, `${o}|${mk}`, v)
      bump(rw, `${o}|${wk}`, v)
      bump(rd, `${o}|${dk}`, v)
      if (v > 0 && (!biggestDeal || v > biggestDeal.value))
        biggestDeal = { value: v, holderId: o, when: dayLabel(dk) }
    }
    if (teamCtx && o) {
      const tk = teamOfSale(o, d.sale_date, teamCtx.usersById, teamCtx.heads, teamCtx.changesByProfile)
      if (tk && tk !== 'unassigned') {
        bump(tm, `${tk}|${mk}`, v)
        bump(tw, `${tk}|${wk}`, v)
        bump(td, `${tk}|${dk}`, v)
      }
    }
  }

  const company = {
    revMonth:   pickRecord(cm, 'revenue', curMonth, monthLabel),
    revWeek:    pickRecord(cw, 'revenue', curWeek,  weekLabel),
    revDay:     pickRecord(cd, 'revenue', todayISO, dayLabel),
    dealsMonth: pickRecord(cm, 'deals',   curMonth, monthLabel),
    dealsWeek:  pickRecord(cw, 'deals',   curWeek,  weekLabel),
    dealsDay:   pickRecord(cd, 'deals',   todayISO, dayLabel),
  }
  const reps = {
    revMonth:   pickEntityRecord(rm, 'revenue', curMonth, monthLabel, nameOf),
    revWeek:    pickEntityRecord(rw, 'revenue', curWeek,  weekLabel,  nameOf),
    revDay:     pickEntityRecord(rd, 'revenue', todayISO, dayLabel,   nameOf),
    dealsMonth: pickEntityRecord(rm, 'deals',   curMonth, monthLabel, nameOf),
    dealsWeek:  pickEntityRecord(rw, 'deals',   curWeek,  weekLabel,  nameOf),
    dealsDay:   pickEntityRecord(rd, 'deals',   todayISO, dayLabel,   nameOf),
    biggestDeal,
  }
  if (biggestDeal) biggestDeal.holderName = nameOf(biggestDeal.holderId)
  const teams = teamCtx ? {
    revMonth:   pickEntityRecord(tm, 'revenue', curMonth, monthLabel, teamNameOf),
    revWeek:    pickEntityRecord(tw, 'revenue', curWeek,  weekLabel,  teamNameOf),
    revDay:     pickEntityRecord(td, 'revenue', todayISO, dayLabel,   teamNameOf),
    dealsMonth: pickEntityRecord(tm, 'deals',   curMonth, monthLabel, teamNameOf),
    dealsWeek:  pickEntityRecord(tw, 'deals',   curWeek,  weekLabel,  teamNameOf),
    dealsDay:   pickEntityRecord(td, 'deals',   todayISO, dayLabel,   teamNameOf),
  } : null
  return { company, reps, teams }
}

// One rep's personal bests (owner-credited), for the Home card.
export function personalBests(deals = [], repId, { dataStartDate = '', todayISO }) {
  if (!repId) return null
  const curMonth = todayISO.slice(0, 7)
  const curWeek  = weekStartOf(todayISO)
  const months = {}, weeks = {}
  let biggestDeal = null
  for (const d of deals) {
    if (!d.sale_date || !countsInTotals(d) || saleOwnerId(d) !== repId) continue
    if (dataStartDate && d.sale_date < dataStartDate) continue
    const v = Number(d.baseline_revenue) || 0
    bump(months, d.sale_date.slice(0, 7), v)
    bump(weeks, weekStartOf(d.sale_date), v)
    if (v > 0 && (!biggestDeal || v > biggestDeal.value)) biggestDeal = { value: v, when: dayLabel(d.sale_date) }
  }
  const bestMonth = pickRecord(months, 'revenue', curMonth, monthLabel)
  const bestWeek  = pickRecord(weeks,  'revenue', curWeek,  weekLabel)
  const mostDealsMonth = pickRecord(months, 'deals', curMonth, monthLabel)
  return { bestMonth, bestWeek, mostDealsMonth, biggestDeal }
}

// ── Personal bests IN PLAY — who is having a breakout, in any timeframe ──
//
// Deliberately a DIFFERENT question from the `reps` block in
// buildRecordBook. That one is the company-wide "biggest rep month ever":
// one name holds it, and the same two or three people hold every line of it
// forever. This one measures each rep against THEIR OWN history (per Keaton:
// "highlight who's having a break out performance and on cusp of setting a
// personal record or did"), so a rep who will never top the company board
// still surfaces the period they beat themselves.
//
// PERIOD IS SELECTABLE — week | month | quarter, stepped back by `offset`
// (per Keaton: "I want to see last months results but also would want to see
// weekly, quarterly"). Five days into a month almost nobody is near their
// best, so the live view is nearly empty exactly when you want to review the
// month that just ended.
//
// THE MARK IS ALWAYS THEIR BEST **BEFORE** THE PERIOD BEING VIEWED, never
// their best overall. "Did they set a personal record in September" has to
// mean "was it their best up to then" — measuring September against an
// October that beat it would retract a record they genuinely set, and the
// list would rewrite its own history every month. For the CURRENT period the
// two rules are identical, since nothing later exists yet.
//
// ONE ROW PER REP — the stronger of revenue and deals for the chosen period.
// A rep topping both is one story, and printing both would bury everyone else.

const quarterOf = (m) => Math.floor(m / 3) + 1                   // m = 0..11
const quarterKeyOfDay = (iso) => {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)) - 1
  return `${y}-Q${quarterOf(m)}`
}
const quarterLabel = (qk) => `Q${qk.slice(-1)} ${qk.slice(0, 4)}`

// week/month/quarter keys all sort lexically, which is what lets "periods
// before this one" be a plain string comparison.
export const PB_PERIODS = {
  week:    { label: 'Week',    keyOf: (iso) => weekStartOf(iso),        labelFn: weekLabel,    noun: 'week' },
  month:   { label: 'Month',   keyOf: (iso) => iso.slice(0, 7),         labelFn: monthLabel,   noun: 'month' },
  quarter: { label: 'Quarter', keyOf: (iso) => quarterKeyOfDay(iso),    labelFn: quarterLabel, noun: 'quarter' },
}

// The key of the period `offset` steps back from today.
export function pbPeriodKey(period, todayISO, offset = 0) {
  const spec = PB_PERIODS[period] || PB_PERIODS.month
  if (!todayISO) return null
  const n = Math.max(0, Math.floor(offset) || 0)
  if (!n) return spec.keyOf(todayISO)
  const d = new Date(todayISO + 'T12:00:00')
  if (period === 'week') {
    const start = new Date(weekStartOf(todayISO) + 'T12:00:00')
    start.setDate(start.getDate() - n * 7)
    return weekStartOf(format(start, 'yyyy-MM-dd'))
  }
  if (period === 'quarter') {
    const q = quarterOf(d.getMonth()) - 1 - n            // 0-based, can go negative
    const y = d.getFullYear() + Math.floor(q / 4)
    return `${y}-Q${((q % 4) + 4) % 4 + 1}`
  }
  const m = new Date(d.getFullYear(), d.getMonth() - n, 1)
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`
}

export const pbPeriodLabel = (period, key) =>
  (key ? (PB_PERIODS[period] || PB_PERIODS.month).labelFn(key) : '')

// A live NEW record always outranks a near-miss; past that, whoever is
// further along as a share of their own mark.
const pbBetter = (a, b) =>
  (a.status === 'new') !== (b.status === 'new') ? a.status === 'new' : a.pct > b.pct

export function personalBestWatch(deals = [], {
  users = [], isAdmin = false, dataStartDate = '', todayISO, period = 'month', offset = 0,
} = {}) {
  if (!todayISO) return []
  const spec = PB_PERIODS[period] || PB_PERIODS.month
  const target = pbPeriodKey(period, todayISO, offset)
  if (!target) return []
  const byId = new Map(users.map(u => [u.id, u]))

  // One pass for the whole roster rather than calling personalBests() per
  // rep, which would re-walk every deal once per person.
  const per = new Map()
  for (const d of deals) {
    if (!d.sale_date || !countsInTotals(d)) continue
    if (dataStartDate && d.sale_date < dataStartDate) continue
    const owner = saleOwnerId(d)
    const u = owner ? byId.get(owner) : null
    if (!u) continue
    if (u.ghost && !isAdmin) continue        // same ghost rule as every other board
    if (!per.has(owner)) per.set(owner, {})
    bump(per.get(owner), spec.keyOf(d.sale_date), Number(d.baseline_revenue) || 0)
  }

  const METRICS = [
    { field: 'revenue', unit: 'money', title: `Best ${spec.noun}` },
    { field: 'deals',   unit: 'deals', title: `Most deals in a ${spec.noun}` },
  ]
  const out = []
  for (const [id, buckets] of per) {
    const cur = buckets[target]
    if (!cur) continue                        // nothing in the period being viewed
    const u = byId.get(id)
    let pick = null
    for (const m of METRICS) {
      const value = cur[m.field]
      if (!(value > 0)) continue
      // Their best among periods BEFORE this one — see the header note.
      let best = null
      for (const k of Object.keys(buckets)) {
        if (k >= target) continue
        const v = buckets[k][m.field]
        if (!best || v > best.value) best = { key: k, value: v }
      }
      // A COUNT needs a mark worth beating. Percentage thresholds go
      // degenerate on small integers: with a best of 1 deal, any month with
      // a deal sits at 100% and reads "matched their best" — every rep,
      // every month, forever. Revenue has no such floor (a tie is already
      // impossible there).
      const minBest = m.field === 'deals' ? 2 : 0
      if (!best || !(best.value > 0) || best.value < minBest) continue
      const pct = value / best.value
      const status = value > best.value ? 'new' : pct >= 0.85 ? 'watch' : null
      if (!status) continue
      const row = {
        id, name: u.name, ghost: !!u.ghost,
        metric: m.field, title: m.title, unit: m.unit,
        value, periodLabel: spec.labelFn(target),
        best: best.value, bestLabel: spec.labelFn(best.key),
        pct, status,                           // 'new' = past it, 'watch' = closing in
      }
      if (!pick || pbBetter(row, pick)) pick = row
    }
    if (pick) out.push(pick)
  }
  return out.sort((a, b) =>
    (a.status === b.status ? 0 : a.status === 'new' ? -1 : 1) ||
    (b.pct - a.pct) || a.name.localeCompare(b.name))
}
