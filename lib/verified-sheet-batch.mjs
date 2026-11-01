import { createHash } from 'node:crypto'

// One-shot orchestration only. The existing runtime still owns every source
// check, exact plan approval, field allowlist, write, and immediate read-back.
export function batchIdentity(approvals) {
  if (!Array.isArray(approvals) || !approvals.length || approvals.length > 228 || approvals.some(h=>! /^[a-f0-9]{64}$/.test(h)) || new Set(approvals).size !== approvals.length) throw Error('invalid batch approvals')
  return createHash('sha256').update(JSON.stringify([...approvals].sort())).digest('hex')
}
export function batchGuards(env) {
  return env.ARC_VERIFIED_SHEET_AUTO !== '1' && env.ARC_VERIFIED_SHEET_WRITES === '1' && env.ARC_VERIFIED_SHEET_SINGLE_WRITER === '1' && env.ARC_VERIFIED_SHEET_BATCH === '1'
}
export function createVerifiedBatch(deps) {
  return async function start({authorized,body,query}={}) {
    if (authorized !== true) return {status:401,body:{ok:false,error:'Unauthorized'}}
    // The application intentionally uses express.text({type:'*/*'}).
    // Decode that raw JSON once; accept only an empty object, never parameters.
    if (typeof body === 'string') {
      try { body=JSON.parse(body) } catch { return {status:400,body:{ok:false,error:'batch accepts only an empty JSON object'}} }
    }
    if ((body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)) || (query && Object.keys(query).length)) return {status:400,body:{ok:false,error:'batch accepts no parameters'}}
    if (!batchGuards(deps.env)) return {status:409,body:{ok:false,error:'batch guards disabled or AUTO enabled'}}
    if (!deps.acquire()) return {status:409,body:{ok:false,error:'verified reconciliation already running'}}
    let launched=false
    const cleanup=()=>{
      // Process-local defense only. Operators must also remove persisted Railway
      // guards. Durable per-plan claims prevent replay even across restarts.
      deps.env.ARC_VERIFIED_SHEET_BATCH='0'
      deps.env.ARC_VERIFIED_SHEET_WRITES='0'
      deps.env.ARC_VERIFIED_SHEET_SINGLE_WRITER='0'
      deps.release()
    }
    try {
      const policy=structuredClone(await deps.loadPolicy())
      const approvals=[...policy.approvedPlanHashes]
      const batchId=batchIdentity(approvals)
      // Atomic INSERT-only claim includes EVERY plan hash, preventing regrouped
      // or subset approvals from replaying a previously consumed plan.
      if (!await deps.claim(batchId,approvals)) return {status:409,body:{ok:false,error:'batch or plan already claimed; inspect evidence before retry'}}
      if (!batchGuards(deps.env)) {
        await deps.finish(batchId,{state:'held',reason:'guards changed before execution'})
        return {status:409,body:{ok:false,batchId,error:'guards changed; claim retained'}}
      }
      launched=true
      const completion=(async()=>{
        let outcome
        try {
          const report=await deps.run(policy,approvals)
          const fields=(report.results||[]).flatMap(result=>result.fields||[])
          const fieldStates={}
          for(const field of fields)fieldStates[field.state]=(fieldStates[field.state]||0)+1
          outcome={state:'finished',meaning:'runtime returned; inspect field outcomes, not a success assertion',fieldStates,report}
        } catch {
          outcome={state:'uncertain',reason:'run failed; inspect read-backs before any further action'}
        }
        // No raw exceptions, credentials, or URLs are persisted or returned.
        // If this persistence fails the original claim remains non-replayable.
        try { await deps.finish(batchId,outcome) } finally { cleanup() }
        return outcome
      })()
      completion.catch(()=>{})
      return {status:202,body:{ok:true,started:true,batchId,statusPath:`/api/arcsite/verified-sheet-reconcile/batch/${batchId}`},completion}
    } catch {
      return {status:503,body:{ok:false,error:'batch preparation unavailable or uncertain; no execution started; inspect claims'}}
    } finally { if(!launched)cleanup() }
  }
}
