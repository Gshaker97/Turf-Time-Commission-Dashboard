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

// ── People the feed names who are not field reps ────────────────────────────
// `app_settings.feed_non_reps` (Admin → Settings): inside sales, or someone
// who has left. Their names arrive from the CRM and will never match a
// profile, so without this every one of their appointments reads as a
// missing setter forever and the "Needs attention" worklist never empties.
//
// Marking a name here changes NOTHING about the appointment itself — it still
// counts as a Leads ran for whoever sat it, which is the point: inside sales
// books, a field rep runs it, and the field rep keeps that credit (per
// Keaton). The name simply stops being treated as a fixable gap. That is why
// this is a separate decision from `leads.ignored` (drops the row from every
// count) and from `perf_excluded_ids` (hides a real PROFILE from Performance).
//
// Matched on the whole trimmed name, case-insensitive — never a substring,
// which would make "Jack" swallow "Jackson".
export const nonRepSet = (names = []) =>
  new Set((names || []).map(n => String(n || '').trim().toLowerCase()).filter(Boolean))

export const isNonRep = (name, nonReps) =>
  !!nonReps && nonReps.size > 0 && nonReps.has(String(name || '').trim().toLowerCase())

export function hasGap(l, nowISO, nonReps) {
  if (!l.setter_id && !isNonRep(l.setter_name, nonReps)) return true
  if (RAN_STATUSES.has(l.status) && !l.closer_id && !isNonRep(l.closer_name, nonReps)) return true
  return ranPast(l, nowISO)
}

// ── Duplicates ──────────────────────────────────────────────────────────
// RepCard creates a NEW appointment record when one is reassigned to another
// closer, so the same doorstep arrives twice with two different ids. Both are
// genuine records to the feed; only a human can say which is the duplicate.
// Grouping key: same customer at the same minute. Address is deliberately NOT
// part of it — a reassignment can arrive with a differently formatted address
// and we would miss the pair.
const dupeKey = (l) => {
  const name = String(l.customer_name || '').trim().toLowerCase()
  if (!name || !l.appointment_at) return null       // never group the unnamed
  return `${l.source || 'repcard'}|${name}|${l.appointment_at}`
}

// ids of every appointment that shares its customer+time with another one.
// Ignored rows don't count toward a group: once one of a pair is ignored the
// other is no longer a duplicate of anything.
export function duplicateIds(leads = []) {
  const groups = new Map()
  for (const l of leads) {
    if (l.ignored) continue
    const k = dupeKey(l)
    if (!k) continue
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(l.id)
  }
  const out = new Set()
  for (const ids of groups.values()) if (ids.length > 1) ids.forEach(id => out.add(id))
  return out
}

// One filter, one question: does this row need a human? (per Keaton)
export const needsAttention = (l, nowISO, dupes, nonReps) =>
  !l.ignored && (hasGap(l, nowISO, nonReps) || (dupes ? dupes.has(l.id) : false))

// What exactly is missing, so the row can say it in plain words.
export function gapReasons(l, nowISO, nonReps) {
  const out = []
  if (!l.setter_id && !isNonRep(l.setter_name, nonReps)) {
    const named = String(l.setter_name || '').trim()
    out.push(named ? `setter "${named}" not on the roster` : 'no setter')
  }
  if (RAN_STATUSES.has(l.status) && !l.closer_id && !isNonRep(l.closer_name, nonReps)) {
    out.push('ran, but no closer recorded')
  }
  if (ranPast(l, nowISO)) out.push('its time passed with no outcome logged')
  return out
}
