// Access review (Nov 12 2026): the analyst (Jarvis) key must read the analyst views and must get 401
// on all four verified-sheet-reconcile POST routes even when every feature switch is enabled; the
// owner's existing write mechanism (and only that) must still work.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../server.js', import.meta.url), 'utf8')
const fn = name => { const m = source.match(new RegExp(`^function ${name}\\(req\\) \\{[\\s\\S]*?\\n\\}`, 'm')); assert.ok(m, `${name} must exist in server.js`); return m[0] }
const authSrc = fn('analystAuthorized') + '\n' + fn('ingestAuthorized') + '\n' + fn('verifiedTriggerAuthorized')
const build = (env = {}) => {
  const saved = { ...process.env }
  Object.assign(process.env, { LEADS_INGEST_SECRET: 'ingest-secret', ...env })
  const f = new Function('ANALYST_API_KEY', 'DASHBOARD_READ_KEY', 'SERVICE_KEY', 'process', authSrc + '; return { analystAuthorized, ingestAuthorized, verifiedTriggerAuthorized }')
  const out = f('jarvis-key', 'dashboard-key', 'service-key', process)
  return { ...out, restore: () => { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved) } }
}
const req = (key, headerName = 'x-api-key') => ({ headers: headerName === 'authorization' ? { authorization: 'Bearer ' + key } : { [headerName]: key }, query: {} })
const SWITCHES_ON = { ARC_VERIFIED_SHEET_WRITES: '1', ARC_VERIFIED_SHEET_SINGLE_WRITER: '1', ARC_VERIFIED_SHEET_BATCH: '1', ARC_VERIFIED_SHEET_AUTO: '0' }

test('analyst key reads: analystAuthorized recognises jarvis and dashboard keys only', () => {
  const a = build(); try {
    assert.equal(a.analystAuthorized(req('jarvis-key')), 'jarvis')
    assert.equal(a.analystAuthorized(req('jarvis-key', 'authorization')), 'jarvis')
    assert.equal(a.analystAuthorized(req('dashboard-key')), 'dashboard')
    assert.equal(a.analystAuthorized(req('ingest-secret')), false)
    assert.equal(a.analystAuthorized(req('')), false)
  } finally { a.restore() }
})

test('trigger auth never accepts the analyst or dashboard key, even with every switch enabled', () => {
  const a = build({ ...SWITCHES_ON, ARC_VERIFIED_TRIGGER_KEY: 'should-be-ignored' }); try {
    assert.equal(a.verifiedTriggerAuthorized(req('should-be-ignored')), false, 'no dedicated-key mechanism exists')
    assert.equal(a.verifiedTriggerAuthorized(req('jarvis-key')), false)
    assert.equal(a.verifiedTriggerAuthorized(req('jarvis-key', 'authorization')), false)
    assert.equal(a.verifiedTriggerAuthorized(req('dashboard-key')), false)
    assert.equal(a.verifiedTriggerAuthorized(req('')), false)
    assert.equal(a.verifiedTriggerAuthorized({ headers: {}, query: { secret: 'jarvis-key' } }), false)
  } finally { a.restore() }
})

test('trigger auth accepts only the existing owner write mechanism', () => {
  const a = build(SWITCHES_ON); try {
    assert.equal(a.verifiedTriggerAuthorized(req('ingest-secret')), true)          // LEADS_INGEST_SECRET
    assert.equal(a.verifiedTriggerAuthorized(req('service-key')), true)            // service key
    assert.equal(a.verifiedTriggerAuthorized(req('ingest-secret', 'authorization')), true)
    assert.equal(a.verifiedTriggerAuthorized(req('random')), false)
  } finally { a.restore() }
})

