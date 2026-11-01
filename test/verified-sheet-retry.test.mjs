import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {canonicalHash,validateRetry,createVerifiedRetry} from '../lib/verified-sheet-retry.mjs'
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex')
const request={authorized:true,body:'{}',query:{}}
const armed=()=>({ARC_VERIFIED_SHEET_AUTO:'0',ARC_VERIFIED_SHEET_WRITES:'1',ARC_VERIFIED_SHEET_SINGLE_WRITER:'1',ARC_VERIFIED_SHEET_BATCH:'1'})
function fixture(store={receipts:new Set(),plans:new Set()}){
  const entries=[1,2].map(i=>{const e={projectId:String(i),opportunityId:`op${i}`,sourceHash:String(i).repeat(64),changes:[{field:'baseline',wasCents:100,wantCents:200}]};return {...e,planHash:digest(e)}})
  const parent={batchId:'a'.repeat(64),state:'finished',report:{policyVersion:'original',dryRun:false,fullScope:true,plans:entries.map(e=>({projectId:e.projectId,opportunityId:e.opportunityId,changes:[],holds:['source evidence stale or undated']})),results:[]}}
  const config={version:1,approved:true,parentBatchId:parent.batchId,parentReceiptHash:canonicalHash(parent),entries}
  const policy={version:'original',maxAgeMs:300000,scope:entries.map(e=>({projectId:e.projectId,opportunityId:e.opportunityId,fieldHolds:{}})),approvedPlanHashes:entries.map(e=>e.planHash)}
  const consumed=Object.fromEntries(entries.map(e=>[e.planHash,{batchId:parent.batchId,planHash:e.planHash}]))
  const calls={runs:[],claims:[],finishes:[],releases:0};let busy=false
  const env=armed(),deps={env,acquire:()=>{if(busy)return false;busy=true;return true},release:()=>{busy=false;calls.releases++},loadConfig:async()=>config,loadPolicy:async()=>policy,loadParent:async()=>parent,loadConsumed:async h=>consumed[h],
    claimReceipt:async id=>{if(store.receipts.has(id))return false;store.receipts.add(id);return true},
    claimPlan:async(id,e)=>{calls.claims.push(e.planHash);if(store.plans.has(e.planHash))return false;store.plans.add(e.planHash);return true},
    run:async(p,o)=>{calls.runs.push({policy:p,...o});const e=entries.find(e=>e.projectId===o.onlyProject);return {dryRun:!o.enabled,plans:[structuredClone(e)],results:o.enabled?[{projectId:e.projectId,opportunityId:e.opportunityId,ok:true,fields:[{field:'baseline',state:'verified'}]}]:[]}},
    finish:async(id,outcome)=>calls.finishes.push({id,outcome})}
  return {entries,parent,config,policy,consumed,calls,store,env,deps,controller:createVerifiedRetry(deps)}
}
async function execute(f){const r=await f.controller.start(request);if(r.completion)await r.completion;return r}
const rehash=f=>{f.config.parentReceiptHash=canonicalHash(f.parent)}
test('canonical receipt digest ignores JSONB key order, preserves array order',()=>{
  assert.equal(canonicalHash({a:1,b:{c:2,d:3}}),canonicalHash({b:{d:3,c:2},a:1}));assert.notEqual(canonicalHash([1,2]),canonicalHash([2,1]));assert.throws(()=>canonicalHash(undefined))
})
test('strict binding validates only original stale unattempted tuples',()=>{
  const f=fixture();assert.equal(validateRetry(f.config,f.parent,f.policy,f.consumed).entries.length,2)
  const mutations=[
    f=>{f.config.approved='true'},f=>{f.config.extra=true},f=>{f.config.entries=[]},f=>{f.config.parentReceiptHash='b'.repeat(64)},
    f=>{f.config.entries[0].changes[0].wantCents++},f=>{f.config.entries[0].changes[0].field='value'},f=>{f.config.entries.push(f.config.entries[0])},
    f=>{f.parent.state='uncertain';rehash(f)},f=>{f.parent.report.dryRun=true;rehash(f)},f=>{f.parent.report.fullScope=false;rehash(f)},
    f=>{f.parent.report.plans[0].holds.push('extra');rehash(f)},f=>{f.parent.report.plans.push(f.parent.report.plans[0]);rehash(f)},
    f=>{f.parent.report.results.push({projectId:'1',opportunityId:'op1',fields:[]});rehash(f)},
    f=>{f.parent.report.results.push({fields:[]});rehash(f)},f=>{f.parent.report.plans.pop();rehash(f)},f=>{f.policy.version='changed'},
    f=>{f.parent.report.results.push({projectId:'1',opportunityId:'other',ok:false});rehash(f)},
    f=>{f.policy.scope[0].hold='held'},f=>{f.policy.scope[0].fieldHolds.baseline='held'},f=>{f.policy.approvedPlanHashes=[]},f=>{f.policy.maxAgeMs=600000},
    f=>{f.consumed[f.entries[0].planHash].batchId='b'.repeat(64)},f=>{delete f.consumed[f.entries[0].planHash]},
  ]
  for(const mutate of mutations){const f=fixture();mutate(f);assert.throws(()=>validateRetry(f.config,f.parent,f.policy,f.consumed))}
})
test('preview permits proposed config, uses fresh per-job dry generations, never claims or disarms',async()=>{
  const f=fixture();f.config.approved=false
  const result=await f.controller.preview(request)
  assert.equal(result.status,200);assert.ok(result.body.jobs.every(j=>j.eligible));assert.deepEqual(f.calls.runs.map(r=>[r.onlyProject,r.enabled]),[['1',false],['2',false]])
  assert.equal(f.store.receipts.size,0);assert.equal(f.store.plans.size,0);assert.equal(f.env.ARC_VERIFIED_SHEET_WRITES,'1');assert.equal(f.calls.releases,1)
})
test('unapproved start, parameters, unauthorized caller and guards cannot execute',async()=>{
  const f=fixture();f.config.approved=false;assert.equal((await execute(f)).status,409);assert.equal(f.calls.runs.length,0);assert.equal(f.store.receipts.size,0)
  for(const req of [{...request,authorized:false},{...request,body:'null'},{...request,body:'{"hashes":[]}'},{...request,query:{projectId:'1'}}]){const g=fixture();assert.ok([400,401].includes((await g.controller.start(req)).status));assert.equal(g.calls.runs.length,0)}
  const g=fixture();g.env.ARC_VERIFIED_SHEET_AUTO='1';assert.equal((await execute(g)).status,409);assert.equal(g.store.receipts.size,0)
})
test('execution retains exact original hashes, snapshots, parent records and fresh per-job generations',async()=>{
  const f=fixture(),before=canonicalHash({parent:f.parent,consumed:f.consumed});let clock=0
  const run=f.deps.run;f.deps.run=async(p,o)=>{clock+=240000;assert.equal(p.maxAgeMs,300000);return run(p,o)}
  const response=await execute(f);assert.equal(response.status,202)
  assert.deepEqual(f.calls.runs.map(r=>[r.onlyProject,r.enabled]),[['1',false],['1',true],['2',false],['2',true]])
  assert.ok(clock>300000);assert.deepEqual(f.calls.runs.filter(r=>r.enabled).map(r=>r.approvedPlanHashes),f.entries.map(e=>[e.planHash]))
  assert.equal(before,canonicalHash({parent:f.parent,consumed:f.consumed}));assert.equal(f.calls.finishes.length,1);assert.equal(f.env.ARC_VERIFIED_SHEET_WRITES,'0')
})
test('fresh plan drift never claims that plan or executes it',async()=>{
  const f=fixture(),run=f.deps.run;f.deps.run=async(p,o)=>{const r=await run(p,o);r.plans[0].planHash='c'.repeat(64);return r}
  await execute(f);assert.equal(f.store.plans.size,0);assert.ok(f.calls.runs.every(r=>!r.enabled));assert.ok(f.calls.finishes[0].outcome.jobs.every(j=>j.state==='held'))
})
test('alternate retry receipt cannot replay permanently consumed original plans',async()=>{
  const store={receipts:new Set(),plans:new Set()},f=fixture(store);await execute(f)
  const g=fixture(store);g.config.entries.reverse();await execute(g)
  assert.ok(g.calls.runs.every(r=>!r.enabled));assert.equal(store.plans.size,2)
  const h=fixture(store);h.config.entries=h.config.entries.slice(0,1);await execute(h);assert.ok(h.calls.runs.every(r=>!r.enabled))
})
test('claim acknowledgement uncertainty stops all writes and retains consumed claim',async()=>{
  const f=fixture(),claim=f.deps.claimPlan;f.deps.claimPlan=async(...args)=>{await claim(...args);throw Error('secret-token')}
  await execute(f);assert.equal(f.store.plans.size,1);assert.ok(f.calls.runs.every(r=>!r.enabled));assert.equal(f.calls.finishes[0].outcome.state,'uncertain');assert.doesNotMatch(JSON.stringify(f.calls.finishes),/secret-token/)
})
test('partial execution stops later jobs and cannot be automatically replayed',async()=>{
  const f=fixture(),run=f.deps.run;f.deps.run=async(p,o)=>{const r=await run(p,o);if(o.enabled)r.results[0].ok=false;return r}
  await execute(f);assert.equal(f.calls.runs.length,2);assert.equal(f.store.plans.size,1);assert.equal(f.calls.finishes[0].outcome.state,'uncertain')
})
test('guard removal after plan claim blocks execution and preserves claim',async()=>{
  const f=fixture(),claim=f.deps.claimPlan;f.deps.claimPlan=async(...a)=>{const r=await claim(...a);f.env.ARC_VERIFIED_SHEET_BATCH='0';return r}
  await execute(f);assert.equal(f.store.plans.size,1);assert.ok(f.calls.runs.every(r=>!r.enabled));assert.equal(f.calls.releases,1)
})
test('finish failure always releases and disarms without deleting claims',async()=>{
  const f=fixture();f.deps.finish=async()=>{throw Error('unavailable')};const r=await f.controller.start(request);await assert.rejects(r.completion);assert.equal(f.store.plans.size,2);assert.equal(f.calls.releases,1);assert.equal(f.env.ARC_VERIFIED_SHEET_WRITES,'0')
})
test('shared lock excludes overlapping preview and start',async()=>{
  const f=fixture();let release;f.deps.loadConfig=async()=>{await new Promise(r=>{release=r});return f.config}
  const first=f.controller.preview(request);while(!release)await new Promise(r=>setImmediate(r));assert.equal((await f.controller.start(request)).status,409);release();await first
})
test('private config mutation after receipt claim cannot change execution approvals',async()=>{
  const f=fixture(),claim=f.deps.claimReceipt,original=f.entries.map(e=>e.planHash)
  f.deps.claimReceipt=async(...a)=>{const result=await claim(...a);f.config.approved=false;f.policy.approvedPlanHashes=[];f.policy.version='modified';return result}
  await execute(f);assert.deepEqual(f.calls.runs.filter(r=>r.enabled).map(r=>r.approvedPlanHashes[0]),original);assert.ok(f.calls.runs.every(r=>r.policy.version==='original'))
})
test('receipt claim uncertainty never previews, claims jobs or writes',async()=>{
  const f=fixture(),claim=f.deps.claimReceipt;f.deps.claimReceipt=async(...a)=>{await claim(...a);throw Error('secret')}
  const r=await execute(f);assert.equal(r.status,503);assert.equal(f.store.receipts.size,1);assert.equal(f.store.plans.size,0);assert.equal(f.calls.runs.length,0);assert.equal(f.calls.releases,1)
})
test('execution exception consumes only attempted permit and stops later jobs',async()=>{
  const f=fixture(),run=f.deps.run;f.deps.run=async(p,o)=>{if(o.enabled)throw Error('secret');return run(p,o)}
  await execute(f);assert.equal(f.store.plans.size,1);assert.equal(f.calls.finishes[0].outcome.state,'uncertain');assert.equal(f.calls.releases,1);assert.doesNotMatch(JSON.stringify(f.calls.finishes),/secret/)
})
test('independent workers cannot use the same retry receipt concurrently',async()=>{
  const store={receipts:new Set(),plans:new Set()},f=fixture(store),g=fixture(store)
  const results=await Promise.all([f.controller.start(request),g.controller.start(request)])
  await Promise.all(results.map(r=>r.completion).filter(Boolean))
  assert.deepEqual(results.map(r=>r.status).sort(),[202,409]);assert.equal([...f.calls.runs,...g.calls.runs].filter(r=>r.enabled).length,2)
})
test('fake runtime clock uses fresh generations beyond five minutes; one expired job stays unwritten',async()=>{
  const f=fixture();let now=0;const generations=[]
  f.deps.run=async(policy,options)=>{
    const fetchedAt=now;now+=options.onlyProject==='1'?300001:200000
    generations.push({fetchedAt,completedAt:now,...options})
    assert.equal(policy.maxAgeMs,300000)
    const entry=f.entries.find(e=>e.projectId===options.onlyProject)
    if(now-fetchedAt>policy.maxAgeMs)return {dryRun:!options.enabled,plans:[{projectId:entry.projectId,opportunityId:entry.opportunityId,changes:[],holds:['source evidence stale or undated']}],results:[]}
    return {dryRun:!options.enabled,plans:[entry],results:options.enabled?[{projectId:entry.projectId,opportunityId:entry.opportunityId,ok:true,fields:[{field:'baseline',state:'verified'}]}]:[]}
  }
  await execute(f)
  assert.ok(now>600000)
  assert.deepEqual(generations.map(g=>[g.onlyProject,g.enabled]),[['1',false],['2',false],['2',true]])
  assert.equal(generations[1].fetchedAt,generations[0].completedAt)
  assert.equal(generations[2].fetchedAt,generations[1].completedAt)
  assert.deepEqual([...f.store.plans],[f.entries[1].planHash])
  assert.equal(f.calls.finishes[0].outcome.jobs[0].state,'held')
})
