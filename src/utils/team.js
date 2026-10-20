// ============================================================
// ONE rule for "what teams exist", shared by the Admin roster, the Team page,
// the Dashboard breakdown, and Weekly Stats. ROLE is the source of truth:
//
//   • The MANAGER role is what makes a team — every manager heads one, and
//     having people report to you never makes you a head (a rep with a stale
//     reports-to link pointed at them is NOT a team).
//   • Leadership exception: a DIRECTOR or VP shows as a team head when active
//     people report directly to them (e.g. Garrison's direct reports).
//   • Absorbing/dissolving a team = changing the person's ROLE; moving a lead
//     offers to bring their reports along (Admin → saveUser cascade).
// ============================================================

export function headIdSet(users = []) {
  const activeReports = new Set(
    users.filter(u => u.manager_id && u.active !== false).map(u => u.manager_id)
  )
  const ids = new Set()
  for (const u of users) {
    if (u.role === 'manager') ids.add(u.id)
    else if ((u.role === 'director' || u.role === 'vp') && activeReports.has(u.id)) ids.add(u.id)
  }
  return ids
}

// The team a person belongs to for grouping: their own if they head one, else
// the HEAD they report to. Reporting to a non-head groups as unassigned.
export function teamKeyFor(u, heads) {
  if (heads.has(u.id)) return u.id
  if (u.manager_id && heads.has(u.manager_id)) return u.manager_id
  return 'unassigned'
}

// Who a SALE belongs to for deal counts / revenue attribution — the setter
// (company convention: setter gets full revenue credit), falling back to the
// closer when no setter was recorded. Without the fallback, a deal missing
// its setter silently vanishes from every leaderboard / team breakdown while
// still counting in the company totals — the Dashboard-vs-Team mismatch.
export const saleOwnerId = (d) => d.setter_id || d.closer_id || null

// How a team is NAMED, everywhere. Teams are keyed by their HEAD, so the
// official name lives on the head's profile (profiles.team_name, migration
// 046) and is available wherever `users` is loaded — no extra fetch. Empty →
// the default "<Head>'s Team". `teamShortLabel` is for legends and donut
// slices: the official name, else the head's first name.
// (Deliberately NOT sales_teams.name — those are BONUS PODS (045), a separate
// model whose lead can be a rep who heads nothing on the org chart.)
export const teamLabel = (head) => {
  if (!head) return 'Team'
  const official = String(head.team_name || '').trim()
  return official || `${head.name || 'Team'}'s Team`
}
export const teamShortLabel = (head) => {
  if (!head) return 'Team'
  const official = String(head.team_name || '').trim()
  return official || (head.name || 'Team').split(' ')[0]
}

// ── Date-effective team membership ───────────────────────────────────────────
// Every reports-to move is date-stamped in team_changes (migration 029). A
// SALE belongs to the team its owner was on AS OF THE SALE DATE: deals before
// a move stay with the old team; deals on/after the move date go to the new
// team. Used by every team aggregate (Dashboard breakdown/filter, Team page
// comparison) so moving a rep never rewrites history.

// 'yyyy-MM-dd' in the viewer's LOCAL timezone for a stored timestamp.
// Exported because ANY display of a timestamptz as a calendar day has to use
// it: `.slice(0, 10)` reads the UTC day, which is tomorrow for anything after
// 5pm Arizona (see the timestamps-vs-days note in CLAUDE.md).
export const localDay = (ts) => {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 10)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// THE day a logged move counts from (migration 058). `effective_date` is the
// admin's answer to "when does this start counting" — a plain date column, so
// it is compared as a string like sale_date. `changed_at` only says when the
// record was MADE, which is a different question and is wrong whenever a move
// was backdated or scheduled ahead. Pre-058 rows have no effective_date, so
// they fall back to it.
export const changeDay = (c) => c?.effective_date || localDay(c?.changed_at)

