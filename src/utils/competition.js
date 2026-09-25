// ============================================================
// Competition scoring — turns a competition definition + the deals/users
// into a ranked set of entrants. Standings are derived from real deal data
// (sale_date within the window; baseline_revenue for "revenue", count for
// "deals"), with optional per-entrant manual overrides.
//
// Two axes the VP configures:
//   • goal_mode:   'race' (highest score wins) or 'target' (reach a number to
//                  earn it — drives a progress bar + "earned" state).
//   • credit_mode: how a deal's metric is attributed when the setter and closer
//                  differ — 'both' (each gets full credit, default), 'self_gen'
//                  (only solo deals), 'setter', 'closer', or 'split' (setter and
//                  closer share it by credit_split_pct = the closer's share).
// ============================================================
import { fmt, isCanceled, countsInTotals } from './commission'
import { teamOfSale, teamLabel, headIdSet } from './team'

export const COMP_TYPES = [
  { key: 'individual', label: 'Individual' },
  { key: 'team',       label: 'Team' },
  { key: 'squads',     label: 'Grouped Teams' },
  { key: 'team_avg',   label: 'Team Average (per rep)' },
  { key: 'company',    label: 'Company-wide' },
  { key: 'matchup',    label: 'Head-to-head' },
]
// A per-rep-average contest: scores are "metric ÷ reps", not raw totals.
export const perRepComp = (comp) => comp?.type === 'team_avg'
export const COMP_METRICS = [
  { key: 'revenue', label: 'Revenue (baseline)' },
  { key: 'deals',   label: 'Deals closed' },
]
export const COMP_GOAL_MODES = [
  { key: 'race',   label: 'Race — highest score wins' },
  { key: 'target', label: 'Target — reach a number to earn it' },
]
export const COMP_CREDIT_MODES = [
  { key: 'both',     label: 'Setter & closer — both get full credit' },
  { key: 'setter',   label: 'Setter only — the rep who generated the lead' },
  { key: 'closer',   label: 'Closer only — the rep who closed it' },
  { key: 'self_gen', label: 'Solo only — one rep both set AND closed it' },
  { key: 'split',    label: 'Split between setter & closer' },
]

export const typeLabel    = (k) => COMP_TYPES.find(t => t.key === k)?.label   ?? k
export const metricLabel  = (k) => COMP_METRICS.find(m => m.key === k)?.label ?? k
export const creditLabel  = (k) => COMP_CREDIT_MODES.find(c => c.key === k)?.label ?? 'Setter & closer'
export const goalModeLabel = (k) => COMP_GOAL_MODES.find(g => g.key === k)?.label ?? 'Race'
// `perRep` renders an AVERAGE ("3.5 deals / rep", "$18,400.00 / rep") — the
// score of a Team Average contest, or its goal target.
export const fmtScore = (value, metric, perRep = false) => {
  const v = Number(value) || 0
  const base = metric === 'deals'
    ? `${Number.isInteger(v) ? v : v.toFixed(1)} deal${v === 1 ? '' : 's'}`
    : fmt(v)
  return perRep ? `${base} / rep` : base
}

const inWindow = (deal, comp) => {
  const d = deal.sale_date ?? ''
  if (comp.start_date && d < comp.start_date) return false
  if (comp.end_date && d > comp.end_date) return false
  return true
}

const dealValue = (deal, metric) =>
  metric === 'deals' ? 1 : (Number(deal.baseline_revenue) || 0)

// Fraction of a deal's metric that a person earns under the competition's
// credit_mode. Solo deals (no separate closer) treat the setter as the closer.
function personCredit(deal, userId, comp) {
  const isSetter  = deal.setter_id === userId
  const solo      = !deal.closer_id || deal.setter_id === deal.closer_id
  const effCloser = deal.closer_id ?? deal.setter_id
  const isCloser  = effCloser === userId
  switch (comp.credit_mode || 'both') {
    case 'self_gen': return (solo && isSetter) ? 1 : 0
    case 'setter':   return isSetter ? 1 : 0
    case 'closer':   return isCloser ? 1 : 0
    case 'split': {
      if (solo) return isSetter ? 1 : 0
      const closerShare = comp.credit_split_pct == null ? 0.5 : Number(comp.credit_split_pct)
      let c = 0
      if (isSetter) c += (1 - closerShare)
      if (deal.closer_id === userId) c += closerShare
      return c
    }
    case 'both':
    default: return (isSetter || isCloser) ? 1 : 0
  }
}

// Every scoring fn returns { score, revenue } — revenue is the credited
// baseline $ regardless of the competition metric, so a deal-count contest
// can display the money its deals represent alongside the count.
function personScore(userId, deals, comp) {
  let total = 0, revenue = 0
  for (const d of deals) {
    if (!inWindow(d, comp) || !countsInTotals(d)) continue   // canceled/hidden jobs don't count
    const credit = personCredit(d, userId, comp)
    if (credit) {
      total   += dealValue(d, comp.metric) * credit
      revenue += (Number(d.baseline_revenue) || 0) * credit
    }
  }
  return { score: total, revenue }
}

