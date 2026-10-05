// ============================================================
// Performance page engine — ONE pass that turns deals + appointments + field
// activity into the org scoreboard, the by-office split, and one section per
// team with a row per rep. Pure: the page feeds data in and renders.
//
// Attribution rules (the same ones every other page uses — numbers here must
// always match the Dashboard):
//   • Revenue = baseline_revenue. Canceled deals never count.
//   • A deal's count + revenue credit its OWNER (saleOwnerId: setter, else
//     closer), on the team the owner was on AS OF THE SALE DATE (teamOfSale).
//   • Commission per rep = that rep's OWN share only (setter share and/or a
//     distinct closer's share — dealAmounts.setter/.closer). Never overrides.
//     A closer's share lands on the CLOSER's team, so team commission = the
//     sum of its reps' commission, which can differ from "commission on the
//     team's deals". Org commission = sum of all rep shares.
//   • Appointments (leads feed): SET credits the setter on the appointment
//     day. SELF-GEN RAN credits the SETTER when their appointment ran, no
//     matter who sat it; LEADS RAN credits whoever SAT an appointment they
//     did not set. So the two are per-person CREDIT columns, not a partition
//     of the ran count: one appointment set by A and sat by B gives A a
//     self-gen ran AND B a leads ran. `ran` (appointments a person sat)
//     stays a true count, which is what the org funnel uses.
//     An appointment with NO SETTER recorded counts as a LEAD ran,
//     never a self-gen (per Keaton) — we don't know who generated it, and
//     assuming the runner did inflated closers' self-gen counts. Those rows
//     are tallied as `noSetter` so the page can flag them for fixing.
//   • Field activity: day rows credit profile_id on activity_date.
//   • A rep who moved teams mid-range appears under EACH team with only the
//     work attributed there, so a team's total row always equals the sum of
//     its rep rows. Current members with nothing in the range still get a
//     row (zeros) so an idle rep is visible, not hidden.
// ============================================================
import { dealAmounts, countsInTotals } from './commission'
import { saleOwnerId, teamOfSale, teamLabel } from './team'
import { RAN_STATUSES, apptDay } from './estimates'
import { summarizeActivity } from './fieldActivity'
import { nonRepSet, isNonRep, ranPast } from './leadGaps'

const UNASSIGNED = 'unassigned'

const inRange = (day, from, to) => !!day && (!from || day >= from) && (!to || day <= to)

const localToday = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function newStats() {
  return { revenue: 0, job: 0, deals: 0, selfGen: 0, leadCloses: 0, leadRevenue: 0, commission: 0, set: 0, setRan: 0, ran: 0, sgRan: 0, leadRan: 0, pastDue: 0, activityRows: [] }
}

// A deal-over-appointment rate, or null when it can't be read as a rate:
// nothing to divide by, or more deals than logged appointments.
const rateOrNull = (deals, ran) => {
  if (!ran) return null
  const pct = (deals / ran) * 100
  return pct > 100 ? null : pct
}

