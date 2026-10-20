// ============================================================
// Team moves — the pure part (migration 058).
//
// The whole point of this file is the PREVIEW: before a move is committed, say
// exactly how many deals and how much revenue change hands, and name the ones
// sitting on the boundary day. Nothing here recomputes attribution by hand —
// it builds the team_changes log the move WOULD produce and runs the real
// engine (`teamOfSale`) over both versions. Any rule that engine honours
// (dissolved teams, historical leads, the pre-log fallback, the closer
// fallback for a setter-less deal) is therefore honoured by the preview too,
// for free and without a second definition to keep in step.
// ============================================================

import { countsInTotals } from './commission'
import { buildChangesByProfile, headIdSet, managerAsOf, saleOwnerId, teamLabel, teamOfSale } from './team'

// ── Dates ───────────────────────────────────────────────────────────────────
// TODAY IN ARIZONA, which is the company's day and the one the database uses
// (`tt_today()`). Not the browser's: at 6am UTC a browser set to UTC is
// already on tomorrow, and "effective today" would then be a FUTURE date and
// get scheduled instead of applied. Everyone here is in Arizona, so the two
// normally agree — this makes them agree always.
export function azToday() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())
  } catch {
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }
}

// Plain 'yyyy-MM-dd' arithmetic, done in UTC so it can never drift a day.
export function addDays(iso, n) {
  const [y, m, d] = String(iso).split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}
