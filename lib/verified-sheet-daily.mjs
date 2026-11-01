import {createHash} from 'node:crypto'
import {canonicalHash} from './verified-sheet-retry.mjs'
const FIELDS=['value','price','baseline','commission']
const HASH=/^[a-f0-9]{64}$/
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v}
export const dailyGuards=env=>env.ARC_VERIFIED_SHEET_AUTO==='1'&&env.ARC_VERIFIED_SHEET_WRITES==='1'&&env.ARC_VERIFIED_SHEET_SINGLE_WRITER==='1'&&env.ARC_VERIFIED_SHEET_BATCH!=='1'
export function dailyScopeHash(policy){return canonicalHash(policy.scope)}
export function validateDailyConfig(config,policy){
  const fail=()=>{throw Error('daily authorization unavailable or changed')}
  if(!config||Object.keys(config).sort().join(',')!==['version','enabled','policyVersion','scopeHash','allowedFields'].sort().join(',')||config.version!==1||typeof config.enabled!=='boolean'||typeof config.policyVersion!=='string'||!HASH.test(config.scopeHash)||!Array.isArray(config.allowedFields)||canonicalHash([...config.allowedFields].sort())!==canonicalHash([...FIELDS].sort()))fail()
  if(!policy||policy.version!==config.policyVersion||policy.maxAgeMs!==300000||!Array.isArray(policy.scope)||policy.scope.length!==228||dailyScopeHash(policy)!==config.scopeHash)fail()
  const projects=new Set(),opps=new Set()
  for(const s of policy.scope){if(!s||typeof s.projectId!=='string'||!/^\d+$/.test(s.projectId)||typeof s.opportunityId!=='string'||!s.opportunityId||projects.has(s.projectId)||(!s.hold&&opps.has(s.opportunityId))||(s.opportunityId==='UNRESOLVED'&&!s.hold))fail();projects.add(s.projectId);if(!s.hold)opps.add(s.opportunityId)}
  return freeze(structuredClone(config))
}
function eligible(report,scope){
  if(report?.dryRun!==true||!Array.isArray(report.plans)||report.plans.length!==1||!Array.isArray(report.results)||report.results.length)throw Error('invalid daily preview')
  const p=report.plans[0]
  if(p.projectId!==scope.projectId||p.opportunityId!==scope.opportunityId||!Array.isArray(p.changes)||!Array.isArray(p.holds))throw Error('invalid daily preview')
  if(!p.changes.length)return {plan:p,action:false}
  if(!HASH.test(p.planHash)||!HASH.test(p.sourceHash)||scope.hold)throw Error('invalid daily plan')
  const fields=new Set()
  for(const c of p.changes){if(!FIELDS.includes(c.field)||fields.has(c.field)||scope.fieldHolds?.[c.field]||!Number.isSafeInteger(c.wasCents)||!Number.isSafeInteger(c.wantCents)||c.wasCents<0||c.wantCents<0||c.wasCents===c.wantCents||(['price','value'].includes(c.field)&&(!c.wasCents||!c.wantCents)))throw Error('invalid daily field');fields.add(c.field)}
  const hash=createHash('sha256').update(JSON.stringify({projectId:p.projectId,opportunityId:p.opportunityId,sourceHash:p.sourceHash,changes:p.changes})).digest('hex')
  if(hash!==p.planHash)throw Error('invalid daily plan hash')
  return {plan:p,action:true}
}
function verified(report,entry){
  if(report?.dryRun!==false||!Array.isArray(report.results)||report.results.length!==1)return false
  const r=report.results[0]
  if(r.projectId!==entry.projectId||r.opportunityId!==entry.opportunityId||r.ok!==true||!Array.isArray(r.fields)||r.fields.length!==entry.changes.length)return false
  return entry.changes.every(c=>r.fields.filter(f=>f.field===c.field&&(f.state==='already matches'||f.state==='verified'&&f.expectedCents===c.wantCents&&f.observedCents===c.wantCents)).length===1)
}
/** Internal daily controller only. No route accepts plans, hashes, or scope.
 * Adapter claims use durable singleton / per-project CAS, never lease expiry.
 * A failed/uncertain persistence leaves its gate closed for manual review.
 */
