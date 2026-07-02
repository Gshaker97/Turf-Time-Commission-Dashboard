// ============================================================
// ONE rule for "what teams exist", shared by the Admin roster, the Team page,
// the Dashboard breakdown, and Weekly Stats. ROLE is the source of truth:
//
//   • Someone titled MANAGER is always a team head — regardless of who they
//     report to or whether anyone reports to them. Dissolving/absorbing a team
//     is done by changing the person's ROLE (e.g. Colt: manager → rep when
//     Team Niznik merged into Team Jones), not by rewiring reports.
//   • A director/VP additionally heads a team when ACTIVE people report
//     directly to them (e.g. Garrison's direct reports show as his team).
//     A deactivated user's stale reports-to link doesn't keep a team alive
//     (their deals still count everywhere — this is only team structure).
// ============================================================

export function headIdSet(users = []) {
  const hasActiveReports = new Set(
    users.filter(u => u.manager_id && u.active !== false).map(u => u.manager_id)
  )
  const ids = new Set()
  for (const u of users) {
    if (u.role === 'manager' || hasActiveReports.has(u.id)) ids.add(u.id)
  }
  return ids
}

// The team a person belongs to for grouping: their own if they head one, else
// the HEAD they report to. Reporting to a non-head (e.g. a demoted manager a
// deactivated rep still points at) doesn't create a team — that's unassigned.
export function teamKeyFor(u, heads) {
  if (heads.has(u.id)) return u.id
  if (u.manager_id && heads.has(u.manager_id)) return u.manager_id
  return 'unassigned'
}