export const monthStart = (iso) => `${String(iso).slice(0, 7)}-01`
export function nextMonthStart(iso) {
  const [y, m] = String(iso).split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// A plain date column formatted without going through Date(), which would
// parse '2026-10-20' as UTC midnight and render the 19th west of Greenwich.
export function fmtDay(iso, { year = false } = {}) {
  const [y, m, d] = String(iso || '').split('-')
  if (!y || !m || !d) return '—'
  return `${MONTHS[Number(m) - 1]} ${Number(d)}${year ? `, ${y}` : ''}`
}

// ── Labels ──────────────────────────────────────────────────────────────────
// A team key is a head id, 'unassigned', or a HISTORICAL lead's id (a team
// that was dissolved and never absorbed — teamOfSale returns those so a sale
// never falls into Unassigned just because its team is gone).
export function teamKeyLabel(key, users = []) {
  if (!key || key === 'unassigned') return 'Unassigned'
  const head = users.find(u => u.id === key)
  return head ? teamLabel(head) : 'Unassigned'
}

// ── The preview ─────────────────────────────────────────────────────────────
// `profileIds` move to `newManagerId` effective `effectiveDate` (a plain
// 'yyyy-MM-dd'). Returns what that does to already-recorded deals.
export function previewTeamMove({
  deals = [], users = [], teamChanges = [],
  profileIds = [], newManagerId = null, effectiveDate = null,
} = {}) {
  const ids = [...new Set(profileIds.filter(Boolean))]
  const empty = {
    effectiveDate, movingCount: 0, movingRevenue: 0, stayingCount: 0, stayingRevenue: 0,
    moving: [], boundary: [], boundaryCount: 0, boundaryRevenue: 0, perPerson: [],
  }
  if (!ids.length || !effectiveDate) return empty

  const usersById = Object.fromEntries(users.map(u => [u.id, u]))
  const heads = headIdSet(users)
  const before = buildChangesByProfile(teamChanges)

  // The log as it WOULD be. old_manager_id matters only when the new entry
  // ends up first for that person, in which case it is the pre-log state —
  // so it is resolved from the existing log as of the same date.
  const synthetic = ids.map((pid, i) => ({
    id: `preview-${i}`,
    profile_id: pid,
    old_manager_id: managerAsOf(before, usersById[pid], effectiveDate),
    new_manager_id: newManagerId,
    effective_date: effectiveDate,
    // Sorts last among same-day entries, so an existing move already dated
    // that day is treated as earlier — which is what committing would do.
    changed_at: '9999-12-31T00:00:00Z',
  }))
  const after = buildChangesByProfile([...teamChanges, ...synthetic])

  const idSet = new Set(ids)
  const per = new Map(ids.map(id => [id, {
    id, name: usersById[id]?.name || '—',
    movingCount: 0, movingRevenue: 0, stayingCount: 0, stayingRevenue: 0,
    fromKey: null, toKey: null,
  }]))

  const moving = []
  for (const d of deals) {
    const owner = saleOwnerId(d)
    if (!owner || !idSet.has(owner) || !d.sale_date) continue
    // Canceled and hidden deals count nowhere (convention #4), so moving one
    // between teams changes no figure and listing it would overstate the move.
    if (!countsInTotals(d)) continue

    const revenue = Number(d.baseline_revenue) || 0
    const fromKey = teamOfSale(owner, d.sale_date, usersById, heads, before)
    const toKey   = teamOfSale(owner, d.sale_date, usersById, heads, after)
    const row = per.get(owner)
    if (fromKey === toKey) {
      row.stayingCount++; row.stayingRevenue += revenue
      continue
    }
    row.movingCount++; row.movingRevenue += revenue
    row.fromKey ??= fromKey
    row.toKey   ??= toKey
    moving.push({
      id: d.id,
      name: d.deal_name || d.customer_name || 'Deal',
      saleDate: String(d.sale_date).slice(0, 10),
      revenue, ownerId: owner, fromKey, toKey,
    })
  }

  // Newest first: the deals nearest the boundary are the ones worth reading.
  moving.sort((a, b) => b.saleDate.localeCompare(a.saleDate))
  // THE LINE THAT MATTERS: deals dated exactly on the effective day. A move
  // is inclusive of its own date, so these go to the new team — push the date
  // out by one and they stay put. Nothing else on the card says that.
  const boundary = moving.filter(m => m.saleDate === effectiveDate)
  const rows = [...per.values()]

  return {
    effectiveDate,
    moving,
    movingCount: moving.length,
    movingRevenue: moving.reduce((s, m) => s + m.revenue, 0),
    stayingCount: rows.reduce((s, r) => s + r.stayingCount, 0),
    stayingRevenue: rows.reduce((s, r) => s + r.stayingRevenue, 0),
    boundary,
    boundaryCount: boundary.length,
    boundaryRevenue: boundary.reduce((s, m) => s + m.revenue, 0),
    perPerson: rows,
  }
}

// What CHANGING an existing log entry's date would do — the same question in
// reverse, so the correction dialog can state the consequence in the same
// terms as the move dialog. Rebuilds the log with that one row re-dated.
export function previewDateChange({ deals = [], users = [], teamChanges = [], changeId, effectiveDate } = {}) {
  if (!changeId || !effectiveDate) return { movingCount: 0, movingRevenue: 0, moving: [] }
  const row = teamChanges.find(c => c.id === changeId)
  if (!row) return { movingCount: 0, movingRevenue: 0, moving: [] }

  const usersById = Object.fromEntries(users.map(u => [u.id, u]))
  const heads = headIdSet(users)
  const before = buildChangesByProfile(teamChanges)
  const after  = buildChangesByProfile(
    teamChanges.map(c => (c.id === changeId ? { ...c, effective_date: effectiveDate } : c))
  )

  const moving = []
  for (const d of deals) {
    const owner = saleOwnerId(d)
    if (owner !== row.profile_id || !d.sale_date || !countsInTotals(d)) continue
    const fromKey = teamOfSale(owner, d.sale_date, usersById, heads, before)
    const toKey   = teamOfSale(owner, d.sale_date, usersById, heads, after)
    if (fromKey === toKey) continue
    moving.push({
      id: d.id,
      name: d.deal_name || d.customer_name || 'Deal',
      saleDate: String(d.sale_date).slice(0, 10),
      revenue: Number(d.baseline_revenue) || 0,
      fromKey, toKey,
    })
  }
  moving.sort((a, b) => b.saleDate.localeCompare(a.saleDate))
  return { moving, movingCount: moving.length, movingRevenue: moving.reduce((s, m) => s + m.revenue, 0) }
}

// Everyone who currently reports to one of `ids` — the "bring their reports
// along" set. One hop only, matching the Admin cascade: moving a lead offers
// to move their direct reports, not the whole sub-tree, because a sub-tree
// here is a team inside a team and that is a different decision.
export function directReportsOf(ids = [], users = []) {
  const set = new Set(ids.filter(Boolean))
  return users.filter(u => u.manager_id && set.has(u.manager_id) && !set.has(u.id) && u.active !== false)
}
