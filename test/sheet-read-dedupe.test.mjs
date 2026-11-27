import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'

// The install sheet is read at most once per reconciler pass and concurrent readers share
// one request: Google allows 60 reads a minute per service account (the Nov 2026 429s).
const SB = 'http://supabase.test'
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
process.env.ARC_NO_LISTEN = '1'
process.env.ARC_DISABLE_TIMERS = '1'
process.env.ARC_SALE_TEST = '1'
process.env.GHL_LOCATION_ID = 'loc-test'
process.env.GHL_API_TOKEN = 'test-read-token'
process.env.GHL_WRITE_TOKEN = 'test-write-token'
process.env.ARCSITE_API_TOKEN = 'test-arcsite-token'
process.env.SUPABASE_URL = SB
process.env.SUPABASE_SERVICE_KEY = 'test-service-key'
process.env.INSTALL_SHEET_ID = 'sheet-test'
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'sheet@example.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) })
delete process.env.CALENDAR_SYNC_URL
delete process.env.ANALYST_API_KEY

const calls = { sheet: 0, token: 0, ghlPut: 0, pendingWrite: 0, deals: 0 }
let pending = {}
let sheetDelayMs = 0
globalThis.fetch = async (url, opts = {}) => {
  const parsed = new URL(String(url)), method = (opts.method || 'GET').toUpperCase()
  const send = (status, payload) => new Response(JSON.stringify(payload ?? {}), { status, headers: { 'content-type': 'application/json' } })
  if (parsed.origin === 'https://oauth2.googleapis.com') { calls.token++; return send(200, { access_token: 'sheet-token', expires_in: 3600 }) }
  if (parsed.hostname === 'sheets.googleapis.com') {
    calls.sheet++
    if (sheetDelayMs) await new Promise(r => setTimeout(r, sheetDelayMs))
    return send(200, { valueRanges: [
      { range: 'Jobs!A1:E2', values: [['Project ID', 'Baseline Cost', 'Approved Total', 'Pre-Tax Sale', 'Commission'], ['111', '800', '1500', '1400', '200']] },
      { range: 'Schedule!A1:A1', values: [['Project ID']] },
    ] })
  }
  if (parsed.origin === SB) {
    if (parsed.pathname === '/rest/v1/app_settings' && method === 'GET') {
      const key = decodeURIComponent(parsed.searchParams.get('key') || '').replace(/^eq\./, '')
      return send(200, key === 'arcsite_pending' ? [{ value: pending }] : [])
    }
    if (parsed.pathname === '/rest/v1/app_settings' && method === 'POST') { calls.pendingWrite++; return send(201, {}) }
    if (parsed.pathname.startsWith('/rest/v1/deals')) { calls.deals++; return send(200, []) }
    return send(200, [])
  }
  if (parsed.hostname === 'services.leadconnectorhq.com') {
    if (parsed.pathname.endsWith('/customFields')) return send(200, { customFields: [] })
    if (method === 'PUT') { calls.ghlPut++; return send(200, {}) }
    return send(200, {})
  }
  throw new Error('unexpected fetch ' + method + ' ' + parsed.href)
}

const mod = await import('../server.js')
const { readInstallSheetForTests: readSheet, arcPendingReconcileForTests: reconcile, resetArcSaleMemoryForTests: reset } = mod
const zero = () => { for (const k of Object.keys(calls)) calls[k] = 0 }

test('50 pending projects in one reconciler tick make exactly ONE sheet read', async () => {
  reset(); zero()
  pending = {}
  for (let i = 0; i < 50; i++) pending[`90000000000${String(i).padStart(4, '0')}`] = { oppId: `opp-${i}`, estimator: false, firstAt: Date.now() - 3600_000, wrote: {} }
  await reconcile()
  assert.equal(calls.sheet, 1, `sheet reads: ${calls.sheet}`)
  assert.equal(calls.deals, 50, 'every project still got its deal lookup')
  assert.equal(calls.ghlPut, 0, 'no project is on the sheet, so nothing was written')
})

test('concurrent readers share one in-flight fetch', async () => {
  reset(); zero(); sheetDelayMs = 40
  const results = await Promise.all([readSheet(), readSheet(), readSheet(), readSheet(), readSheet()])
  sheetDelayMs = 0
  assert.equal(calls.sheet, 1, `sheet reads: ${calls.sheet}`)
  assert.ok(results.every(r => r === results[0]), 'all five callers got the same data')
})

test('a fresh-row reader reuses a cache under 30s old and refetches an older one', async () => {
  reset(); zero()
  await readSheet()
  await readSheet({ maxAgeMs: 30_000 })
  assert.equal(calls.sheet, 1, 'second read served from the young cache')
  // age the cache past 30s (but under the 60s default) by reading it with a tiny max age
  await readSheet({ maxAgeMs: 0 })
  assert.equal(calls.sheet, 2, 'a stale-for-this-caller cache is refetched once')
  await readSheet()
  assert.equal(calls.sheet, 2, 'the default reader keeps using the refreshed cache')
})

test('a failed read does not break later readers (the in-flight slot is released)', async () => {
  reset(); zero()
  const saved = globalThis.fetch
  globalThis.fetch = async (url, opts) => { if (String(url).includes('sheets.googleapis.com')) { calls.sheet++; return new Response('{"error":{"code":429}}', { status: 429 }) } return saved(url, opts) }
  await assert.rejects(readSheet(), /429/)
  globalThis.fetch = saved
  await readSheet()
  assert.equal(calls.sheet, 2)
})
