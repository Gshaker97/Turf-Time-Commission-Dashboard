import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {batchIdentity,batchGuards,createVerifiedBatch} from '../lib/verified-sheet-batch.mjs'
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64)
const armed=()=>({ARC_VERIFIED_SHEET_AUTO:'0',ARC_VERIFIED_SHEET_WRITES:'1',ARC_VERIFIED_SHEET_SINGLE_WRITER:'1',ARC_VERIFIED_SHEET_BATCH:'1'})
function fixture(store=new Map()){
  let busy=false;const calls={claims:0,runs:0,releases:0,finishes:[]},policy={approvedPlanHashes:[A,B],scope:[{projectId:'1'}]},env=armed()
  const deps={env,acquire:()=>{if(busy)return false;busy=true;return true},release:()=>{busy=false;calls.releases++},loadPolicy:async()=>policy,
    claim:async(id,hashes)=>{calls.claims++;const keys=[id,...hashes];if(keys.some(k=>store.has(k)))return false;keys.forEach(k=>store.set(k,id));return true},
    run:async(p,h)=>{calls.runs++;calls.policy=p;calls.approvals=h;return {dryRun:false,results:[{ok:true}],plans:[]}},
    finish:async(id,outcome)=>{calls.finishes.push({id,outcome})}}
  return {deps,calls,policy,env,store,start:createVerifiedBatch(deps)}
}
const request={authorized:true,body:{},query:{}}
async function complete(f,req=request){const r=await f.start(req);if(r.completion)await r.completion;return r}
test('batch identity canonicalizes ordering but rejects empty, duplicate and malformed approvals',()=>{
  assert.equal(batchIdentity([A,B]),batchIdentity([B,A]));assert.notEqual(batchIdentity([A]),batchIdentity([A,B]))
  for(const h of [[],[A,A],['secret'],null,Array(229).fill(A)])assert.throws(()=>batchIdentity(h))
})
test('auth, payload, query, and each guard fail before lock or claim',async()=>{
  for(const req of [{...request,authorized:false},{...request,authorized:'jarvis'},...['',[],{hashes:[A]},{write:true},42].map(body=>({...request,body})),{...request,query:{project:'1'}}]){
    const f=fixture(),r=await f.start(req);assert.ok([400,401].includes(r.status));assert.equal(f.calls.claims,0);assert.equal(f.calls.releases,0)
  }
  for(const [key,value] of [['ARC_VERIFIED_SHEET_AUTO','1'],['ARC_VERIFIED_SHEET_WRITES','0'],['ARC_VERIFIED_SHEET_SINGLE_WRITER',undefined],['ARC_VERIFIED_SHEET_BATCH','true']]){
    const f=fixture();f.env[key]=value;assert.equal(batchGuards(f.env),false);assert.equal((await f.start(request)).status,409);assert.equal(f.calls.claims,0)
  }
})
test('successful batch uses private frozen snapshot and returns batch-specific outcome',async()=>{
  const f=fixture();const claim=f.deps.claim;f.deps.claim=async(id,h)=>{f.policy.scope[0].projectId='changed';f.policy.approvedPlanHashes=[C];return claim(id,h)}
  const r=await complete(f);assert.equal(r.status,202);assert.equal(r.body.batchId,batchIdentity([A,B]));assert.match(r.body.statusPath,new RegExp(r.body.batchId+'$'))
  assert.deepEqual(f.calls.approvals,[A,B]);assert.equal(f.calls.policy.scope[0].projectId,'1');assert.equal(f.calls.finishes[0].id,r.body.batchId);assert.equal(f.calls.finishes[0].outcome.state,'finished')
  assert.equal(f.calls.runs,1);assert.equal(f.calls.releases,1);assert.equal(batchGuards(f.env),false)
})
test('shared lock rejects overlap without changing active guards',async()=>{
  const f=fixture();let release;f.deps.run=async()=>new Promise(r=>{release=r})
  const first=await f.start(request),second=await f.start(request);assert.equal(first.status,202);assert.equal(second.status,409);assert.equal(batchGuards(f.env),true);assert.equal(f.calls.claims,1)
  release({results:[]});await first.completion;assert.equal(f.calls.releases,1)
})
test('durable per-plan claims reject replay, reordered, subset and superset after restart',async()=>{
  const store=new Map();await complete(fixture(store))
  for(const approvals of [[A,B],[B,A],[A],[A,B,C]]){
    const f=fixture(store);f.policy.approvedPlanHashes=approvals
    assert.equal((await complete(f)).status,409);assert.equal(f.calls.runs,0);assert.equal(f.calls.releases,1)
  }
  assert.equal(store.has(C),false)
})
test('claim timeout after durable insert never executes or retries',async()=>{
  const f=fixture(),claim=f.deps.claim;f.deps.claim=async(...args)=>{await claim(...args);throw Error('secret-token')}
  const r=await complete(f);assert.equal(r.status,503);assert.equal(f.calls.runs,0);assert.equal(f.calls.claims,1);assert.equal(f.store.has(A),true);assert.equal(f.calls.releases,1);assert.doesNotMatch(JSON.stringify(r),/secret-token/)
})
test('guard change during claim retains claim and stops before run',async()=>{
  const f=fixture(),claim=f.deps.claim;f.deps.claim=async(...args)=>{const r=await claim(...args);f.env.ARC_VERIFIED_SHEET_AUTO='1';return r}
  const r=await complete(f);assert.equal(r.status,409);assert.equal(f.calls.runs,0);assert.equal(f.calls.finishes[0].outcome.state,'held');assert.equal(f.store.has(A),true);assert.equal(f.calls.releases,1)
})
test('run failure is uncertain, sanitized, durable, and cleaned up',async()=>{
  const f=fixture();f.deps.run=async()=>{throw Error('secret-token')}
  const r=await complete(f);assert.equal(r.status,202);assert.equal(f.calls.finishes[0].outcome.state,'uncertain');assert.doesNotMatch(JSON.stringify(f.calls.finishes),/secret-token/);assert.equal(f.calls.releases,1);assert.equal(f.store.has(A),true)
})
test('finish failure leaves durable claim and always disarms/releases',async()=>{
  const f=fixture();f.deps.finish=async()=>{throw Error('secret-token')}
  const r=await f.start(request);await assert.rejects(r.completion);assert.equal(f.calls.releases,1);assert.equal(batchGuards(f.env),false);assert.equal(f.store.has(A),true)
})
test('policy load failure cannot claim or run and cleans up',async()=>{
  const f=fixture();f.deps.loadPolicy=async()=>{throw Error('secret-token')}
  const r=await complete(f);assert.equal(r.status,503);assert.equal(f.calls.claims,0);assert.equal(f.calls.runs,0);assert.equal(f.calls.releases,1);assert.doesNotMatch(JSON.stringify(r),/secret-token/)
})
test('server claims insert-only with private auth and per-field guards',()=>{
  const s=readFileSync(new URL('../server.js',import.meta.url),'utf8'),block=s.slice(s.indexOf("const VERIFIED_BATCH_PREFIX="),s.indexOf('// The daily contract audit by hand'))
  assert.match(block,/verifiedBatchStore\('POST','\/rest\/v1\/app_settings',rows\)/)
  assert.match(block,/verified_sheet_consumed_/);assert.doesNotMatch(block,/resolution=merge-duplicates|\?on_conflict=/)
  assert.match(block,/redirect:'manual'/);assert.match(block,/controller\.signal/)
  assert.match(block,/authorized:analystAuthorized\(req\)==='jarvis'/)
  assert.match(block,/if\(analystAuthorized\(req\)!=='jarvis'\)/)
  assert.match(s,/verifiedBatchActive && !batchGuards\(process\.env\)/)
  assert.doesNotMatch(block,/ARC_VERIFIED_SHEET_AUTO\s*=/)
})
test('independent instances cannot both consume the same approval set',async()=>{
  const store=new Map(),one=fixture(store),two=fixture(store)
  const results=await Promise.all([one.start(request),two.start(request)])
  await Promise.all(results.map(r=>r.completion).filter(Boolean))
  assert.deepEqual(results.map(r=>r.status).sort(),[202,409])
  assert.equal(one.calls.runs+two.calls.runs,1)
})
test('empty or duplicate private approvals cannot claim or run',async()=>{
  for(const hashes of [[],[A,A]]){
    const f=fixture();f.policy.approvedPlanHashes=hashes
    const r=await complete(f);assert.equal(r.status,503);assert.equal(f.calls.claims,0);assert.equal(f.calls.runs,0);assert.equal(f.calls.releases,1)
  }
})
test('partial and uncertain field outcomes remain in exact batch receipt',async()=>{
  const f=fixture(),report={results:[{ok:false,fields:[{field:'baseline',state:'verified'},{field:'commission',state:'uncertain; readback required before retry'}]}],plans:[]}
  f.deps.run=async()=>report
  const r=await complete(f);assert.equal(r.status,202);assert.deepEqual(f.calls.finishes[0].outcome.report,report);assert.equal(f.store.has(A),true)
  assert.deepEqual(f.calls.finishes[0].outcome.fieldStates,{'verified':1,'uncertain; readback required before retry':1})
  assert.match(f.calls.finishes[0].outcome.meaning,/not a success assertion/)
})
test('actual batch transport is bounded, manual redirect, insert-only and sanitizes status failures',async()=>{
  const s=readFileSync(new URL('../server.js',import.meta.url),'utf8')
  const source=s.slice(s.indexOf('async function verifiedBatchStore('),s.indexOf('const verifiedBatchStart='))
  const seen=[]
  const build=fetch=>new Function('fetch','SUPABASE_URL','jsonHeaders',source+';return verifiedBatchStore')(fetch,'https://synthetic.invalid',{'Content-Type':'application/json'})
  const store=build(async(url,options)=>{seen.push({url,options});return {status:201,ok:true,json:async()=>[{key:'fake'}]}})
  assert.deepEqual(await store('POST','/rest/v1/app_settings',[{key:'fake'}]),[{key:'fake'}])
  assert.equal(seen[0].options.redirect,'manual');assert.equal(seen[0].options.headers.Prefer,'return=representation');assert.ok(seen[0].options.signal);assert.doesNotMatch(seen[0].url,/on_conflict/)
  assert.equal(await build(async()=>({status:409,ok:false}))('POST','/rest/v1/app_settings',[]),null)
  await assert.rejects(build(async()=>({status:500,ok:false,text:async()=>'secret-token'}))('POST','/rest/v1/app_settings',[]),e=>e.message==='batch store unavailable')
})
test('PUT boundary rechecks guards after any asynchronous schema lookup',()=>{
  const s=readFileSync(new URL('../server.js',import.meta.url),'utf8')
  const put=s.slice(s.indexOf('async function verifiedWriteOpportunity('),s.indexOf('const verifiedSheetRuntime ='))
  assert.match(put,/verifiedBatchActive && !batchGuards\(process\.env\)/)
  assert.ok(put.indexOf('batchGuards(process.env)')<put.indexOf('await fetch('))
  const claim=s.slice(s.indexOf('claim:async(batchId,approvals)=>'),s.indexOf('run:async(policy,approvedPlanHashes)=>'))
  assert.match(claim,/isDeepStrictEqual\(actual\.value,expected\.value\)/)
  assert.doesNotMatch(claim,/JSON\.stringify\(actual\.value\)/)
})
test('raw text middleware JSON bodies decode once and only empty objects pass',async()=>{
  for(const body of ['{}',' \n { } \t']){const f=fixture();assert.equal((await complete(f,{...request,body})).status,202);assert.equal(f.calls.claims,1)}
  for(const body of ['{','null','[]','[{}]','"{}"','true','1','{"hashes":[]}','{"scope":{}}','{"values":{}}','{"nested":{"hashes":[]}}','   ',null]){
    const f=fixture(),r=await complete(f,{...request,body});assert.equal(r.status,400,String(body));assert.equal(f.calls.claims,0);assert.equal(f.calls.runs,0);assert.equal(f.calls.releases,0)
  }
})
