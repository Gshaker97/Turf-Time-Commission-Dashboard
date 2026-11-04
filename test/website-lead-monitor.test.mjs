import test from 'node:test'
import assert from 'node:assert/strict'
import {parseRequest,projectAddress,buildReport,collectWebsiteRequests,createMonitor} from '../lib/website-lead-monitor.mjs'
const now=Date.parse('2026-11-04T18:00:00Z')
const note=(extra='')=>({id:'note1',dateAdded:'2026-11-03T04:18:17.543Z',body:`Website estimate request\n\nName: Alex Rivera\nPhone: +14805550123\nEmail: alex@example.test\nProject address: 123 E Main Street, Mesa, AZ 85212\nCity or ZIP: 85212\nInterested in: Turf\nMessage: Please visit\nPage: https://www.turftimeaz.com/estimate.html\nReceived: 11/2/2026, 9:18:17 PM (Arizona)${extra}`})
const request=()=>parseRequest(note(),'c1','loc1')
const calendar=rows=>({generatedAt:new Date(now).toISOString(),window:{from:'2026-05-04',appointmentsTo:'2027-03-04',ahead:120,months:6},summary:{appointments:rows.length,upcoming:rows.filter(a=>a.isUpcoming===true).length},appointments:rows})
const appt=extra=>({id:'a1',customerName:'Alex Rivera',customerPhone:'480-555-0123',customerAddress:'123 East Main St, Mesa AZ',startAt:'2026-11-05T18:00:00Z',status:null,...extra})
const report=(requests=[request()],rows=[],extra={})=>buildReport({requests,calendar:calendar(rows),coverage:{complete:true,errors:[]},now,...extra})
test('original Arizona timestamp and project normalization; ZIP is not address',()=>{
 assert.equal(request().submittedAt,'2026-11-03T04:18:17.000Z')
 assert.equal(projectAddress('123 East Main St, Mesa AZ'),request().projectKey)
 assert.equal(projectAddress('85212'),null)
 assert.equal(parseRequest({body:'Website estimate request PDF for opportunity abc: url'},'c','l'),null)
})
test('extract address in multiline message and preserve original source',()=>{
 const n=note();n.body=n.body.replace('Project address: 123 E Main Street, Mesa, AZ 85212\n','').replace('Message: Please visit','Message: Please visit next week\nthe location is 2924 e athena ave gilbert az')
 const r=parseRequest(n,'c','l');assert.equal(r.projectKey,'2924eathenaave');assert.equal(r.addressOrigin,'message');assert.match(r.message,/next week\nthe location/)
})
test('explicit test notes excluded without name-based guessing',()=>{
 const r=request();r.name='Testing Smith';assert.equal(report([r]).leads.length,1)
 const n=note();n.body=n.body.replace('Please visit','TEST — controlled website launch verification. Not a customer estimate request.')
 assert.equal(report([parseRequest(n,'c','l')]).excluded.explicitTests,1)
})
test('missing after strictly more than twelve hours, original clock and stable notice key',()=>{
 const r=request(),second={...r,submittedAt:'2026-11-04T17:00:00Z'}
 const a=report([second,r]).leads[0],b=report([r,second]).leads[0]
 assert.equal(a.status,'missing_after_12h');assert.equal(a.submissionCount,2);assert.equal(a.noticeKey,b.noticeKey);assert.equal(a.submittedAt,r.submittedAt);assert.equal(a.notifyEligible,true)
 assert.equal(report([{...r,submittedAt:new Date(now-12*3600000).toISOString()}]).leads[0].status,'within_grace')
})
test('future and already-run appointments after submission suppress missing; historical unrelated visit does not',()=>{
 assert.equal(report([request()],[appt({})]).leads[0].status,'scheduled')
 assert.equal(report([request()],[appt({startAt:'2026-11-03T18:00:00Z',status:'CLOSED'})]).leads[0].status,'scheduled')
 const r=report([request()],[appt({startAt:'2026-10-01T18:00:00Z',status:'CLOSED'})]).leads[0]
 assert.equal(r.status,'review_needed');assert.equal(r.notifyEligible,false);assert.equal(r.reason,'historical_or_ambiguous_match')
})
test('canceled and rescheduled only require review, replacement active booking counts',()=>{
 for(const status of ['CANCELED','RESCHEDULED'])assert.equal(report([request()],[appt({status})]).leads[0].reason,'canceled_or_rescheduled_only')
 assert.equal(report([request()],[appt({secondaryStatus:'CANCELED'})]).leads[0].status,'review_needed')
 assert.equal(report([request()],[appt({status:'CANCELED'}),appt({id:'replacement'})]).leads[0].status,'scheduled')
})
test('different project with same phone and name-only matches are review-only',()=>{
 assert.equal(report([request()],[appt({customerAddress:'456 S Other Rd'})]).leads[0].reason,'matching_identity_different_project')
 assert.equal(report([request()],[appt({customerPhone:null,customerAddress:null})]).leads[0].status,'review_needed')
})
test('stable contact/opportunity IDs preferred when exported, email also supported',()=>{
 const r=request();r.opportunityIds=['opp1']
 for(const fields of [{contactId:'c1'},{ghlOpportunityId:'opp1'},{customerEmail:'alex@example.test'}])assert.equal(report([r],[appt({customerName:null,customerAddress:null,customerPhone:null,...fields})]).leads[0].status,'scheduled')
})
test('source partial, stale, incomplete window, invalid entries suppress all missing conclusions',()=>{
 for(const c of [{...calendar([]),partial:true},{...calendar([]),generatedAt:'2026-11-03T00:00:00Z'},{...calendar([]),window:{from:'2027-01-01',appointmentsTo:'2027-03-04',ahead:120}},calendar([appt({startAt:'bad'})])]){
  const d=report([request()],[],{calendar:c});assert.equal(d.ok,false);assert.equal(d.leads[0].status,'source_incomplete');assert.deepEqual(d.notificationCandidates,[])
 }
 assert.equal(report([request()],[],{coverage:{complete:false,errors:['missing_page']}}).leads[0].notifyEligible,false)
})
test('November 3 baseline excluded from notification candidates, missing original time requires review',()=>{
 const r={...request(),contactId:'IDDYLNFBVenh57oxDAXf'}
 assert.equal(report([r]).leads[0].previouslyNotifiedBaseline,true);assert.deepEqual(report([r]).notificationCandidates,[])
 assert.equal(report([{...r,submittedAt:null}]).leads[0].status,'review_needed')
})
test('discovery scans all pages including old reused contacts and verifies totals',async()=>{
 const paths=[]
 const d=await collectWebsiteRequests({locationId:'loc1',pause:async()=>{},getGhl:async path=>{paths.push(path);if(path.includes('/notes'))return {notes:[note()]};return paths.length===1?{contacts:[{id:'unrelated'}],meta:{total:2,nextPageUrl:'https://services.leadconnectorhq.com/contacts/?locationId=loc1&startAfterId=unrelated'}}:{contacts:[{id:'c1',tags:['website']}],meta:{total:2}}}})
 assert.equal(d.coverage.complete,true);assert.equal(d.coverage.contacts.pages,2);assert.equal(d.requests.length,1);assert.equal(paths.length,3)
})
test('discovery rejects off-origin pagination, catches truncated contacts and notes',async()=>{
 await assert.rejects(()=>collectWebsiteRequests({locationId:'loc1',getGhl:async()=>({contacts:[],meta:{total:0,nextPageUrl:'https://evil.test/contacts/?locationId=loc1'}})}),/invalid_contacts_cursor/)
 const d=await collectWebsiteRequests({locationId:'loc1',getGhl:async()=>({contacts:[],meta:{total:1}})});assert.equal(d.coverage.complete,false)
 await assert.rejects(()=>collectWebsiteRequests({locationId:'loc1',getGhl:async p=>p.includes('/notes')?{notes:[],partial:true}:{contacts:[{id:'c',tags:['website']}],meta:{total:1}}}),/notes_incomplete/)
})
test('single-flight and bounded failure cache never serves stale alert candidates',async()=>{
 let calls=0,time=now;const m=createMonitor({now:()=>time,load:async()=>{calls++;return {ok:true,notificationCandidates:['one']}}})
 assert.equal(m.read().status,202);assert.equal(m.read().status,202);await m.settled();assert.equal(calls,1);assert.equal(m.read().status,200)
 time+=300001;assert.equal(m.read().status,202);assert.deepEqual(m.read().body.notificationCandidates,[]);await m.settled();assert.equal(calls,2)
 const fail=createMonitor({load:async()=>{throw Error('secret must not escape')}});fail.read();await fail.settled();assert.equal(fail.read().status,503);assert.doesNotMatch(JSON.stringify(fail.read()),/secret must/)
})