// Derived figures computed once at the end so partial sums never leak out.
function finish(s) {
  const act = summarizeActivity(s.activityRows)
  return {
    revenue: s.revenue, job: s.job, deals: s.deals, leadCloses: s.leadCloses, commission: s.commission,
    // Mutually exclusive with leadCloses; selfGen + setForOthers = deals OWNED.
    selfGen: s.selfGen, setForOthers: Math.max(0, s.deals - s.selfGen),
    // Self-gen revenue (owner-credited) + baseline of the deals this rep
    // closed for another setter. At team/org level this double-counts a deal
    // whose setter and closer are both in the group — it is a per-rep view.
    leadRevenue: s.leadRevenue, totalRevenue: s.revenue + s.leadRevenue,
    avgDeal:   s.deals ? s.revenue / s.deals : null,
    markupPct: s.revenue > 0 ? ((s.job - s.revenue) / s.revenue) * 100 : null,
    set: s.set, ran: s.ran, sgRan: s.sgRan, leadRan: s.leadRan, pastDue: s.pastDue,
    // Conversion rates (per Keaton): set → ran is a SETTER stat — of the
    // appointments this rep set, how many ran (whoever ran them), so a
    // closer's lead volume never inflates it; self-gen ran → self-gen deals
    // (owner-credited deals ÷ self-gen appointments ran); leads ran → lead
    // closes. `dealCloseRate` is the DEAL count ÷ appointments ran.
    //
    // THE FUNNEL'S LAST STEP IS `deals`, NOT THE CRM's "sold" DISPOSITION
    // (per Keaton: "guys don't always update their leads, so there will always
    // be a discrepancy — just go off our actual sales numbers"). RepCard's own
    // sold outcome was tracked here as `sold` and is GONE: it disagreed with
    // the deal count on the same screen, which is the exact two-numbers-for-
    // one-thing problem the Dashboard merge existed to kill. The Leads page
    // still shows the CRM outcome, correctly — that page IS the appointment
    // records, and it labels the figure "outcome, not a deal record".
    //
    // The two DEAL-over-APPOINTMENT rates are BLANK when they'd exceed 100%
    // (per Keaton). Deals come from the site, appointments from the CRM, and
    // a rep can close a sale without ever logging an appointment — so there
    // will always be deals with no appointment behind them. A rate over 100%
    // is that gap, not performance, and showing "250% close" reads as a bug.
    // Of the appointments BOOKED in this range, how many have run. A cohort
    // rate: both sides are the same appointments, so it stays honest now that
    // set and ran are dated differently.
    showRate:      s.set ? (s.setRan / s.set) * 100 : null,
    sgCloseRate:   rateOrNull(s.deals, s.sgRan),
    leadCloseRate: rateOrNull(s.leadCloses, s.leadRan),
    // Deals ÷ appointments ran, and deals ÷ appointments set — the two steps
    // of the funnel. Cross-source, so both take the same >100% blank rule as
    // the others: a rep can close without ever logging an appointment.
    dealCloseRate: rateOrNull(s.deals, s.ran),
    setCloseRate:  rateOrNull(s.deals, s.set),
    doors: act.doors, knockDays: act.knockDays, doorsPerDay: act.doorsPerDay,
    firstKnock: act.firstKnock, lastKnock: act.lastKnock, fieldMinutes: act.fieldMinutes,
    hasActivity: act.rows > 0,
  }
}

// Team key for a person on a day — with the page's two overrides:
//   • defaultTeamId: anything that would land in Unassigned (no owner, owner
//     on no team) is filed under this head instead (per Keaton: Garrison's
//     team is the default home for unassigned reps and deals).
//   • excluded: people removed from this page altogether (per Keaton: Tanner
//     is not a rep) — they get no row, and their deals, appointments and
//     door knocks are left out of every total ON THIS PAGE. The Dashboard and
//     payroll still count them, so this page's org totals can differ from
//     the Dashboard by exactly their production.
function makeTeamOf(teamCtx, defaultTeamId) {
  const { usersById, heads, changesByProfile } = teamCtx
  return (pid, day) => {
    const k = pid ? teamOfSale(pid, day, usersById, heads, changesByProfile) : UNASSIGNED
    return k === UNASSIGNED && defaultTeamId ? defaultTeamId : k
  }
}

