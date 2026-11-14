// ============================================================
// repActivity.js — one row per rep: what they BOOKED, and what they SAT for
// somebody else. Pure; the Leads page's "By rep" view renders it.
//
// Per Keaton: "For a setter: how many appointments did they set, and how many
// ran / closed, and who ran those appointments and what was the outcome? For a
// closer: … how many leads they ran and for who and how many of those ran /
// closed."
//
// FIVE STATS IN TWO GROUPS THAT DO NOT OVERLAP, which is what keeps any one
// column from containing another (the trap that made the Dashboard
// leaderboard unreadable — see CLAUDE.md):
//
//   what they BOOKED:  set → ran → closed      (one funnel, each a slice of
//                                               the one before)
//   someone else's:    leadsRan → leadsClosed
//
// A self-gen lives only on the left; a lead they sat only on the right.
//
// THE TWO SIDES COME FROM DIFFERENT SYSTEMS, deliberately. set/ran/leadsRan
// are APPOINTMENTS from the CRM; closed/leadsClosed are SIGNED DEALS from the
// site (per Keaton: "deals should only count for actual signed deals… if
// outcomes number of deals differ, it goes with the site's data which is
// true"). That is also why every rate here can exceed 100% and has to be
// allowed to blank — a rep can close a sale having logged no appointment.
// ============================================================

import { RAN_STATUSES, apptDay } from './estimates.js'
import { countsInTotals } from './commission.js'
import { saleOwnerId } from './team.js'

const inRange = (d, from, to) => !!d && (!from || d >= from) && (!to || d <= to)

// A rate over 100% measures the gap between two systems, not performance, so
// it reads blank. Never cap it at 100% — blank says "can't be read as a
// rate", a cap would lie. The ONE rule, same as perfSummary's `rateOrNull`.
export const rateOrNull = (top, bottom) => {
  if (!bottom) return null
  const r = (top / bottom) * 100
  return r > 100 ? null : r
}

const newRow = (u) => ({
  id: u.id, name: u.name, ghost: !!u.ghost, role: u.role, active: u.active !== false,
  set: 0, ran: 0, closed: 0, leadsRan: 0, leadsClosed: 0,
  // REVENUE is baseline (convention #1), never job_price. Two figures, never
  // summed across people: `revenue` is owner-credited (the deals they own),
  // `leadRevenue` is the baseline of deals they CLOSED for another setter.
  // One sale therefore puts revenue on the setter and leadRevenue on the
  // closer — add the two columns together and you have counted it twice.
  revenue: 0, leadRevenue: 0,
  // who ran what this rep booked / whose leads this rep sat — Maps keyed by
  // the other person's id ('' when nobody is recorded), each { ran, closed }
  ranBy: new Map(), leadFrom: new Map(),
  appts: [],
})

// Busiest counterpart first — who this rep works with most.
const byCount = (a, b) => (b.ran - a.ran) || (b.closed - a.closed)

const bump = (map, key, field) => {
  if (!map.has(key)) map.set(key, { id: key || null, ran: 0, closed: 0 })
  map.get(key)[field] += 1
}

/**
 * @param leads  rows from the CRM feed
 * @param deals  signed deals (already visible to the caller)
 * @param opts.users     roster
 * @param opts.from/to   'yyyy-MM-dd'
 * @param opts.onlyIds   restrict to these profile ids (the team filter picks
 *                       the ROSTER, never the appointments — a closer who ran
 *                       another team's lead keeps that credit on their own
 *                       team's view, per Keaton)
 * @returns { rows, totals, distinct }
 */
