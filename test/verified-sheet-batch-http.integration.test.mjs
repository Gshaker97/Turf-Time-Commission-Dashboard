import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createVerifiedBatch} from '../lib/verified-sheet-batch.mjs'

const enabled=process.env.RUN_SERVER_HTTP_INTEGRATION==='1'
const source=readFileSync(new URL('../server.js',import.meta.url),'utf8')
const middleware=source.match(/^app\.use\(express\.text\(\{ type: '\*\/\*', limit: '1mb' \}\)\)$/m)?.[0]
const routeStart=source.indexOf("app.post('/api/arcsite/verified-sheet-reconcile/batch',")
const routeEnd=source.indexOf("app.get('/api/arcsite/verified-sheet-reconcile/batch/:batchId'",routeStart)
const route=source.slice(routeStart,routeEnd)

test('real Express text middleware and actual batch route preserve strict raw-body boundary',{skip:!enabled},async()=>{
  const {default:express}=await import('express')
  assert.ok(middleware,'production text middleware must be located exactly')
  assert.ok(routeStart>=0 && routeEnd>routeStart,'production POST route must be located exactly')
  const cases=[
    {body:'{}',status:202},{body:' \n { } \t',status:202},
    ...['{','null','[]','[{}]','"{}"','true','1','{"approvedPlanHashes":[]}','{"nested":{"hashes":[]}}','{"scope":[]}','{"values":{}}','{"write":true}','   '].map(body=>({body,status:400})),
    {body:'{}',query:'?hashes=x',status:400},{body:'{}',query:'?scope=x',status:400},
    {body:'{}',authorized:false,status:401},{body:'{',authorized:false,status:401},
    ...['ARC_VERIFIED_SHEET_WRITES','ARC_VERIFIED_SHEET_SINGLE_WRITER','ARC_VERIFIED_SHEET_BATCH'].map(guard=>({body:'{}',guard,status:409})),
    {body:'{}',auto:true,status:409},
  ]
  for(const scenario of cases){
    const env={ARC_VERIFIED_SHEET_AUTO:scenario.auto?'1':'0',ARC_VERIFIED_SHEET_WRITES:'1',ARC_VERIFIED_SHEET_SINGLE_WRITER:'1',ARC_VERIFIED_SHEET_BATCH:'1'}
    if(scenario.guard)env[scenario.guard]='0'
    const calls={claims:0,runs:0,acquires:0};let completion
    const helper=createVerifiedBatch({env,acquire:()=>{calls.acquires++;return true},release:()=>{},loadPolicy:async()=>({approvedPlanHashes:['a'.repeat(64)]}),claim:async()=>{calls.claims++;return true},run:async()=>{calls.runs++;return {results:[],plans:[]}},finish:async()=>{}})
    const verifiedBatchStart=async args=>{const result=await helper(args);completion=result.completion;return result}
    const app=express()
    // Evaluate the exact production middleware and POST route, not a substitute.
    new Function('app','express',middleware)(app,express)
    new Function('app','verifiedBatchStart','analystAuthorized',route)(app,verifiedBatchStart,req=>req.get('X-Test-Authorization')==='owner'?'jarvis':null)
    const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener))})
    try{
      const response=await fetch(`http://127.0.0.1:${server.address().port}/api/arcsite/verified-sheet-reconcile/batch${scenario.query||''}`,{method:'POST',headers:{'Content-Type':'application/json','X-Test-Authorization':scenario.authorized===false?'denied':'owner'},body:scenario.body})
      const payload=await response.json()
      assert.equal(response.status,scenario.status,JSON.stringify(scenario))
      if(completion)await completion
      const expected=scenario.status===202?1:0
      assert.equal(calls.claims,expected,JSON.stringify(scenario));assert.equal(calls.runs,expected)
      if(expected){assert.equal(payload.started,true);assert.match(payload.batchId,/^[a-f0-9]{64}$/)}
      else assert.equal(calls.acquires,0,'rejected input/auth/guards must not acquire execution lock')
    }finally{
      server.closeAllConnections()
      await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))
    }
  }
})