// A team's score: deals in the window the team is credited for under the chosen
// credit_mode (split behaves like 'both' at the team level — counted once).
function teamScore(managerId, deals, users, comp) {
  const ids = new Set([managerId, ...users.filter(u => u.manager_id === managerId).map(u => u.id)])
  let total = 0, revenue = 0
  for (const d of deals) {
    if (!inWindow(d, comp) || !countsInTotals(d)) continue   // canceled/hidden jobs don't count
    if (teamCounts(d, ids, comp)) {
      total   += dealValue(d, comp.metric)
      revenue += Number(d.baseline_revenue) || 0
    }
  }
  return { score: total, revenue }
}

// Whether a team is credited for a deal under the chosen mode (ignores cancel).
function teamCounts(deal, ids, comp) {
  const setterIn = ids.has(deal.setter_id)
  const solo     = !deal.closer_id || deal.setter_id === deal.closer_id
  const closerIn = ids.has(deal.closer_id ?? deal.setter_id)
  switch (comp.credit_mode || 'both') {
    case 'self_gen': return solo && setterIn
    case 'setter':   return setterIn
    case 'closer':   return closerIn
    default:         return setterIn || closerIn
  }
}

// ── Squads ("Grouped Teams") — sides mixing whole teams + individual reps ──
// Membership is DATE-EFFECTIVE: a person belongs to a side on a given date if
// they're named directly (rep_ids) or their team AS OF THAT DATE is one of the
// side's team_ids (same teamOfSale rule as every dashboard — a mid-contest
// roster move never swings the contest retroactively). Requires opts.teamCtx
// = { usersById, heads, changesByProfile }; without it, team_ids fall back to
// current-roster membership.
function personInSide(personId, saleDate, side, teamCtx) {
  if (!personId) return false
  if ((side.rep_ids || []).includes(personId)) return true
  const teams = side.team_ids || []
  if (!teams.length) return false
  if (teamCtx) {
    const k = teamOfSale(personId, saleDate, teamCtx.usersById, teamCtx.heads, teamCtx.changesByProfile)
    return teams.includes(k)
  }
  return false
}

// Whether a side is credited for a deal under the chosen mode (like teamCounts).
function sideCounts(deal, side, comp, teamCtx) {
  const setterIn = personInSide(deal.setter_id, deal.sale_date, side, teamCtx)
  const solo     = !deal.closer_id || deal.setter_id === deal.closer_id
  const closerIn = personInSide(deal.closer_id ?? deal.setter_id, deal.sale_date, side, teamCtx)
  switch (comp.credit_mode || 'both') {
    case 'self_gen': return solo && setterIn
    case 'setter':   return setterIn
    case 'closer':   return closerIn
    default:         return setterIn || closerIn
  }
}

function sideScore(side, deals, comp, teamCtx) {
  let total = 0, revenue = 0
  for (const d of deals) {
    if (!inWindow(d, comp) || !countsInTotals(d)) continue
    if (sideCounts(d, side, comp, teamCtx)) {
      total   += dealValue(d, comp.metric)
      revenue += Number(d.baseline_revenue) || 0
    }
  }
  return { score: total, revenue }
}

