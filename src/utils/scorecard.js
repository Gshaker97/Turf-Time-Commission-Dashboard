// ── Scorecard: the ONE rule for "who am I looking at" ────────────────────
//
// The Dashboard answers the same question — how are we doing — at four levels:
// the company, one office, one team, one rep. Before the merge, the Dashboard
// and the Performance page each answered a slice of that with their own
// vocabulary, and the two disagreed: "Set" was DEALS on one page and
// APPOINTMENTS on the other, "Revenue" was everything-touched on one and
// owner-credited on the other. One page with one scope model makes that
// impossible to reintroduce — there is nowhere for a second definition to live.
//
// This module is pure and does no fetching. `buildPerformance` (perfSummary.js)
// already computes the whole tree — org, offices[] and teams[] with rep rows —
// so nothing here recomputes a metric. It SELECTS the node a scope points at,
// resolves that scope's goal, and filters deals for the trend charts.
//
// THE OFFICE ASYMMETRY, which drives several decisions below: a team is a
// property of the PERSON (date-effective), while an office is a property of the
// DEAL. So one rep can appear under two offices with the deals they sold in
// each, and — because RepCard keys doors and appointments to a rep and a day
// with no office on them — an office has NO appointment figures at all.
// `showFunnel` is false at office scope for that reason; inventing an
// attribution (say, the office where most of their deals landed) would put a
// confident number on a guess.

import { saleOwnerId, teamOfSale } from './team'
import { countsInTotals } from './commission'

export const COMPANY = { level: 'company', key: null }

export const isCompany = (scope) => !scope || scope.level === 'company'

// A stable, shareable token for the scope — this is what goes in the URL so a
// team lead can be sent straight to their own team.
export function scopeToParam(scope) {
  if (isCompany(scope)) return ''
  return `${scope.level}:${scope.key}`
}
export function scopeFromParam(param) {
  const s = String(param || '').trim()
  if (!s) return COMPANY
  const i = s.indexOf(':')
  if (i < 0) return COMPANY
  const level = s.slice(0, i), key = s.slice(i + 1)
  if (!key || !['team', 'office', 'rep'].includes(level)) return COMPANY
  return { level, key }
}

// Does this deal belong to the scope? Used for the trend series, which are
// computed from raw deals rather than from a window's accumulation.
export function scopeFilter(scope, teamCtx) {
  if (isCompany(scope)) return () => true
  const { usersById = {}, heads = new Set(), changesByProfile = {} } = teamCtx || {}
  if (scope.level === 'office') {
    const want = String(scope.key || '').trim().toLowerCase()
    return (d) => String(d.office || '').trim().toLowerCase() === want
  }
  if (scope.level === 'rep') {
    // Owner-credited, matching how revenue is counted everywhere else: the
    // setter, falling back to the closer. A lead close is NOT the closer's deal.
    return (d) => saleOwnerId(d) === scope.key
  }
  // team — date-effective, so moving a rep never rewrites which team a past
  // sale belongs to.
  return (d) => teamOfSale(saleOwnerId(d), d.sale_date, usersById, heads, changesByProfile) === scope.key
}

// The node a scope points at, plus its children for the drill table.
//   groupBy — only consulted at company level: 'team' | 'office'.
// Returns null when the scope names something the current range has no data
// for (a team with no sales, a rep who left), so the page can fall back.
export function pickScope(perf, scope, groupBy = 'team') {
  if (!perf) return null

  if (isCompany(scope)) {
    const children = groupBy === 'office'
      ? perf.offices.map(o => ({
          kind: 'office', key: o.key, label: o.name, stats: o, prev: o.prev,
          sub: o.share > 0 ? `${Math.round(o.share * 100)}% of revenue` : null,
          drillable: !!o.key,          // the "No office" bucket has nothing to open
        }))
      : perf.teams.map(t => ({
          kind: 'team', key: t.key, label: t.label, stats: t.totals, prev: t.prev,
          sub: t.members ? `${t.members} rep${t.members === 1 ? '' : 's'}` : null,
          drillable: true,
        }))
    return {
      level: 'company', key: null, title: 'Company',
      stats: perf.org, prev: perf.prevOrg,
      children, childKind: groupBy === 'office' ? 'Offices' : 'Teams',
      showFunnel: true,
    }
  }

  if (scope.level === 'office') {
    const o = perf.offices.find(x => x.key === scope.key)
    if (!o) return null
    return {
      level: 'office', key: o.key, title: o.name,
      stats: o, prev: o.prev,
      children: (o.rows || []).map(r => ({
        kind: 'rep', key: r.id, label: r.name, stats: r, prev: r.prev,
        ghost: r.ghost, drillable: true,
      })),
      childKind: 'Reps',
      // See the header note — an office has no appointment or door figures.
      showFunnel: false,
      funnelNote: 'Doors and appointments are recorded against a rep and a day, never an office, so they cannot be split this way. Open a team or a rep to see them.',
    }
  }

  if (scope.level === 'team') {
    const t = perf.teams.find(x => x.key === scope.key)
    if (!t) return null
    return {
      level: 'team', key: t.key, title: t.label,
      stats: t.totals, prev: t.prev,
      children: t.rows.map(r => ({
        kind: 'rep', key: r.id, label: r.name, stats: r, prev: r.prev,
        ghost: r.ghost, sub: r.isHead ? 'lead' : (r.member ? null : 'moved teams'),
        drillable: true,
      })),
      childKind: 'Reps', showFunnel: true,
    }
  }

  // rep — find them on whichever team carries their row
  for (const t of perf.teams) {
    const r = t.rows.find(x => x.id === scope.key)
    if (r) {
      return {
        level: 'rep', key: r.id, title: r.name,
        stats: r, prev: r.prev, children: [], childKind: null,
        showFunnel: true, parentTeam: { key: t.key, label: t.label },
      }
    }
  }
  return null
}