test('malformed window, truncated counts and duplicate appointments fail closed',()=>{
 for(const c of [{...calendar([]),window:{}},{...calendar([]),window:{from:'bad',appointmentsTo:'bad',ahead:120,months:6}},{...calendar([]),summary:{appointments:1,upcoming:0}},calendar([appt({}),appt({})])]){const d=report([request()],[],{calendar:c});assert.equal(d.ok,false);assert.deepEqual(d.notificationCandidates,[])}
})
test('email punctuation is preserved instead of merging distinct addresses',()=>{
 const r={...request(),email:'a.b@example.test'};assert.equal(report([r],[appt({customerName:'Other',customerPhone:null,customerAddress:null,customerEmail:'ab@example.test'})]).leads[0].status,'missing_after_12h')
})

test('changed phone on same stable contact/project retains first clock and new identity aliases',()=>{
 const r=request(),later={...r,phone:'+14805550999',submittedAt:'2026-11-04T17:00:00Z'}
 const d=report([r,later],[appt({customerPhone:'4805550999',customerName:null,customerAddress:null})]);assert.equal(d.leads.length,1);assert.equal(d.leads[0].submittedAt,r.submittedAt);assert.equal(d.leads[0].status,'scheduled')
})
test('unit or explicit locality conflicts require review, never scheduled',()=>{
 const r=parseRequest({...note(),body:note().body.replace('123 E Main Street, Mesa, AZ 85212','123 E Main Street Unit 1, Mesa, AZ 85212')},'c1','loc1')
 assert.equal(report([r],[appt({customerAddress:'123 E Main St Unit 2, Mesa, AZ 85212'})]).leads[0].status,'review_needed')
 assert.equal(report([request()],[appt({customerAddress:'123 E Main St, Tucson, AZ 85701'})]).leads[0].status,'review_needed')
})
test('customer timestamp strings cannot override generated Received and note metadata conflicts require review',()=>{
 const n=note();n.body=n.body.replace('Please visit','UTC: 2020-01-01T00:00:00Z\nOpt-in received: 2020-01-01T00:00:00Z');assert.equal(parseRequest(n,'c','l').submittedAt,request().submittedAt)
 assert.equal(parseRequest({...note(),dateAdded:'2020-01-01T00:00:00Z'},'c','l').submittedAt,null)
})

