import test from 'node:test'
import assert from 'node:assert/strict'
import {isDeepStrictEqual} from 'node:util'
import {createDailyStore,DAILY_WORKER_KEY,dailyProjectKey,dailyCasPath} from '../lib/verified-sheet-daily-store.mjs'
function fixture(){
  const db=new Map(),calls={writes:0};let id=0
  const read=async key=>structuredClone(db.get(key)??null)
  const insert=async(key,value)=>{calls.writes++;if(db.has(key))return false;db.set(key,structuredClone(value));return true}
  const patch=async(key,expected,value)=>{calls.writes++;if(!isDeepStrictEqual(db.get(key),expected))return false;db.set(key,structuredClone(value));return true}
  return {db,calls,read,insert,patch,store:createDailyStore({read,insert,patch,uuid:()=>`synthetic-${++id}`,now:()=> '2026-11-02T13:00:00Z'})}
}
const binding={binding:'a'.repeat(64),policyVersion:'synthetic',scopeHash:'b'.repeat(64)}
const entry={projectId:'1',opportunityId:'synthetic-opportunity',planHash:'c'.repeat(64),sourceHash:'d'.repeat(64),binding:binding.binding,changes:[{field:'baseline',wasCents:100,wantCents:200}]}
test('durable daily singleton survives restart; no expiry or automatic takeover',async()=>{
  const f=fixture(),worker=await f.store.acquireWorker('2026-11-02',binding)
  assert.equal(worker.binding,binding.binding)
  const restarted=createDailyStore(f)
  assert.equal(await restarted.acquireWorker('2026-11-03',binding),null)
  assert.equal(await f.store.releaseWorker(worker.token,{complete:true}),true)
  assert.ok(await restarted.acquireWorker('2026-11-03',binding))
})
test('concurrent durable singleton claims admit only one writer',async()=>{
  const f=fixture()
  const results=await Promise.all([f.store.acquireWorker('2026-11-02',binding),f.store.acquireWorker('2026-11-02',binding)])
  assert.equal(results.filter(Boolean).length,1)
})
test('intent and final receipt are append-only, future different verified plans use CAS',async()=>{
  const f=fixture(),worker=await f.store.acquireWorker('2026-11-02',binding)
  const claim=await f.store.claimJob(worker.token,entry,null)
  assert.equal(f.db.get('verified_sheet_daily_intent_'+claim.attemptId).state,'attempting')
  const finished=await f.store.finishJob(claim,{state:'verified'})
  assert.equal(finished.state,'verified')
  assert.equal(f.db.get('verified_sheet_daily_intent_'+claim.attemptId).state,'attempting')
  assert.equal(f.db.get('verified_sheet_daily_result_'+claim.attemptId).state,'verified')
  assert.equal(await f.store.claimJob(worker.token,entry,null),null)
  assert.ok(await f.store.claimJob(worker.token,{...entry,planHash:'e'.repeat(64)},finished))
})
test('uncertain attempt cannot be replayed on a new process',async()=>{
  const f=fixture(),worker=await f.store.acquireWorker('2026-11-02',binding)
  const claim=await f.store.claimJob(worker.token,entry,null)
  const failed=await f.store.finishJob(claim,{state:'uncertain'})
  assert.equal(await f.store.claimJob(worker.token,entry,failed),null)
  assert.equal((await f.store.loadJobState('1')).state,'uncertain')
})
test('intent storage failure leaves the project gate closed before any financial write',async()=>{
  const f=fixture(),worker=await f.store.acquireWorker('2026-11-02',binding)
  const store=createDailyStore({...f,insert:async(k,v)=>{if(k.includes('_intent_'))throw Error('timeout');return f.insert(k,v)}})
  await assert.rejects(store.claimJob(worker.token,entry,null))
  assert.equal(f.db.get(dailyProjectKey('1')).state,'attempting')
})
test('receipt failure leaves the project gate attempting and worker retained',async()=>{
  const f=fixture(),worker=await f.store.acquireWorker('2026-11-02',binding)
  const claim=await f.store.claimJob(worker.token,entry,null)
  const store=createDailyStore({...f,insert:async(k,v)=>{if(k.includes('_result_'))throw Error('timeout');return f.insert(k,v)}})
  await assert.rejects(store.finishJob(claim,{state:'verified'}))
  assert.equal(f.db.get(dailyProjectKey('1')).state,'attempting')
  assert.equal(f.db.get(DAILY_WORKER_KEY).state,'running')
})
test('completed day receipt is distinct from runtime findings and cannot be replaced',async()=>{
  const f=fixture(),outcome={binding:binding.binding,complete:true,jobs:[]}
  const saved=await f.store.saveSweep('2026-11-02',outcome)
  assert.equal(saved.complete,true)
  assert.equal(await f.store.saveSweep('2026-11-02',{complete:false}),false)
  assert.equal((await f.store.loadSweep('2026-11-02')).complete,true)
})
test('storage read-back corruption fails closed',async()=>{
  const f=fixture(),store=createDailyStore({...f,read:async k=>{const v=await f.read(k);return v?{...v,token:'corrupt'}:v}})
  await assert.rejects(store.acquireWorker('2026-11-02',binding),/read-back mismatch/)
})
test('next-day 228-job worker CAS stays bounded and never sends reports in the URL',async()=>{
  const f=fixture(),paths=[]
  const store=createDailyStore({...f,patch:async(k,p,v)=>{paths.push(dailyCasPath(k,p));return f.patch(k,p,v)}})
  const worker=await store.acquireWorker('2026-11-02',binding)
  const jobs=Array.from({length:228},(_,i)=>({projectId:String(i+1),state:'matched',detail:'x'.repeat(200)}))
  await store.saveSweep('2026-11-02',{day:'2026-11-02',binding:binding.binding,complete:true,ok:true,jobs})
  await store.releaseWorker(worker.token,{day:'2026-11-02',complete:true,ok:true,jobs})
  assert.ok(await store.acquireWorker('2026-11-03',binding))
  assert.ok(paths.every(p=>p.length<300&&!p.includes('detail')&&!p.includes('%7B')))
  assert.ok(JSON.stringify(f.db.get(DAILY_WORKER_KEY)).length<600)
  assert.equal((await store.loadSweep('2026-11-02')).jobs.length,228)
})
