/** Fail-closed GHL-only reconciliation. No network, timers, or credentials here.
 * Evidence adapters MUST establish completeness and exact PDF/revision identity.
 * Commission here is an informational GHL field, never a payroll calculation.
 */
import { createHash } from 'node:crypto'
const runningJobs = new Set()
const FIELDS = Object.freeze(['value', 'price', 'baseline', 'commission'])
// Exact fixed adapter messages only. Never forward exception text, URLs or
// arbitrary evidence strings into saved reports. Unknown reasons stay generic.
const SOURCE_HOLDS = new Map([
  ['invalid exact project ID', 'ARCSITE_PROJECT_ID_INVALID'],
  ['proposal pagination completeness unproved', 'ARCSITE_PAGINATION_UNPROVED'],
  ['single proposal page cannot establish completeness', 'ARCSITE_SINGLE_PAGE_INCOMPLETE'],
  ['invalid proposal pages', 'ARCSITE_PAGES_INVALID'],
  ['invalid or duplicate proposal identity', 'ARCSITE_PROPOSAL_ID_INVALID'],
  ['proposal list project identity mismatch', 'ARCSITE_LIST_PROJECT_MISMATCH'],
  ['proposal detail identity mismatch', 'ARCSITE_DETAIL_ID_MISMATCH'],
  ['approved proposal lacks proposal-level PDF URL', 'ARCSITE_SIGNED_PDF_ABSENT'],
  ['unsafe proposal PDF URL', 'ARCSITE_PDF_URL_UNSAFE'],
  ['signed PDF retrieval incomplete or redirected', 'ARCSITE_PDF_RETRIEVAL_INCOMPLETE'],
  ['document is not PDF bytes', 'ARCSITE_PDF_BYTES_INVALID'],
  ['PDF body signature evidence absent', 'ARCSITE_PDF_SIGNATURE_ABSENT'],
  ['PDF body signed timestamp absent or invalid', 'ARCSITE_PDF_SIGNED_TIME_INVALID'],
  ['approved total invalid', 'ARCSITE_APPROVED_TOTAL_INVALID'],
  ['PDF body Total absent or disagrees with proposal metadata', 'ARCSITE_PDF_TOTAL_UNVERIFIED'],
  ['no valid signed approved proposals', 'ARCSITE_SIGNED_SET_EMPTY'],
  ['ArcSite evidence read failed; no writes', 'ARCSITE_READ_FAILED'],
])
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const id = value => typeof value === 'string' && value.length > 0
export function cents(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) < 1e12 ? Math.round(value * 100) : null
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (!s) return null
  // Do not strip arbitrary text into a plausible number; preserve parentheses.
  if (!/^(?:-?\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?|\(\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\))$/.test(s)) return null
  const n = Number(s.replace(/[$,()]/g, ''))
  return Number.isSafeInteger(Math.round(n * 100)) ? Math.round(n * 100) * (s.startsWith('(') ? -1 : 1) : null
}
const fresh = (at, now, maxAgeMs) => Number.isFinite(Date.parse(at)) && now - Date.parse(at) >= 0 && now - Date.parse(at) <= maxAgeMs

/** Scope is an immutable reviewed Project -> exact opportunity mapping, not names.
 * revision proof must include all valid signed proposal IDs and the PDF hash.
 * Multiple contracts require reviewed replacement resolution covering that EXACT set.
 */
