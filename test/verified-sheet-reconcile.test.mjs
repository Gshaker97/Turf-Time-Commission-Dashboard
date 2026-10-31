import test from 'node:test'
import assert from 'node:assert/strict'
import { cents, planReconcile, executePlan, reconcileScope } from '../lib/verified-sheet-reconcile.mjs'
const now = Date.parse('2026-10-31T20:00:00Z')
const fixture = () => ({ projectId:'p', opportunityId:'o', complete:true, sourceHealthy:true, readAt:new Date(now).toISOString(), opportunitiesForProject:['o'], activeBooked:true, canceled:false, commissionApplicable:true,
 revision:{projectId:'p',proposalId:'2',status:'APPROVED',total:7400,verifiedAt:new Date(now).toISOString(),pdf:{projectId:'p',proposalId:'2',signed:true,sha256:'a'.repeat(64)}}, validSignedProposalIds:['2'],latestValidProposalId:'2',
 sheetRows:[{projectId:'p',proposalId:'2',status:'APPROVED',revisionHash:'row2',approvedTotal:7400,baseline:5389.19,commission:2010.81}], current:{value:7400,price:7400,baseline:4937.46,commission:1862.54} })
const policy = () => ({version:'1',maxAgeMs:300000,scope:[{projectId:'p',opportunityId:'o',fieldHolds:{}}]})
const plan = (x=fixture(),p=policy())=>planReconcile(x,p,{now})
for (const [raw,want] of [['($743.99)',-74399],['-$743.99',-74399],['$1,001.01',100101],['',null],[' ',null],[null,null],['EMPTY ($3)',null],['1,2',null],[Infinity,null],[0,0]]) test(`money ${String(raw)}`,()=>assert.equal(cents(raw),want))
test('same total secondary fields are checked',()=>assert.deepEqual(plan().changes.map(c=>c.field),['baseline','commission']))
for (const [label, mutate] of [
 ['unknown scope',x=>x.opportunityId='other'],['incomplete',x=>x.complete=false],['stale',x=>x.readAt='2020-01-01'],['duplicate opp',x=>x.opportunitiesForProject.push('other')],['canceled',x=>x.canceled=true],['void',x=>x.revision.void=true],['unsigned',x=>x.revision.pdf.signed=false],['wrong PDF proposal',x=>x.revision.pdf.proposalId='1'],['old revision',x=>x.latestValidProposalId='3'],['duplicate row',x=>x.sheetRows.push({...x.sheetRows[0]})],['same-total wrong sheet proposal',x=>x.sheetRows[0].proposalId='1'],['missing hash',x=>delete x.sheetRows[0].revisionHash],['source price dispute',x=>x.revision.total=7500],['unresolved add-on',x=>x.validSignedProposalIds.push('1')]
]) test(label,()=>{const x=fixture();mutate(x);const p=plan(x);assert.equal(p.changes.length,0);assert.ok(p.holds.length)})
test('reviewed replacement set exact',()=>{const x=fixture(),p=policy();x.validSignedProposalIds=['1','2'];p.scope[0].replacementResolution={kind:'replacement',proposalId:'2',proposalIds:['1','2'],pdfSha256:'a'.repeat(64)};assert.equal(plan(x,p).changes.length,2);x.validSignedProposalIds.push('3');assert.equal(plan(x,p).changes.length,0)})
test('whole job holds win',()=>{const p=policy();p.scope[0].hold='named';assert.equal(plan(fixture(),p).changes.length,0)})
test('negative and blank fields held separately',()=>{const x=fixture();x.sheetRows[0].commission='($743.99)';x.current.baseline=' ';assert.equal(plan(x).changes.length,0)})
test('field hold preserves other changes',()=>{const p=policy();p.scope[0].fieldHolds.commission='Rebecca';assert.deepEqual(plan(fixture(),p).changes.map(x=>x.field),['baseline'])})
test('Sheet Approved Total wins a signed-PDF rounding gap; never write PDF-derived amount',()=>{const x=fixture();x.revision.total=7399.99;x.current.value=7399.99;x.current.price=7399.99;const changes=plan(x).changes.filter(c=>['value','price'].includes(c.field));assert.deepEqual(changes.map(c=>c.wantCents),[740000,740000]);assert.ok(changes.every(c=>c.wantCents!==739999))})
test('already Sheet-matching values are unchanged despite PDF cent difference',()=>{const x=fixture();x.revision.total=7399.99;assert.ok(plan(x).changes.every(c=>!['value','price'].includes(c.field)))})
test('nonpositive Sheet total remains held even inside PDF tolerance',()=>{const x=fixture();x.revision.total=0.5;x.sheetRows[0].approvedTotal=0;assert.equal(plan(x).changes.length,0);assert.match(plan(x).holds[0],/disagree/)})
test('unverified markup and contacts never in plan',()=>{const x=fixture();x.current.markup=1;x.current.contact=1;assert.ok(plan(x).changes.every(c=>['value','price','baseline','commission'].includes(c.field)))})
function adapter(x=fixture()){const writes=[];return {x,writes,readEvidence:async()=>structuredClone(x),writeGhlField:async(o,f,v)=>{writes.push({o,f,v});x.current[f]=v},readGhlField:async(o,f)=>x.current[f]}}
test('default OFF and missing approval cause zero writes',async()=>{const a=adapter(),p=plan();await executePlan(p,policy(),a);await executePlan(p,policy(),a,{enabled:true});assert.equal(a.writes.length,0)})
test('live readback and second run idempotent',async()=>{const a=adapter(),p=plan();const r=await executePlan(p,policy(),a,{enabled:true,approvedPlanHashes:[p.planHash],now:()=>now});assert.equal(r.ok,true);assert.equal(a.writes.length,2);assert.equal(plan(a.x).changes.length,0)})
test('destination drift aborts',async()=>{const a=adapter(),p=plan();a.x.current.baseline=5000;const r=await executePlan(p,policy(),a,{enabled:true,approvedPlanHashes:[p.planHash],now:()=>now});assert.equal(r.ok,false);assert.equal(a.writes.length,0)})
test('source drift aborts',async()=>{const a=adapter(),p=plan();a.x.revision.pdf.sha256='b'.repeat(64);const r=await executePlan(p,policy(),a,{enabled:true,approvedPlanHashes:[p.planHash],now:()=>now});assert.equal(r.ok,false);assert.equal(a.writes.length,0)})
test('HTTP success but unchanged value stops remaining fields',async()=>{const a=adapter(),p=plan();a.writeGhlField=async()=>a.writes.push('dropped');const r=await executePlan(p,policy(),a,{enabled:true,approvedPlanHashes:[p.planHash],now:()=>now});assert.equal(r.ok,false);assert.equal(a.writes.length,1)})
test('timeout after applied write verified without retry',async()=>{const a=adapter(),p=plan();const w=a.writeGhlField;a.writeGhlField=async(...args)=>{await w(...args);throw Error('timeout')};const r=await executePlan(p,policy(),a,{enabled:true,approvedPlanHashes:[p.planHash],now:()=>now});assert.equal(r.ok,true);assert.equal(a.writes.length,2)})
test('uncertain readback stops',async()=>{const a=adapter(),p=plan();a.readGhlField=async()=>{throw Error('offline')};const r=await executePlan(p,policy(),a,{enabled:true,approvedPlanHashes:[p.planHash],now:()=>now});assert.match(r.reason,/no retry/);assert.equal(a.writes.length,1)})
test('scope dry run never calls writer',async()=>{const a=adapter();await reconcileScope(policy(),a,{now:()=>now});assert.equal(a.writes.length,0)})
test('incomplete source retains only allowlisted diagnostic codes and remains held',()=>{
  const x=fixture();x.complete=false;x.holds=['PDF body Total absent or disagrees with proposal metadata','PDF body Total absent or disagrees with proposal metadata','PDF body signature evidence absent']
  const p=plan(x)
  assert.equal(p.changes.length,0);assert.equal(p.planHash,undefined);assert.equal(p.sourceHash,undefined)
  assert.deepEqual(p.sourceIssues,[{code:'ARCSITE_PDF_TOTAL_UNVERIFIED',message:'PDF body Total absent or disagrees with proposal metadata'},{code:'ARCSITE_PDF_SIGNATURE_ABSENT',message:'PDF body signature evidence absent'}])
  assert.equal(p.holds[0],'source unavailable or incomplete; retry without writes');assert.equal(p.holds.length,3)
})
test('untrusted source diagnostic text and objects never enter a plan report',()=>{
  const x=fixture();x.complete=false;x.holds=['Bearer secret123','https://private.invalid/signed?token=secret123','PDF body signature evidence absent secret123','constructor',{toString(){throw Error('must not stringify')}}]
  const p=plan(x)
  assert.deepEqual(p.holds,['source unavailable or incomplete; retry without writes']);assert.equal(p.sourceIssues,undefined)
  assert.doesNotMatch(JSON.stringify(p),/secret123|private.invalid/)
})
test('named exclusion remains first and suppresses lower-priority source diagnostics',()=>{
  const x=fixture(),policyValue=policy();x.complete=false;x.holds=['PDF body signature evidence absent'];policyValue.scope[0].hold='named exclusion'
  const p=plan(x,policyValue);assert.deepEqual(p.holds,['named exclusion']);assert.equal(p.sourceIssues,undefined);assert.equal(p.changes.length,0)
})
test('source diagnostics never bypass unhealthy state or affect a healthy plan',()=>{
  const x=fixture();x.sourceHealthy=false;x.holds=['ArcSite evidence read failed; no writes']
  assert.equal(plan(x).sourceIssues[0].code,'ARCSITE_READ_FAILED');assert.equal(plan(x).changes.length,0)
  x.sourceHealthy=true;assert.equal(plan(x).sourceIssues,undefined);assert.equal(plan(x).changes.length,2)
})

