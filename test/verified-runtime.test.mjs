import test from 'node:test'
import assert from 'node:assert/strict'
import { createVerifiedSheetRuntime } from '../lib/verified-sheet-runtime.mjs'
const policy = { version:'test',maxAgeMs:300000,scope:[{projectId:'1',opportunityId:'o1',fieldHolds:{}}] }
function setup() {
  const current = {value:100,price:100,baseline:50,commission:10}, writes = [], reports = []
  const sheet = { jobs:{headers:['Project ID','Proposal ID','Status','Approved Total','Baseline Cost','Commission'],rows:[{'Project ID':'1','Proposal ID':'10',Status:'APPROVED','Approved Total':100,'Baseline Cost':60,Commission:10}]},schedule:{headers:['Proposal ID','Status','Install Date'],rows:[{'Proposal ID':'10',Status:'BOOKED','Install Date':'2026-11-01'}]} }
  const deps = {
    readGhlSnapshot:async()=>({opportunities:[{id:'o1',project_id:'1',status:'open'}],meta:{partial:false,errors:[],opportunity_pages:1}}),
    readFreshSheet:async()=>({data:structuredClone(sheet),fetchedAt:new Date().toISOString()}),
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
test('228 exact-scope dry-run jobs share one detached Sheet fetch',async()=>{
  const f=setup();let sheetReads=0
  const scope=Array.from({length:228},(_,i)=>({projectId:String(i+1),opportunityId:`o${i+1}`,fieldHolds:{}}))
  f.sheet.jobs.rows=scope.map(s=>({...f.sheet.jobs.rows[0],'Project ID':s.projectId,'Proposal ID':s.projectId}))
  f.sheet.schedule.rows=scope.map(s=>({...f.sheet.schedule.rows[0],'Proposal ID':s.projectId}))
  f.deps.readFreshSheet=async()=>{sheetReads++;return {data:f.sheet,fetchedAt:new Date().toISOString()}}
  f.deps.readGhlSnapshot=async()=>({opportunities:scope.map(s=>({id:s.opportunityId,project_id:s.projectId,status:'open'})),meta:{partial:false}})
  f.deps.readOpportunity=async opportunityId=>({projectId:opportunityId.slice(1),opportunityId,status:'open',commissionApplicable:true,fields:{...f.current}})
  f.deps.arcsite.arcGet=async path=>{
    const id=path.includes('?')?new URL(`https://synthetic.invalid${path}`).searchParams.get('project_id'):path.split('/').at(-1)
    // Mutating the original reader object cannot change the normalized run snapshot.
    f.sheet.jobs.rows[0]['Baseline Cost']=999
    return path.includes('?')?[{proposal_id:id,project_id:id}]:{proposal_id:id,project_id:id,status:'APPROVED',total:100,pdf_url:`https://cdn.example/${id}.pdf`}
  }
  const r=await createVerifiedSheetRuntime(f.deps,{...policy,scope}).run()
  assert.equal(r.plans.length,228);assert.equal(sheetReads,1);assert.equal(f.writes.length,0)
  assert.match(r.sheetSnapshot.snapshotHash,/^[a-f0-9]{64}$/);assert.ok(Number.isFinite(Date.parse(r.sheetSnapshot.fetchedAt)))
  assert.ok(r.plans.every(p=>p.changes.some(c=>c.field==='baseline' && c.wantCents===6000)))
})
test('initial Sheet failure or incomplete schema aborts whole run without plans',async()=>{
  for(const [code,read] of [
    ['VERIFIED_SHEET_READ_FAILED',async()=>{throw Error('secret-token')}],
    ['VERIFIED_SHEET_SCHEMA_INVALID',async()=>({data:{},fetchedAt:new Date().toISOString()})],
    ['VERIFIED_SHEET_SCHEMA_INVALID',async()=>({data:{},fetchedAt:'2020-01-01'})],
  ]) {
    const f=setup();f.deps.readFreshSheet=read
    await assert.rejects(f.runtime.run({enabled:true}),e=>e.code===code)
    assert.deepEqual(f.reports.at(-1).plans,[]);assert.equal(f.writes.length,0)
    assert.doesNotMatch(JSON.stringify(f.reports),/secret-token/)
  }
})
test('prewrite refresh detects Sheet drift instead of using planning snapshot',async()=>{
  const f=setup(),dry=await f.runtime.run();let reads=0
  f.deps.readFreshSheet=async()=>{reads++;const data=structuredClone(f.sheet);if(reads>1)data.jobs.rows[0]['Baseline Cost']=70;return {data,fetchedAt:new Date().toISOString()}}
  const r=await f.runtime.run({enabled:true,approvedPlanHashes:[dry.plans[0].planHash]})
  assert.equal(reads,2);assert.equal(r.results[0].ok,false);assert.equal(f.writes.length,0)
  assert.equal(r.sheetSnapshot.snapshotHash,dry.sheetSnapshot.snapshotHash)
})
test('overlapping runtime run is rejected without another Sheet fetch',async()=>{
  const f=setup();let release,reads=0
  f.deps.readFreshSheet=async()=>{reads++;await new Promise(resolve=>{release=resolve});return {data:structuredClone(f.sheet),fetchedAt:new Date().toISOString()}}
  const first=f.runtime.run()
  while(!release) await new Promise(resolve=>setImmediate(resolve))
  const second=await f.runtime.run();assert.equal(second.ok,false);assert.match(second.reason,/already running/)
  release();await first;assert.equal(reads,1)
})
test('Sheet fetched timestamp cannot be refreshed by evidence assembly',async()=>{
  const f=setup();const fetchedAt=new Date(Date.now()-1000).toISOString()
  f.deps.readFreshSheet=async()=>({data:structuredClone(f.sheet),fetchedAt})
  const tiny={...policy,maxAgeMs:2000}
  const parse=f.deps.arcsite.parsePdfText
  f.deps.arcsite.parsePdfText=async()=>{await new Promise(resolve=>setTimeout(resolve,1100));return parse()}
  const r=await createVerifiedSheetRuntime(f.deps,tiny).run()
  assert.equal(r.plans[0].changes.length,0);assert.equal(f.writes.length,0)
  assert.equal(r.sheetSnapshot.fetchedAt,fetchedAt)
  assert.ok(r.plans[0].holds.includes('source evidence stale or undated'))
})
test('prewrite snapshots never replace later projects planning generation',async()=>{
  const f=setup(),scope=[policy.scope[0],{projectId:'2',opportunityId:'o2',fieldHolds:{}}]
  f.sheet.jobs.rows.push({...f.sheet.jobs.rows[0],'Project ID':'2','Proposal ID':'20'})
  f.sheet.schedule.rows.push({...f.sheet.schedule.rows[0],'Proposal ID':'20'})
  f.deps.readGhlSnapshot=async()=>({opportunities:scope.map(s=>({id:s.opportunityId,project_id:s.projectId,status:'open'})),meta:{partial:false}})
  f.deps.readOpportunity=async opportunityId=>({projectId:opportunityId.slice(1),opportunityId,status:'open',commissionApplicable:true,fields:{...f.current}})
  f.deps.arcsite.arcGet=async path=>{const projectId=path.includes('?')?new URL(`https://synthetic.invalid${path}`).searchParams.get('project_id'):path.split('/').at(-1).slice(0,-1);return path.includes('?')?[{proposal_id:projectId+'0',project_id:projectId}]:{proposal_id:projectId+'0',project_id:projectId,status:'APPROVED',total:100,pdf_url:`https://cdn.example/${projectId}.pdf`}}
  const runtime=createVerifiedSheetRuntime(f.deps,{...policy,scope}),dry=await runtime.run();let reads=0
  f.deps.readFreshSheet=async()=>{const data=structuredClone(f.sheet);if(++reads>1)data.jobs.rows.forEach(r=>{r['Baseline Cost']=70});return {data,fetchedAt:new Date().toISOString()}}
  const r=await runtime.run({enabled:true,approvedPlanHashes:dry.plans.map(p=>p.planHash)})
  assert.equal(reads,3);assert.equal(f.writes.length,0)
  assert.ok(r.plans.every(p=>p.changes.some(c=>c.field==='baseline'&&c.wantCents===6000)))
  assert.equal(r.sheetSnapshot.snapshotHash,dry.sheetSnapshot.snapshotHash)
})