// One window's raw accumulation: org, offices, and team → rep buckets.
function accumulate({ deals, leads, activity, teamCtx, from, to, defaultTeamId = null, excluded = new Set(), nonReps = new Set(), nowISO = new Date().toISOString() }) {
  const teamOf = makeTeamOf(teamCtx, defaultTeamId)
  const out = (pid) => !!pid && excluded.has(pid)

  const org = newStats()
  const offices = new Map()          // office key (lc) → stats; '' = no office
  const teams = new Map()            // teamKey → { totals, reps: Map(repId → stats) }
  const unmatched = new Map()        // rep_name → doors (activity rows with no profile)
  // Appointments we can't credit. `unmatchedSetter` is the FIXABLE case: the
  // feed sent a setter NAME but it matched no profile (spelling, a nickname,
  // someone off the roster, or a name two profiles share — which resolves to
  // neither on purpose), so `setter_id` stayed null and every total ignores
  // the person the CRM clearly recorded.
  const gaps = { noSetter: 0, noSetterRan: 0, unmatchedSetter: 0 }

  const team = (k) => {
    if (!teams.has(k)) teams.set(k, { totals: newStats(), reps: new Map() })
    return teams.get(k)
  }
  const rep = (k, pid) => {
    const t = team(k)
    if (!t.reps.has(pid)) t.reps.set(pid, newStats())
    return t.reps.get(pid)
  }
  // Offices carry rep sub-buckets so the Dashboard can drill Company → Office
  // → rep, the same way it drills into a team. NOTE the asymmetry with teams:
  // office is a property of the DEAL, not of the person, so one rep can appear
  // under several offices with the deals they sold in each. Doors and
  // appointments carry no office at all (RepCard keys them to a rep and a day),
  // so an office's rep rows hold deal figures only — see `officeFunnel` in
  // scorecard.js, which is why the funnel is hidden at office scope.
  //
  // They ALSO carry TEAM sub-buckets (per Keaton: "how do I filter by team
  // while viewing office stats?"), shaped exactly like the top-level `teams`
  // map — totals plus reps — so Company → Tucson → Conner's Team → reps works
  // the same way as Company → Conner's Team → reps. Same asymmetry applies: a
  // team appears under every office it sold in, with that office's deals.
  const office = (name) => {
    const k = String(name || '').trim().toLowerCase()
    if (!offices.has(k)) offices.set(k, { name: String(name || '').trim(), reps: new Map(), teams: new Map(), ...newStats() })
    return offices.get(k)
  }
  const officeRep = (off, pid) => {
    if (!off.reps.has(pid)) off.reps.set(pid, newStats())
    return off.reps.get(pid)
  }
  const officeTeam = (off, k) => {
    if (!off.teams.has(k)) off.teams.set(k, { totals: newStats(), reps: new Map() })
    return off.teams.get(k)
  }
  const officeTeamRep = (ot, pid) => {
    if (!ot.reps.has(pid)) ot.reps.set(pid, newStats())
    return ot.reps.get(pid)
  }

  for (const d of deals) {
    if (!countsInTotals(d) || !inRange(d.sale_date, from, to)) continue
    const owner = saleOwnerId(d)
    if (out(owner)) continue                       // an excluded person's deal leaves this page entirely
    const a = dealAmounts(d)
    const key = teamOf(owner, d.sale_date)
    const off = office(d.office)
    // The owner's team WITHIN this office. Revenue/deals land here exactly as
    // they land on the owner's top-level team, so an office's team rows always
    // sum back to the office total.
    const ot = officeTeam(off, key)
    for (const s of [org, off, team(key).totals, ot.totals]) {
      s.revenue += a.baseline; s.job += a.job; s.deals += 1
    }
    // REP commission only (setter + closer shares) — never overrides. Org and
    // office both take the deal's whole rep commission, so the offices always
    // sum to the org figure; the per-team/per-rep numbers below instead split
    // it by who earned which share.
    org.commission += a.repCommission
    off.commission += a.repCommission
    if (owner) {
      const r = rep(key, owner); r.revenue += a.baseline; r.job += a.job; r.deals += 1
      const orr = officeRep(off, owner); orr.revenue += a.baseline; orr.job += a.job; orr.deals += 1
      const otr = officeTeamRep(ot, owner); otr.revenue += a.baseline; otr.job += a.job; otr.deals += 1
      // Self-gen = no distinct closer, so the owner closed their own deal. A
      // setter-less deal is a self-gen too: saleOwnerId fell back to the
      // closer, who therefore both owns and closed it.
      if (!d.closer_id || d.closer_id === owner) {
        r.selfGen += 1; orr.selfGen += 1; otr.selfGen += 1
        team(key).totals.selfGen += 1; ot.totals.selfGen += 1; off.selfGen += 1; org.selfGen += 1
      }
    }
    // Commission follows each rep's own share to each rep's own team — inside
    // the office as well as outside it, so the two never disagree.
    if (d.setter_id) {
      const k = teamOf(d.setter_id, d.sale_date)
      rep(k, d.setter_id).commission += a.setter; team(k).totals.commission += a.setter
      officeRep(off, d.setter_id).commission += a.setter
      const okt = officeTeam(off, k)
      okt.totals.commission += a.setter; officeTeamRep(okt, d.setter_id).commission += a.setter
    }
    if (d.closer_id && d.closer_id !== d.setter_id && !out(d.closer_id)) {
      const k = teamOf(d.closer_id, d.sale_date)
      rep(k, d.closer_id).commission += a.closer; team(k).totals.commission += a.closer
      officeRep(off, d.closer_id).commission += a.closer
      // A closer on ANOTHER team keeps their share on THEIR team's row inside
      // this office, the same rule the company-level breakdown follows.
      const okt = officeTeam(off, k)
      okt.totals.commission += a.closer; officeTeamRep(okt, d.closer_id).commission += a.closer
      // A LEAD CLOSE: the setter keeps the deal (owner credit above); the
      // closer is credited with having closed a lead — same split the Home
      // card and Dashboard use, never an extra deal. Its baseline feeds the
      // closer's TOTAL revenue (self-gen revenue + lead-close revenue).
      if (d.setter_id) {
        for (const s of [org, team(k).totals, rep(k, d.closer_id)]) { s.leadCloses += 1; s.leadRevenue += a.baseline }
      }
    }
    if (!d.setter_id && !d.closer_id) {
      team(key).totals.commission += a.repCommission
      ot.totals.commission += a.repCommission
    }
  }

  for (const l of leads) {
    if (l.ignored) continue          // an admin marked it a duplicate (049)
    // TWO DATES, deliberately (per Keaton). A SET counts on the day the rep
    // BOOKED it; a RAN/SOLD counts on the day the appointment happened. One
    // range therefore answers both "what did they book this week" and "what
    // ran this week", which are different sets of appointments.
    // `set_at` is null on anything the feed sent before migration 051, so it
    // falls back to the appointment day rather than dropping the row.
    const day    = apptDay(l.appointment_at)          // when it HAPPENS
    const setDay = apptDay(l.set_at) || day           // when it was BOOKED
    const setIn  = inRange(setDay, from, to)
    const ranIn  = inRange(day, from, to)
    if (!setIn && !ranIn) continue
    // A name on the admin's "not a field rep" list (inside sales, someone who
    // has left) is a KNOWN blank, not a fixable gap — it would otherwise sit
    // in this banner forever. The appointment itself is untouched: it still
    // counts as a Leads ran for whoever sat it.
    if (ranIn && !l.setter_id && !isNonRep(l.setter_name, nonReps)) {
      gaps.noSetter += 1
      if (RAN_STATUSES.has(l.status)) gaps.noSetterRan += 1
      if (String(l.setter_name || '').trim()) gaps.unmatchedSetter += 1
    }
    const setter = out(l.setter_id) ? null : l.setter_id
    const ran = RAN_STATUSES.has(l.status)
    // Its time passed and the CRM never sent an outcome, so it is neither ran
    // nor cancelled and it silently drags Ran down. Counted on the day it was
    // MEANT to run, credited to whoever set it so it follows the scope.
    if (ranIn && ranPast(l, nowISO)) {
      org.pastDue += 1
      if (setter) { const k = teamOf(setter, day); team(k).totals.pastDue += 1; rep(k, setter).pastDue += 1 }
    }
    if (setIn && setter) {
      const k = teamOf(setter, setDay)
      org.set += 1; team(k).totals.set += 1; rep(k, setter).set += 1
      // Of what they booked in this window, how much has run — a COHORT rate,
      // counted whenever it ran. `sgRan / set` would mix two date bases now
      // that the two columns key off different days.
      if (ran) { org.setRan += 1; team(k).totals.setRan += 1; rep(k, setter).setRan += 1 }
    }
    if (!ran || !ranIn) continue
    // SELF-GEN RAN = "an appointment I generated ran", credited to the
    // SETTER whoever ended up sitting it (per Keaton). A separate "sets ran"
    // column was the same number by another name.
    if (setter) {
      const k = teamOf(setter, day)
      org.sgRan += 1; team(k).totals.sgRan += 1; rep(k, setter).sgRan += 1
    }
    const ranBy = l.closer_id || l.setter_id
    // An appointment that RAN with nobody we can credit still happened, so it
    // counts in the ORG funnel — skipping the whole row here used to drop it
    // from org `ran`/`sold` as well as from the person's, quietly
    // undercounting the company's own numbers.
    if (!ranBy || out(ranBy)) {
      if (!out(ranBy)) { org.ran += 1; org.leadRan += 1 }
      continue
    }
    const k = teamOf(ranBy, day)
    for (const s of [org, team(k).totals, rep(k, ranBy)]) {
      s.ran += 1
      // LEADS RAN = "I sat someone else's appointment". A rep who set AND
      // sat it already has it under self-gen ran, so it is never both.
      if (!l.setter_id || l.setter_id !== ranBy) s.leadRan += 1
    }
  }

  for (const row of activity) {
    if (!inRange(row.activity_date, from, to)) continue
    if (out(row.profile_id)) continue
    org.activityRows.push(row)
    if (!row.profile_id) {
      const n = row.rep_name || 'Unknown rep'
      unmatched.set(n, (unmatched.get(n) || 0) + (Number(row.doors_knocked) || 0))
      continue
    }
    const k = teamOf(row.profile_id, row.activity_date)
    team(k).totals.activityRows.push(row)
    rep(k, row.profile_id).activityRows.push(row)
  }

  return { org, offices, teams, unmatched, gaps }
}

