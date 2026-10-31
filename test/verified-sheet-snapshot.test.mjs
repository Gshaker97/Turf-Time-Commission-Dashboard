import test from 'node:test'
import assert from 'node:assert/strict'
import {readVerifiedSheetSnapshot as read} from '../lib/verified-sheet-snapshot.mjs'
const body=()=>({valueRanges:[{range:'Jobs!A1:B2',values:[['Project ID','Proposal ID'],['1','10']]},{range:'Schedule!A1:B2',values:[['Proposal ID','Status'],['10','BOOKED']]}]})
const parseTab=rows=>({headers:rows[0],rows:rows.slice(1)})
const options=(extra={})=>({sheetId:'synthetic_sheet',getToken:async()=> 'synthetic-token',parseTab,fetchImpl:async()=>({ok:true,json:async()=>body()}),now:()=>Date.parse('2026-10-31T20:00:00Z'),...extra})
test('isolated reader fetches both tabs once, timestamps actual completed read',async()=>{
  let calls=0,signal
  const result=await read(options({fetchImpl:async(url,init)=>{calls++;signal=init.signal;assert.match(url,/ranges=Jobs&ranges=Schedule/);assert.equal(init.redirect,'manual');return {ok:true,json:async()=>body()}}}))
  assert.equal(calls,1);assert.equal(result.fetchedAt,'2026-10-31T20:00:00.000Z');assert.ok(result.data.jobs);assert.ok(signal.aborted)
})
test('missing, duplicate, empty and malformed tabs fail closed without retry',async()=>{
  for(const valueRanges of [[],[body().valueRanges[0]],[body().valueRanges[0],body().valueRanges[0]],[{range:'Jobs',values:[]},body().valueRanges[1]],[{range:'Jobs',values:[[],{}]},body().valueRanges[1]]]){
    let calls=0;await assert.rejects(read(options({fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({valueRanges})}}})),/incomplete/);assert.equal(calls,1)
  }
})
test('auth and HTTP failures never leak response content or retry',async()=>{
  let calls=0;await assert.rejects(read(options({fetchImpl:async()=>{calls++;return {ok:false,status:401,text:async()=> 'secret body'}}})),e=>e.message==='verified Sheet read rejected');assert.equal(calls,1)
})
test('deadline aborts fetch and token acquisition, no late cache mutation or next-read contamination',async()=>{
  let release,signal,parsed=0
  const pending=read(options({timeoutMs:5,parseTab:rows=>{parsed++;return parseTab(rows)},fetchImpl:async(_,init)=>{signal=init.signal;return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>body()})})}}))
  await assert.rejects(pending,/timeout/);assert.ok(signal.aborted)
  const next=await read(options());release();await new Promise(resolve=>setImmediate(resolve))
  assert.equal(parsed,0);assert.equal(next.data.jobs.rows[0][0],'1')
  let tokenSignal
  await assert.rejects(read(options({timeoutMs:5,getToken:async s=>{tokenSignal=s;return new Promise(()=>{})}})),/timeout/);assert.ok(tokenSignal.aborted)
})
