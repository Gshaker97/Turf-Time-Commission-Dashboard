// ============================================================
// Where estimate counts come from.
//
// Estimates used to be hand-entered per rep per week (`weekly_stats`). Now the
// CRM feed gives us real appointments, and an appointment that RAN *is* an
// estimate — no typing, no guessing.
//
// The switch is DATE-BASED so history survives: on/after
// `app_settings.estimates_from_leads_date` estimates come from the leads feed;
// before it they keep coming from the manual weekly entries. Weeks are the
// unit of comparison because that's the grain the manual data was captured at.
//
// Credit rule — the rep who RAN the appointment owns the estimate:
//   • they set it AND ran it            → self-gen estimate
//   • someone else set it, they ran it  → lead estimate
// (matches how `weekly_stats.self_gen_estimates` / `lead_estimates` were used)
// ============================================================
import { weekStartOf } from './dateRanges'

// Appointment statuses that mean it actually happened.
export const RAN_STATUSES = new Set(['completed', 'sold'])

// The LOCAL calendar day an appointment falls on. Timestamps are stored UTC,
// so a 6:30pm Arizona appointment is 01:30 the NEXT day in UTC — slicing the
// raw string put evening appointments on tomorrow, dropping them out of
// "today" filters and shifting their estimates into the next week.
export const apptDay = (ts) => {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 10)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const dayOf = apptDay

// Estimates from the LEADS feed for one rep (or the whole company when repId
// is null) inside [start, end], counting only appointments on/after `from`.
export function leadEstimates(leads = [], repId, start, end, from = null) {
  let sgEst = 0, leadEst = 0
  for (const l of leads) {
    const d = dayOf(l.appointment_at)
    if (!d || d < start || d > end) continue
    if (from && d < from) continue
    if (!RAN_STATUSES.has(l.status)) continue
    const ranBy = l.closer_id || l.setter_id
    if (!ranBy) continue
    if (repId && ranBy !== repId) continue
    if (l.setter_id && l.setter_id !== ranBy) leadEst += 1
    else sgEst += 1
  }
  return { sgEst, leadEst }
}

// Estimates from the MANUAL weekly entries, ignoring weeks the feed now owns.
export function manualEstimates(weeklyStats = [], repId, start, end, from = null) {
  let sgEst = 0, leadEst = 0
  for (const s of weeklyStats) {
    const w = s.week_start
    if (!w || w < start || w > end) continue
    if (from && w >= from) continue            // that week belongs to the feed
    if (repId && s.rep_id !== repId) continue
    const sg = Number(s.self_gen_estimates) || 0
    const ld = Number(s.lead_estimates) || 0
    if (sg || ld) { sgEst += sg; leadEst += ld }
    else sgEst += Number(s.estimates) || 0     // legacy unsplit weeks = self-gen
  }
  return { sgEst, leadEst }
}

// The combined answer: feed for periods on/after the cutover, manual before.
// `from` null = the feed isn't live yet, so everything stays manual.
export function estimatesFor({ leads, weeklyStats, repId = null, start, end, from = null }) {
  const a = from ? leadEstimates(leads, repId, start, end, from) : { sgEst: 0, leadEst: 0 }
  const b = manualEstimates(weeklyStats, repId, start, end, from)
  return { sgEst: a.sgEst + b.sgEst, leadEst: a.leadEst + b.leadEst }
}

// Is this week's estimate count owned by the feed (so manual entry is moot)?
export const weekIsFeedOwned = (weekStart, from) => !!from && String(weekStart) >= String(from)
export const dayIsFeedOwned  = (dayISO, from)   => !!from && String(dayISO) >= String(from)
// The Sunday that a cutover date falls in — manual/feed boundaries align to weeks.
export const cutoverWeek = (from) => (from ? weekStartOf(from) : null)
