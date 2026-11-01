import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {readFileSync} from 'node:fs'
import {createVerifiedRetry,canonicalHash,retryRequestValid} from '../lib/verified-sheet-retry.mjs'
const enabled=process.env.RUN_SERVER_HTTP_INTEGRATION==='1'
const source=readFileSync(new URL('../server.js',import.meta.url),'utf8')
const middleware=source.match(/^app\.use\(express\.text\(\{ type: '\*\/\*', limit: '1mb' \}\)\)$/m)?.[0]
function fixture(){
  const entry={projectId:'1',opportunityId:'opp1',sourceHash:'a'.repeat(64),changes:[{field:'baseline',wasCents:100,wantCents:200}]}
  entry.planHash=crypto.createHash('sha256').update(JSON.stringify(entry)).digest('hex')
  const parent={batchId:'b'.repeat(64),state:'finished',report:{dryRun:false,fullScope:true,policyVersion:'test-v1',plans:[{projectId:'1',opportunityId:'opp1',changes:[],holds:['source evidence stale or undated']}],results:[]}}
  const config={version:1,approved:true,parentBatchId:parent.batchId,parentReceiptHash:canonicalHash(parent),entries:[entry]}
  const policy={version:'test-v1',maxAgeMs:300000,scope:[{projectId:'1',opportunityId:'opp1'}],approvedPlanHashes:[entry.planHash]}
  const calls={claims:0,writes:0,runs:0,previewRecords:[]},env={ARC_VERIFIED_SHEET_AUTO:'0',ARC_VERIFIED_SHEET_BATCH:'1',ARC_VERIFIED_SHEET_WRITES:'1',ARC_VERIFIED_SHEET_SINGLE_WRITER:'1'}
  let busy=false
  const helper=createVerifiedRetry({env,acquire:()=>{if(busy)return false;busy=true;return true},release:()=>{busy=false},loadConfig:async()=>config,loadParent:async()=>parent,loadPolicy:async()=>policy,loadConsumed:async()=>({batchId:parent.batchId,planHash:entry.planHash}),claimReceipt:async()=>{calls.claims++;return true},claimPlan:async()=>{calls.claims++;return true},run:async(_policy,options)=>{calls.runs++;if(options.enabled)calls.writes++;return {dryRun:!options.enabled,plans:[entry],results:options.enabled?[{ok:true,fields:[{field:'baseline',state:'verified'}]}]:[]}},finish:async()=>{}})
  return {helper,calls,env}
}
test('actual retry and preview HTTP routes retain raw-body auth and no-parameter boundaries',{skip:!enabled},async()=>{
  const {default:express}=await import('express')
  assert.ok(middleware)
  for(const preview of [false,true])for(const scenario of [{body:'{}',status:202},{body:' { } ',status:202},{body:'{"hashes":[]}',status:400},{body:'null',status:400},{body:'{',status:400},{body:'{}',query:'?project=1',status:400},{body:'{}',authorized:false,status:401}]){
    const f=fixture(),app=express();let completion
    const verifiedRetry={preview:f.helper.preview,start:async request=>{const result=await f.helper.start(request);completion=result.completion;return result}}
    const routeName=preview?'retry-preview':'retry'
    const start=source.indexOf(`app.post('/api/arcsite/verified-sheet-reconcile/${routeName}',`),end=source.indexOf(`app.get('/api/arcsite/verified-sheet-reconcile/${routeName}/`,start)
    assert.ok(start>=0&&end>start)
    new Function('app','express',middleware)(app,express)
    const args=['app','verifiedRetry','analystAuthorized','retryRequestValid','verifiedRunBusy','crypto','VERIFIED_RETRY_PREFIX','verifiedInsertClaim','err']
    new Function(...args,source.slice(start,end))(app,verifiedRetry,req=>req.get('X-Test-Authorization')==='owner'?'jarvis':null,retryRequestValid,false,crypto,'synthetic_',async(key,value)=>{f.calls.previewRecords.push({key,value});return true},error=>({ok:false,error}))
    const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))})
    try{
      const response=await fetch(`http://127.0.0.1:${server.address().port}/api/arcsite/verified-sheet-reconcile/${routeName}${scenario.query||''}`,{method:'POST',headers:{'Content-Type':'application/json','X-Test-Authorization':scenario.authorized===false?'denied':'owner'},body:scenario.body})
      assert.equal(response.status,scenario.status,JSON.stringify({preview,...scenario}));await response.json()
      if(completion)await completion
      await new Promise(resolve=>setImmediate(resolve))
      if(preview){assert.equal(f.calls.claims,0);assert.equal(f.calls.writes,0);assert.equal(f.calls.previewRecords.length,scenario.status===202?1:0)}
      else{assert.equal(f.calls.claims,scenario.status===202?2:0);assert.equal(f.calls.writes,scenario.status===202?1:0)}
    }finally{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))}
  }
})
