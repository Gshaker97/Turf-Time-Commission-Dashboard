import test from 'node:test'
import assert from 'node:assert/strict'
import { clampPage, redact, pageView, sweepSeenView, runView, dailyView, receiptsView, pdfQueueView } from '../lib/analyst-arcsite-views.mjs'

test('pagination clamps and pages correctly, including out-of-range offsets', () => {
  assert.deepEqual(clampPage({}), { offset: 0, limit: 50 })
  assert.deepEqual(clampPage({ offset: '-5', limit: '9999' }), { offset: 0, limit: 200 })
  assert.deepEqual(clampPage({ offset: 'abc', limit: '0' }), { offset: 0, limit: 50 })
  const list = Array.from({ length: 7 }, (_, i) => ({ i }))
  const p1 = pageView(list, { limit: 3 }); assert.equal(p1.total, 7); assert.deepEqual(p1.rows.map(r => r.i), [0, 1, 2]); assert.equal(p1.next_offset, 3)
  const p3 = pageView(list, { offset: 6, limit: 3 }); assert.deepEqual(p3.rows.map(r => r.i), [6]); assert.equal(p3.next_offset, null)
  const p4 = pageView(list, { offset: 50, limit: 3 }); assert.deepEqual(p4.rows, []); assert.equal(p4.next_offset, null)
  const q = pageView([{ customer: 'Ann' }, { customer: 'Bob' }], { q: 'bob' }); assert.equal(q.total, 1)
})

test('missing data is explicit, never a crash', () => {
  assert.deepEqual(pageView(null).available, false)
  assert.deepEqual(sweepSeenView(undefined).available, false)
  assert.deepEqual(runView(null), { available: false })
  const d = dailyView({ days: [], day: null, worker: null, sweep: null }); assert.equal(d.available, false); assert.match(d.note, /no daily sweep records/)
  const d2 = dailyView({ days: ['2026-11-02'], day: '2026-11-09', worker: { state: 'running' }, sweep: null }); assert.equal(d2.available, true); assert.match(d2.note, /no sweep record stored for 2026-11-09/)
  assert.equal(receiptsView(undefined, 'x_', { id: 'abc' }).available, false)
  assert.equal(pdfQueueView(null, null).available, false)
})

test('redaction removes tokens, secrets and links at any depth and keeps everything else', () => {
  const r = redact({ token: 'T', binding: 'keep-hash', nested: { secret: 'S', pdf_url: 'http://x', pdfUrl: 'http://y', url: 'http://z', ok: 1, list: [{ password: 'p', name: 'n' }] } })
  assert.equal(r.token, '[redacted]'); assert.equal(r.binding, 'keep-hash')
  assert.equal(r.nested.secret, '[redacted]'); assert.equal(r.nested.pdf_url, '[redacted]'); assert.equal(r.nested.pdfUrl, '[redacted]'); assert.equal(r.nested.url, '[redacted]')
  assert.equal(r.nested.ok, 1); assert.equal(r.nested.list[0].password, '[redacted]'); assert.equal(r.nested.list[0].name, 'n')
  const d = dailyView({ days: ['d'], day: 'd', worker: { state: 'running', token: 'abc' }, sweep: { ok: true, jobs: [{ state: 'held', holds: ['x'] }, { state: 'matched' }] } })
  assert.equal(d.worker.token, '[redacted]'); assert.deepEqual(d.sweep.job_states, { held: 1, matched: 1 }); assert.equal(d.sweep.jobs.total, 2)
})

test('sweep-seen rows are minimized and filterable by project or proposal id', () => {
  const v = sweepSeenView({ '282300044590465': { p: '621393', t: 2570.59 }, '1': { p: '2', t: 3 } }, { q: '590465' })
  assert.equal(v.available, true); assert.equal(v.total, 1)
  assert.deepEqual(v.rows[0], { project_id: '282300044590465', proposal_id: '621393', total: 2570.59 })
  assert.match(v.meaning, /will not revisit/)
})

test('run view pages its list fields and counts the rest; receipts summarize and redact', () => {
  const run = runView({ at: 'x', checked: 3, changes: [{ a: 1 }, { a: 2 }], holds: [], extra: [1, 2, 3] }, { limit: 1 })
  assert.equal(run.checked, 3); assert.equal(run.changes.total, 2); assert.equal(run.changes.rows.length, 1); assert.equal(run.extra_count, 3)
  const rows = [{ key: 'verified_sheet_batch_abc', value: { state: 'finished', at: '2026-11-01', finishedAt: '2026-11-01T17:46Z', report: { dryRun: false, results: [1, 2, 3, 4, 5] }, approvedPlanHashes: ['h'], token: 'secret' } }]
  const list = receiptsView(rows, 'verified_sheet_batch_', {})
  assert.deepEqual(list.rows[0], { id: 'abc', state: 'finished', at: '2026-11-01', finished_at: '2026-11-01T17:46Z', dry_run: false, results: 5, approved_plans: 1 })
  const one = receiptsView(rows, 'verified_sheet_batch_', { id: 'abc' }); assert.equal(one.receipt.token, '[redacted]'); assert.equal(one.receipt.state, 'finished')
  const pq = pdfQueueView([{ customer: 'C', projectId: 'P', oppId: 'O', pdfUrl: 'http://secret', since: 's', tries: 2 }], [])
  assert.deepEqual(Object.keys(pq.pending[0]).includes('pdfUrl'), false); assert.equal(pq.pending[0].customer, 'C')
})
