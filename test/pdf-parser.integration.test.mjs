import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { parseSignedPdfText } from '../lib/parse-signed-pdf.mjs'
import { readArcsiteEvidence } from '../lib/arcsite-revision-evidence.mjs'

// Synthetic PDF only: no customer records, identifiers or actual signed PDFs.
function syntheticPdf() {
  return Buffer.from(readFileSync(new URL('./fixtures/synthetic-signed-body.pdf.base64',import.meta.url),'utf8').trim(),'base64')
}

test('real locked pdf-parse imports and validates a synthetic signed-body fixture', {skip:process.env.RUN_PDF_PARSE_INTEGRATION!=='1'}, async()=>{
  // Exercise the exact production parser adapter; never import/start server.js.
  const bytes=syntheticPdf()
  let text
  try { text=await parseSignedPdfText(bytes) } catch (error) {
    const require=createRequire(import.meta.url),direct=require('pdf-parse')
    const versions=readdirSync(new URL('../node_modules/pdf-parse/lib/pdf.js/',import.meta.url)).filter(v=>/^v[0-9.]+$/.test(v))
    for(const version of versions)for(const type of ['buffer','uint8array']){
      try{const r=await direct(type==='buffer'?Buffer.from(bytes):new Uint8Array(bytes),{version});console.log('synthetic parser diagnostic',version,type,'ok',r.text.length)}
      catch(e){console.log('synthetic parser diagnostic',version,type,String(e.message))}
    }
    throw error
  }
  assert.match(text,/Total\s+\$100\.00/)
  const proof=await readArcsiteEvidence('1',{
    arcGet:async path=>path.includes('?')?[{proposal_id:'10',project_id:'1'}]:{proposal_id:'10',project_id:'1',status:'APPROVED',total:100,pdf_url:'https://synthetic.invalid/10.pdf'},
    fetchPdfBytes:async url=>({status:200,url,bytes}),
    parsePdfText:parseSignedPdfText,
    now:()=>Date.parse('2026-10-31T20:00:00Z'),
  })
  assert.equal(proof.complete,true,proof.holds.join('; '))
  assert.equal(proof.revision.pdf.sha256,createHash('sha256').update(bytes).digest('hex'))
})
