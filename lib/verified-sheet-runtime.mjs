import { createHash } from 'node:crypto'
import { reconcileScope } from './verified-sheet-reconcile.mjs'
import { readArcsiteEvidence } from './arcsite-revision-evidence.mjs'
const READ_ERRORS = Object.freeze({
  VERIFIED_SHEET_READ_FAILED:'Sheet read failed; no writes',
  VERIFIED_SHEET_SCHEMA_INVALID:'Sheet schema invalid; no writes',
  VERIFIED_GHL_READ_FAILED:'live GHL read failed; no writes',
  VERIFIED_GHL_IDENTITY_MISMATCH:'live GHL identity mismatch; no writes',
  VERIFIED_GHL_SNAPSHOT_FAILED:'GHL snapshot unavailable or incomplete; no writes',
  VERIFIED_ARCSITE_READ_FAILED:'ArcSite evidence read failed; no writes',
})
function sourceError(code) { return Object.assign(new Error(READ_ERRORS[code]),{code}) }
async function readStage(code, read) {
  try { return await read() } catch { throw sourceError(code) }
}
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function installDay(value) {
  let s = typeof value === 'number' && Number.isFinite(value) && value > 20000 && value < 100000 ? new Date(Math.floor(value) * 86400000 - 2209161600000).toISOString().slice(0,10) : String(value ?? '').trim()
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (us) s = `${us[3]}-${us[1].padStart(2,'0')}-${us[2].padStart(2,'0')}`
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const t = Date.parse(s+'T00:00:00Z')
  return Number.isFinite(t) && new Date(t).toISOString().slice(0,10)===s ? s : null
}
const header = (tab, re) => {
  const matches = (tab?.headers || []).filter(h => re.test(String(h).trim()))
  if (matches.length !== 1) throw Error('required Sheet header absent or ambiguous')
  return matches[0]
}
export function normalizeSheet(sheet) {
  const jobs = sheet?.jobs, schedule = sheet?.schedule
  if (!Array.isArray(jobs?.rows) || !Array.isArray(schedule?.rows)) throw Error('Sheet feed unavailable')
  const h = { project:header(jobs,/^project\s*id$/i),proposal:header(jobs,/^proposal\s*id$/i),status:header(jobs,/^status$/i),total:header(jobs,/^approved\s*total$/i),baseline:header(jobs,/baseline/i),commission:header(jobs,/^commission$/i) }
  const s = { proposal:header(schedule,/^proposal\s*id$/i),status:header(schedule,/^status$/i),date:header(schedule,/^install\s*date$/i) }
  const rows = jobs.rows.map(r=>({ projectId:String(r[h.project] || '').trim(),proposalId:String(r[h.proposal] || '').trim(),status:String(r[h.status] || '').trim().toUpperCase(),approvedTotal:r[h.total],baseline:r[h.baseline],commission:r[h.commission],revisionHash:hash(r) }))
  const booked = new Set(), inScopeBooked = new Set(), ambiguous = new Set(), bookingRows = new Map()
  for (const r of schedule.rows) {
    if (String(r[s.status]).trim().toUpperCase() !== 'BOOKED') continue
    // Scope membership is frozen separately. Dates are read only, never written.
    const matches = [...new Set(rows.filter(j=>j.proposalId === String(r[s.proposal] || '').trim()).map(j=>j.projectId))]
    if (matches.length !== 1) { for (const id of matches) ambiguous.add(id); continue }
    const id = matches[0]
    booked.add(id)
    bookingRows.set(id, [...(bookingRows.get(id) || []), r])
  }
  for (const [id, matches] of bookingRows) {
    if (matches.length !== 1) { ambiguous.add(id); continue }
    const date = installDay(matches[0][s.date])
    if (!date) { ambiguous.add(id); continue }
    if (date >= '2026-10-01' && date <= '2026-11-30' && !ambiguous.has(id)) inScopeBooked.add(id)
  }
  return {rows,booked,inScopeBooked,ambiguous}
}

/** Dependencies are existing private server readers and field-only GHL adapter.
 * No direct access to commission-site writes, PM writes, contacts or dates.
 */
