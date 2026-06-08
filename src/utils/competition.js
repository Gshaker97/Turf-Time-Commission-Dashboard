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
import { fmt } from './commission'

export const COMP_TYPES = [
  { key: 'individual', label: 'Individual' },
  { key: 'team',       label: 'Team' },
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

function personScore(userId, deals, comp) {
  let total = 0
  for (const d of deals) {
    if (!inWindow(d, comp)) continue
    const credit = personCredit(d, userId, comp)
    if (credit) total += dealValue(d, comp.metric) * credit
  }
  return total
}

// A team's score: deals in the window the team is credited for under the chosen
// credit_mode (split behaves like 'both' at the team level — counted once).
function teamScore(managerId, deals, users, comp) {
  const ids = new Set([managerId, ...users.filter(u => u.manager_id === managerId).map(u => u.id)])
  let total = 0
  for (const d of deals) {
    if (!inWindow(d, comp)) continue
    const setterIn  = ids.has(d.setter_id)
    const solo      = !d.closer_id || d.setter_id === d.closer_id
    const closerIn  = ids.has(d.closer_id ?? d.setter_id)
    let counts
    switch (comp.credit_mode || 'both') {
      case 'self_gen': counts = solo && setterIn; break
      case 'setter':   counts = setterIn; break
      case 'closer':   counts = closerIn; break
      default:         counts = setterIn || closerIn; break  // both / split
    }
    if (counts) total += dealValue(d, comp.metric)
  }
  return total
}

export function competitionStatus(comp, todayISO) {
  if (comp.active === false) return 'ended'
  if (comp.start_date && todayISO < comp.start_date) return 'upcoming'
  if (comp.end_date && todayISO > comp.end_date) return 'ended'
  return 'active'
}

// Ranked entrants: [{ id, name, score, manual, rank, target, earned, progress }]
// sorted high → low. target/earned/progress are populated for 'target' goals.
export function competitionStandings(comp, deals = [], users = []) {
  const nameOf = (id) => users.find(u => u.id === id)?.name ?? '—'
  let entrants = []
  if (comp.type === 'company') {
    entrants = users.filter(u => u.role === 'rep' || u.role === 'manager').map(u => ({ id: u.id, name: u.name }))
  } else if (comp.type === 'team') {
    entrants = (comp.participant_ids || []).map(id => ({ id, name: `${nameOf(id)}'s Team` }))
  } else {
    entrants = (comp.participant_ids || []).map(id => ({ id, name: nameOf(id) }))
  }

  const manual = comp.manual_scores || {}
  const target = comp.goal_mode === 'target' ? (Number(comp.goal_target) || 0) : 0
  return entrants
    .map(e => {
      const override = manual[e.id]
      const hasManual = override != null && override !== ''
      const computed = comp.type === 'team'
        ? teamScore(e.id, deals, users, comp)
        : personScore(e.id, deals, comp)
      return { ...e, score: hasManual ? Number(override) : computed, manual: hasManual }
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
