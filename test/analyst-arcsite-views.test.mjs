// Read-only analyst arcsite views: allowlist projection, fail-closed nesting, paging on every list,
// and storage failures that can never pass for empty data.
import test from 'node:test'
import assert from 'node:assert/strict'
import { clampPage, depthOf, project, read, pageView, sweepSeenView, runView, logView, dailyView, receiptsView, pdfQueueView, MAX_DEPTH, MAX_LIMIT } from '../lib/analyst-arcsite-views.mjs'

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'

test('clampPage bounds offset and limit', () => {
  assert.deepEqual(clampPage(), { offset: 0, limit: 50 })
  assert.deepEqual(clampPage({ offset: '-5', limit: '0' }), { offset: 0, limit: 50 })
  assert.deepEqual(clampPage({ offset: '20', limit: '999' }), { offset: 20, limit: MAX_LIMIT })
  assert.deepEqual(clampPage({ offset: 'x', limit: 'y' }), { offset: 0, limit: 50 })
})

test('project is an ALLOWLIST: unlisted keys never pass, whatever they are called', () => {
  const raw = { customer: 'Robert Durwood', total: 2570.59, token: 'T', accessToken: 'a', 'X-Sync-Secret': 'x', pdf_url: 'http://x', anything_new: 'leaks?', nested: { secret: 'S' } }
  assert.deepEqual(project(raw, { customer: 'string', total: 'scalar' }), { customer: 'Robert Durwood', total: 2570.59 })
  // wrong shape in an allowed slot is dropped, not coerced
  assert.deepEqual(project({ customer: { name: 'obj' }, total: 'NaN' }, { customer: 'string', total: 'number' }), {})
  // arrays and records project element-wise
  assert.deepEqual(project({ holds: ['a', 7, { x: 1 }], skipped: { held: 3, bad: 'no' } }, { holds: ['string'], skipped: { __record: 'number' } }), { holds: ['a'], skipped: { held: 3 } })
})

test('top-level and deeply nested secret-looking VALUES are redacted even inside allowed fields', () => {
  const schema = { note: 'string', list: [{ reason: 'string', deeper: { url_text: 'string' } }] }
  const out = project({ note: JWT, list: [{ reason: 'Bearer abc.def.ghi', deeper: { url_text: 'https://assets.example/file.pdf' } }, { reason: 'fine', deeper: { url_text: 'sk-abcdefghijklmnopqrstuvwxyz' } }] }, schema)
  assert.equal(out.note, '[redacted]')
  assert.equal(out.list[0].reason, '[redacted]'); assert.equal(out.list[0].deeper.url_text, '[redacted]')
  assert.equal(out.list[1].reason, 'fine'); assert.equal(out.list[1].deeper.url_text, '[redacted]')
})

test('excessive nesting fails CLOSED: the record is refused, not trimmed', () => {
  let deep = { reason: 'x' }; for (let i = 0; i < MAX_DEPTH + 2; i++) deep = { child: deep }
  assert.ok(depthOf(deep) > MAX_DEPTH)
  const run = { at: '2026-11-12', changes: [deep] }
  const v = runView(read(run), 'install-date')
  assert.equal(v.available, false); assert.equal(v.reason, 'error'); assert.match(v.error, /nests deeper/)
  assert.equal(v.changes, undefined)
  const p = pageView([deep], { reason: 'string' }); assert.equal(p.reason, 'error')
  const cyc = { a: 1 }; cyc.self = cyc
  assert.equal(depthOf(cyc), Infinity)
  assert.equal(runView(read(cyc), 'install-date').reason, 'error')
})

test('every list is a page: first page, SECOND page, last page, out of range', () => {
  const rows = Array.from({ length: 450 }, (_, i) => ({ reason: 'r' + i }))
  const p1 = pageView(rows, { reason: 'string' })
  assert.equal(p1.total, 450); assert.equal(p1.rows.length, 50); assert.equal(p1.next_offset, 50); assert.equal(p1.rows[0].reason, 'r0')
  const p2 = pageView(rows, { reason: 'string' }, { offset: p1.next_offset, limit: 50 })
  assert.equal(p2.rows[0].reason, 'r50'); assert.equal(p2.rows.at(-1).reason, 'r99'); assert.equal(p2.next_offset, 100)
  const last = pageView(rows, { reason: 'string' }, { offset: 400, limit: 500 })
  assert.equal(last.limit, MAX_LIMIT); assert.equal(last.rows.length, 50); assert.equal(last.next_offset, null)
  const beyond = pageView(rows, { reason: 'string' }, { offset: 9999 })
  assert.equal(beyond.rows.length, 0); assert.equal(beyond.next_offset, null); assert.equal(beyond.total, 450)
})

