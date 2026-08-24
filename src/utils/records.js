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
import { isCanceled } from './commission'
import { saleOwnerId, teamOfSale } from './team'
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
  const teamNameOf = (id) => (id === 'unassigned' ? 'Unassigned' : `${nameOf(id)}'s Team`)

  const cm = {}, cw = {}, cd = {}
  const rm = {}, rw = {}, rd = {}
  const tm = {}, tw = {}, td = {}
  let biggestDeal = null
  for (const d of deals) {
    if (!d.sale_date || isCanceled(d)) continue
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
    if (!d.sale_date || isCanceled(d) || saleOwnerId(d) !== repId) continue
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
