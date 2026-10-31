import test from 'node:test'
import assert from 'node:assert/strict'
import { readArcsiteRevisionEvidence as read, readArcsiteEvidence, listArcsitePages } from '../lib/arcsite-revision-evidence.mjs'
const now = Date.parse('2026-10-31T20:00:00Z')
const pdf = Buffer.from('%PDF-1.7 fixture supplied only by test')
function fixture(overrides = {}) {
  return { listProposals: async () => [{ proposal_id: '10', project_id: '1' }],
    getProposal: async id => ({ proposal_id: id, project_id: '1', status: 'APPROVED', total: 100, pdf_url: `https://cdn.example/${id}.pdf` }),
    fetchPdf: async url => ({ status: 200, url, bytes: pdf }),
    extractPdfText: async () => 'Total $100.00\nCustomer Signature\n2026-10-30 01:45 PM UTC', ...overrides }
}
const opts = { now, providerContract: { singlePageUnderLimitComplete: true } }
test('complete single-page proof binds exact metadata PDF and body timestamp', async () => {
  const r = await read('1', fixture(), opts)
  assert.equal(r.complete, true); assert.equal(r.revision.signedAt, '2026-10-30T13:45:00.000Z')
  assert.match(r.revision.pdf.sha256, /^[a-f0-9]{64}$/); assert.deepEqual(r.validSignedProposalIds, ['10'])
})
test('no inferred pagination: bare page or capped page held', async () => {
  assert.equal((await read('1', fixture(), { now })).complete, false)
  assert.equal((await read('1', fixture({ listProposals: async () => Array.from({ length: 20 }, (_, i) => ({ proposal_id: String(i + 1) })) }), opts)).complete, false)
})
test('explicit complete documented pages supported; multi proposals not resolved', async () => {
  const r = await read('1', fixture({ listPages: async () => ({ complete: true, pages: [[{ proposal_id: '10' }], [{ proposal_id: '11' }]] }) }), { now })
  assert.equal(r.complete, true); assert.equal(r.latestValidProposalId, '11'); assert.equal(r.replacementResolution, undefined)
})
test('wrong detail identity and duplicate references fail closed', async () => {
  assert.equal((await read('1', fixture({ getProposal: async () => ({ proposal_id: '10', project_id: '2' }) }), opts)).complete, false)
  assert.equal((await read('1', fixture({ listProposals: async () => [{ proposal_id: '10' }, { proposal_id: '10' }] }), opts)).complete, false)
})
test('unsigned, void, and unsupported statuses do not count', async () => {
  for (const status of ['UNSIGNED', 'VOID', 'APPROVED_ON_DEVICE', 'DRAFT']) {
    const a = fixture(); const original = a.getProposal; a.getProposal = async id => ({ ...await original(id), status })
    assert.equal((await read('1', a, opts)).complete, false)
  }
})
test('no option PDF fallback; no redirects or non-PDF body', async () => {
  const a = fixture(); const original = a.getProposal; a.getProposal = async id => ({ ...await original(id), pdf_url: null, proposal_options: [{ pdf_url: 'https://cdn.example/unsigned.pdf' }] })
  assert.equal((await read('1', a, opts)).complete, false)
  assert.equal((await read('1', fixture({ fetchPdf: async () => ({ status: 302 }) }), opts)).complete, false)
  assert.equal((await read('1', fixture({ fetchPdf: async url => ({ status: 200, url, bytes: Buffer.from('<html>login</html>') }) }), opts)).complete, false)
})
test('signature text and actual timestamp required, dates validated', async () => {
  for (const text of ['APPROVED metadata only', 'Customer Signature', 'Customer Signature 2026-02-30 01:00 PM UTC', 'Customer Signature 2027-01-01 01:00 PM UTC']) {
    assert.equal((await read('1', fixture({ extractPdfText: async () => text }), opts)).complete, false)
  }
})
test('retrieval failures are sanitized holds, not partial complete proofs', async () => {
  const r = await read('1', fixture({ getProposal: async () => { throw new Error('secret') } }), opts)
  assert.equal(r.complete, false); assert.doesNotMatch(JSON.stringify(r), /secret/)
})
test('documented pagination reads more than 100 proposals to short final page', async () => {
  const paths = []
  const r = await listArcsitePages('1', async path => {
    paths.push(path)
    return path.includes('page=1&') ? Array.from({ length: 100 }, (_, i) => ({ proposal_id: String(i + 1) })) : [{ proposal_id: '101' }]
  })
  assert.equal(r.complete, true); assert.equal(r.pages.flat().length, 101)
  assert.deepEqual(paths, ['/proposals?project_id=1&page=1&per_page=100', '/proposals?project_id=1&page=2&per_page=100'])
})
test('pagination duplicates, cap, and upstream errors fail closed', async () => {
  const full = Array.from({ length: 100 }, (_, i) => ({ proposal_id: String(i + 1) }))
  await assert.rejects(listArcsitePages('1', async () => full), /duplicate/)
  await assert.rejects(listArcsitePages('1', async () => full, { maxPages: 1 }), /cap reached/)
  await assert.rejects(listArcsitePages('1', async () => { throw new Error('unavailable') }), /unavailable/)
})
test('server interface uses documented default pagination', async () => {
  const f = fixture(), paths = []
  const r = await readArcsiteEvidence('1', { arcGet: async path => { paths.push(path); return path.includes('?') ? f.listProposals() : f.getProposal('10') }, fetchPdfBytes: f.fetchPdf, parsePdfText: f.extractPdfText, now: () => now })
  assert.equal(r.complete, true)
  assert.deepEqual(paths, ['/proposals?project_id=1&page=1&per_page=100', '/proposals/10'])
})

test('PDF body amount must agree with exact approved metadata', async () => {
  for (const text of ['Customer Signature 2026-10-30 01:45 PM UTC', 'Total $99.00\nCustomer Signature 2026-10-30 01:45 PM UTC']) {
    assert.equal((await read('1', fixture({ extractPdfText: async () => text }), opts)).complete, false)
  }
})

// pdf-parse 1.1.1 joins independently positioned label/currency text items.
test('exact Total accepts observed joined currency label without treating Subtotal or Balance as Total', async () => {
  const suffix='\nCustomer Signature\n2026-10-30 01:45 PM UTC'
  const a=fixture({extractPdfText:async()=> 'Subtotal$100.00\nTotal$100.00 \nPayment\nBalance$100.00'+suffix})
  assert.equal((await read('1',a,opts)).complete,true)
  for(const body of ['Subtotal$100.00\nBalance$100.00','Total$99.99','Total$100.00\nTotal$99.99','Grand Total$100.00','Total100.00','Total$100.000','Total$100.00 extra']) {
    const r=await read('1',fixture({extractPdfText:async()=>body+suffix}),opts)
    assert.equal(r.complete,false,body)
  }
})
