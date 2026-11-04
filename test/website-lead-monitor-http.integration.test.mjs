import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import express from 'express'
const source=readFileSync(new URL('../server.js',import.meta.url),'utf8')
const route=source.slice(source.indexOf("app.all('/api/analyst/website-lead-status'"),source.indexOf('async function calendarExport(path)'))
const auth=source.slice(source.indexOf('function analystAuthorized(req)'),source.indexOf('// Private, read-only website request monitor.'))
test('actual route uses existing Jarvis key only, rejects methods/params and never starts unauthorized reads',async()=>{
 const app=express();let reads=0
 const actualAuth=new Function('ANALYST_API_KEY','DASHBOARD_READ_KEY',auth+';return analystAuthorized')('owner-key','dashboard-key')
 new Function('app','analystAuthorized','websiteLeadMonitor',route)(app,actualAuth,{read:()=>{reads++;return {status:202,body:{status:'building',notificationCandidates:[]}}}})
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))})
 const base=`http://127.0.0.1:${server.address().port}/api/analyst/website-lead-status`
 try{
  for(const c of [{key:null,status:401},{key:'wrong',status:401},{key:'dashboard-key',status:401},{key:'owner-key',method:'POST',status:405},{key:'owner-key',query:'?contact=any',status:400},{key:'owner-key',status:202}]){
   const r=await fetch(base+(c.query||''),{method:c.method||'GET',headers:c.key?{'x-api-key':c.key}:{}})
   assert.equal(r.status,c.status);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.doesNotMatch(await r.text(),/owner-key|dashboard-key/)
   if(c.status===202)assert.equal(r.headers.get('retry-after'),'10')
  }
  assert.equal(reads,1)
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
})
test('monitor adapter has GET-only fixed-origin reads, no credential changes or business writes',()=>{
 const block=source.slice(source.indexOf('async function websiteMonitorJSON'),source.indexOf('async function calendarExport(path)'))
 assert.match(block,/method:'GET'/);assert.match(block,/redirect:'manual'/);assert.match(block,/AbortSignal.timeout\(120000\)/);assert.match(block,/AbortSignal.timeout\(8000\)/)
 assert.doesNotMatch(block,/restWrite|restPatch|ghlUpdate|console\.|process\.env\.[A-Z_]+\s*=/)
 assert.match(block,/GHL_BASE\+path,ghlHeaders\(\)/);assert.match(block,/CALENDAR_SYNC_URL\+'\/api\/export\/analyst\?months=6&ahead=120'/)
})
