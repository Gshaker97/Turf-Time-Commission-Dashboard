/** Policy is read ONLY from owner-private server configuration, never GitHub.
 * No setter/API is supplied: population requires separate owner approval.
 */
export function validatePrivatePolicy(value) {
  if (!value || value.policyApproved !== true || value.existingHoldsPreserved !== true || value.reviewedProjectCount !== 228 || !Array.isArray(value.scope) || value.scope.length !== 228) throw Error('owner-private reviewed scope is unconfigured')
  if (typeof value.version !== 'string' || !value.version.trim()) throw Error('policy version missing')
  const projects = new Set(), pairs = new Set()
  for (const entry of value.scope) {
    if (!/^\d+$/.test(entry.projectId || '') || !/^[A-Za-z0-9_-]+$/.test(entry.opportunityId || '')) throw Error('invalid exact policy identity')
    if (entry.opportunityId === 'UNRESOLVED' && !entry.hold) throw Error('unresolved identity must remain held')
    if (projects.has(entry.projectId)) throw Error('duplicate policy project')
    projects.add(entry.projectId)
    const pair = entry.projectId + ':' + entry.opportunityId
    if (pairs.has(pair)) throw Error('duplicate policy identity')
    pairs.add(pair)
    if (entry.fieldHolds && Object.keys(entry.fieldHolds).some(k=>!['value','price','baseline','commission'].includes(k))) throw Error('unsupported field hold')
  }
  const approvals = value.approvedPlanHashes || []
  if (!Array.isArray(approvals) || approvals.length > 228 || approvals.some(h=>!/^[a-f0-9]{64}$/.test(h))) throw Error('invalid exact plan approvals')
  return {version:value.version,maxAgeMs:300000,scope:structuredClone(value.scope),approvedPlanHashes:[...approvals]}
}
