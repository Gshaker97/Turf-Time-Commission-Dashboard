import {createHash} from 'node:crypto'
import {batchGuards} from './verified-sheet-batch.mjs'
const HASH=/^[a-f0-9]{64}$/
const FIELDS=new Set(['price','baseline','commission'])
const same=(a,b)=>canonicalHash(a)===canonicalHash(b)
function canonical(value){
  if(value===null || typeof value==='string' || typeof value==='boolean')return JSON.stringify(value)
  if(typeof value==='number' && Number.isFinite(value))return JSON.stringify(value)
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']'
  if(value && Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}'
  throw Error('invalid canonical evidence')
}
export const canonicalHash=value=>createHash('sha256').update(canonical(value)).digest('hex')
const exactKeys=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) && same(Object.keys(value).sort(),[...keys].sort())
const frozen=value=>{if(value && typeof value==='object'){Object.values(value).forEach(frozen);Object.freeze(value)}return value}
export function validateRetry(config,parent,policy,consumed){
  const fail=()=>{throw Error('retry evidence or approval invalid')}
  if(!exactKeys(config,['version','approved','parentBatchId','parentReceiptHash','entries']) || config.version!==1 || typeof config.approved!=='boolean' || !HASH.test(config.parentBatchId) || !HASH.test(config.parentReceiptHash) || !Array.isArray(config.entries) || !config.entries.length || config.entries.length>16)fail()
  if(canonicalHash(parent)!==config.parentReceiptHash || parent.batchId!==config.parentBatchId || parent.state!=='finished' || parent.report?.dryRun!==false || parent.report?.fullScope!==true || !Array.isArray(parent.report.plans) || !Array.isArray(parent.report.results))fail()
  if(!Array.isArray(policy?.scope) || !Array.isArray(policy.approvedPlanHashes) || policy.maxAgeMs!==300000)fail()
  // A complete terminal report must account for the entire original reviewed
  // scope. Missing/identityless result rows cannot prove 'zero attempts'.
  if(parent.report.policyVersion!==policy.version || parent.report.plans.length!==policy.scope.length || policy.scope.some(s=>parent.report.plans.filter(p=>p.projectId===s.projectId && p.opportunityId===s.opportunityId).length!==1))fail()
  const resultIds=new Set()
  for(const r of parent.report.results){
    if(!r || typeof r.projectId!=='string' || typeof r.opportunityId!=='string' || !policy.scope.some(s=>s.projectId===r.projectId && s.opportunityId===r.opportunityId))fail()
    const key=r.projectId+':'+r.opportunityId
    if(resultIds.has(key))fail()
    resultIds.add(key)
  }
  const projects=new Set(),opps=new Set(),hashes=new Set();let fields=0
  for(const e of config.entries){
    if(!exactKeys(e,['projectId','opportunityId','planHash','sourceHash','changes']) || typeof e.projectId!=='string' || !/^\d+$/.test(e.projectId) || typeof e.opportunityId!=='string' || !/^[A-Za-z0-9_-]+$/.test(e.opportunityId) || !HASH.test(e.planHash) || !HASH.test(e.sourceHash) || !Array.isArray(e.changes) || !e.changes.length || e.changes.length>3 || projects.has(e.projectId) || opps.has(e.opportunityId) || hashes.has(e.planHash))fail()
    projects.add(e.projectId);opps.add(e.opportunityId);hashes.add(e.planHash)
    const used=new Set()
    for(const c of e.changes){
      if(!exactKeys(c,['field','wasCents','wantCents']) || !FIELDS.has(c.field) || used.has(c.field) || !Number.isSafeInteger(c.wasCents) || !Number.isSafeInteger(c.wantCents) || c.wasCents<0 || c.wantCents<0 || c.wasCents===c.wantCents || (c.field==='price' && (!c.wasCents || !c.wantCents)))fail()
      used.add(c.field);fields++
    }
    // EXACT existing plan digest: insertion order is part of the current core contract.
    const expected=createHash('sha256').update(JSON.stringify({projectId:e.projectId,opportunityId:e.opportunityId,sourceHash:e.sourceHash,changes:e.changes.map(c=>({field:c.field,wasCents:c.wasCents,wantCents:c.wantCents}))})).digest('hex')
    if(expected!==e.planHash || !policy.approvedPlanHashes.includes(e.planHash))fail()
    const scopes=policy.scope.filter(s=>s.projectId===e.projectId || s.opportunityId===e.opportunityId)
    if(scopes.length!==1 || scopes[0].projectId!==e.projectId || scopes[0].opportunityId!==e.opportunityId || scopes[0].hold || e.changes.some(c=>scopes[0].fieldHolds?.[c.field]))fail()
    const plans=parent.report.plans.filter(p=>p.projectId===e.projectId || p.opportunityId===e.opportunityId)
    if(plans.length!==1 || plans[0].projectId!==e.projectId || plans[0].opportunityId!==e.opportunityId || !same(plans[0].changes,[]) || !same(plans[0].holds,['source evidence stale or undated']) || parent.report.results.some(r=>r.projectId===e.projectId || r.opportunityId===e.opportunityId))fail()
    const claim=consumed?.[e.planHash]
    if(!claim || claim.batchId!==config.parentBatchId || claim.planHash!==e.planHash)fail()
  }
  if(fields>20)fail()
  return frozen(structuredClone(config))
}
export function retryRequestValid({body,query}={}){
  if(typeof body==='string'){try{body=JSON.parse(body)}catch{return false}}
  return !((body!==undefined && (body===null || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length)) || (query && Object.keys(query).length))
}
function validRequest(request={}){
  if(request.authorized!==true)return {status:401,body:{ok:false,error:'Unauthorized'}}
  if(!retryRequestValid(request))return {status:400,body:{ok:false,error:'retry accepts only an empty JSON object and no parameters'}}
}
function exactPlan(report,entry){
  if(report?.dryRun!==true || !Array.isArray(report.plans) || report.plans.length!==1 || !Array.isArray(report.results) || report.results.length)return false
  const p=report.plans[0]
  return p.projectId===entry.projectId && p.opportunityId===entry.opportunityId && p.planHash===entry.planHash && p.sourceHash===entry.sourceHash && same(p.changes,entry.changes)
}
export function createVerifiedRetry(deps){
  async function snapshot(){
    const config=structuredClone(await deps.loadConfig()),policy=frozen(structuredClone(await deps.loadPolicy()))
    // Validate shape before using config identifiers in any reader.
    if(!config || !HASH.test(config.parentBatchId) || !Array.isArray(config.entries) || config.entries.length>16 || config.entries.some(e=>!e || !HASH.test(e.planHash)))throw Error('retry configuration unavailable')
    const parent=structuredClone(await deps.loadParent(config.parentBatchId)),consumed={}
    for(const e of config.entries)consumed[e.planHash]=await deps.loadConsumed(e.planHash)
    const validated=validateRetry(config,parent,policy,consumed)
    const {approved,...binding}=validated
    return {config:validated,policy,retryId:canonicalHash(binding)}
  }
  const disarm=()=>{deps.env.ARC_VERIFIED_SHEET_BATCH='0';deps.env.ARC_VERIFIED_SHEET_WRITES='0';deps.env.ARC_VERIFIED_SHEET_SINGLE_WRITER='0'}
  async function preview(request){
    const invalid=validRequest(request);if(invalid)return invalid
    if(!deps.acquire())return {status:409,body:{ok:false,error:'verified reconciliation already running'}}
    try{
      const {config,policy,retryId}=await snapshot(),jobs=[]
      for(const e of config.entries){
        try{const report=await deps.run(policy,{onlyProject:e.projectId,enabled:false,approvedPlanHashes:[]});jobs.push({projectId:e.projectId,opportunityId:e.opportunityId,planHash:e.planHash,eligible:exactPlan(report,e),report})}
        catch{jobs.push({projectId:e.projectId,opportunityId:e.opportunityId,eligible:false,reason:'fresh evidence unavailable'})}
      }
      return {status:200,body:{ok:true,dryRun:true,retryId,jobs}}
    }catch{return {status:409,body:{ok:false,error:'retry evidence or approval unavailable'}}}
    finally{deps.release()}
  }
  async function start(request){
    const invalid=validRequest(request);if(invalid)return invalid
    if(!batchGuards(deps.env))return {status:409,body:{ok:false,error:'retry guards disabled or AUTO enabled'}}
    if(!deps.acquire())return {status:409,body:{ok:false,error:'verified reconciliation already running'}}
    let launched=false
    const cleanup=()=>{disarm();deps.release()}
    try{
      const {config,policy,retryId}=await snapshot()
      if(config.approved!==true)return {status:409,body:{ok:false,error:'retry not approved'}}
      if(!await deps.claimReceipt(retryId,config))return {status:409,body:{ok:false,error:'retry already claimed; inspect receipt'}}
      launched=true
      const completion=(async()=>{
        const jobs=[];let state='finished'
        try{
          for(const e of config.entries){
            if(!batchGuards(deps.env)){jobs.push({projectId:e.projectId,state:'held',reason:'guards changed'});break}
            let report
            try{report=await deps.run(policy,{onlyProject:e.projectId,enabled:false,approvedPlanHashes:[]})}
            catch{jobs.push({projectId:e.projectId,state:'held',reason:'fresh evidence unavailable'});continue}
            if(!exactPlan(report,e)){jobs.push({projectId:e.projectId,state:'held',reason:'original plan drift or hold'});continue}
            if(!batchGuards(deps.env)){jobs.push({projectId:e.projectId,state:'held',reason:'guards changed'});break}
            if(!await deps.claimPlan(retryId,e)){jobs.push({projectId:e.projectId,state:'held',reason:'original plan retry already consumed'});continue}
            if(!batchGuards(deps.env)){jobs.push({projectId:e.projectId,state:'held',reason:'guards changed; claim retained'});break}
            const result=await deps.run(policy,{onlyProject:e.projectId,enabled:true,approvedPlanHashes:[e.planHash]})
            jobs.push({projectId:e.projectId,opportunityId:e.opportunityId,planHash:e.planHash,state:'runtime returned',report:result})
            if(!Array.isArray(result.results) || result.results.length!==1 || result.results[0].ok!==true){state='uncertain';break}
          }
        }catch{state='uncertain';jobs.push({state:'uncertain',reason:'claim or execution unavailable; no automatic retry'})}
        const outcome={state,parentBatchId:config.parentBatchId,parentReceiptHash:config.parentReceiptHash,jobs,meaning:'inspect per-field outcomes; finished is not a success assertion',persistedGuardReset:'operator must verify Railway guards OFF'}
        try{await deps.finish(retryId,outcome)}finally{cleanup()}
        return outcome
      })()
      completion.catch(()=>{})
      return {status:202,body:{ok:true,started:true,retryId,statusPath:`/api/arcsite/verified-sheet-reconcile/retry/${retryId}`},completion}
    }catch{return {status:503,body:{ok:false,error:'retry preparation unavailable or uncertain; inspect claims'}}}
    finally{if(!launched)cleanup()}
  }
  return {preview,start}
}
