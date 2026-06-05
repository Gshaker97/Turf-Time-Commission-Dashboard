// ============================================================
// Competition scoring — turns a competition definition + the deals/users
// into a ranked set of entrants. Standings are derived from real deal data
// (sale_date within the window; baseline_revenue for "revenue", count for
// "deals"), with optional per-entrant manual overrides.
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

export const typeLabel   = (k) => COMP_TYPES.find(t => t.key === k)?.label   ?? k
export const metricLabel = (k) => COMP_METRICS.find(m => m.key === k)?.label ?? k
export const fmtScore = (value, metric) => metric === 'deals'
  ? `${value} deal${value === 1 ? '' : 's'}`
  : fmt(value)

const inWindow = (deal, comp) => {
  const d = deal.sale_date ?? ''
  if (comp.start_date && d < comp.start_date) return false
  if (comp.end_date && d > comp.end_date) return false
  return true
}

const sumMetric = (deals, metric) =>
  metric === 'deals' ? deals.length : deals.reduce((s, d) => s + (Number(d.baseline_revenue) || 0), 0)

// A person's score: deals in the window they set OR closed.
function personScore(userId, deals, comp) {
  const ds = deals.filter(d => inWindow(d, comp) && (d.setter_id === userId || d.closer_id === userId))
  return sumMetric(ds, comp.metric)
}

// A team's score: deals in the window any team member (manager + their reps) is on.
function teamScore(managerId, deals, users, comp) {
  const ids = new Set([managerId, ...users.filter(u => u.manager_id === managerId).map(u => u.id)])
  const ds = deals.filter(d => inWindow(d, comp) && (ids.has(d.setter_id) || ids.has(d.closer_id)))
  return sumMetric(ds, comp.metric)
}

export function competitionStatus(comp, todayISO) {
  if (comp.active === false) return 'ended'
  if (comp.start_date && todayISO < comp.start_date) return 'upcoming'
  if (comp.end_date && todayISO > comp.end_date) return 'ended'
  return 'active'
}

// Ranked entrants: [{ id, name, score, manual, rank }] sorted high → low.
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
    .map((e, i) => ({ ...e, rank: i + 1 }))
}