export function createVerifiedSheetRuntime(deps, policy) {
  let running = false
  async function run({ enabled = false, approvedPlanHashes = [], onlyProject = null } = {}) {
    if (running) return {ok:false,reason:'verified reconciliation already running'}
    running = true
    try {
      const readSnapshot = () => readStage('VERIFIED_GHL_SNAPSHOT_FAILED',async()=>{
        const result=await deps.readGhlSnapshot()
        // Existing reader caps at 300 pages; a full final page cannot prove completion.
        if (!Array.isArray(result?.opportunities) || result.meta?.partial || result.meta?.errors?.length || result.meta?.opportunity_pages>=300) throw sourceError('VERIFIED_GHL_SNAPSHOT_FAILED')
        return result
      })
      let snapshot = await readSnapshot()
      let snapshotAt = Date.now()
      const runPolicy = onlyProject ? {...policy,scope:policy.scope.filter(s=>s.projectId===onlyProject)} : policy
      const adapters = {
        async readEvidence(projectId, opportunityId, {prewrite=false}={}) {
          if (prewrite || Date.now()-snapshotAt > policy.maxAgeMs) {
            snapshot=await readSnapshot()
            snapshotAt=Date.now()
          }
          const [rawSheet, current, arc] = await Promise.all([
            readStage('VERIFIED_SHEET_READ_FAILED',()=>deps.readFreshSheet()),
            readStage('VERIFIED_GHL_READ_FAILED',async()=>{
              const result=await deps.readOpportunity(opportunityId)
              if (!result || typeof result !== 'object' || !result.fields || typeof result.fields !== 'object') throw sourceError('VERIFIED_GHL_READ_FAILED')
              return result
            }),
            readStage('VERIFIED_ARCSITE_READ_FAILED',()=>readArcsiteEvidence(projectId,deps.arcsite)),
          ])
          const sheet = await readStage('VERIFIED_SHEET_SCHEMA_INVALID',()=>normalizeSheet(rawSheet))
          if (current.projectId !== projectId || current.opportunityId !== opportunityId) throw sourceError('VERIFIED_GHL_IDENTITY_MISMATCH')
          return {...arc,projectId,opportunityId,complete:arc.complete && Date.now()-snapshotAt <= policy.maxAgeMs,sourceHealthy:true,readAt:new Date().toISOString(),opportunitiesForProject:snapshot.opportunities.filter(o=>o.project_id===projectId && !/^(lost|abandoned)$/i.test(o.status||'')).map(o=>o.id),activeBooked:sheet.inScopeBooked.has(projectId) && !sheet.ambiguous.has(projectId),canceled:/^(lost|abandoned)$/i.test(current.status||''),commissionApplicable:current.commissionApplicable,current:current.fields,sheetRows:sheet.rows.filter(r=>r.projectId===projectId)}
        },
        writeGhlField:deps.writeGhlField,
        readGhlField:deps.readGhlField,
      }
      const report = await reconcileScope(runPolicy,adapters,{enabled,approvedPlanHashes})
      report.policyVersion=policy.version
      report.fullScope=!onlyProject
      report.commissionSite='untouched; gold-check and payroll protections retained'
      report.pm='no direct writes; existing normal GHL-to-PM value sync only'
      await deps.saveReport(report)
      return report
    } catch (error) {
      // Never leave an old successful report looking like the latest run.
      const sourceCode = Object.hasOwn(READ_ERRORS,error?.code) ? error.code : null
      await deps.saveReport({...(sourceCode ? {sourceCode} : {}),at:new Date().toISOString(),ok:false,dryRun:!enabled,fullScope:!onlyProject,policyVersion:policy.version,plans:[],results:[],error:sourceCode ? READ_ERRORS[sourceCode] : 'reconciliation source or report unavailable; no success claimed'}).catch(()=>{})
      throw sourceCode ? sourceError(sourceCode) : Error('reconciliation source or report unavailable; no success claimed')
    } finally {running=false}
  }
  return {run}
}
