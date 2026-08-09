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
import { fmt, isCanceled } from './commission'
import { teamOfSale } from './team'

export const COMP_TYPES = [
  { key: 'individual', label: 'Individual' },
  { key: 'team',       label: 'Team' },
  { key: 'squads',     label: 'Grouped Teams' },
  { key: 'company',    label: 'Company-wide' },
  { key: 'matchup',    label: 'Head-to-head' },
]
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
export const fmtScore = (value, metric) => metric === 'deals'
  ? `${Number.isInteger(value) ? value : value.toFixed(1)} deal${value === 1 ? '' : 's'}`
  : fmt(value)

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
    if (!inWindow(d, comp) || isCanceled(d)) continue   // canceled jobs don't count
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
    if (!inWindow(d, comp) || isCanceled(d)) continue   // canceled jobs don't count
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
    if (!inWindow(d, comp) || isCanceled(d)) continue
    if (sideCounts(d, side, comp, teamCtx)) {
      total   += dealValue(d, comp.metric)
      revenue += Number(d.baseline_revenue) || 0
    }
  }
  return { score: total, revenue }
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
  for (const d of deals) {
    if (!inWindow(d, comp)) continue
    const credit = comp.type === 'team'
      ? (teamCounts(d, ids, comp) ? 1 : 0)
      : comp.type === 'squads'
        ? (side && sideCounts(d, side, comp, opts.teamCtx) ? 1 : 0)
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
  } else if (comp.type === 'team') {
    entrants = (comp.participant_ids || []).map(id => ({ id, name: `${nameOf(id)}'s Team` }))
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
          : personScore(e.id, deals, comp)
      // revenue stays computed even under a manual score override.
      return { ...e, score: hasManual ? Number(override) : computed.score, revenue: computed.revenue, manual: hasManual }
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
