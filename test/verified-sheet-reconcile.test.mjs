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
test('signed cent wins source tolerance, exact cents compared',()=>{const x=fixture();x.revision.total=7399.99;assert.equal(plan(x).changes.find(c=>c.field==='price').wantCents,739999)})
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
