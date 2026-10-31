import test from 'node:test'
import assert from 'node:assert/strict'
import { createVerifiedSheetRuntime } from '../lib/verified-sheet-runtime.mjs'
const policy = { version:'test',maxAgeMs:300000,scope:[{projectId:'1',opportunityId:'o1',fieldHolds:{}}] }
function setup() {
  const current = {value:100,price:100,baseline:50,commission:10}, writes = [], reports = []
  const sheet = { jobs:{headers:['Project ID','Proposal ID','Status','Approved Total','Baseline Cost','Commission'],rows:[{'Project ID':'1','Proposal ID':'10',Status:'APPROVED','Approved Total':100,'Baseline Cost':60,Commission:10}]},schedule:{headers:['Proposal ID','Status','Install Date'],rows:[{'Proposal ID':'10',Status:'BOOKED','Install Date':'2026-11-01'}]} }
  const deps = {
    readGhlSnapshot:async()=>({opportunities:[{id:'o1',project_id:'1',status:'open'}],meta:{partial:false,errors:[],opportunity_pages:1}}),
    readFreshSheet:async()=>structuredClone(sheet),
    readOpportunity:async()=>({projectId:'1',opportunityId:'o1',status:'open',commissionApplicable:true,fields:{...current}}),
    arcsite:{arcGet:async path=>path.includes('?')?[{proposal_id:'10',project_id:'1'}]:{proposal_id:'10',project_id:'1',status:'APPROVED',total:100,pdf_url:'https://cdn.example/10.pdf'},fetchPdfBytes:async url=>({status:200,url,bytes:Buffer.from('%PDF-1.7 test')}),parsePdfText:async()=> 'Total $100.00\nCustomer Signature 2020-01-01 01:00 PM UTC'},
    writeGhlField:async(id,field,value)=>{writes.push({id,field,value});current[field]=value},
    readGhlField:async(id,field)=>current[field], saveReport:async r=>reports.push(r),
  }
  return {deps,sheet,current,writes,reports,runtime:createVerifiedSheetRuntime(deps,policy)}
}
test('runtime fake sources build exact dry-run plan without writes',async()=>{
  const f=setup(),r=await f.runtime.run()
  assert.equal(r.plans.length,1);assert.deepEqual(r.plans[0].changes,[{field:'baseline',wasCents:5000,wantCents:6000}])
  assert.equal(f.writes.length,0);assert.equal(f.reports.length,1)
})
test('runtime enables only approved exact plan then independently reads back',async()=>{
  const f=setup(),dry=await f.runtime.run()
  const blocked=await f.runtime.run({enabled:true})
  assert.equal(f.writes.length,0);assert.equal(blocked.results[0].ok,false)
  const r=await f.runtime.run({enabled:true,approvedPlanHashes:[dry.plans[0].planHash]})
  assert.equal(r.results[0].ok,true);assert.deepEqual(f.writes,[{id:'o1',field:'baseline',value:60}])
})
test('runtime partial source prevents all writes',async()=>{
  const f=setup();f.deps.readGhlSnapshot=async()=>({meta:{partial:true},opportunities:[]})
  await assert.rejects(f.runtime.run({enabled:true}),/incomplete/);assert.equal(f.writes.length,0);assert.equal(f.reports.at(-1).ok,false)
})
test('runtime changed Sheet revision requires a new approval',async()=>{
  const f=setup(),dry=await f.runtime.run();f.sheet.jobs.rows[0]['Baseline Cost']=70
  const r=await f.runtime.run({enabled:true,approvedPlanHashes:[dry.plans[0].planHash]})
  assert.equal(r.results[0].ok,false);assert.equal(f.writes.length,0)
})
test('runtime multiple opportunities for same project holds',async()=>{
  const f=setup();f.deps.readGhlSnapshot=async()=>({meta:{partial:false},opportunities:[{id:'o1',project_id:'1'},{id:'o2',project_id:'1'}]})
  const r=await f.runtime.run();assert.equal(r.plans[0].changes.length,0);assert.match(r.plans[0].holds.join(),/ambiguous/)
})
test('runtime unsigned PDF body is never an executable plan',async()=>{
  const f=setup();f.deps.arcsite.parsePdfText=async()=> 'Unsigned estimate'
  const r=await f.runtime.run({enabled:true});assert.equal(r.plans[0].changes.length,0);assert.equal(f.writes.length,0)
})
test('runtime duplicate BOOKED rows and invalid/out-of-window dates hold',async()=>{
  for (const date of ['2026-12-01','2026-09-30','2026-11-31','garbage']) {
    const f=setup();f.sheet.schedule.rows[0]['Install Date']=date
    assert.equal((await f.runtime.run()).plans[0].changes.length,0)
  }
  const f=setup();f.sheet.schedule.rows.push({...f.sheet.schedule.rows[0],'Install Date':'2026-11-02'})
  assert.equal((await f.runtime.run()).plans[0].changes.length,0)
})
test('runtime October and November endpoints are inclusive',async()=>{
  for (const date of ['2026-10-01','2026-11-30','11/30/2026']) {
    const f=setup();f.sheet.schedule.rows[0]['Install Date']=date
    assert.equal((await f.runtime.run()).plans[0].changes.length,1)
  }
})
test('runtime refreshes identity before write, catching newly created duplicate',async()=>{
  const f=setup(),dry=await f.runtime.run();let reads=0
  f.deps.readGhlSnapshot=async()=>({meta:{partial:false},opportunities:++reads===1?[{id:'o1',project_id:'1'}]:[{id:'o1',project_id:'1'},{id:'o2',project_id:'1'}]})
  const r=await f.runtime.run({enabled:true,approvedPlanHashes:[dry.plans[0].planHash]})
  assert.equal(reads,2);assert.equal(r.results[0].ok,false);assert.equal(f.writes.length,0)
})
test('runtime source stages retain only fixed safe diagnostic codes',async()=>{
  const secret='https://private.invalid/?token=DO_NOT_LEAK'
  for(const [code,mutate] of [
    ['VERIFIED_SHEET_READ_FAILED',f=>{f.deps.readFreshSheet=async()=>{throw Error(secret)}}],
    ['VERIFIED_SHEET_SCHEMA_INVALID',f=>{f.sheet.jobs.headers=[]}],
    ['VERIFIED_GHL_READ_FAILED',f=>{f.deps.readOpportunity=async()=>{throw Error(secret)}}],
    ['VERIFIED_GHL_READ_FAILED',f=>{f.deps.readOpportunity=async()=>null}],
    ['VERIFIED_GHL_IDENTITY_MISMATCH',f=>{const read=f.deps.readOpportunity;f.deps.readOpportunity=async()=>({...await read(),projectId:'other'})}],
  ]) {
    const f=setup();mutate(f)
    const r=await f.runtime.run({enabled:true,approvedPlanHashes:['unrelated']})
    assert.equal(r.plans[0].sourceIssues[0].code,code)
    assert.equal(r.plans[0].changes.length,0)
    assert.equal(f.writes.length,0)
    assert.doesNotMatch(JSON.stringify(r),/DO_NOT_LEAK|private\.invalid/)
  }
})
test('runtime snapshot failures sanitize exceptions and stored reports',async()=>{
  for(const read of [async()=>{throw Error('secret-token')},async()=>null,async()=>({opportunities:[],meta:{opportunity_pages:300}})]) {
    const f=setup();f.deps.readGhlSnapshot=read
    await assert.rejects(f.runtime.run({enabled:true}),e=>e.code==='VERIFIED_GHL_SNAPSHOT_FAILED' && !e.message.includes('secret-token'))
    assert.equal(f.reports.at(-1).sourceCode,'VERIFIED_GHL_SNAPSHOT_FAILED')
    assert.equal(f.writes.length,0)
    assert.doesNotMatch(JSON.stringify(f.reports),/secret-token/)
  }
})
test('runtime preserves safe ArcSite failed-read hold without raw exception',async()=>{
  const f=setup();f.deps.arcsite.arcGet=async()=>{throw Error('secret-token')}
  const r=await f.runtime.run()
  assert.equal(r.plans[0].sourceIssues[0].code,'ARCSITE_READ_FAILED')
  assert.equal(r.plans[0].changes.length,0)
  assert.doesNotMatch(JSON.stringify(r),/secret-token/)
})