test('all four verified-reconcile POST routes use the trigger auth, and no POST route anywhere uses the analyst key', () => {
  const posts = [...source.matchAll(/^app\.post\('([^']+)'[\s\S]*?\n\}\)/gm)]
  assert.ok(posts.length > 20)
  const verified = posts.filter(m => m[1].startsWith('/api/arcsite/verified-sheet-reconcile'))
  assert.deepEqual(verified.map(m => m[1]).sort(), ['/api/arcsite/verified-sheet-reconcile', '/api/arcsite/verified-sheet-reconcile/batch', '/api/arcsite/verified-sheet-reconcile/retry', '/api/arcsite/verified-sheet-reconcile/retry-preview'])
  for (const m of verified) assert.match(m[0], /verifiedTriggerAuthorized\(req\)/, m[1] + ' must use verifiedTriggerAuthorized')
  for (const m of posts) assert.doesNotMatch(m[0], /analystAuthorized\(/, m[1] + ' is a POST route and must not consult the analyst key')
})

test('live route slices: analyst key → 401 on the four POST routes with switches enabled; owner key accepted; analyst GET still 200', async () => {
  const { default: express } = await import('express')
  const slice = (start, end) => { const a = source.indexOf(start); const b = source.indexOf(end, a); assert.ok(a >= 0 && b > a, start); return source.slice(a, b) }
  const middleware = source.match(/^app\.use\(express\.text\(\{ type: '\*\/\*', limit: '1mb' \}\)\)$/m)[0]
  const runRoute = slice("app.post('/api/arcsite/verified-sheet-reconcile',", "// INSERT-only app_settings keys")
  const batchRoute = slice("app.post('/api/arcsite/verified-sheet-reconcile/batch',", "app.get('/api/arcsite/verified-sheet-reconcile/batch/:batchId'")
  const previewRoute = slice("app.post('/api/arcsite/verified-sheet-reconcile/retry-preview',", "app.get('/api/arcsite/verified-sheet-reconcile/retry-preview/:requestId'")
  const retryRoute = slice("app.post('/api/arcsite/verified-sheet-reconcile/retry',", "app.get('/api/arcsite/verified-sheet-reconcile/retry/:retryId'")
  const reportGet = slice("app.get('/api/arcsite/verified-sheet-reconcile',", "app.post('/api/arcsite/verified-sheet-reconcile',")
  const a = build(SWITCHES_ON)
  const calls = { run: 0, batch: 0, preview: 0, retry: 0 }
  try {
    const app = express()
    new Function('app', 'express', middleware)(app, express)
    const err = m => ({ ok: false, error: m })
    new Function('app', 'verifiedTriggerAuthorized', 'analystAuthorized', 'err', 'verifiedRunBusy', 'verifiedLoadPrivatePolicy', 'verifiedSheetRun', 'verifiedBatchStart', 'verifiedRetry', 'retryRequestValid', 'crypto', 'VERIFIED_RETRY_PREFIX', 'verifiedInsertClaim', 'verifiedSheetLast',
      reportGet + '\n' + runRoute + '\n' + batchRoute + '\n' + previewRoute + '\n' + retryRoute)(
      app, a.verifiedTriggerAuthorized, a.analystAuthorized, err, false,
      async () => { calls.run++ }, async () => {},
      // The batch/retry modules decide inside on `authorized` (production design): count only AUTHORIZED work.
      async ({ authorized }) => { if (authorized) calls.batch++; return authorized ? { status: 202, body: { ok: true, started: true } } : { status: 401, body: err('Unauthorized') } },
      { preview: async () => { calls.preview++; return { status: 200, body: { ok: true } } }, start: async ({ authorized }) => { if (authorized) calls.retry++; return authorized ? { status: 200, body: { ok: true } } : { status: 401, body: err('Unauthorized') } } },
      () => true, { randomUUID: () => 'id' }, 'verified_sheet_retry_', async () => true, async () => ({ at: 'x' }))
    const server = await new Promise(r => { const l = app.listen(0, '127.0.0.1', () => r(l)) })
    const base = `http://127.0.0.1:${server.address().port}`
    try {
      for (const path of ['/api/arcsite/verified-sheet-reconcile', '/api/arcsite/verified-sheet-reconcile/batch', '/api/arcsite/verified-sheet-reconcile/retry-preview', '/api/arcsite/verified-sheet-reconcile/retry']) {
        for (const key of ['jarvis-key', 'dashboard-key', 'nope']) {
          const r = await fetch(base + path, { method: 'POST', headers: { 'x-api-key': key, 'Content-Type': 'application/json' }, body: '{}' })
          assert.equal(r.status, 401, `${path} with ${key}`)
        }
      }
      assert.deepEqual(calls, { run: 0, batch: 0, preview: 0, retry: 0 }, 'rejected keys must trigger no run, batch, preview or retry work')
      const ok1 = await fetch(base + '/api/arcsite/verified-sheet-reconcile/batch', { method: 'POST', headers: { 'x-api-key': 'service-key', 'Content-Type': 'application/json' }, body: '{}' })
      assert.equal(ok1.status, 202, 'owner service key starts a batch')
      const ok2 = await fetch(base + '/api/arcsite/verified-sheet-reconcile/retry', { method: 'POST', headers: { 'x-api-key': 'ingest-secret', 'Content-Type': 'application/json' }, body: '{}' })
      assert.equal(ok2.status, 200, 'existing owner write mechanism still works')
      const get = await fetch(base + '/api/arcsite/verified-sheet-reconcile', { headers: { 'x-api-key': 'jarvis-key' } })
      assert.equal(get.status, 200, 'analyst key still reads the report GET')
      const getDash = await fetch(base + '/api/arcsite/verified-sheet-reconcile', { headers: { 'x-api-key': 'dashboard-key' } })
      assert.equal(getDash.status, 401, 'report GET stays Jarvis-only')
    } finally { server.closeAllConnections(); await new Promise((res, rej) => server.close(e => e ? rej(e) : res())) }
  } finally { a.restore() }
})

test('analyst arcsite views are registered as Jarvis-only GET routes', () => {
  const views = ['/api/analyst/arcsite/sweep-seen', '/api/analyst/arcsite/verified/daily', '/api/analyst/arcsite/verified/batches', '/api/analyst/arcsite/verified/retries', '/api/analyst/arcsite/install-date-sync', '/api/analyst/arcsite/pdf-pending', '/api/analyst/arcsite/contract-audit']
  for (const v of views) { const m = source.match(new RegExp(`analystRoute\\('${v.replace(/\//g, '\\/')}'[\\s\\S]*?\\{ jarvisOnly: true \\}\\)`)); assert.ok(m, v + ' must be a jarvisOnly analystRoute') }
  assert.match(source.match(/^function analystRoute[\s\S]*?\n\}/m)[0], /app\.get\(path/, 'analystRoute registers GET only')
  assert.doesNotMatch(source.match(/^function analystRoute[\s\S]*?\n\}/m)[0], /app\.(post|put|delete)\(/)
})

test('analystRoute answers 503 (not an empty 200) when a view reports a storage read error', () => {
  const src = source.match(/^function analystRoute[\s\S]*?\n\}/m)[0]
  assert.match(src, /reason === 'error'\) return res\.status\(503\)/, 'a failed storage read must surface as 503')
  assert.match(source, /const arcSetting = async key => \{ try \{/, 'arcSetting must catch and return a read result, not swallow to null')
  assert.doesNotMatch(source, /arcSetting[\s\S]{0,200}\.catch\(\(\) => \[\]\)/, 'no read helper may turn an error into an empty list')
  assert.doesNotMatch(source, /ARC_VERIFIED_TRIGGER_KEY/, 'no new trigger credential')
})

test('analystRoute envelope fields come after the view body so a view can never shadow ok/caller', () => {
  const src = source.match(/^function analystRoute[\s\S]*?\n\}/m)[0]
  assert.ok(src.indexOf('...body,') < src.indexOf('ok: true, caller, bundle_built_at'), 'body spread must precede the envelope')
})