// The goal for a scope, and where it came from — so the UI can say whether it
// is editable here and what it is a sum of.
//   companyGoal — monthly_goals, office ''
//   officeGoals — { [office]: target } from monthly_goals (migration 053)
//   repGoals    — { [profileId]: target } from rep_goals scope 'rep'
//   teamGoals   — { [headId]: target }    from rep_goals scope 'team'
// A team with no goal of its own falls back to the SUM of its members' goals,
// which is almost always what a lead means by "the team's number".
export function resolveScopeGoal(node, { companyGoal, officeGoals = {}, repGoals = {}, teamGoals = {} } = {}) {
  if (!node) return { target: null, source: null }
  if (node.level === 'company') return { target: companyGoal ?? null, source: 'company', editable: true }
  if (node.level === 'office') {
    const t = officeGoals[node.title] ?? officeGoals[node.key] ?? null
    return { target: t, source: 'office', editable: true }
  }
  if (node.level === 'rep') return { target: repGoals[node.key] ?? null, source: 'rep', editable: false }

  const own = teamGoals[node.key]
  if (own != null) return { target: own, source: 'team', editable: false }
  const summed = node.children.reduce((s, c) => s + (repGoals[c.key] || 0), 0)
  return { target: summed > 0 ? summed : null, source: 'team-sum', editable: false }
}

// ── Trend series ─────────────────────────────────────────────────────────
// Both charts are computed from raw deals so they follow the scope, not the
// page's date range — the point of a trend is the months around the one you
// are looking at.

const ymOf = (iso) => String(iso || '').slice(0, 7)     // sale_date is a plain DATE column, safe to slice

// `months` newest-last, e.g. 12 → last 12 including the current one.
export function monthlySeries(deals, scope, teamCtx, { months = 12, todayISO } = {}) {
  const keep = scopeFilter(scope, teamCtx)
  const now = todayISO ? new Date(todayISO + 'T12:00:00') : new Date()
  const slots = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    slots.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleString('en-US', { month: 'short' }),
      revenue: 0, deals: 0,
    })
  }
  const byKey = new Map(slots.map(s => [s.key, s]))
  for (const d of deals) {
    if (!d.sale_date || !countsInTotals(d) || !keep(d)) continue
    const slot = byKey.get(ymOf(d.sale_date))
    if (!slot) continue
    slot.revenue += parseFloat(d.baseline_revenue) || 0
    slot.deals += 1
  }
  return slots
}

// Sun–Sat weeks, oldest first, last one flagged `current`.
export function weeklySeries(deals, scope, teamCtx, { weeks = 8, todayISO } = {}) {
  const keep = scopeFilter(scope, teamCtx)
  const now = todayISO ? new Date(todayISO + 'T12:00:00') : new Date()
  const thisSunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay())
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const slots = []
  for (let i = weeks - 1; i >= 0; i--) {
    const from = new Date(thisSunday.getFullYear(), thisSunday.getMonth(), thisSunday.getDate() - i * 7)
    const to   = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6)
    slots.push({
      from: iso(from), to: iso(to),
      label: from.toLocaleString('en-US', { month: 'numeric', day: 'numeric' }),
      revenue: 0, deals: 0, current: i === 0,
    })
  }
  for (const d of deals) {
    if (!d.sale_date || !countsInTotals(d) || !keep(d)) continue
    const slot = slots.find(s => d.sale_date >= s.from && d.sale_date <= s.to)
    if (!slot) continue
    slot.revenue += parseFloat(d.baseline_revenue) || 0
    slot.deals += 1
  }
  return slots
}

// The deals behind a rep's figures, newest first — the rep scope has no
// children to list, so it shows the work instead.
export function repDeals(deals, repId, { from, to } = {}) {
  return deals
    .filter(d => countsInTotals(d) && saleOwnerId(d) === repId && d.sale_date &&
                 (!from || d.sale_date >= from) && (!to || d.sale_date <= to))
    .sort((a, b) => String(b.sale_date).localeCompare(String(a.sale_date)))
}
