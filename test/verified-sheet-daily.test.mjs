import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {createVerifiedDaily,dailyScopeHash,validateDailyConfig} from '../lib/verified-sheet-daily.mjs'
import {createDailyStore,DAILY_WORKER_KEY,dailyProjectKey} from '../lib/verified-sheet-daily-store.mjs'
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
function fixture(db=new Map(),all=false){
  const scope=Array.from({length:228},(_,i)=>({projectId:String(i+1),opportunityId:`op${i+1}`,fieldHolds:{}}))
  const policy={version:'daily-v1',maxAgeMs:300000,scope,approvedPlanHashes:[]}
  const config={version:1,enabled:true,policyVersion:policy.version,scopeHash:dailyScopeHash(policy),allowedFields:['value','price','baseline','commission']}
  const state=scope.map((_,i)=>({was:100,want:all||i===0?200:100})),calls={runs:[],writes:0,releases:0},env={ARC_VERIFIED_SHEET_AUTO:'1',ARC_VERIFIED_SHEET_WRITES:'1',ARC_VERIFIED_SHEET_SINGLE_WRITER:'1',ARC_VERIFIED_SHEET_BATCH:'0'}
  let busy=false,clock=0,serial=0
  const store=createDailyStore({read:async k=>structuredClone(db.get(k)||null),insert:async(k,v)=>{if(db.has(k))return false;db.set(k,structuredClone(v));return true},patch:async(k,old,v)=>{if(!isDeepStrictEqual(db.get(k),old))return false;db.set(k,structuredClone(v));return true},uuid:()=>`instance-${Math.random()}-${++serial}`})
  const plan=projectId=>{const index=Number(projectId)-1,s=scope[index],v=state[index],changes=v.was===v.want?[]:[{field:'baseline',wasCents:v.was,wantCents:v.want}],p={projectId,opportunityId:s.opportunityId,sourceHash:digest({source:v.want}),changes};return {...p,planHash:digest(p),holds:[]}}
  const deps={...store,env,acquire:()=>{if(busy)return false;busy=true;return true},release:()=>{busy=false;calls.releases++},loadPolicy:async()=>policy,loadConfig:async()=>config,
    run:async(p,o)=>{const fetchedAt=clock;clock+=200000;calls.runs.push({...o,fetchedAt,completedAt:clock});assert.equal(p.maxAgeMs,300000);const entry=plan(o.onlyProject)
      if(!o.enabled)return {dryRun:true,plans:[entry],results:[]}
      const ok=o.approvedPlanHashes.includes(entry.planHash)
      if(ok){calls.writes++;state[Number(o.onlyProject)-1].was=state[Number(o.onlyProject)-1].want}
      return {dryRun:false,plans:[entry],results:[{projectId:entry.projectId,opportunityId:entry.opportunityId,ok,fields:ok?entry.changes.map(c=>({field:c.field,state:'verified',expectedCents:c.wantCents,observedCents:c.wantCents})):[]}]}
    }}
  return {db,scope,policy,config,state,calls,env,deps,controller:createVerifiedDaily(deps),plan}
}
test('daily config strictly binds all228 scope entries, holds, version, four fields and five-minute TTL',()=>{
  const f=fixture();assert.equal(validateDailyConfig(f.config,f.policy).enabled,true)
  for(const mutate of [f=>f.policy.scope.pop(),f=>f.policy.scope[0].fieldHolds.commission='hold',f=>f.policy.version='new',f=>f.policy.maxAgeMs=600000,f=>f.config.allowedFields.push('payroll'),f=>f.config.allowedFields.pop(),f=>f.config.extra=true]){const f=fixture();mutate(f);assert.throws(()=>validateDailyConfig(f.config,f.policy))}
})
test('228-job long sweep uses individual fresh generations, exact derived approvals, no old approval-list writes',async()=>{
  const f=fixture(new Map(),true),r=await f.controller.sweep({day:'2026-11-01'})
  assert.equal(r.complete,true);assert.equal(r.jobs.length,228);assert.equal(f.calls.writes,228);assert.equal(f.calls.runs.length,456)
  for(let i=0;i<228;i++){const [dry,write]=f.calls.runs.slice(i*2,i*2+2);assert.equal(dry.onlyProject,String(i+1));assert.equal(dry.enabled,false);assert.equal(write.onlyProject,dry.onlyProject);assert.equal(write.enabled,true);assert.equal(write.fetchedAt,dry.completedAt);assert.ok(write.completedAt-write.fetchedAt<300000)}
  assert.ok(f.calls.runs.at(-1).completedAt>300000);assert.deepEqual(f.policy.approvedPlanHashes,[]);assert.equal(f.db.get(DAILY_WORKER_KEY).state,'finished')
})
test('completed day skips duplicate; verified job permits a genuinely new plan next day',async()=>{
  const f=fixture();await f.controller.sweep({day:'2026-11-01'});assert.equal((await f.controller.sweep({day:'2026-11-01'})).skipped,true);assert.equal(f.calls.writes,1)
  f.state[0].want=300;await f.controller.sweep({day:'2026-11-02'});assert.equal(f.calls.writes,2)
  f.state[0].was=200;await f.controller.sweep({day:'2026-11-03'});assert.equal(f.calls.writes,2,'identical completed hash must not replay')
})
test('unknown prior attempts stay held after restart and no new source can bypass them',async()=>{
  const f=fixture();f.db.set(dailyProjectKey('1'),{state:'attempting',attemptId:'old'})
  const r=await f.controller.sweep({day:'2026-11-01'});assert.equal(r.jobs[0].state,'held');assert.equal(f.calls.writes,0)
})
test('disabled authorization or scope change cannot acquire a durable worker',async()=>{
  for(const mutate of [f=>f.config.enabled=false,f=>f.scope[0].fieldHolds.baseline='newhold',f=>f.env.ARC_VERIFIED_SHEET_AUTO='0']){const f=fixture();mutate(f);const r=await f.controller.sweep({day:'2026-11-01'});assert.equal(r.ok,false);assert.equal(f.db.has(DAILY_WORKER_KEY),false);assert.equal(f.calls.writes,0)}
})
test('source and destination drift after fresh preview remain uncertain and never replay',async()=>{
  const f=fixture(),run=f.deps.run;f.deps.run=async(p,o)=>{if(o.enabled)f.state[0].want=300;return run(p,o)}
  const r=await f.controller.sweep({day:'2026-11-01'});assert.equal(r.ok,false);assert.equal(f.calls.writes,0);assert.equal(f.db.get(dailyProjectKey('1')).state,'uncertain');assert.equal(f.db.get(DAILY_WORKER_KEY).state,'running')
  const restarted=fixture(f.db);assert.equal((await restarted.controller.sweep({day:'2026-11-02'})).ok,false);assert.equal(restarted.calls.writes,0)
})
test('uncertain write/readback retains job and worker barriers',async()=>{
  const f=fixture(),run=f.deps.run;f.deps.run=async(p,o)=>{const report=await run(p,o);if(o.enabled)report.results[0].fields[0].state='uncertain; readback required';return report}
  const r=await f.controller.sweep({day:'2026-11-01'});assert.equal(r.ok,false);assert.equal(f.calls.writes,1);assert.equal(f.db.get(dailyProjectKey('1')).state,'uncertain');assert.equal(f.db.get(DAILY_WORKER_KEY).state,'running')
})
test('known source failures before claims are held, not success, and other projects continue',async()=>{
  const f=fixture(),run=f.deps.run;f.deps.run=async(p,o)=>{if(o.onlyProject==='1')throw Error('secret');return run(p,o)}
  const r=await f.controller.sweep({day:'2026-11-01'});assert.equal(r.complete,true);assert.equal(r.jobs[0].state,'held');assert.equal(f.db.has(dailyProjectKey('1')),false);assert.doesNotMatch(JSON.stringify(r),/secret/)
})
test('claim denial executes nothing; uncertain claim acknowledgement leaves worker blocked',async()=>{
  for(const uncertain of [false,true]){const f=fixture();f.deps.claimJob=async()=>{if(uncertain)throw Error('secret');return null};const r=await f.controller.sweep({day:'2026-11-01'});assert.equal(f.calls.writes,0);assert.equal(r.complete,!uncertain);assert.equal(f.db.get(DAILY_WORKER_KEY).state,uncertain?'running':'finished')}
})
test('whole-job and partial-field holds remain in daily scope fingerprint',async()=>{
  const f=fixture();f.scope[0].hold='named';f.config.scopeHash=dailyScopeHash(f.policy);let r=await f.controller.sweep({day:'2026-11-01'});assert.equal(f.calls.writes,0);assert.equal(r.jobs[0].state,'held')
  const g=fixture();g.scope[0].fieldHolds.commission='cent exception';g.config.scopeHash=dailyScopeHash(g.policy);r=await g.controller.sweep({day:'2026-11-01'});assert.equal(g.calls.writes,1);assert.equal(r.jobs[0].state,'verified')
})
test('actual PUT authorization assertion fails when config or guards change mid-job',async()=>{
  const f=fixture(),run=f.deps.run;f.deps.run=async(p,o)=>{if(o.enabled){f.config.enabled=false;await f.controller.assertAuthorized()}return run(p,o)}
  const r=await f.controller.sweep({day:'2026-11-01'});assert.equal(r.ok,false);assert.equal(f.calls.writes,0);await assert.rejects(f.controller.assertAuthorized())
})
test('persistence exception after verified writes cannot unlock worker or report completed day',async()=>{
  const f=fixture();f.deps.finishJob=async()=>{throw Error('secret')};const r=await f.controller.sweep({day:'2026-11-01'});assert.equal(r.ok,false);assert.equal(f.db.get(DAILY_WORKER_KEY).state,'running');assert.equal(f.db.get(dailyProjectKey('1')).state,'attempting')
})
test('destination drift after preview cannot acquire fresh automatic approval mid-execution',async()=>{
  const f=fixture(),run=f.deps.run;f.deps.run=async(p,o)=>{if(o.enabled)f.state[0].was=150;return run(p,o)}
  const r=await f.controller.sweep({day:'2026-11-01'});assert.equal(r.ok,false);assert.equal(f.calls.writes,0);assert.equal(f.db.get(dailyProjectKey('1')).state,'uncertain')
})
test('concurrent independent controllers cannot acquire the same durable worker',async()=>{
  const db=new Map(),f=fixture(db),g=fixture(db)
  const results=await Promise.all([f.controller.sweep({day:'2026-11-01'}),g.controller.sweep({day:'2026-11-01'})])
  assert.equal(results.filter(r=>r.complete).length,1);assert.equal(f.calls.writes+g.calls.writes,1)
})
test('claim proof must match active worker and bound financial plan before any write',async()=>{
  const f=fixture(),claim=f.deps.claimJob;f.deps.claimJob=async(...args)=>({...await claim(...args),workerToken:'wrong'})
  const r=await f.controller.sweep({day:'2026-11-01'});assert.equal(r.ok,false);assert.equal(f.calls.writes,0);assert.equal(f.db.get(DAILY_WORKER_KEY).state,'running')
})
test('policy changed during a run cannot silently become new rule-based authorization',async()=>{
  const f=fixture(),run=f.deps.run;f.deps.run=async(p,o)=>{const report=await run(p,o);if(!o.enabled)f.policy.scope[0].fieldHolds.baseline='new hold';return report}
  const r=await f.controller.sweep({day:'2026-11-01'});assert.equal(r.ok,false);assert.equal(f.calls.writes,0);assert.equal(f.db.has(dailyProjectKey('1')),false)
})
