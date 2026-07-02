// ============================================================
// ONE rule for "what teams exist", shared by the Admin roster, the Team page,
// the Dashboard breakdown, and Weekly Stats. ROLE is the source of truth:
//
//   • Someone titled MANAGER is always a team head — regardless of who they
//     report to or whether anyone reports to them. Dissolving/absorbing a team
//     is done by changing the person's ROLE (e.g. Colt: manager → rep when
//     Team Niznik merged into Team Jones), not by rewiring reports.
//   • A director/VP additionally heads a team when people report DIRECTLY to
//     them (e.g. Garrison's direct reports show as his team).
// ============================================================

export function headIdSet(users = []) {
  const hasReports = new Set(users.filter(u => u.manager_id).map(u => u.manager_id))
  const ids = new Set()
  for (const u of users) {
    if (u.role === 'manager' || hasReports.has(u.id)) ids.add(u.id)
  }
  return ids
}

// The team a person belongs to for grouping: their own if they head one,
// otherwise whoever they report to, otherwise unassigned.
export function teamKeyFor(u, heads) {
  if (heads.has(u.id)) return u.id
  return u.manager_id || 'unassigned'
}