test('daily view: jobs are paged with a reachable second page; days are paged too; unlisted job fields dropped', () => {
  const jobs = Array.from({ length: 450 }, (_, i) => ({ state: i % 3 ? 'matched' : 'held', projectId: String(i), token: 'leak', report: { deep: { secret: 's' } } }))
  const days = Array.from({ length: 260 }, (_, i) => '2026-' + String(100 + i))
  const sweep = { ok: true, day: 'd', jobs, binding: 'hash', token: 't' }
  const p1 = dailyView({ days, day: 'd', worker: read({ day: 'd', state: 'running', token: 'T', binding: 'b' }), sweep: read(sweep) })
  assert.equal(p1.sweep.jobs.total, 450); assert.equal(p1.sweep.jobs.rows.length, 50); assert.equal(p1.sweep.jobs.next_offset, 50)
  assert.deepEqual(Object.keys(p1.sweep.jobs.rows[0]).sort(), ['projectId', 'state'])
  assert.deepEqual(p1.sweep.job_states, { held: 150, matched: 300 })
  assert.equal(p1.sweep.token, undefined); assert.equal(p1.sweep.binding, undefined)
  assert.deepEqual(p1.worker, { day: 'd', state: 'running' })
  const p2 = dailyView({ days, day: 'd', worker: null, sweep: read(sweep) }, { offset: 400, limit: 500 })
  assert.equal(p2.sweep.jobs.rows[0].projectId, '400'); assert.equal(p2.sweep.jobs.rows.length, 50); assert.equal(p2.sweep.jobs.next_offset, null)
  assert.equal(p1.days.total, 260); assert.equal(p1.days.rows.length, 200); assert.equal(p1.days.next_offset, 200)
  const d2 = dailyView({ days, day: 'd', worker: null, sweep: read(sweep) }, { days_offset: 200 })
  assert.equal(d2.days.rows.length, 60); assert.equal(d2.days.next_offset, null)
})

test('missing data is explicit ("missing"), distinct from a FAILED read ("error") — upstream failures never look empty', () => {
  assert.equal(pageView(null, {}).reason, 'missing'); assert.equal(sweepSeenView(undefined).reason, 'missing')
  assert.deepEqual(runView(read(null), 'install-date'), { available: false, reason: 'missing' })
  assert.equal(receiptsView([], 'x_', { id: 'nope' }).reason, 'missing'); assert.equal(pdfQueueView(null, null).reason, 'missing')
  assert.equal(dailyView({ worker: read(null), sweep: read(null) }).reason, 'missing')
  const err = read(null, new Error('fetch failed'))
  const views = [pageView(err, {}), sweepSeenView(err), runView(err, 'install-date'), runView(err, 'contract-audit'), logView(err), receiptsView(err, 'x_'),
    pdfQueueView(err, read([])), pdfQueueView(read([]), err), dailyView({ worker: err }), dailyView({ daysError: 'storage read failed' }), dailyView({ worker: read(null), sweep: err })]
  for (const v of views) {
    assert.equal(v.available, false); assert.equal(v.reason, 'error'); assert.match(String(v.error), /fetch failed|storage read failed/)
    assert.equal(v.rows, undefined); assert.equal(v.sweep, undefined); assert.equal(v.pending, undefined)
  }
})

test('sweep-seen view maps the stamp map to rows, pages, filters, and never carries anything else', () => {
  const map = { 282300044590465: { p: 621393, t: 2570.59, token: 'leak' }, 1: { p: 2, t: 3 } }
  const v = sweepSeenView(read(map), { q: '2823' })
  assert.equal(v.total, 1); assert.deepEqual(v.rows[0], { project_id: '282300044590465', proposal_id: '621393', total: 2570.59 })
  assert.equal(sweepSeenView(read(map), { limit: 1 }).next_offset, 1)
})

test('run views: allowlisted scalars, paged lists, nothing unlisted', () => {
  const run = { at: 'A', dry: true, moves: 2, errors: ['e1'], skipped: { held: 3 }, secret_thing: 'x', changes: [{ customer: 'C', kind: 'move', from: '2026-01-01', to: '2026-01-02', pdf_url: 'http://x', outcome: 'ok' }], holds: [], flags: [{ customer: 'F', flag: 'no PM job', url: 'u' }] }
  const v = runView(read(run), 'install-date', { limit: 1 })
  assert.equal(v.available, true); assert.equal(v.at, 'A'); assert.equal(v.moves, 2); assert.deepEqual(v.errors, ['e1']); assert.deepEqual(v.skipped, { held: 3 }); assert.equal(v.secret_thing, undefined)
  assert.deepEqual(v.changes.rows[0], { customer: 'C', kind: 'move', from: '2026-01-01', to: '2026-01-02', outcome: 'ok' })
  assert.deepEqual(v.flags.rows[0], { customer: 'F', flag: 'no PM job' })
  const audit = runView(read({ at: 'A', scanned: 5, gaps: [{ project_id: 'p', customer: 'c', contracts: '2 attached / 1 signed', value: 1, signed_total: 2, sheet_price: 3, ghl_token: 'x' }], sheet_gaps: [], fixed: [], failed: [{ project_id: 'p', error: 'boom' }] }), 'contract-audit')
  assert.equal(audit.scanned, 5); assert.equal(audit.ok, undefined); assert.equal(runView(read({ ok: 205 }), 'contract-audit').ok_count, 205); assert.deepEqual(audit.gaps.rows[0], { project_id: 'p', customer: 'c', contracts: '2 attached / 1 signed', value: 1, signed_total: 2, sheet_price: 3 }); assert.deepEqual(audit.failed.rows[0], { project_id: 'p', error: 'boom' })
  const log = logView(read([{ at: 'A', opp: 'o', kind: 'fill', to: '2026-02-02', token: 'x' }]), {})
  assert.deepEqual(log.rows[0], { at: 'A', opp: 'o', kind: 'fill', to: '2026-02-02' })
})

