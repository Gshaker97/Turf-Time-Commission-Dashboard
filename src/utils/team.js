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

// ── Date-effective team membership ───────────────────────────────────────────
// Every reports-to move is date-stamped in team_changes (migration 029). A
// SALE belongs to the team its owner was on AS OF THE SALE DATE: deals before
// a move stay with the old team; deals on/after the move date go to the new
// team. Used by every team aggregate (Dashboard breakdown/filter, Team page
// comparison) so moving a rep never rewrites history.

// team_changes rows grouped per profile, oldest first.
export function buildChangesByProfile(teamChanges = []) {
  const by = {}
  const sorted = [...teamChanges].sort((a, b) => String(a.changed_at).localeCompare(String(b.changed_at)))
  for (const c of sorted) (by[c.profile_id] ||= []).push(c)
  return by
}

// Who a user reported to on a given date. Before their first logged move =
// that move's OLD lead; after the latest = current. No log → current.
export function managerAsOf(changesByProfile, user, dateISO) {
  const list = user ? changesByProfile?.[user.id] : null
  if (!list?.length || !dateISO) return user?.manager_id ?? null
  let mgr = list[0].old_manager_id ?? null
  for (const c of list) {
    if (String(dateISO) >= String(c.changed_at).slice(0, 10)) mgr = c.new_manager_id ?? null
    else break
  }
  return mgr
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
  if (!mgrId) return 'unassigned'
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