// The team a user is on as of `asOf` (their own id if they head one).
const memberTeam = (u, asOf, teamCtx) =>
  teamOfSale(u.id, asOf, teamCtx.usersById, teamCtx.heads, teamCtx.changesByProfile)

// opts.defaultTeamId — head id that adopts everything Unassigned (null = keep
// an Unassigned section). opts.excludedIds — profile ids removed from this
// page altogether (see makeTeamOf). opts.nonRepNames — feed names that are not
// field reps, so they stop reading as fixable gaps (see nonRepSet).
export function buildPerformance({
  deals = [], leads = [], activity = [], users = [], teamCtx,
  range = {}, prev = null, defaultTeamId = null, excludedIds = [], nonRepNames = [],
}) {
  const { usersById, heads } = teamCtx
  const today = localToday()
  // Full timestamp, not a day — `ranPast` compares the appointment's exact
  // timestamptz, so slicing here would mis-flag anything later today.
  const nowISO = new Date().toISOString()
  const asOf = range.to && range.to < today ? range.to : today
  const excluded = new Set((excludedIds || []).filter(Boolean))
  const nonReps = nonRepSet(nonRepNames)
  const defTeam = defaultTeamId && usersById[defaultTeamId] ? defaultTeamId : null
  const acc = (from, to) => accumulate({ deals, leads, activity, teamCtx, from, to, defaultTeamId: defTeam, excluded, nonReps, nowISO })

  const cur = acc(range.from, range.to)
  const prv = prev ? acc(prev.from, prev.to) : null

  // Roster as of the range end: every active person gets a row on their team
  // even with nothing in the window, and a head's team exists even when idle.
  const roster = new Map()   // teamKey → Set(repId)
  for (const u of users) {
    if (u.active === false || excluded.has(u.id)) continue
    if (!['rep', 'manager', 'director', 'vp'].includes(u.role) && !heads.has(u.id)) continue
    let k = memberTeam(u, asOf, teamCtx)
    if (k === UNASSIGNED && defTeam) k = defTeam
    if (!roster.has(k)) roster.set(k, new Set())
    roster.get(k).add(u.id)
  }
  for (const h of heads) if (!roster.has(h) && !excluded.has(h)) roster.set(h, new Set([h]))
  if (defTeam && !roster.has(defTeam)) roster.set(defTeam, new Set([defTeam]))

  const teamKeys = new Set([...roster.keys(), ...cur.teams.keys()])
  const teams = []
  for (const key of teamKeys) {
    const bucket = cur.teams.get(key) || { totals: newStats(), reps: new Map() }
    const prevBucket = prv?.teams.get(key) || null
    const members = roster.get(key) || new Set()
    const repIds = new Set([...members, ...bucket.reps.keys()])
    const head = key !== UNASSIGNED ? usersById[key] : null
    const rows = []
    for (const pid of repIds) {
      const u = usersById[pid]
      if (!u) continue
      const stats = finish(bucket.reps.get(pid) || newStats())
      const prevRep = prevBucket ? finish(prevBucket.reps.get(pid) || newStats()) : null
      rows.push({
        id: pid, name: u.name, role: u.role, ghost: !!u.ghost, active: u.active !== false,
        isHead: pid === key,
        member: members.has(pid),                 // on this team as of the range end
        prev: prevRep,
        ...stats,
      })
    }
    rows.sort((a, b) => (b.isHead - a.isHead) || (b.revenue - a.revenue) || (b.deals - a.deals) || a.name.localeCompare(b.name))
    const totals = finish(bucket.totals)
    const prevTotals = prv ? finish(prv.teams.get(key)?.totals || newStats()) : null
    const hasAnything = rows.length > 0 || totals.deals > 0 || totals.set > 0 || totals.doors > 0
    if (!hasAnything) continue
    teams.push({
      key,
      label: key === UNASSIGNED ? 'Unassigned' : teamLabel(head),
      head,
      isDefault: key === defTeam,                          // adopts everything unassigned
      historical: key !== UNASSIGNED && key !== defTeam && !heads.has(key),   // a former lead's old team
      unassigned: key === UNASSIGNED,
      members: rows.filter(r => r.member).length,
      knockers: rows.filter(r => r.doors > 0).length,
      rows, totals, prev: prevTotals,
    })
  }
  teams.sort((a, b) => (a.unassigned - b.unassigned) || (a.historical - b.historical) || (b.totals.revenue - a.totals.revenue) || a.label.localeCompare(b.label))

  const org = finish(cur.org)
  const prevOrg = prv ? finish(prv.org) : null
  const offices = [...cur.offices.entries()].map(([k, s]) => {
    const st = finish(s)
    const p = prv?.offices.get(k)
    // Rep rows for the drill-down. Deal figures only — an office has no doors
    // or appointments to hand out (see the `office` bucket comment above).
    const prevReps = p?.reps || null
    const rows = [...s.reps.entries()].map(([pid, rs]) => {
      const u = usersById[pid]
      if (!u) return null
      const prevRep = prevReps ? finish(prevReps.get(pid) || newStats()) : null
      return { id: pid, name: u.name, role: u.role, ghost: !!u.ghost, active: u.active !== false,
               prev: prevRep, ...finish(rs) }
    }).filter(Boolean).sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name))
    // TEAM rows for the office → team → rep drill. Same shape as a top-level
    // team so scorecard.js can render either without a second code path, and
    // deal figures only for the same reason the rep rows are.
    const prevTeams = p?.teams || null
    const teamRows = [...s.teams.entries()].map(([tk, tb]) => {
      const pb = prevTeams?.get(tk) || null
      const trows = [...tb.reps.entries()].map(([pid, rs]) => {
        const u = usersById[pid]
        if (!u) return null
        return { id: pid, name: u.name, role: u.role, ghost: !!u.ghost, active: u.active !== false,
                 prev: pb ? finish(pb.reps.get(pid) || newStats()) : null, ...finish(rs) }
      }).filter(Boolean).sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name))
      return {
        key: tk,
        label: tk === UNASSIGNED ? 'Unassigned' : teamLabel(usersById[tk]),
        unassigned: tk === UNASSIGNED,
        totals: finish(tb.totals),
        prev: pb ? finish(pb.totals) : null,
        rows: trows,
      }
    }).sort((a, b) => (a.unassigned - b.unassigned) || (b.totals.revenue - a.totals.revenue) || a.label.localeCompare(b.label))
    return { key: k, name: s.name || 'No office', ...st, rows, teamRows, prev: p ? finish(p) : null,
             share: org.revenue > 0 ? st.revenue / org.revenue : 0 }
  }).sort((a, b) => (a.key === '') - (b.key === '') || b.revenue - a.revenue)

  return {
    asOf,
    org, prevOrg,
    offices,
    teams,
    unmatched: [...cur.unmatched.entries()].map(([name, doors]) => ({ name, doors })).sort((a, b) => b.doors - a.doors),
    hasActivity: org.hasActivity,
    gaps: cur.gaps,
    excluded: [...excluded].map(id => usersById[id]).filter(Boolean).map(u => ({ id: u.id, name: u.name })),
    defaultTeamId: defTeam,
  }
}