// ── Team Average ("per rep") — a team's metric divided by its head count ──
// Per Keaton: teams compete on average production per rep, and part-timers
// can be left out. `comp.excluded_ids` (migration 047) removes a person from
// BOTH sides of the average — their deals don't count for the team and they
// aren't counted as a rep — so pulling someone out never warps the number.
//
// Numerator: the team's in-window, non-canceled deals, attributed like every
// team view (date-effective teamOfSale by sale date; current-roster fallback
// when no teamCtx), credited per credit_mode, skipping excluded people.
// Denominator ("roster"): active members of the team as of the window end
// (today while it's running) ∪ everyone who actually earned credit in the
// window (a rep who left mid-contest still counts on both sides) − excluded.
// One population on both sides is what makes it an average and not a ratio
// of two different groups.
const localToday = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Membership test for a Team Average team, built ONCE per team: (personId,
// dateISO) → is this person on `headId`'s team that day. With a teamCtx it is
// the date-effective rule (`teamOfSale`); without one (Home's card) it falls
// back to the CURRENT grouping — `teamKeyFor`, the same rule the People chart
// draws — never raw manager_id, which would put a manager who reports to a
// director on the director's team as well as their own.
function teamAvgMembership(headId, users, teamCtx) {
  if (teamCtx) {
    const { usersById, heads, changesByProfile } = teamCtx
    return (pid, date) => !!pid && teamOfSale(pid, date, usersById, heads, changesByProfile) === headId
  }
  // No history → teamOfSale with an empty change log = today's grouping,
  // including the one-hop chain through a demoted ex-head (Tyler → Colt →
  // Jared) that teamKeyFor alone would file as Unassigned.
  const usersById = Object.fromEntries(users.map(u => [u.id, u]))
  const heads = headIdSet(users)
  const current = new Set(users.filter(u => teamOfSale(u.id, null, usersById, heads, {}) === headId).map(u => u.id))
  return (pid) => !!pid && current.has(pid)
}

// The people a deal is credited to for a Team Average team — [] if none.
// The deal itself counts ONCE (like teamCounts/sideCounts); the ids are
// returned so the roster can include everyone who actually earned credit.
function teamAvgCredited(deal, comp, onTeamFn, excluded) {
  const onTeam = (pid, date) => !!pid && !excluded.has(pid) && onTeamFn(pid, date)
  const effCloser = deal.closer_id ?? deal.setter_id
  const solo      = !deal.closer_id || deal.setter_id === deal.closer_id
  const setterOk  = onTeam(deal.setter_id, deal.sale_date)
  const closerOk  = onTeam(effCloser, deal.sale_date)
  switch (comp.credit_mode || 'both') {
    case 'self_gen': return (solo && setterOk) ? [deal.setter_id] : []
    case 'setter':   return setterOk ? [deal.setter_id] : []
    case 'closer':   return closerOk ? [effCloser] : []
    default: {
      const ids = []
      if (setterOk) ids.push(deal.setter_id)
      if (closerOk && effCloser !== deal.setter_id) ids.push(effCloser)
      return ids
    }
  }
}

// Everyone who WOULD count toward a Team Average team before exclusions:
// active members as of the window end (today while it's running) ∪ everyone
// who earned credit in the window. This is the ONE roster rule — the engine
// divides by it (minus `excluded_ids`) and the modal renders its chips from
// it, so the "N of M count" label and the card's "÷ N reps" always agree.
// Deactivation isn't date-logged, so a deactivated member who sold nothing in
// the window drops out even from a finished contest; `excluded_ids` is the
// admin's explicit tool either way.
export function teamAvgRoster(headId, deals = [], users = [], comp = {}, teamCtx = null) {
  const onTeam = teamAvgMembership(headId, users, teamCtx)
  const none = new Set()
  const ids = new Set()
  for (const d of deals) {
    if (!inWindow(d, comp) || !countsInTotals(d)) continue
    teamAvgCredited(d, comp, onTeam, none).forEach(p => ids.add(p))
  }
  const today = localToday()
  const asOf  = comp.end_date && comp.end_date < today ? comp.end_date : today
  for (const u of users) {
    if (u.active === false) continue
    if (onTeam(u.id, asOf)) ids.add(u.id)
  }
  return [...ids]
}

function teamAvgScore(headId, deals, users, comp, teamCtx) {
  const excluded = new Set(comp.excluded_ids || [])
  const onTeam = teamAvgMembership(headId, users, teamCtx)
  let total = 0, revenue = 0
  for (const d of deals) {
    if (!inWindow(d, comp) || !countsInTotals(d)) continue
    if (!teamAvgCredited(d, comp, onTeam, excluded).length) continue
    total   += dealValue(d, comp.metric)
    revenue += Number(d.baseline_revenue) || 0
  }
  const roster = teamAvgRoster(headId, deals, users, comp, teamCtx).filter(id => !excluded.has(id))
  const count = roster.length
  return { score: count ? total / count : 0, revenue, total, count, roster }
}

// ── Rounds ────────────────────────────────────────────────────
// Normalized, chronologically sorted rounds (only rows with both dates count).
export function compRounds(comp) {
  return (comp.rounds || [])
    .filter(r => r && r.start && r.end)
    .slice()
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))
}

export function roundStatus(round, todayISO) {
  if (todayISO < round.start) return 'upcoming'
  if (todayISO > round.end) return 'ended'
  return 'active'
}

// Standings for ONE round: same competition rules, the round's window, scores
// reset (manual competition-level overrides don't apply — rounds are computed;
// the admin override for a round is its winner_id, not its scores).
export function roundStandings(comp, round, deals = [], users = [], opts = {}) {
  return competitionStandings(
    { ...comp, start_date: round.start, end_date: round.end, manual_scores: {} },
    deals, users, opts)
}

// The round's winner entrant (or null while nobody has scored / pre-round):
// winner_id override wins; otherwise the top of the round's standings.
export function roundWinner(comp, round, deals = [], users = [], opts = {}) {
  const standings = roundStandings(comp, round, deals, users, opts)
  if (round.winner_id) {
    const w = standings.find(e => e.id === round.winner_id)
    if (w) return { ...w, overridden: true }
    return { id: round.winner_id, name: '—', score: 0, overridden: true }
  }
  const top = standings[0]
  return top && top.score > 0 ? top : null
}