export function createVerifiedDaily(deps){
  let activeBinding=null
  async function authorization(){
    const policy=freeze(structuredClone(await deps.loadPolicy())),config=validateDailyConfig(await deps.loadConfig(),policy)
    if(config.enabled!==true||!dailyGuards(deps.env))throw Error('daily disabled')
    return {policy,config,binding:canonicalHash(config)}
  }
  async function sweep({day}={}){
    if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))return {ok:false,reason:'invalid daily identity'}
    if(!dailyGuards(deps.env))return {ok:false,reason:'daily guards disabled'}
    if(!deps.acquire())return {ok:false,reason:'verified reconciliation already running'}
    let worker=null,uncertain=false
    const jobs=[]
    try{
      const {policy,config,binding}=await authorization()
      activeBinding=binding
      const priorSweep=await deps.loadSweep(day)
      if(priorSweep?.complete===true&&priorSweep.binding!==binding)throw Error('completed daily binding differs')
      if(priorSweep?.complete===true)return {ok:true,skipped:true,reason:'daily sweep already recorded',day}
      worker=await deps.acquireWorker(day,{binding,policyVersion:policy.version,scopeHash:config.scopeHash})
      if(!worker||typeof worker.token!=='string'||!worker.token||worker.day!==day||worker.binding!==binding||worker.state!=='running')throw Error('daily worker claim unavailable or uncertain')
      for(const scope of policy.scope){
        const identity={projectId:scope.projectId,opportunityId:scope.opportunityId}
        // Re-read authorization before each job. Changes stop this bound run;
        // they never become new approval merely because they are on the server.
        const current=await authorization()
        if(current.binding!==binding)throw Error('daily authorization changed')
        if(scope.hold){jobs.push({...identity,state:'held',reason:'existing whole-job hold'});continue}
        let prior
        try{prior=await deps.loadJobState(scope.projectId)}catch{jobs.push({...identity,state:'held',reason:'job attempt history unavailable'});continue}
        if(prior!==null&&(!prior||prior.state!=='verified'||typeof prior.attemptId!=='string'||!HASH.test(prior.planHash)||prior.projectId!==scope.projectId||prior.opportunityId!==scope.opportunityId)){
          jobs.push({...identity,state:'held',reason:'unresolved prior attempt; review required'});continue
        }
        let preview
        try{preview=eligible(await deps.run(policy,{onlyProject:scope.projectId,enabled:false,approvedPlanHashes:[]}),scope)}
        catch{jobs.push({...identity,state:'held',reason:'fresh evidence unavailable or invalid'});continue}
        if(!preview.action){jobs.push({...identity,state:preview.plan.holds.length?'held':'matched',holds:preview.plan.holds});continue}
        const plan=preview.plan
        if(prior?.planHash===plan.planHash){jobs.push({...identity,state:'held',reason:'previously completed exact plan will not replay'});continue}
        // Check again after potentially slow fresh evidence retrieval.
        const latest=await authorization()
        if(latest.binding!==binding)throw Error('daily authorization changed')
        const entry={...identity,day,planHash:plan.planHash,sourceHash:plan.sourceHash,changes:structuredClone(plan.changes),binding}
        let claim
        try{claim=await deps.claimJob(worker.token,entry,prior)}catch{uncertain=true;throw Error('daily job claim uncertain')}
        if(claim===null||claim===false){jobs.push({...identity,state:'held',reason:'job claim denied; inspect attempt history'});continue}
        if(!claim||claim.state!=='attempting'||claim.workerToken!==worker.token||typeof claim.attemptId!=='string'||!claim.attemptId||['projectId','opportunityId','planHash','sourceHash','binding'].some(k=>claim[k]!==entry[k])){uncertain=true;throw Error('daily job claim proof invalid')}
        let report,success=false
        try{
          const live=await authorization()
          if(live.binding!==binding)throw Error('daily authorization changed')
          report=await deps.run(policy,{onlyProject:scope.projectId,enabled:true,approvedPlanHashes:[entry.planHash]})
          success=verified(report,entry)
        }catch{success=false}
        const outcome={...entry,attemptId:claim.attemptId,state:success?'verified':'uncertain',...(report?{report}:{}),reason:success?'all planned fields read back':'execution or read-back incomplete; review required'}
        let saved
        try{saved=await deps.finishJob(claim,outcome)}catch{uncertain=true;throw Error('daily attempt persistence uncertain')}
        if(!saved||saved.attemptId!==claim.attemptId||saved.state!==outcome.state){uncertain=true;throw Error('daily attempt receipt unproved')}
        jobs.push({...identity,attemptId:claim.attemptId,state:outcome.state,planHash:entry.planHash})
        if(!success){uncertain=true;break}
      }
      const outcome={day,binding,policyVersion:policy.version,scopeHash:config.scopeHash,complete:jobs.length===policy.scope.length&&!uncertain,ok:!uncertain,jobs,meaning:'complete means all scope jobs accounted for, not all jobs repaired'}
      const saved=await deps.saveSweep(day,outcome)
      if(!saved||saved.day!==day||saved.binding!==binding||saved.complete!==outcome.complete)throw Error('daily sweep receipt unproved')
      // Uncertain attempts retain the singleton gate. No automatic takeover.
      if(!uncertain){const released=await deps.releaseWorker(worker.token,outcome);if(released!==true)throw Error('daily worker release unproved')}
      return outcome
    }catch{
      // Do not release a possibly acquired durable gate on any ambiguous failure.
      return {ok:false,complete:false,day,jobs,reason:'daily stopped; inspect durable worker and attempt receipts before retry'}
    }finally{activeBinding=null;deps.release()}
  }
  async function assertAuthorized(){
    if(!activeBinding)throw Error('daily run is not active')
    const current=await authorization()
    if(current.binding!==activeBinding)throw Error('daily authorization changed')
    return true
  }
  return {sweep,assertAuthorized}
}
