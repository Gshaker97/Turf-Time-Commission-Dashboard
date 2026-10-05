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
//
// There is a FIFTH node, `office-team` — one team's work inside one office
// (per Keaton: "how do I filter by team while viewing office stats?"). The two
// axes used never cross: offices drilled straight to reps, and a team at
// company level mixed every office together. It keys as `<officeKey>|<teamKey>`
// because neither half identifies it alone, and it inherits the office's
// funnel rule for the asymmetry above.

import { saleOwnerId, teamOfSale } from './team'
import { countsInTotals } from './commission'

export const COMPANY = { level: 'company', key: null }

export const isCompany = (scope) => !scope || scope.level === 'company'

const OFFICE_FUNNEL_NOTE =
  'Doors and appointments are recorded against a rep and a day, never an office, so they cannot be split this way. Open a team or a rep to see them.'

// `<officeKey>|<teamKey>`. Split at the LAST separator: a team key is a uuid
// or 'unassigned' and can never contain one, while an office name in theory
// could.
export const officeTeamKey = (officeKey, teamKey) => `${officeKey}|${teamKey}`
export function splitOfficeTeam(key) {
  const s = String(key || '')
  const i = s.lastIndexOf('|')
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)]
}

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
  if (!key || !['team', 'office', 'office-team', 'rep'].includes(level)) return COMPANY
  return { level, key }
}

// Does this deal belong to the scope? Used for the trend series, which are
// computed from raw deals rather than from a window's accumulation.
export function scopeFilter(scope, teamCtx) {
  if (isCompany(scope)) return () => true
  const { usersById = {}, heads = new Set(), changesByProfile = {} } = teamCtx || {}
  const inOffice = (want) => (d) => String(d.office || '').trim().toLowerCase() === want
  const onTeam = (want) => (d) =>
    teamOfSale(saleOwnerId(d), d.sale_date, usersById, heads, changesByProfile) === want
  if (scope.level === 'office') return inOffice(String(scope.key || '').trim().toLowerCase())
  if (scope.level === 'office-team') {
    // BOTH, which is the whole point of the node — the deal was sold in this
    // office AND its owner was on this team on the day it sold.
    const [ok, tk] = splitOfficeTeam(scope.key)
    const office = inOffice(String(ok).trim().toLowerCase()), team = onTeam(tk)
    return (d) => office(d) && team(d)
  }
  if (scope.level === 'rep') {
    // Owner-credited, matching how revenue is counted everywhere else: the
    // setter, falling back to the closer. A lead close is NOT the closer's deal.
    return (d) => saleOwnerId(d) === scope.key
  }
  // team — date-effective, so moving a rep never rewrites which team a past
  // sale belongs to.
  return onTeam(scope.key)
}

