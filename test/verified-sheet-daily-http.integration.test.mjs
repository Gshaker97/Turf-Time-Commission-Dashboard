import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {dailyGuards} from '../lib/verified-sheet-daily.mjs'
import {dailyCasPath} from '../lib/verified-sheet-daily-store.mjs'
import {isDeepStrictEqual} from 'node:util'
const source=readFileSync(new URL('../server.js',import.meta.url),'utf8')
const middleware=source.match(/^app\.use\(express\.text\(\{ type: '\*\/\*', limit: '1mb' \}\)\)$/m)?.[0]
test('actual server CAS adapter uses bounded JSON-path revision equality and validates full readback',async()=>{
  const start=source.indexOf('const verifiedDailyStore=createDailyStore('),end=source.indexOf('const verifiedDaily=createVerifiedDaily(',start)
  const calls=[],value={revision:'new-token',state:'finished'}
  const adapter=new Function('createDailyStore','verifiedPrivateValue','verifiedInsertClaim','dailyCasPath','verifiedBatchStore','isDeepStrictEqual',source.slice(start,end)+';return verifiedDailyStore')(x=>x,()=>{},()=>{},dailyCasPath,async(method,path,body)=>{calls.push({method,path});return [{key:'verified_sheet_daily_worker',value:body.value}]},isDeepStrictEqual)
  assert.equal(await adapter.patch('verified_sheet_daily_worker',{revision:'old-token',jobs:Array(228).fill({detail:'x'.repeat(500)})},value),true)
  assert.equal(calls[0].method,'PATCH')
  assert.ok(calls[0].path.length<200)
  assert.match(calls[0].path,/value->>revision=eq.old-token$/)
  assert.doesNotMatch(calls[0].path,/jobs|detail/)
})
test('actual daily timer wiring runs only configured hour with all guards and never uses old plan approvals',async()=>{
  const start=source.indexOf('async function verifiedSheetTick(){'),end=source.indexOf("app.get('/api/arcsite/verified-sheet-reconcile',",start)
  const block=source.slice(start,end),calls=[]
  const env={ARC_VERIFIED_SHEET_AUTO:'1',ARC_VERIFIED_SHEET_WRITES:'1',ARC_VERIFIED_SHEET_SINGLE_WRITER:'1',ARC_VERIFIED_SHEET_BATCH:'0'}
  let hour=5
  const tick=new Function('process','dailyGuards','phoenixNow','ARC_AUDIT_HOUR','verifiedDaily',block+';return verifiedSheetTick')({env},dailyGuards,()=>({day:'2026-11-02',hour}),6,{sweep:async v=>calls.push(v)})
  await tick();assert.equal(calls.length,0)
  hour=6;await tick();assert.deepEqual(calls,[{day:'2026-11-02'}])
  env.ARC_VERIFIED_SHEET_BATCH='1';await tick();assert.equal(calls.length,1)
  env.ARC_VERIFIED_SHEET_BATCH='0';env.ARC_VERIFIED_SHEET_WRITES='0';await tick();assert.equal(calls.length,1)
  assert.doesNotMatch(block,/approvedPlanHashes|verifiedSheetRun/)
})
test('actual final PUT checks active daily authorization before sending any network write',async()=>{
  const start=source.indexOf('async function verifiedWriteOpportunity('),end=source.indexOf('const verifiedSheetRuntime',start)
  const block=source.slice(start,end),calls=[]
  const env={ARC_VERIFIED_SHEET_WRITES:'1',ARC_VERIFIED_SHEET_SINGLE_WRITER:'1'}
  const write=new Function('verifiedDailyActive','verifiedDaily','process','verifiedBatchActive','batchGuards','fetch','GHL_BASE','ghlHeaders','GHL_WRITE_TOKEN',block+';return verifiedWriteOpportunity')(true,{assertAuthorized:async()=>{throw Error('authorization changed')}},{env},false,()=>false,async()=>{calls.push('write');return {ok:true}},'https://example.invalid',()=>({}),'synthetic')
  await assert.rejects(write('synthetic',{monetaryValue:1}),/authorization changed/)
  assert.equal(calls.length,0)
})
test('actual daily status HTTP route is owner-only and read-only through production middleware',{skip:process.env.RUN_SERVER_HTTP_INTEGRATION!=='1'},async()=>{
  const {default:express}=await import('express'),app=express()
  const start=source.indexOf("app.get('/api/arcsite/verified-sheet-reconcile/daily',"),end=source.indexOf('// Preview persists findings',start)
  assert.ok(start>=0&&end>start&&middleware)
  const block=source.slice(start,end),reads=[]
  assert.doesNotMatch(block,/req\.body|\.sweep\(|verifiedBatchStore|verifiedInsertClaim/)
  new Function('app','express',middleware)(app,express)
  new Function('app','analystAuthorized','phoenixNow','verifiedPrivateValue','DAILY_WORKER_KEY','dailyDayKey','dailyGuards','process','ARC_AUDIT_HOUR','err',block)(app,req=>req.get('X-Test-Owner')==='yes'?'jarvis':null,()=>({day:'2026-11-02'}),async key=>{reads.push(key);return null},'worker',day=>'day_'+day,dailyGuards,{env:{}},6,error=>({ok:false,error}))
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))})
  try{
    const url=`http://127.0.0.1:${server.address().port}/api/arcsite/verified-sheet-reconcile/daily`
    assert.equal((await fetch(url)).status,401);assert.equal(reads.length,0)
    const r=await fetch(url,{headers:{'X-Test-Owner':'yes'}});assert.equal(r.status,200)
    assert.equal((await r.json()).guardsEnabled,false);assert.equal(reads.length,2)
    assert.equal((await fetch(url,{method:'POST',headers:{'X-Test-Owner':'yes','Content-Type':'application/json'},body:'{}'})).status,404)
    assert.equal(reads.length,2)
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
})
