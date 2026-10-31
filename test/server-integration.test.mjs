import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const server=readFileSync(new URL('../server.js',import.meta.url),'utf8')
const block=server.slice(server.indexOf('// Verified Sheet -> GHL money reconciliation.'),server.indexOf('// The daily contract audit by hand',server.indexOf('// Verified Sheet -> GHL money reconciliation.')))
test('new endpoints exclusively require Jarvis analyst authorization',()=>{
  const routes=block.slice(block.indexOf("app.get('/api/arcsite/verified-sheet-reconcile'"))
  assert.equal((routes.match(/analystAuthorized\(req\)!=='jarvis'/g)||[]).length,2)
  assert.doesNotMatch(routes,/ingestAuthorized|req\.body|req\.query/)
  assert.match(routes,/verifiedSheetRun\(\)\.catch/)
  assert.doesNotMatch(routes,/await verifiedSheetRun|write:true/)
})
test('new adapter uses ESM PDF parsing and bounded no-credential storage GET',()=>{
  assert.match(block,/parsePdfText:parseSignedPdfText/);assert.doesNotMatch(block,/require\(/)
  const parser=readFileSync(new URL('../lib/parse-signed-pdf.mjs',import.meta.url),'utf8')
  assert.match(parser,/createRequire\(import\.meta\.url\)/);assert.match(parser,/requirePdf\('pdf-parse'\)/)
  const download=block.slice(block.indexOf('fetchPdfBytes:'),block.indexOf('parsePdfText:'))
  assert.match(download,/verifiedPdfHosts\.has\(parsed\.hostname\)/)
  assert.match(download,/redirect:'manual',signal:AbortSignal\.timeout\(30000\)/)
  assert.doesNotMatch(download,/headers:|Authorization:|cookies:/)
  assert.match(download,/size>32\*1024\*1024/)
})
test('writer has two OFF-default guards, field whitelist and abortable PUT',()=>{
  assert.match(block,/ARC_VERIFIED_SHEET_WRITES!=='1' \|\| process\.env\.ARC_VERIFIED_SHEET_SINGLE_WRITER!=='1'/)
  assert.match(block,/\['price','baseline','commission'\]\.includes\(field\)/)
  assert.match(block,/method:'PUT',redirect:'manual',signal:AbortSignal\.timeout\(30000\)/)
  assert.doesNotMatch(block,/pipelineStageId|ghlContactSetFields|change-orders\/ingest|\/rest\/v1\/deals/)
  assert.equal((block.match(/restWrite\(/g)||[]).length,1)
  assert.match(block,/restWrite\('POST','\/rest\/v1\/app_settings\?on_conflict=key'/)
})
test('schedule OFF by default and hooks only queue nonblocking hints',()=>{
  assert.match(block,/ARC_VERIFIED_SHEET_AUTO!=='1'/)
  assert.match(server,/if \(TIMERS_ON && process\.env\.ARC_VERIFIED_SHEET_AUTO === '1'\) setInterval/)
  assert.match(server,/if \(isChangeOrder\) verifiedSheetQueue\(projectId\)/)
  assert.doesNotMatch(server,/await verifiedSheetQueue/)
})
test('scope is owner-private and unconfigured by default; no business IDs committed',()=>{
  const example=JSON.parse(readFileSync(new URL('../docs/verified-sheet-policy.example.json',import.meta.url),'utf8'))
  assert.deepEqual(example.scope,[]);assert.deepEqual(example.approvedPlanHashes,[])
  assert.equal(example.policyApproved,false)
  assert.match(block,/verified_sheet_reconcile_policy&select=value/)
  assert.match(block,/validatePrivatePolicy/)
  assert.doesNotMatch(block,/verified-sheet-scope\.json/)
})