export function planReconcile(input, policy, { now = Date.now() } = {}) {
  const out = { version: 1, projectId: input?.projectId, opportunityId: input?.opportunityId, changes: [], holds: [] }
  const hold = reason => { out.holds.push(reason); return out }
  const scope = policy?.scope?.find(s => s.projectId === input?.projectId && s.opportunityId === input?.opportunityId)
  if (!scope) return hold('outside reviewed exact-ID scope')
  if (scope.hold) return hold(scope.hold)
  if (!input.complete || !input.sourceHealthy) {
    hold('source unavailable or incomplete; retry without writes')
    const reasons = Array.isArray(input.holds) ? input.holds : []
    const matched = new Set(reasons.filter(reason => typeof reason === 'string' && SOURCE_HOLDS.has(reason)))
    if (matched.size) {
      out.sourceIssues = [...matched].map(message => ({code:SOURCE_HOLDS.get(message),message}))
      for (const issue of out.sourceIssues) out.holds.push(`source: ${issue.message}`)
    }
    return out
  }
  if (!fresh(input.readAt, now, policy.maxAgeMs)) return hold('source evidence stale or undated')
  if (input.opportunitiesForProject?.length !== 1 || input.opportunitiesForProject[0] !== input.opportunityId) return hold('ambiguous project/opportunity identity')
  if (!input.activeBooked || input.canceled) return hold('not an active booked in-scope job')
  const r = input.revision
  if (!r || r.projectId !== input.projectId || !id(r.proposalId) || r.status !== 'APPROVED' || r.void === true) return hold('operative approved revision unresolved')
  if (!r.pdf || r.pdf.projectId !== input.projectId || r.pdf.proposalId !== r.proposalId || r.pdf.signed !== true || !/^[a-f0-9]{64}$/.test(r.pdf.sha256 || '')) return hold('exact signed PDF identity not verified')
  if (!fresh(r.verifiedAt, now, policy.maxAgeMs)) return hold('revision verification stale')
  const ids = input.validSignedProposalIds
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || !ids.every(id) || !ids.includes(r.proposalId)) return hold('complete signed revision set unresolved')
  if (input.latestValidProposalId !== r.proposalId) return hold('operative proposal is not latest valid signed revision')
  if (ids.length > 1) {
    const resolution = scope.replacementResolution
    if (!resolution || resolution.proposalId !== r.proposalId || resolution.pdfSha256 !== r.pdf.sha256 || resolution.kind !== 'replacement' || JSON.stringify([...resolution.proposalIds].sort()) !== JSON.stringify([...ids].sort())) return hold('add-on versus replacement unresolved for current signed set')
  }
  const rows = input.sheetRows?.filter(s => s.projectId === input.projectId && s.proposalId === r.proposalId && s.status === 'APPROVED') || []
  if (rows.length !== 1) return hold('exact approved Sheet revision absent or duplicate')
  const row = rows[0]
  if (!id(row.revisionHash)) return hold('Sheet row revision fingerprint missing')
  const total = cents(r.total), sheetTotal = cents(row.approvedTotal)
  if (total === null || total <= 0 || sheetTotal === null || Math.abs(total - sheetTotal) > 100) return hold('signed total and Approved Total disagree')
  // Approved existing source-consensus rule: signed total wins a <= $1 rounding gap.
  // Destination fields compare exact cents, not that $1 source-agreement tolerance.
  const expected = { value: total, price: total, baseline: cents(row.baseline), commission: cents(row.commission) }
  const fieldHolds = scope.fieldHolds || {}
  for (const field of FIELDS) {
    if (field === 'commission' && input.commissionApplicable !== true) continue
    if (fieldHolds[field]) { out.holds.push(`${field}: ${fieldHolds[field]}`); continue }
    const was = cents(input.current?.[field]), want = expected[field]
    if (was === null || want === null) { out.holds.push(`${field}: blank or invalid; no financial blank fills`); continue }
    if ((field === 'value' || field === 'price') && was <= 0) { out.holds.push(`${field}: zero/nonpositive value requires review`); continue }
    if (field === 'commission' && want < 0) { out.holds.push('commission: negative held for review'); continue }
    if (want < 0) { out.holds.push(`${field}: negative held for review`); continue }
    if (was !== want) out.changes.push({ field, wasCents: was, wantCents: want })
  }
  out.proposalId = r.proposalId
  out.sourceHash = digest({ projectId: input.projectId, opportunityId: input.opportunityId, proposalId: r.proposalId, pdf: r.pdf.sha256, signedIds: [...ids].sort(), row, expected, policyVersion: policy.version, scopePolicy: scope })
  out.planHash = digest({ projectId: out.projectId, opportunityId: out.opportunityId, sourceHash: out.sourceHash, changes: out.changes })
  return out
}

