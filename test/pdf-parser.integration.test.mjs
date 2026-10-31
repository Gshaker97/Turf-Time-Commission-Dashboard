import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readArcsiteEvidence } from '../lib/arcsite-revision-evidence.mjs'

// Synthetic PDF only: no customer records, identifiers or actual signed PDFs.
function syntheticPdf() {
  const stream='BT /F1 12 Tf 72 750 Td (Total $100.00) Tj 0 -25 Td (Customer Signature) Tj 0 -25 Td (2026-10-30 01:45 PM UTC) Tj ET'
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ]
  let pdf='%PDF-1.4\n',offsets=[0]
  for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`}
  const xref=Buffer.byteLength(pdf)
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`
  for(const offset of offsets.slice(1))pdf+=String(offset).padStart(10,'0')+' 00000 n \n'
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}
test('real locked pdf-parse imports and validates a synthetic signed-body fixture', {skip:process.env.RUN_PDF_PARSE_INTEGRATION!=='1'}, async()=>{
  // Same ESM import expression as server adapter; never import/start server.js.
  const parse=(await import('pdf-parse')).default
  assert.equal(typeof parse,'function')
  const bytes=syntheticPdf(), parsed=await parse(bytes)
  assert.match(parsed.text,/Total\s+\$100\.00/)
  const proof=await readArcsiteEvidence('1',{
    arcGet:async path=>path.includes('?')?[{proposal_id:'10',project_id:'1'}]:{proposal_id:'10',project_id:'1',status:'APPROVED',total:100,pdf_url:'https://synthetic.invalid/10.pdf'},
    fetchPdfBytes:async url=>({status:200,url,bytes}),
    parsePdfText:async input=>(await parse(input)).text,
    now:()=>Date.parse('2026-10-31T20:00:00Z'),
  })
  assert.equal(proof.complete,true,proof.holds.join('; '))
  assert.equal(proof.revision.pdf.sha256,createHash('sha256').update(bytes).digest('hex'))
})