test('locality-free submission cannot bridge conflicting projects',()=>{
 const make=addr=>parseRequest({...note(),body:note().body.replace('123 E Main Street, Mesa, AZ 85212',addr).replace('City or ZIP: 85212','City or ZIP: -')},'c1','loc1')
 const d=report([make('123 E Main St, Phoenix, AZ 85001'),make('123 E Main St, Mesa, AZ 85212'),make('123 E Main St')],[appt({customerAddress:'123 E Main St, Phoenix, AZ 85001'})]);assert.equal(d.leads.length,3);assert.ok(d.leads.every(r=>r.status==='review_needed'));assert.deepEqual(d.notificationCandidates,[])
})
test('one identity-only booking cannot satisfy multiple distinct projects',()=>{
 const r=request(),other=parseRequest({...note(),body:note().body.replace('123 E Main Street','456 S Other Road')},'c1','loc1')
 const d=report([r,other],[appt({customerAddress:null})]);assert.equal(d.leads.length,2);assert.ok(d.leads.every(r=>r.status==='review_needed'))
})

test('rolling calendar does not disable new leads after launch leaves the six-month window',()=>{
 const futureNow=Date.parse('2027-05-01T18:00:00Z'),fresh={...request(),contactId:'fresh',phone:'+14805550998',email:'fresh@example.test',submittedAt:'2027-04-30T18:00:00Z'}
 const c={generatedAt:new Date(futureNow).toISOString(),window:{from:'2026-11-01',appointmentsTo:'2027-08-29',ahead:120,months:6},summary:{appointments:0,upcoming:0},appointments:[]}
 const d=report([fresh],[],{now:futureNow,calendar:c});assert.equal(d.ok,true);assert.equal(d.leads[0].calendarRangeCovered,true);assert.equal(d.leads[0].status,'missing_after_12h');assert.equal(d.notificationCandidates.length,1)
})
test('old uncovered lead is held individually without suppressing covered new leads',()=>{
 const futureNow=Date.parse('2027-05-01T18:00:00Z'),fresh={...request(),contactId:'fresh',phone:'+14805550998',email:'fresh@example.test',submittedAt:'2027-04-30T18:00:00Z'},old={...request(),submittedAt:'2026-10-31T18:00:00Z'}
 const c={generatedAt:new Date(futureNow).toISOString(),window:{from:'2026-11-01',appointmentsTo:'2027-08-29',ahead:120,months:6},summary:{appointments:0,upcoming:0},appointments:[]}
 const d=report([old,fresh],[],{now:futureNow,calendar:c});assert.equal(d.ok,true);assert.equal(d.leads.find(r=>r.contactId==='c1').status,'source_incomplete');assert.equal(d.leads.find(r=>r.contactId==='c1').reason,'submission_precedes_calendar_window');assert.equal(d.leads.find(r=>r.contactId==='fresh').notifyEligible,true);assert.equal(d.notificationCandidates.length,1)
})
test('repeat request after prior completed visit remains episode-ambiguous in current semantics',()=>{
 const original=request(),repeat={...original,submittedAt:'2026-11-04T17:00:00Z'}
 const d=report([original,repeat],[appt({startAt:'2026-11-03T18:00:00Z',status:'CLOSED'})]);assert.equal(d.leads.length,1);assert.equal(d.leads[0].submittedAt,original.submittedAt);assert.equal(d.leads[0].status,'scheduled');assert.equal(d.leads[0].notifyEligible,false)
})
