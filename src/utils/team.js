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
