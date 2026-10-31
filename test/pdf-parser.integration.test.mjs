import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parseSignedPdfText } from '../lib/parse-signed-pdf.mjs'
import { readArcsiteEvidence } from '../lib/arcsite-revision-evidence.mjs'

// Synthetic PDF only: no customer records, identifiers or actual signed PDFs.
function syntheticPdf(name = 'synthetic-signed-body') {
  const bytes=Buffer.from(readFileSync(new URL(`./fixtures/${name}.pdf.base64`,import.meta.url),'utf8').trim(),'base64')
  const backing=new Uint8Array(bytes.length+17);backing.set(bytes,17)
  return Buffer.from(backing.buffer,17,bytes.length)
}

for (const name of ['synthetic-signed-body','synthetic-joined-total']) test(`real locked pdf-parse validates ${name} fixture`, {skip:process.env.RUN_PDF_PARSE_INTEGRATION!=='1'}, async()=>{
  // Exercise the exact production parser adapter; never import/start server.js.
  const bytes=syntheticPdf(name)
  assert.equal(bytes.byteOffset,17) // regression: legacy PDF.js ignored this offset
  const originalHash=createHash('sha256').update(bytes).digest('hex')
  const text=await parseSignedPdfText(bytes)
  assert.equal(createHash('sha256').update(bytes).digest('hex'),originalHash)
  assert.match(text,name==='synthetic-joined-total'?/^Total\$100\.00\s*$/m:/Total\s+\$100\.00/)
  const proof=await readArcsiteEvidence('1',{
    arcGet:async path=>path.includes('?')?[{proposal_id:'10',project_id:'1'}]:{proposal_id:'10',project_id:'1',status:'APPROVED',total:100,pdf_url:'https://synthetic.invalid/10.pdf'},
    fetchPdfBytes:async url=>({status:200,url,bytes}),
    parsePdfText:parseSignedPdfText,
    now:()=>Date.parse('2026-10-31T20:00:00Z'),
  })
  assert.equal(proof.complete,true,proof.holds.join('; '))
  assert.equal(proof.revision.pdf.sha256,createHash('sha256').update(bytes).digest('hex'))
})
