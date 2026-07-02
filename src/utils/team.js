// ============================================================
// ONE rule for "what teams exist", shared by the Admin roster, the Team page,
// the Dashboard breakdown, and Weekly Stats:
//
//   A team head is anyone with DIRECT REPORTS, or a manager who reports to
//   nobody (their own team, even while it's empty). A manager who reports to
//   another lead and has no direct reports of their own is a MEMBER of that
//   lead's team — e.g. when Team Niznik was absorbed into Team Jones, Colt
//   (still titled manager) reports to Danny and shows under Team Jones.
// ============================================================

export function headIdSet(users = []) {
  const hasReports = new Set(users.filter(u => u.manager_id).map(u => u.manager_id))
  const ids = new Set()
  for (const u of users) {
    if (hasReports.has(u.id)) ids.add(u.id)
    else if (u.role === 'manager' && !u.manager_id) ids.add(u.id)
  }
  return ids
}

// The team a person belongs to for grouping: their own if they head one,
// otherwise whoever they report to, otherwise unassigned.
export function teamKeyFor(u, heads) {
  if (heads.has(u.id)) return u.id
  return u.manager_id || 'unassigned'
}
