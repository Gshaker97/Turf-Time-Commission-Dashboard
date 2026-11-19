// The daily contract audit must also catch a PM calendar job that is behind
// GHL on signed contracts (GHL right, calendar still on the old design) and
// re-send the change order to the calendar.
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'

const GHL = 'https://services.leadconnectorhq.com'
const SB = 'http://supabase.test'
const CAL = 'http://calendar.test'
const PID = '282300099990001'
const OPP = 'opp-calendar-behind'
const PROJECT_FIELD = 'OEpWsIX1eOfXHqrSI273'
const INSTALL_FIELD = 'j3gHe7eeXd2yfujzpln8'
const PDF_FIELD = 'uluDL3vxcRVmeHSqpaj4'
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
process.env.CALENDAR_SYNC_URL = CAL
process.env.CALENDAR_SYNC_SECRET = 'test-sync-secret'
process.env.CALENDAR_EXPORT_KEY = 'test-export-key'
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'fixture@example.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) })
delete process.env.ARCSITE_WEBHOOK_SECRET
delete process.env.ANALYST_API_KEY

const future = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10)
const files = n => Array.from({ length: n }, (_, i) => ({ url: `https://ghl.example/contract-${i + 1}.pdf`, meta: { name: `contract-${i + 1}.pdf` } }))
let world
function reset({ ghlFiles = 2, calFiles = 1, sheetTotal = '2000', calendarDown = false } = {}) {
  world = {
    calendarDown,
    opp: { id: OPP, name: 'Fixture Calendar', contactId: 'contact-cal', status: 'open', pipelineId: 'pipe-outside', monetaryValue: 2000,
      customFields: [{ id: PROJECT_FIELD, fieldValueString: PID }, { id: INSTALL_FIELD, fieldValueString: future }, { id: PDF_FIELD, fieldValueFiles: files(ghlFiles) }] },
    proposals: [
      { proposal_id: 'p2', project_id: PID, status: 'APPROVED', total: 2000, pdf_url: 'https://cdn.example/2.pdf', proposal_options: [], document_number: '1002' },
      { proposal_id: 'p1', project_id: PID, status: 'APPROVED', total: 1500, pdf_url: 'https://cdn.example/1.pdf', proposal_options: [], document_number: '1001' },
    ],
    calendarJobs: [{ jobNumber: 'J-77', ghlOpportunityId: OPP, contracts: files(calFiles) }],
    sheetTotal, ingests: [], settings: new Map(),
  }
}

globalThis.fetch = async (url, opts = {}) => {
  const parsed = new URL(String(url)), method = (opts.method || 'GET').toUpperCase()
  const body = opts.body && typeof opts.body === 'string' && /^[[{]/.test(opts.body) ? JSON.parse(opts.body) : null
  const send = (status, payload) => new Response(JSON.stringify(payload ?? {}), { status, headers: { 'content-type': 'application/json' } })
  if (parsed.origin === 'https://oauth2.googleapis.com') return send(200, { access_token: 't', expires_in: 3600 })
  if (parsed.hostname === 'sheets.googleapis.com') return send(200, { valueRanges: [
    { range: 'Jobs!A1:E2', values: [['Project ID', 'Baseline Cost', 'Approved Total', 'Pre-Tax Sale', 'Commission'], [PID, '1000', world.sheetTotal, world.sheetTotal, '200']] },
    { range: 'Schedule!A1:A1', values: [['Project ID']] },
  ] })
  if (parsed.origin === CAL) {
    if (parsed.pathname === '/api/export/analyst') return world.calendarDown ? send(503, { error: 'calendar down' }) : send(200, { jobs: world.calendarJobs })
    if (parsed.pathname === '/api/change-orders/ingest' && method === 'POST') { world.ingests.push(body); return send(200, { ok: true, job: { jobNumber: 'J-77' } }) }
    return send(404, {})
  }
  if (parsed.hostname === 'api.arcsite.com') {
    if (parsed.pathname === '/v1/proposals') return send(200, parsed.searchParams.get('project_id') === PID ? world.proposals : [])
    if (parsed.pathname.startsWith('/v1/projects/')) return send(200, { name: 'Fixture Calendar', customer: { name: 'Fixture Calendar', phone: '5550100100', address: { street: '1 Example St', city: 'Phoenix', state: 'AZ', zip_code: '85001' } } })
    return send(404, {})
  }
  if (parsed.origin === SB) {
    if (parsed.pathname === '/rest/v1/app_settings' && method === 'POST') { if (body && body.key) world.settings.set(body.key, body.value); return send(201, {}) }
    if (parsed.pathname === '/rest/v1/app_settings') { const k = decodeURIComponent(parsed.searchParams.get('key') || '').replace(/^eq\./, ''); const v = world.settings.get(k); return send(200, v === undefined ? [] : [{ key: k, value: v }]) }
    return send(200, [])
  }
  if (parsed.origin !== GHL) return send(404, {})
  if (parsed.pathname.startsWith('/opportunities/search')) return send(200, { opportunities: [world.opp], meta: { total: 1 } })
  if (method === 'GET' && parsed.pathname === `/opportunities/${OPP}`) return send(200, { opportunity: world.opp })
  if (method === 'PUT' && parsed.pathname.startsWith('/contacts/')) return send(200, { contact: { id: 'contact-cal' } })
  if (parsed.pathname.includes('/customFields')) return send(200, { customFields: [] })
  return send(404, {})
}

const { arcContractAudit, resetArcSaleMemoryForTests } = await import('../server.js')

test('GHL has both signed contracts but the PM calendar has one: flagged and re-sent', async () => {
  reset(); resetArcSaleMemoryForTests()
  const audit = await arcContractAudit({ fix: true })
  assert.equal(audit.calendar.behind, 1, JSON.stringify(audit))
  assert.equal(audit.gaps.length, 1); assert.match(audit.gaps[0].reason, /PM calendar/)
  assert.equal(audit.fixed.length, 1); assert.equal(audit.fixed[0].action, 'calendar_resend')
  assert.equal(world.ingests.length, 1)
  assert.equal(world.ingests[0].contracts.length, 2)
  assert.equal(world.ingests[0].contracts[1].url, 'https://ghl.example/contract-2.pdf')
  assert.equal(world.ingests[0].newTotal, 2000)
})

test('report-only run lists the calendar gap and sends nothing', async () => {
  reset(); resetArcSaleMemoryForTests()
  const audit = await arcContractAudit({ fix: false })
  assert.equal(audit.gaps.length, 1); assert.equal(audit.fixed.length, 0); assert.equal(world.ingests.length, 0)
})

test('calendar in step with GHL is ok', async () => {
  reset({ calFiles: 2 }); resetArcSaleMemoryForTests()
  const audit = await arcContractAudit({ fix: true })
  assert.equal(audit.ok, 1); assert.equal(audit.gaps.length, 0); assert.equal(world.ingests.length, 0)
})

test('a value the Sheet and ArcSite disagree on is listed, never pushed to the calendar', async () => {
  reset({ sheetTotal: '2500' }); resetArcSaleMemoryForTests()
  const audit = await arcContractAudit({ fix: true })
  assert.ok(audit.gaps.some(g => /PM calendar/.test(g.reason || '')), JSON.stringify(audit))
  assert.equal(world.ingests.length, 0)
})

test('calendar export down: GHL checks still run and the reason is kept', async () => {
  reset({ calendarDown: true }); resetArcSaleMemoryForTests()
  const audit = await arcContractAudit({ fix: true })
  assert.match(audit.calendar.error, /503|calendar down/); assert.equal(audit.ok, 1); assert.equal(world.ingests.length, 0)
})