test('reviewed commission cent hold remains protected despite Sheet difference',()=>{const x=fixture(),p=policy();x.current.commission=2000;x.sheetRows[0].commission=1999.99;p.scope[0].fieldHolds.commission='manual review cent hold';const r=plan(x,p);assert.ok(r.changes.every(c=>c.field!=='commission'));assert.ok(r.holds.includes('commission: manual review cent hold'))})
test('scope report preserves only fixed exception codes, never error text',async()=>{
  const a=adapter();a.readEvidence=async()=>{const e=Error('secret URL token');e.code='VERIFIED_SHEET_SCHEMA_INVALID';throw e}
  const r=await reconcileScope(policy(),a);assert.equal(r.plans[0].sourceIssues[0].code,'VERIFIED_SHEET_SCHEMA_INVALID');assert.doesNotMatch(JSON.stringify(r),/secret|token/);assert.equal(r.plans[0].changes.length,0)
  a.readEvidence=async()=>{const e=Error('secret');e.code='untrusted-secret-code';throw e};const unknown=await reconcileScope(policy(),a);assert.equal(unknown.plans[0].sourceIssues,undefined);assert.doesNotMatch(JSON.stringify(unknown),/secret/)
})
test('Approved Total already includes commission; never add commission to revenue',()=>{const x=fixture();x.current.value=7000;x.current.price=7000;const r=plan(x);assert.deepEqual(r.changes.filter(c=>['value','price'].includes(c.field)).map(c=>c.wantCents),[740000,740000]);assert.ok(r.changes.filter(c=>['value','price'].includes(c.field)).every(c=>c.wantCents!==941081));assert.equal(r.changes.find(c=>c.field==='commission').wantCents,201081)})
