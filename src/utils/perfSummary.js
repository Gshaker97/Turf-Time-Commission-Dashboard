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
//     day; RAN (status completed/sold) credits whoever ran it — set it and
//     ran it = self-gen, someone else set it = lead; SOLD is a ran that closed.
//   • Field activity: day rows credit profile_id on activity_date.
//   • A rep who moved teams mid-range appears under EACH team with only the
//     work attributed there, so a team's total row always equals the sum of
//     its rep rows. Current members with nothing in the range still get a
//     row (zeros) so an idle rep is visible, not hidden.
// ============================================================
import { dealAmounts, isCanceled } from './commission'
import { saleOwnerId, teamOfSale, teamLabel } from './team'
import { RAN_STATUSES, apptDay } from './estimates'
import { summarizeActivity } from './fieldActivity'

const UNASSIGNED = 'unassigned'

const inRange = (day, from, to) => !!day && (!from || day >= from) && (!to || day <= to)

const localToday = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function newStats() {
  return { revenue: 0, job: 0, deals: 0, leadCloses: 0, leadRevenue: 0, commission: 0, set: 0, setRan: 0, ran: 0, sgRan: 0, leadRan: 0, sold: 0, activityRows: [] }
}

// Derived figures computed once at the end so partial sums never leak out.
function finish(s) {
  const act = summarizeActivity(s.activityRows)
  return {
    revenue: s.revenue, job: s.job, deals: s.deals, leadCloses: s.leadCloses, commission: s.commission,
    // Self-gen revenue (owner-credited) + baseline of the deals this rep
    // closed for another setter. At team/org level this double-counts a deal
    // whose setter and closer are both in the group — it is a per-rep view.
    leadRevenue: s.leadRevenue, totalRevenue: s.revenue + s.leadRevenue,
    avgDeal:   s.deals ? s.revenue / s.deals : null,
    markupPct: s.revenue > 0 ? ((s.job - s.revenue) / s.revenue) * 100 : null,
    set: s.set, setRan: s.setRan, ran: s.ran, sgRan: s.sgRan, leadRan: s.leadRan, sold: s.sold,
    // Conversion rates (per Keaton): set → ran is a SETTER stat — of the
    // appointments this rep set, how many ran (whoever ran them), so a
    // closer's lead volume never inflates it; self-gen ran → self-gen deals
    // (owner-credited deals ÷ self-gen appointments ran); leads ran → lead
    // closes. `closeRate` is RepCard's own sold outcome ÷ ran.
    showRate:      s.set ? (s.setRan / s.set) * 100 : null,
    sgCloseRate:   s.sgRan ? (s.deals / s.sgRan) * 100 : null,
    leadCloseRate: s.leadRan ? (s.leadCloses / s.leadRan) * 100 : null,
    closeRate:     s.ran ? (s.sold / s.ran) * 100 : null,
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
function accumulate({ deals, leads, activity, teamCtx, from, to, defaultTeamId = null, excluded = new Set() }) {
  const teamOf = makeTeamOf(teamCtx, defaultTeamId)
  const out = (pid) => !!pid && excluded.has(pid)

  const org = newStats()
  const offices = new Map()          // office key (lc) → stats; '' = no office
  const teams = new Map()            // teamKey → { totals, reps: Map(repId → stats) }
  const unmatched = new Map()        // rep_name → doors (activity rows with no profile)

  const team = (k) => {
    if (!teams.has(k)) teams.set(k, { totals: newStats(), reps: new Map() })
    return teams.get(k)
  }
  const rep = (k, pid) => {
    const t = team(k)
    if (!t.reps.has(pid)) t.reps.set(pid, newStats())
    return t.reps.get(pid)
  }
  const office = (name) => {
    const k = String(name || '').trim().toLowerCase()
    if (!offices.has(k)) offices.set(k, { name: String(name || '').trim(), ...newStats() })
    return offices.get(k)
  }

  for (const d of deals) {
    if (isCanceled(d) || !inRange(d.sale_date, from, to)) continue
    const owner = saleOwnerId(d)
    if (out(owner)) continue                       // an excluded person's deal leaves this page entirely
    const a = dealAmounts(d)
    const key = teamOf(owner, d.sale_date)
    const off = office(d.office)
    for (const s of [org, off, team(key).totals]) {
      s.revenue += a.baseline; s.job += a.job; s.deals += 1
    }
    // REP commission only (setter + closer shares) — never overrides. Org and
    // office both take the deal's whole rep commission, so the offices always
    // sum to the org figure; the per-team/per-rep numbers below instead split
    // it by who earned which share.
    org.commission += a.repCommission
    off.commission += a.repCommission
    if (owner) { const r = rep(key, owner); r.revenue += a.baseline; r.job += a.job; r.deals += 1 }
    // Commission follows each rep's own share to each rep's own team.
    if (d.setter_id) {
      const k = teamOf(d.setter_id, d.sale_date)
      rep(k, d.setter_id).commission += a.setter; team(k).totals.commission += a.setter
    }
    if (d.closer_id && d.closer_id !== d.setter_id && !out(d.closer_id)) {
      const k = teamOf(d.closer_id, d.sale_date)
      rep(k, d.closer_id).commission += a.closer; team(k).totals.commission += a.closer
      // A LEAD CLOSE: the setter keeps the deal (owner credit above); the
      // closer is credited with having closed a lead — same split the Home
      // card and Dashboard use, never an extra deal. Its baseline feeds the
      // closer's TOTAL revenue (self-gen revenue + lead-close revenue).
      if (d.setter_id) {
        for (const s of [org, team(k).totals, rep(k, d.closer_id)]) { s.leadCloses += 1; s.leadRevenue += a.baseline }
      }
    }
    if (!d.setter_id && !d.closer_id) team(key).totals.commission += a.repCommission
  }

  for (const l of leads) {
    const day = apptDay(l.appointment_at)
    if (!inRange(day, from, to)) continue
    const setter = out(l.setter_id) ? null : l.setter_id
    if (setter) {
      const k = teamOf(setter, day)
      org.set += 1; team(k).totals.set += 1; rep(k, setter).set += 1
    }
    if (!RAN_STATUSES.has(l.status)) continue
    // The SETTER gets "my appointment ran" credit no matter who ran it.
    if (setter) {
      const k = teamOf(setter, day)
      org.setRan += 1; team(k).totals.setRan += 1; rep(k, setter).setRan += 1
    }
    const ranBy = l.closer_id || l.setter_id
    if (!ranBy || out(ranBy)) continue
    const selfGen = !l.setter_id || l.setter_id === ranBy
    const k = teamOf(ranBy, day)
    const sold = l.status === 'sold'
    for (const s of [org, team(k).totals, rep(k, ranBy)]) {
      s.ran += 1
      if (selfGen) s.sgRan += 1; else s.leadRan += 1
      if (sold) s.sold += 1
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

  return { org, offices, teams, unmatched }
}

// The team a user is on as of `asOf` (their own id if they head one).
const memberTeam = (u, asOf, teamCtx) =>
  teamOfSale(u.id, asOf, teamCtx.usersById, teamCtx.heads, teamCtx.changesByProfile)

// opts.defaultTeamId — head id that adopts everything Unassigned (null = keep
// an Unassigned section). opts.excludedIds — profile ids removed from this
// page altogether (see makeTeamOf).
export function buildPerformance({
  deals = [], leads = [], activity = [], users = [], teamCtx,
  range = {}, prev = null, defaultTeamId = null, excludedIds = [],
}) {
  const { usersById, heads } = teamCtx
  const today = localToday()
  const asOf = range.to && range.to < today ? range.to : today
  const excluded = new Set((excludedIds || []).filter(Boolean))
  const defTeam = defaultTeamId && usersById[defaultTeamId] ? defaultTeamId : null
  const acc = (from, to) => accumulate({ deals, leads, activity, teamCtx, from, to, defaultTeamId: defTeam, excluded })

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
    const members = roster.get(key) || new Set()
    const repIds = new Set([...members, ...bucket.reps.keys()])
    const head = key !== UNASSIGNED ? usersById[key] : null
    const rows = []
    for (const pid of repIds) {
      const u = usersById[pid]
      if (!u) continue
      const stats = finish(bucket.reps.get(pid) || newStats())
      rows.push({
        id: pid, name: u.name, role: u.role, ghost: !!u.ghost, active: u.active !== false,
        isHead: pid === key,
        member: members.has(pid),                 // on this team as of the range end
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
    return { key: k, name: s.name || 'No office', ...st, prev: p ? finish(p) : null,
             share: org.revenue > 0 ? st.revenue / org.revenue : 0 }
  }).sort((a, b) => (a.key === '') - (b.key === '') || b.revenue - a.revenue)

  return {
    asOf,
    org, prevOrg,
    offices,
    teams,
    unmatched: [...cur.unmatched.entries()].map(([name, doors]) => ({ name, doors })).sort((a, b) => b.doors - a.doors),
    hasActivity: org.hasActivity,
    excluded: [...excluded].map(id => usersById[id]).filter(Boolean).map(u => ({ id: u.id, name: u.name })),
    defaultTeamId: defTeam,
  }
}

// Which of a rep row's figures fall below the admin floors. Door floors only
// apply once field activity exists for the team (before the feed is wired,
// every doors figure is 0 and flagging all of them would be noise).
// (First/last knock, field time and knock days are computed but NOT shown —
// RepCard's knock webhook carries only the knock itself, per Keaton.)
export const DEFAULT_FLOORS = { doors_per_day: 5, set: 1 }
export function repFlags(row, floors = DEFAULT_FLOORS, teamHasActivity = false) {
  const f = { ...DEFAULT_FLOORS, ...(floors || {}) }
  const flags = {}
  if (teamHasActivity) {
    if (row.doors <= 0) flags.doors = true
    if ((row.doorsPerDay ?? 0) < Number(f.doors_per_day)) flags.doorsPerDay = true
  }
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