// The deals that make up an entrant's score, for the admin drill-down:
// [{ deal, value, credit, contribution }] newest-first. `value` is the deal's
// metric (baseline or 1), `credit` the fraction earned, `contribution` the
// product that's added to the score.
export function competitionEntryDeals(comp, entrantId, deals = [], users = [], opts = {}) {
  const out = []
  const ids = comp.type === 'team'
    ? new Set([entrantId, ...users.filter(u => u.manager_id === entrantId).map(u => u.id)])
    : null
  const side = comp.type === 'squads' ? (comp.sides || []).find(s => s.id === entrantId) : null
  const avgOnTeam  = comp.type === 'team_avg' ? teamAvgMembership(entrantId, users, opts.teamCtx) : null
  const avgExcluded = new Set(comp.excluded_ids || [])
  for (const d of deals) {
    if (!inWindow(d, comp)) continue
    const credit = comp.type === 'team'
      ? (teamCounts(d, ids, comp) ? 1 : 0)
      : comp.type === 'squads'
        ? (side && sideCounts(d, side, comp, opts.teamCtx) ? 1 : 0)
        : comp.type === 'team_avg'
          ? (teamAvgCredited(d, comp, avgOnTeam, avgExcluded).length ? 1 : 0)
          : personCredit(d, entrantId, comp)
    if (!credit) continue
    // Include canceled deals too, but flagged & worth 0 — they show struck-out
    // so an admin can see what WOULD count if the job weren't canceled.
    const canceled = isCanceled(d)
    const value = dealValue(d, comp.metric)
    out.push({ deal: d, value, credit, contribution: canceled ? 0 : value * credit, canceled })
  }
  return out.sort((a, b) => ((a.deal.sale_date ?? '') < (b.deal.sale_date ?? '') ? 1 : -1))
}

export function competitionStatus(comp, todayISO) {
  if (comp.active === false) return 'ended'
  if (comp.start_date && todayISO < comp.start_date) return 'upcoming'
  if (comp.end_date && todayISO > comp.end_date) return 'ended'
  return 'active'
}

// Ranked entrants: [{ id, name, score, manual, rank, target, earned, progress }]
// sorted high → low. target/earned/progress are populated for 'target' goals.
// opts.hiddenIds: entrant ids to drop from the displayed standings (ghost users
// for non-admins). Their deals still feed team scores — only their own row is
// removed, then ranks are renumbered.
export function competitionStandings(comp, deals = [], users = [], opts = {}) {
  const nameOf = (id) => users.find(u => u.id === id)?.name ?? '—'
  const hidden = opts.hiddenIds
  let entrants = []
  if (comp.type === 'company') {
    entrants = users.filter(u => ['rep', 'manager', 'director', 'vp'].includes(u.role)).map(u => ({ id: u.id, name: u.name }))
  } else if (comp.type === 'team' || comp.type === 'team_avg') {
    entrants = (comp.participant_ids || []).map(id => ({ id, name: teamLabel(users.find(u => u.id === id)) }))
  } else if (comp.type === 'squads') {
    entrants = (comp.sides || []).map(s => ({ id: s.id, name: s.name || 'Unnamed side' }))
  } else {
    entrants = (comp.participant_ids || []).map(id => ({ id, name: nameOf(id) }))
  }
  if (hidden && hidden.size) entrants = entrants.filter(e => !hidden.has(e.id))

  const manual = comp.manual_scores || {}
  const target = comp.goal_mode === 'target' ? (Number(comp.goal_target) || 0) : 0
  return entrants
    .map(e => {
      const override = manual[e.id]
      const hasManual = override != null && override !== ''
      const computed = comp.type === 'team'
        ? teamScore(e.id, deals, users, comp)
        : comp.type === 'squads'
          ? sideScore((comp.sides || []).find(s => s.id === e.id) || {}, deals, comp, opts.teamCtx)
          : comp.type === 'team_avg'
            ? teamAvgScore(e.id, deals, users, comp, opts.teamCtx)
            : personScore(e.id, deals, comp)
      // revenue stays computed even under a manual score override. Team
      // Average entries also carry the raw total and head count so the page
      // can show "12 deals ÷ 4 reps" under the average.
      return { ...e, score: hasManual ? Number(override) : computed.score, revenue: computed.revenue, manual: hasManual,
               total: computed.total, count: computed.count }
    })
    .sort((a, b) => b.score - a.score)
    .map((e, i) => ({
      ...e,
      rank: i + 1,
      target,
      earned: target > 0 && e.score >= target,
      progress: target > 0 ? Math.min(e.score / target, 1) : null,
    }))
}