test('receipts: summaries are paged; a receipt by id is allowlisted with its plans/results/jobs paged', () => {
  const rows = [
    { key: 'verified_sheet_batch_a', value: { state: 'finished', at: '2026-11-01', finishedAt: '2026-11-01T01', token: 'T', approvedPlanHashes: ['h1', 'h2'], report: { dryRun: false, fullScope: true, authorization: 'Bearer x', plans: [{ projectId: 'p', opportunityId: 'o', planHash: 'h', changes: [{ field: 'value', wasCents: 1, wantCents: 2 }], holds: [], secret: 's' }], results: [{ projectId: 'p', ok: true, fields: [{ field: 'value', state: 'verified', expectedCents: 2, observedCents: 2 }] }] }, jobs: [{ projectId: 'p', state: 'verified', planHash: 'h', report: { deep: 1 } }] } },
    { key: 'verified_sheet_batch_b', value: { state: 'held', at: '2026-11-02' } },
  ]
  const list = receiptsView(read(rows), 'verified_sheet_batch_', { limit: 1 })
  assert.equal(list.total, 2); assert.equal(list.rows[0].id, 'b'); assert.equal(list.next_offset, 1)
  assert.equal(receiptsView(read(rows), 'verified_sheet_batch_', { offset: 1 }).rows[0].id, 'a')
  const one = receiptsView(read(rows), 'verified_sheet_batch_', { id: 'a' })
  assert.equal(one.available, true); assert.equal(one.receipt.state, 'finished'); assert.equal(one.receipt.token, undefined); assert.equal(one.receipt.approved_plans, 2)
  assert.deepEqual(one.receipt.report.plans.rows[0], { projectId: 'p', opportunityId: 'o', planHash: 'h', changes: [{ field: 'value', wasCents: 1, wantCents: 2 }], holds: [] })
  assert.equal(one.receipt.report.authorization, undefined)
  assert.deepEqual(one.receipt.report.results.rows[0], { projectId: 'p', ok: true, fields: [{ field: 'value', state: 'verified', expectedCents: 2, observedCents: 2 }] })
  assert.deepEqual(one.receipt.jobs.rows[0], { projectId: 'p', state: 'verified', planHash: 'h' })
  assert.equal(JSON.stringify(one).includes('Bearer'), false)
})

test('pdf queue: both lists paged and allowlisted, links never present', () => {
  const pending = Array.from({ length: 60 }, (_, i) => ({ customer: 'c' + i, projectId: 'p', oppId: 'o', proposalId: 1, since: 's', tries: i, pdf_url: 'http://x', url: 'http://y' }))
  const v = pdfQueueView(read(pending), read([{ customer: 'f', reason: 'unsigned', failed_at: 't', link: 'http://z' }]))
  assert.equal(v.pending.total, 60); assert.equal(v.pending.rows.length, 50); assert.equal(v.pending.next_offset, 50)
  assert.equal(pdfQueueView(read(pending), read([]), { offset: 50 }).pending.rows.length, 10)
  assert.deepEqual(v.failures.rows[0], { customer: 'f', reason: 'unsigned', failed_at: 't' })
  assert.equal(JSON.stringify(v).includes('http'), false)
})

test('eod run view: allowlisted scalars, paged issues, sms text passes but nothing unlisted', () => {
  const v = runView(read({ day: '2026-11-13', checked: 217, ok: false, issue_count: 2, new_count: 1, counts: { price: 2 }, sms: { enabled: false, would_send: true, text: 'Turf EOD …', token: 'x' }, secret: 's', issues: [{ kind: 'price', severity: 'high', customer: 'A', detail: 'Sheet $1 vs GHL $2', new: true, first_seen: '2026-11-13', url: 'http://x' }, { kind: 'name', severity: 'low', customer: 'B', detail: 'd' }] }), 'eod', { limit: 1 })
  assert.equal(v.available, true); assert.equal(v.checked, 217); assert.deepEqual(v.counts, { price: 2 }); assert.equal(v.sms.text, 'Turf EOD …'); assert.equal(v.sms.token, undefined); assert.equal(v.secret, undefined)
  assert.equal(v.issues.total, 2); assert.equal(v.issues.rows.length, 1); assert.equal(v.issues.next_offset, 1); assert.deepEqual(Object.keys(v.issues.rows[0]).sort(), ['customer', 'detail', 'first_seen', 'kind', 'new', 'severity'])
})