// team_changes rows grouped per profile, oldest EFFECTIVE day first.
// Sorting by effective day (not changed_at) is what lets a correction
// reorder history: backdating the second of two moves genuinely makes the
// first one the later of the two, and every reader has to agree on that.
// `changed_at` breaks ties, so two moves effective the same day apply in the
// order they were recorded.
export function buildChangesByProfile(teamChanges = []) {
  const by = {}
  const sorted = [...teamChanges].sort((a, b) =>
    changeDay(a).localeCompare(changeDay(b)) || String(a.changed_at).localeCompare(String(b.changed_at)))
  for (const c of sorted) (by[c.profile_id] ||= []).push(c)
  return by
}

// Who a user reported to on a given date. Before their first logged move =
// that move's OLD lead; after the latest = current. No log → current.
export function managerAsOf(changesByProfile, user, dateISO) {
  const list = user ? changesByProfile?.[user.id] : null
  if (!list?.length || !dateISO) return user?.manager_id ?? null
  // State before the first logged move. A first entry of "Unassigned → X" is
  // almost always the roster being SET UP (the log only began July 2026), not
  // a real team change — so pre-log deals follow the first known lead rather
  // than dumping into Unassigned (real case: Stephen's July 1 deal belonged
  // to Garrison, whose reports-to was first stamped July 2).
  let mgr = list[0].old_manager_id ?? list[0].new_manager_id ?? null
  for (const c of list) {
    // The move's EFFECTIVE day (058), falling back for pre-058 rows to the
    // LOCAL calendar day of changed_at — never its UTC slice: changed_at is a
    // timestamptz, so a move made at 6pm Arizona is stored as 01:00 the NEXT
    // day in UTC. Slicing the raw string put that move on tomorrow, and a
    // deal sold the same afternoon resolved to the OLD team.
    if (String(dateISO) >= changeDay(c)) mgr = c.new_manager_id ?? null
    else break
  }
  return mgr
}

// Everyone who ever had people reporting to them — union of both sides of the
// team-change log plus every current reports-to link. Used to recognize a
// FORMER team lead (e.g. a deactivated ex-manager) whose own sales should
// stay under their own historical team rather than fall into Unassigned.
// Cached per (changes, roster) object pair — both are stable page memos.
const _pastLeadsCache = new WeakMap()
export function pastLeadIds(changesByProfile = {}, usersById = {}) {
  const hit = _pastLeadsCache.get(changesByProfile)
  if (hit && hit.usersById === usersById) return hit.set
  const s = new Set()
  for (const list of Object.values(changesByProfile)) {
    for (const c of list) {
      if (c.old_manager_id) s.add(c.old_manager_id)
      if (c.new_manager_id) s.add(c.new_manager_id)
    }
  }
  for (const u of Object.values(usersById)) if (u.manager_id) s.add(u.manager_id)
  _pastLeadsCache.set(changesByProfile, { usersById, set: s })
  return s
}

// The team (head id, or 'unassigned') a sale belongs to: the owner's team as
// of the sale date. A current head always owns their team (headship history
// isn't tracked — only reports-to moves are). If the as-of lead no longer
// heads a team (dissolved/absorbed, e.g. Team Niznik → Team Jones), the sale
// follows that lead's CURRENT grouping, matching the absorb decision.
export function teamOfSale(ownerId, saleDate, usersById, heads, changesByProfile) {
  const owner = ownerId ? usersById[ownerId] : null
  if (!owner) return 'unassigned'
  if (heads.has(owner.id)) return owner.id
  const mgrId = managerAsOf(changesByProfile, owner, saleDate)
  // No lead as of this date — but a FORMER LEAD's own sales (a deactivated
  // ex-manager, e.g. Danny Jones) stay under their own historical team, the
  // same way their old reps' sales do, instead of dumping into Unassigned.
  if (!mgrId) return pastLeadIds(changesByProfile, usersById).has(owner.id) ? owner.id : 'unassigned'
  if (heads.has(mgrId)) return mgrId
  const mgr = usersById[mgrId]
  if (!mgr) return 'unassigned'
  const k = teamKeyFor(mgr, heads)
  // The as-of lead heads nothing today AND wasn't absorbed anywhere (e.g. a
  // director whose directs all moved away): keep the sale under that lead as
  // a HISTORICAL team key rather than dumping it into Unassigned — the
  // breakdowns render such keys as their own row (real case: Stephen's
  // pre-move deals under Garrison after Garrison's last direct moved).
  return k === 'unassigned' ? mgrId : k
}