export function repActivity(leads = [], deals = [], opts = {}) {
  const { users = [], from = null, to = null, onlyIds = null } = opts
  const byId = new Map(users.map(u => [u.id, u]))
  const keep = onlyIds ? new Set(onlyIds) : null
  const wanted = (id) => !!id && byId.has(id) && (!keep || keep.has(id))

  const rows = new Map()
  const row = (id) => {
    if (!rows.has(id)) rows.set(id, newRow(byId.get(id)))
    return rows.get(id)
  }

  // Distinct counts — the summary must never count one appointment twice just
  // because a setter and a closer both have a row (per Keaton: "a lead set and
  // ran by different people is still just 1 appointment").
  const seenAppts = new Set()
  const seenDeals = new Set()

  // ── appointments ──────────────────────────────────────────────────────────
  for (const l of leads) {
    if (l.ignored) continue
    const day    = apptDay(l.appointment_at)      // when it HAPPENS
    const setDay = apptDay(l.set_at) || day       // when it was BOOKED (051)
    const setIn  = inRange(setDay, from, to)
    const ranIn  = inRange(day, from, to)
    if (!setIn && !ranIn) continue

    const ran    = RAN_STATUSES.has(l.status)
    const setter = l.setter_id
    // An appointment that RAN is credited to whoever sat it; with no closer
    // recorded the setter sat their own. Same resolution as perfSummary.
    const ranBy  = l.closer_id || l.setter_id
    // A setter-less appointment is a LEAD ran for whoever sat it, never a
    // self-gen (per Keaton) — so `self` needs a real setter on both sides.
    const self   = !!setter && setter === ranBy

    let counted = false

    // LEFT GROUP — what they booked.
    if (setIn && wanted(setter)) {
      const r = row(setter)
      r.set += 1
      if (ran) {
        r.ran += 1
        bump(r.ranBy, self ? setter : (l.closer_id || ''), 'ran')
      }
      // SELF-GEN ONLY ONCE IT HAS RUN. `ranBy` falls back to the setter when
      // no closer is recorded, so a still-scheduled appointment with nobody
      // assigned looked self-generated — it isn't, nobody has run anything
      // yet. It reads "Set" until it actually runs. (Counts are unaffected:
      // every use of `self` above is already behind `ran`.)
      r.appts.push(apptRow(l, setter, { role: (ran && self) ? 'self' : 'set', day, setDay }))
      if (!seenAppts.has(l.id)) { seenAppts.add(l.id); counted = true }
    }

    // RIGHT GROUP — someone else's lead they sat. Only once it has RUN: an
    // appointment handed over but not yet sat is still the setter's pipeline
    // and nobody has run anything.
    if (ranIn && ran && !self && wanted(ranBy)) {
      const r = row(ranBy)
      r.leadsRan += 1
      bump(r.leadFrom, setter || '', 'ran')
      r.appts.push(apptRow(l, ranBy, { role: 'closer', day, setDay }))
      if (!counted && !seenAppts.has(l.id)) seenAppts.add(l.id)
    }
  }

  // ── deals (the CLOSED half) ───────────────────────────────────────────────
  for (const d of deals) {
    if (!countsInTotals(d)) continue
    if (!inRange(d.sale_date, from, to)) continue
    const owner  = saleOwnerId(d)
    const closer = d.closer_id
    let any = false

    const baseline = Number(d.baseline_revenue) || 0

    if (wanted(owner)) {
      const r = row(owner)
      r.closed += 1
      r.revenue += baseline
      // Who closed what this rep booked. A deal with no distinct closer was
      // closed by the owner themselves.
      bump(r.ranBy, (closer && closer !== owner) ? closer : owner, 'closed')
      any = true
    }
    if (closer && closer !== owner && wanted(closer)) {
      const r = row(closer)
      r.leadsClosed += 1
      r.leadRevenue += baseline
      bump(r.leadFrom, d.setter_id || '', 'closed')
      any = true
    }
    if (any) seenDeals.add(d.id)
  }

  const name = (id) => (id ? (byId.get(id)?.name || 'Unknown') : 'No one recorded')
  const list = [...rows.values()].map(r => ({
    ...r,
    ranBy:    [...r.ranBy.values()].map(e => ({ ...e, name: name(e.id) })).sort(byCount),
    leadFrom: [...r.leadFrom.values()].map(e => ({ ...e, name: name(e.id) })).sort(byCount),
    appts:    r.appts.sort((a, b) => String(a.at).localeCompare(String(b.at))),
    ranRate:         rateOrNull(r.ran, r.set),
    closeRate:       rateOrNull(r.closed, r.ran),
    leadsCloseRate:  rateOrNull(r.leadsClosed, r.leadsRan),
  })).sort((a, b) => (b.set + b.leadsRan) - (a.set + a.leadsRan) || a.name.localeCompare(b.name))

  const sum = (f) => list.reduce((n, r) => n + r[f], 0)
  const totals = {
    set: sum('set'), ran: sum('ran'), closed: sum('closed'),
    leadsRan: sum('leadsRan'), leadsClosed: sum('leadsClosed'),
    revenue: sum('revenue'), leadRevenue: sum('leadRevenue'),
  }
  totals.ranRate        = rateOrNull(totals.ran, totals.set)
  totals.closeRate      = rateOrNull(totals.closed, totals.ran)
  totals.leadsCloseRate = rateOrNull(totals.leadsClosed, totals.leadsRan)

  // Each counted ONCE, however many rows it appears on.
  const distinct = {
    appointments: seenAppts.size,
    deals: seenDeals.size,
    closeRate: rateOrNull(seenDeals.size, seenAppts.size),
  }

  return { rows: list, totals, distinct }
}


function apptRow(l, viewerId, { role, day, setDay }) {
  return {
    id: l.id, role,                        // 'self' | 'set' | 'closer'
    at: l.appointment_at, day, setDay,
    customer: l.customer_name || '—',
    setterId: l.setter_id || null,
    closerId: l.closer_id || null,
    setterName: l.setter_name || null,     // feed text when no roster match
    closerName: l.closer_name || null,
    status: l.status, disposition: l.disposition || null,
    viewerId,
  }
}

// The roster the team filter resolves to: everyone whose date-effective team
// as of the range end is the picked one. Filtering the APPOINTMENTS instead
// would move a closer onto the team whose lead they ran — the exact bug the
// Dashboard leaderboard already fixed.
export function teamRoster(users, teamKey, asOf, { teamOfSale, usersById, heads, changesByProfile }) {
  if (!teamKey) return null
  return users
    .filter(u => teamOfSale(u.id, asOf, usersById, heads, changesByProfile) === teamKey)
    .map(u => u.id)
}