/** Writer accepts only exact separately-approved plan hashes. OFF is default.
 * Adapters expose field-only GHL writes; no site/contact/PM/stage/date methods.
 * Each source + destination is re-read before every field. A timeout is never
 * blindly retried: read back first, and stop on uncertainty. A later run can
 * safely replan confirmed failures from current evidence.
 */
async function executeUnlocked(plan, policy, adapters, { enabled = false, approvedPlanHashes = [], now = () => Date.now() } = {}) {
  const result = { projectId: plan.projectId, opportunityId: plan.opportunityId, dryRun: true, fields: [], ok: false }
  if (enabled !== true || !approvedPlanHashes.includes(plan.planHash)) return { ...result, reason: 'writer OFF or exact plan not approved' }
  if (!plan.planHash || !plan.sourceHash || !plan.changes.length) return { ...result, reason: 'no verified changes' }
  result.dryRun = false
  for (const change of plan.changes) {
    if (!FIELDS.includes(change.field)) return { ...result, reason: 'forbidden field' }
    let currentInput
    try { currentInput = await adapters.readEvidence(plan.projectId, plan.opportunityId, {prewrite:true}) } catch { return { ...result, reason: 'live precheck unavailable' } }
    const checked = planReconcile(currentInput, policy, { now: now() })
    const eligible = checked.changes.find(c => c.field === change.field)
    if (checked.sourceHash !== plan.sourceHash) return { ...result, reason: 'source/revision drift or hold; reapproval required' }
    const observed = cents(currentInput.current?.[change.field])
    if (observed === change.wantCents) { result.fields.push({ field: change.field, state: 'already matches' }); continue }
    if (!eligible || eligible.wasCents !== change.wasCents || eligible.wantCents !== change.wantCents) return { ...result, reason: 'destination drift; reapproval required' }
    let writeError = false
    try { await adapters.writeGhlField(plan.opportunityId, change.field, change.wantCents / 100) } catch { writeError = true }
    let readback
    try { readback = await adapters.readGhlField(plan.opportunityId, change.field) } catch {
      result.fields.push({ field: change.field, state: 'uncertain; readback required before retry' })
      return { ...result, reason: 'readback unavailable; no retry' }
    }
    const verified = cents(readback) === change.wantCents
    result.fields.push({ field: change.field, expectedCents: change.wantCents, observedCents: cents(readback), state: verified ? 'verified' : writeError ? 'uncertain after write error; verify before retry' : 'not applied', writeError })
    if (!verified) return { ...result, reason: 'field readback mismatch; stop and replan' }
  }
  return { ...result, ok: true }
}

/** One run per day belongs to server scheduling, not this library. Always refresh
 * evidence on retries; never mark a project settled merely from total/PDF count.
 * Default mode cannot call a write adapter. Caller must persist reports privately.
 */
export async function reconcileScope(policy, adapters, options = {}) {
  const report = { at: new Date().toISOString(), dryRun: options.enabled !== true, plans: [], results: [] }
  for (const scope of policy.scope) {
    if(scope.hold){report.plans.push({projectId:scope.projectId,opportunityId:scope.opportunityId,changes:[],holds:[scope.hold]});continue}
    let evidence
    try { evidence = await adapters.readEvidence(scope.projectId, scope.opportunityId) } catch {
      report.plans.push({ projectId: scope.projectId, opportunityId: scope.opportunityId, changes: [], holds: ['source unavailable; retry'] }); continue
    }
    const plan = planReconcile(evidence, policy, { now: options.now ? options.now() : Date.now() })
    report.plans.push(plan)
    if (options.enabled === true && plan.changes.length) report.results.push(await executePlan(plan, policy, adapters, options))
  }
  return report
}

// In-process serialization; multi-instance deployment requires a durable lease
// before enabling this writer. No network lease writes are introduced here.
export async function executePlan(plan, policy, adapters, options = {}) {
  const key = `${plan.projectId}:${plan.opportunityId}`
  if (runningJobs.has(key)) return { ok: false, reason: 'job already running', fields: [] }
  runningJobs.add(key)
  try { return await executeUnlocked(plan, policy, adapters, options) }
  finally { runningJobs.delete(key) }
}
