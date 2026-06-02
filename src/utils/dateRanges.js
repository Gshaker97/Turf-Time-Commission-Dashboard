// ============================================================
// Shared date-range presets — the SINGLE source of truth for every
// date filter in the app (Dashboard, Team, Commissions, Deals, Weekly
// Stats). Each preset returns concrete { from, to } strings (YYYY-MM-DD).
//
//   • "to-date" presets (This Week / MTD / This Quarter / YTD) end at today.
//   • "last X" presets cover the full prior period.
//   • All Time = { from: '', to: '' } (open-ended, no filter).
//
// Weeks start on Monday everywhere, matching the rest of the app.
// ============================================================
import {
  format, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter, startOfYear,
  subWeeks, subMonths, subQuarters, subYears, addDays,
  differenceInCalendarDays,
} from 'date-fns'

const FMT  = 'yyyy-MM-dd'
const WEEK = { weekStartsOn: 1 }
const f     = (d) => format(d, FMT)
const today = () => new Date()

export const PRESETS = [
  { key: 'this_week',    label: 'This Week',    range: () => ({ from: f(startOfWeek(today(), WEEK)), to: f(today()) }) },
  { key: 'last_week',    label: 'Last Week',    range: () => { const d = subWeeks(today(), 1);    return { from: f(startOfWeek(d, WEEK)), to: f(endOfWeek(d, WEEK)) } } },
  { key: 'mtd',          label: 'MTD',          range: () => ({ from: f(startOfMonth(today())), to: f(today()) }) },
  { key: 'last_month',   label: 'Last Month',   range: () => { const d = subMonths(today(), 1);   return { from: f(startOfMonth(d)), to: f(endOfMonth(d)) } } },
  { key: 'this_quarter', label: 'This Quarter', range: () => ({ from: f(startOfQuarter(today())), to: f(today()) }) },
  { key: 'last_quarter', label: 'Last Quarter', range: () => { const d = subQuarters(today(), 1); return { from: f(startOfQuarter(d)), to: f(endOfQuarter(d)) } } },
  { key: 'ytd',          label: 'YTD',          range: () => ({ from: f(startOfYear(today())), to: f(today()) }) },
  { key: 'all',          label: 'All Time',     range: () => ({ from: '', to: '' }) },
]

export const PRESETS_BY_KEY = Object.fromEntries(PRESETS.map(p => [p.key, p]))

export function getPresetRange(key) {
  const p = PRESETS_BY_KEY[key]
  return p ? p.range() : { from: '', to: '' }
}

// Does the given preset key produce exactly this from/to range right now?
// Used to confirm a remembered preset still matches the dates before trusting
// it over matchPreset (which can't disambiguate coincident ranges, e.g. the
// first partial week of a month where This Week == MTD).
export function rangeMatches(key, from, to) {
  const p = PRESETS_BY_KEY[key]
  if (!p) return false
  const r = p.range()
  return r.from === (from || '') && r.to === (to || '')
}

// Which preset (if any) the current from/to matches; else 'custom' (some
// date set by hand) or 'all' (nothing set).
export function matchPreset(from, to) {
  const F = from || '', T = to || ''
  for (const p of PRESETS) {
    const r = p.range()
    if (r.from === F && r.to === T) return p.key
  }
  return (F || T) ? 'custom' : 'all'
}

export function presetLabel(key) {
  if (PRESETS_BY_KEY[key]) return PRESETS_BY_KEY[key].label
  return key === 'custom' ? 'Custom' : key === 'all' ? 'All Time' : 'Range'
}

// The comparable previous period for a given range — used for trend arrows.
// Returns null when there is nothing sensible to compare against (All Time).
export function getPreviousRange(preset, from, to) {
  if (!from && !to) return null
  const toD   = to   ? new Date(to   + 'T12:00:00') : today()
  const fromD = from ? new Date(from + 'T12:00:00') : toD

  switch (preset) {
    case 'mtd': {
      const pm     = subMonths(toD, 1)
      const dayN   = toD.getDate()
      const maxDay = endOfMonth(pm).getDate()
      const pTo    = new Date(pm.getFullYear(), pm.getMonth(), Math.min(dayN, maxDay))
      return { from: f(startOfMonth(pm)), to: f(pTo) }
    }
    case 'ytd': {
      const ly = subYears(toD, 1)
      return { from: f(startOfYear(ly)), to: f(ly) }
    }
    case 'this_quarter': {
      const pq     = subQuarters(toD, 1)
      const offset = differenceInCalendarDays(toD, startOfQuarter(toD))
      return { from: f(startOfQuarter(pq)), to: f(addDays(startOfQuarter(pq), offset)) }
    }
    case 'this_week': {
      const pw     = subWeeks(toD, 1)
      const offset = differenceInCalendarDays(toD, startOfWeek(toD, WEEK))
      return { from: f(startOfWeek(pw, WEEK)), to: f(addDays(startOfWeek(pw, WEEK), offset)) }
    }
    case 'last_week':    { const d = subWeeks(fromD, 1);    return { from: f(startOfWeek(d, WEEK)), to: f(endOfWeek(d, WEEK)) } }
    case 'last_month':   { const d = subMonths(fromD, 1);   return { from: f(startOfMonth(d)), to: f(endOfMonth(d)) } }
    case 'last_quarter': { const d = subQuarters(fromD, 1); return { from: f(startOfQuarter(d)), to: f(endOfQuarter(d)) } }
    default: {
      // Custom: an equal-length window immediately preceding `from`.
      const durMs = toD.getTime() - fromD.getTime()
      const pTo   = new Date(fromD.getTime() - 86400000)
      return { from: f(new Date(pTo.getTime() - durMs)), to: f(pTo) }
    }
  }
}

// Monday (week_start) for a given YYYY-MM-DD date string.
export function weekStartOf(dateStr) {
  if (!dateStr) return null
  return f(startOfWeek(new Date(dateStr + 'T12:00:00'), WEEK))
}

// The list of Monday-anchored weeks that overlap a [from, to] range.
export function weeksInRange(from, to) {
  const start = from ? new Date(from + 'T12:00:00') : startOfWeek(today(), WEEK)
  const end   = to   ? new Date(to   + 'T12:00:00') : today()
  const weeks = []
  let ptr = startOfWeek(start, WEEK)
  let guard = 0
  while (ptr <= end && guard++ < 520) {
    const wEnd = endOfWeek(ptr, WEEK)
    weeks.push({ weekStart: f(ptr), weekEnd: f(wEnd), label: format(ptr, 'MMM d') })
    ptr = addDays(ptr, 7)
  }
  return weeks
}