// The node a scope points at, plus its children for the drill table.
//   groupBy — how to split the CURRENT node's children. At company level it is
//   'team' | 'office'; inside an office it is 'team' | 'rep'. Every other level
//   has one natural child kind and ignores it.
// Returns null when the scope names something the current range has no data
// for (a team with no sales, a rep who left), so the page can fall back.
export function pickScope(perf, scope, groupBy = 'team') {
  if (!perf) return null

  const repChild = (r) => ({
    kind: 'rep', key: r.id, label: r.name, stats: r, prev: r.prev,
    ghost: r.ghost, drillable: true,
  })

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
    // Teams by default: at company level you already chose Offices to get
    // here, so the question being asked is almost always "who inside it".
    const byTeam = groupBy !== 'rep'
    const children = byTeam
      ? (o.teamRows || []).map(t => ({
          kind: 'office-team', key: officeTeamKey(o.key, t.key), label: t.label,
          stats: t.totals, prev: t.prev,
          // "N reps HERE", not the roster count the company-level team rows
          // show — inside an office it can only mean "worked in this office",
          // and reusing the bare words for a different meaning is how the
          // Dashboard ended up with two definitions of "Set" in the first place.
          sub: t.rows.length ? `${t.rows.length} rep${t.rows.length === 1 ? '' : 's'} here` : null,
          drillable: true,
        }))
      : (o.rows || []).map(repChild)
    return {
      level: 'office', key: o.key, title: o.name,
      stats: o, prev: o.prev,
      children, childKind: byTeam ? 'Teams' : 'Reps',
      // See the header note — an office has no appointment or door figures.
      showFunnel: false,
      funnelNote: OFFICE_FUNNEL_NOTE,
    }
  }

  if (scope.level === 'office-team') {
    const [ok, tk] = splitOfficeTeam(scope.key)
    const o = perf.offices.find(x => x.key === ok)
    if (!o) return null
    const t = (o.teamRows || []).find(x => x.key === tk)
    if (!t) return null
    return {
      level: 'office-team', key: scope.key, title: t.label,
      // Anywhere the name travels away from the breadcrumb — a copied table,
      // the leaderboard header, the goal card — it has to carry the office or
      // it reads as the team's WHOLE number while showing one office's slice.
      // That is the two-numbers-for-one-name trap this page exists to avoid.
      fullTitle: `${t.label} · ${o.name}`,
      stats: t.totals, prev: t.prev,
      children: t.rows.map(repChild), childKind: 'Reps',
      // Inherited from the office: the appointments behind these deals carry
      // no office, so they cannot be shown for a slice of one.
      showFunnel: false,
      funnelNote: OFFICE_FUNNEL_NOTE,
      parentOffice: { key: o.key, label: o.name },
    }
  }

  if (scope.level === 'team') {
    const t = perf.teams.find(x => x.key === scope.key)
    if (!t) return null
    return {
      level: 'team', key: t.key, title: t.label,
      stats: t.totals, prev: t.prev,
      children: t.rows.map(r => ({
        ...repChild(r),
        sub: r.isHead ? 'lead' : (r.member ? null : 'moved teams'),
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
  // A team's slice of ONE office has no target anywhere, and must not borrow
  // one: a rep's goal is their whole month across every office, so summing
  // member goals here would measure Tucson against a company-wide number.
  if (node.level === 'office-team') return { target: null, source: null, editable: false }

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

// ── Rep leaderboard ──────────────────────────────────────────────────────
// Every INDIVIDUAL inside the current scope, ranked. The Dashboard's drill
// table shows teams at company level, so without this there is no at-a-glance
// view of people — which is what it is for (per Keaton, who pastes it into a
// meeting he runs).
//
// At company scope a rep who MOVED TEAMS mid-range has a row under each team
// carrying only that team's work (deliberate — it makes every team total sum).
// A leaderboard is about the PERSON, so those rows are merged back together
// here; anywhere else the scope already isolates one team or office.
export function leaderboard(perf, scope, { isAdmin = false } = {}) {
  if (!perf) return []
  let rows = []
  if (isCompany(scope)) {
    const byId = new Map()
    for (const t of perf.teams) {
      for (const r of t.rows) {
        const prevRow = byId.get(r.id)
        if (!prevRow) { byId.set(r.id, { ...r, team: t.label }); continue }
        // Same person, two teams this range — add their work together and
        // say so rather than showing them twice or picking one arbitrarily.
        byId.set(r.id, {
          ...prevRow, team: 'Moved teams',
          revenue: prevRow.revenue + r.revenue,
          deals: prevRow.deals + r.deals,
          selfGen: prevRow.selfGen + r.selfGen,
          setForOthers: prevRow.setForOthers + r.setForOthers,
          leadCloses: prevRow.leadCloses + r.leadCloses,
          leadRevenue: prevRow.leadRevenue + r.leadRevenue,
          totalRevenue: prevRow.totalRevenue + r.totalRevenue,
          commission: prevRow.commission + r.commission,
        })
      }
    }
    rows = [...byId.values()]
  } else if (scope.level === 'team') {
    const t = perf.teams.find(x => x.key === scope.key)
    rows = (t?.rows || []).map(r => ({ ...r, team: t.label }))
  } else if (scope.level === 'office') {
    const o = perf.offices.find(x => x.key === scope.key)
    rows = (o?.rows || []).map(r => ({ ...r, team: o.name }))
  } else if (scope.level === 'office-team') {
    const [ok, tk] = splitOfficeTeam(scope.key)
    const o = perf.offices.find(x => x.key === ok)
    const t = (o?.teamRows || []).find(x => x.key === tk)
    rows = (t?.rows || []).map(r => ({ ...r, team: `${t.label} · ${o.name}` }))
  } else {
    return []       // a single rep is not a leaderboard
  }

  return rows
    // Someone with nothing in the window is noise on a ranking. A setter who
    // handed everything off still shows: they own those deals.
    .filter(r => r.deals || r.leadCloses || r.revenue || r.commission)
    .filter(r => isAdmin || !r.ghost)      // ghost names stay hidden from non-admins
    .sort((a, b) => b.revenue - a.revenue || b.deals - a.deals || a.name.localeCompare(b.name))
}

// Rank the board by any column. Everything sortable is numeric except the
// name, and revenue always breaks a tie so equal counts still order sensibly.
export function sortLeaderboard(rows, key = 'revenue', dir = 'desc') {
  const mul = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    if (key === 'name') return a.name.localeCompare(b.name) * mul
    const d = ((a[key] ?? 0) - (b[key] ?? 0)) * mul
    return d || (b.revenue - a.revenue) || a.name.localeCompare(b.name)
  })
}
