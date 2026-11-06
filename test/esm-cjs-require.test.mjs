import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parseSignedPdfText } from '../lib/parse-signed-pdf.mjs'

// server.js is ESM ("type": "module"), so `require(...)` in it is a
// ReferenceError at CALL time — not at load, not at lint. pdfSigned carried one
// inside a bare `catch { return null }`, which made every signed contract
// unverifiable and reported it as "PDF text unreadable". The Nov 6 change-order
// audit failed all 24 jobs that way while the renders themselves were fine.
// Nothing caught it because the line only runs when a contract is checked.
const SERVER = readFileSync(new URL('../server.js', import.meta.url), 'utf8')

test('server.js never calls require() — it is an ES module', () => {
  const lines = SERVER.split('\n')
    .map((text, i) => ({ no: i + 1, text }))
    // A mention in a comment is how this bug is documented; only real calls count.
    .filter(({ text }) => /(^|[^.\w'"`])require\s*\(/.test(text) && !/^\s*(\/\/|\*)/.test(text))
  assert.deepEqual(
    lines.map((l) => `${l.no}: ${l.text.trim()}`),
    [],
    'use a static import, or lib/parse-signed-pdf.mjs for pdf-parse',
  )
})

test('pdf-parse is reachable from ESM and honours a page limit', async () => {
  const bytes = Buffer.from(
    readFileSync(new URL('./fixtures/synthetic-signed-body.pdf.base64', import.meta.url), 'utf8').trim(),
    'base64',
  )
  const whole = await parseSignedPdfText(bytes)
  assert.equal(typeof whole, 'string')
  assert.match(whole, /Total\s+\$100\.00/)
  // The signature check reads only the first pages; the evidence reader reads
  // all of them. Both callers must get a string out of the same adapter.
  const capped = await parseSignedPdfText(bytes, { max: 4 })
  assert.equal(typeof capped, 'string')
  assert.ok(capped.length > 0)
})

test('the adapter copies the buffer rather than reading a pooled offset', async () => {
  const bytes = Buffer.from(
    readFileSync(new URL('./fixtures/synthetic-signed-body.pdf.base64', import.meta.url), 'utf8').trim(),
    'base64',
  )
  // Buffer.from(await res.arrayBuffer()) can land at a non-zero byteOffset,
  // which bundled PDF.js ignores — it would then read unrelated pool bytes.
  const pooled = Buffer.allocUnsafe(bytes.length + 17).subarray(17)
  bytes.copy(pooled)
  assert.notEqual(pooled.byteOffset, 0)
  const before = createHash('sha256').update(pooled).digest('hex')
  assert.match(await parseSignedPdfText(pooled, { max: 4 }), /Total\s+\$100\.00/)
  assert.equal(createHash('sha256').update(pooled).digest('hex'), before, 'parsing must not mutate the input')
})