// Which of a rep row's figures fall below the admin floors. Door floors only
// apply once field activity exists for the team (before the feed is wired,
// every doors figure is 0 and flagging all of them would be noise).
// (First/last knock, field time and knock days are computed but NOT shown —
// RepCard's knock webhook carries only the knock itself, per Keaton.)
// DOOR FLOORS ARE GONE with the doors display (per Keaton — RepCard's own
// door count never reconciled with ours, so the figure left the site). The
// feed still records knocks; nothing reads them. Appointments-set is the one
// floor left.
export const DEFAULT_FLOORS = { set: 1 }
export function repFlags(row, floors = DEFAULT_FLOORS) {
  const f = { ...DEFAULT_FLOORS, ...(floors || {}) }
  const flags = {}
  if (row.set < Number(f.set)) flags.set = true
  return flags
}

// Relative change for tiles: { pct, dir } or null when there is no baseline.
export function delta(cur, prev) {
  if (prev == null || cur == null || prev === 0) return null   // nothing to compare against
  const pct = ((cur - prev) / Math.abs(prev)) * 100
  return { pct, dir: pct > 0 ? 1 : pct < 0 ? -1 : 0 }
}
// Percentage-point change for rates.
export function deltaPts(cur, prev) {
  if (cur == null || prev == null) return null
  const pts = cur - prev
  if (pts === 0) return null
  return { pts, dir: pts > 0 ? 1 : -1 }
}
