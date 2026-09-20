// ============================================================
// "Missing info" on an appointment — the ONE rule, shared by the Leads page
// filter and its per-row note (per Keaton: one filter, not one per field).
//
// Deliberately NOT "any empty field". A future appointment with no closer
// yet is completely normal, so flagging it would bury the real gaps. What
// actually breaks a number downstream:
//   • no setter        → credited to nobody; counts as a lead ran for
//                        whoever sat it and toward nobody's Set
//   • ran, no closer   → nobody knows who sat it
//   • past, still 'scheduled' → the CRM never sent an outcome, so it counts
//                        as neither ran nor cancelled anywhere on the site
//
// `nowISO` is passed in (never read from the clock here) so the rule stays
// pure and testable. Both sides are ISO-8601 UTC, so comparing as strings
// is exact — this is a timestamptz, never sliced to a calendar day.
// ============================================================
import { RAN_STATUSES } from './estimates'

const ranPast = (l, nowISO) =>
  l.status === 'scheduled' && !!l.appointment_at && String(l.appointment_at) < nowISO

export function hasGap(l, nowISO) {
  if (!l.setter_id) return true
  if (RAN_STATUSES.has(l.status) && !l.closer_id) return true
  return ranPast(l, nowISO)
}

// What exactly is missing, so the row can say it in plain words.
export function gapReasons(l, nowISO) {
  const out = []
  if (!l.setter_id) {
    const named = String(l.setter_name || '').trim()
    out.push(named ? `setter "${named}" not on the roster` : 'no setter')
  }
  if (RAN_STATUSES.has(l.status) && !l.closer_id) out.push('ran, but no closer recorded')
  if (ranPast(l, nowISO)) out.push('its time passed with no outcome logged')
  return out
}
