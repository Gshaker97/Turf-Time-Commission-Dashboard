// The daily contract audit, end to end against a mocked GHL / ArcSite /
// calendar / Sheet. ArcSite's newest signed PDF is the truth: GHL and the PM
// calendar are each checked against it and whichever is behind gets it, on its
// own — the calendar never waits for GHL (Isaac Rosas, Jared Morris, Tyler
// Sibold, Nov 20 2026: calendar jobs days behind their change orders while the
// audit reported "behind: 0"). A job the audit leaves is listed with its reason.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
// A real signed render (stamp + text) so the GHL rebuild path runs for real.
const SIGNED_PDF = Buffer.from(readFileSync(new URL('./fixtures/synthetic-signed-body.pdf.base64', import.meta.url), 'utf8').trim(), 'base64')
const NEW_SIZE = SIGNED_PDF.length, OLD_SIZE = NEW_SIZE + 1000

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
delete process.env.ARC_VALUE_HOLD_OPPS

const future = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10)
// GHL file entries: 'old' = the pre-change-order PDF, 'new' = the newest signed one.
const ghlFile = (which, i) => ({ url: `https://ghl.example/${which}-${i}.pdf`, meta: { name: `${which}-${i}.pdf`, mimetype: 'application/pdf', size: which === 'new' ? NEW_SIZE : OLD_SIZE } })
const calFile = (which) => ({ filename: `fixture-contract.pdf`, sizeBytes: which === 'new' ? NEW_SIZE : which === 'reencoded' ? NEW_SIZE + 77 : OLD_SIZE, mimeType: 'application/pdf', url: `${CAL}/api/export/attachments/${which}` })
let world
function reset({ ghl = ['old', 'new'], cal = ['new'], sheetTotal = '2000', calendarDown = false, arcPdfOk = true, value = 2000, sameSize = false, ingestImported = 1, keepSettings = false, arcsiteStatus = 200 } = {}) {
  const settings = keepSettings && world ? world.settings : new Map()
  world = {
    calendarDown, arcPdfOk, sameSize, ingestImported, arcsiteStatus,
    opp: { id: OPP, name: 'Fixture Calendar', contactId: 'contact-cal', status: 'open', pipelineId: 'pipe-outside', monetaryValue: value,
      customFields: [{ id: PROJECT_FIELD, fieldValueString: PID }, { id: INSTALL_FIELD, fieldValueString: future }, { id: PDF_FIELD, fieldValueFiles: ghl.map(ghlFile) }] },
    proposals: [
      { proposal_id: 'p2', project_id: PID, status: 'APPROVED', total: 2000, pdf_url: 'https://cdn.example/new.pdf', proposal_options: [], document_number: '1002' },
      { proposal_id: 'p1', project_id: PID, status: 'APPROVED', total: 1500, pdf_url: 'https://cdn.example/old.pdf', proposal_options: [], document_number: '1001' },
    ],
    calendarJobs: cal === null ? [] : [{ jobNumber: 'J-77', ghlOpportunityId: OPP, canceledAt: null, value, contracts: cal.map(calFile) }],
    sheetTotal, ingests: [], uploads: [], oppPuts: [], contactPuts: [], settings,
    // the contact behind the opp: in step with the opp by default (Job Price = value, newest contract held)
    contact: { id: 'contact-cal', customFields: [{ id: 'gz5Xoix8Sd37hUbrvQuQ', value }, { id: 'X6s8Kc6QVEVyzSIISktA', value },
      { id: 'BxSAZYBEeT5iBI67CfVW', value: { 'doc-1': { meta: { name: 'contract.pdf', size: NEW_SIZE }, url: 'https://ghl.example/documents/doc-1' } } }] },
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
  if (parsed.hostname === 'cdn.example') {
    // ArcSite's signed render: HEAD answers the size, GET the bytes (or, when
    // arcPdfOk is off, a login page — an expired link — which cannot be hosted).
    const isNew = parsed.pathname === '/new.pdf'
    const bytes = world.arcPdfOk || !isNew ? (isNew || world.sameSize ? SIGNED_PDF : Buffer.concat([SIGNED_PDF, Buffer.alloc(1000)])) : Buffer.from('<html>login</html>')
    if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-length': String(bytes.length) } })
    return new Response(bytes, { status: 200, headers: { 'content-type': 'application/pdf' } })
  }
  if (parsed.origin === CAL) {
    if (parsed.pathname === '/api/export/jobs') return world.calendarDown ? send(503, { error: 'calendar down' }) : send(200, { jobs: world.calendarJobs })
    if (parsed.pathname === '/api/change-orders/ingest' && method === 'POST') { world.ingests.push(body); return send(200, { ok: true, matched: true, job: { jobNumber: 'J-77', filesImported: world.ingestImported, valueChanged: false } }) }
    return send(404, {})
  }
  if (parsed.hostname === 'api.arcsite.com') {
    if (world.arcsiteStatus !== 200) return send(world.arcsiteStatus, { error: 'Too Many Requests' })
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
  if (parsed.pathname.startsWith('/opportunities/search')) return send(200, { opportunities: [world.opp, ...(world.extraOpps || [])], meta: { total: 1 + (world.extraOpps || []).length } })
  if (method === 'GET' && parsed.pathname === `/opportunities/${OPP}`) return send(200, { opportunity: world.opp })
  if (method === 'PUT' && parsed.pathname === `/opportunities/${OPP}`) {
    world.oppPuts.push(body)
    // Mirror GHL: clearing the file field empties it, each later write appends one hosted file.
    for (const f of (body && body.customFields) || []) {
      if (f.id !== PDF_FIELD) continue
      const field = world.opp.customFields.find(c => c.id === PDF_FIELD)
      if (f.field_value === '') field.fieldValueFiles = []
      else field.fieldValueFiles.push({ url: f.field_value, meta: { name: 'hosted.pdf', mimetype: 'application/pdf', size: NEW_SIZE } })
    }
    if (body && body.monetaryValue != null) world.opp.monetaryValue = body.monetaryValue
    return send(200, { opportunity: world.opp })
  }
  if (method === 'POST' && parsed.pathname === '/medias/upload-file') { const n = world.uploads.push(opts.body); return send(200, { url: `https://ghl.example/hosted-${n}.pdf` }) }
  if (method === 'GET' && parsed.pathname === '/contacts/contact-cal') return send(200, { contact: world.contact })
  if (method === 'PUT' && parsed.pathname.startsWith('/contacts/')) { world.contactPuts.push(body); return send(200, { contact: { id: 'contact-cal' } }) }
  if (parsed.pathname.includes('/customFields')) return send(200, { customFields: [] })
  return send(404, {})
}

const { arcContractAudit, resetArcSaleMemoryForTests, resetArcCalendarLedgerForTests } = await import('../server.js')
const quiet = async fn => { const orig = console.log; console.log = () => {}; try { return await fn() } finally { console.log = orig } }
const run = opts => { resetArcCalendarLedgerForTests(); return quiet(() => arcContractAudit(opts)) }

test('calendar behind, GHL current: the newest PDF is pushed to the calendar from GHL\'s copy, nothing else touched', async () => {
  reset({ ghl: ['old', 'new'], cal: ['old'] }); resetArcSaleMemoryForTests()
  const audit = await run({ fix: true })
  assert.equal(audit.calendar.behind, 1, JSON.stringify(audit))
  assert.equal(audit.gaps.length, 1); assert.equal(audit.gaps[0].target, 'calendar'); assert.match(audit.gaps[0].reason, /not the newest signed PDF/)
  assert.equal(audit.fixed.length, 1); assert.equal(audit.fixed[0].action, 'calendar_push'); assert.equal(audit.fixed[0].source, 'ghl')
  assert.equal(world.ingests.length, 1)
  assert.equal(world.ingests[0].contracts.length, 1); assert.equal(world.ingests[0].contracts[0].url, 'https://ghl.example/new-1.pdf')
  assert.equal(world.ingests[0].newTotal, 2000)
  assert.equal(world.uploads.length, 0); assert.equal(world.oppPuts.length, 0, 'GHL untouched')
  assert.equal(audit.skipped_jobs.length, 0)
})

test('GHL behind, calendar current: GHL is rebuilt from ArcSite; the calendar gets the change-order push and is not pushed twice', async () => {
  reset({ ghl: ['old'], cal: ['new'] }); resetArcSaleMemoryForTests()
  const audit = await run({ fix: true })
  assert.equal(audit.gaps.length, 1); assert.equal(audit.gaps[0].target, 'ghl'); assert.match(audit.gaps[0].reason, /1 attached \/ 2 signed/)
  assert.equal(audit.fixed.length, 1); assert.equal(audit.fixed[0].action, 'change_order'); assert.equal(audit.fixed[0].pdf, 'rebuilt 2')
  assert.equal(world.uploads.length, 2, 'both signed PDFs hosted in GHL')
  assert.equal(world.ingests.length, 1, 'one calendar push (from the change order), not a second one')
  assert.equal(audit.calendar.current, 1)
})

test('both behind: GHL rebuilt and the calendar brought up to date in the same run', async () => {
  reset({ ghl: ['old'], cal: ['old'] }); resetArcSaleMemoryForTests()
  const audit = await run({ fix: true })
  assert.equal(audit.fixed.length, 1); assert.equal(audit.fixed[0].action, 'change_order')
  assert.equal(world.uploads.length, 2); assert.equal(world.ingests.length, 1)
  assert.equal(world.ingests[0].contracts.length, 2); assert.equal(world.ingests[0].contracts[1].url, 'https://ghl.example/hosted-2.pdf')
})

test('both behind but GHL cannot be rebuilt (ArcSite link expired): the calendar still gets the newest PDF straight from ArcSite', async () => {
  reset({ ghl: ['old'], cal: ['old'], arcPdfOk: false }); resetArcSaleMemoryForTests()
  const audit = await run({ fix: true })
  const ghl = audit.failed.find(f => f.target === 'ghl'); assert.ok(ghl, JSON.stringify(audit)); assert.match(String(ghl.error), /could not be verified|not a PDF/)
  const cal = audit.fixed.find(f => f.target === 'calendar'); assert.ok(cal, JSON.stringify(audit))
  assert.equal(cal.action, 'calendar_push'); assert.equal(cal.source, 'arcsite')
  // The failed change order still made its best-effort push (GHL's old files);
  // the audit's own push, last, carries ArcSite's newest PDF.
  const last = world.ingests[world.ingests.length - 1]
  assert.equal(last.contracts.length, 1); assert.equal(last.contracts[0].url, 'https://cdn.example/new.pdf')
  assert.equal(last.contracts[0].meta.name, 'Fixture Calendar - contract 1002.pdf')
  assert.ok(!world.ingests.slice(0, -1).some(i => i.contracts.some(c => c.url === 'https://cdn.example/new.pdf')), 'only the audit push carried the newest PDF')
})

test('a held opportunity that is behind is skipped with the reason — never fixed, never silent', async () => {
  reset({ ghl: ['old'], cal: ['old'] }); resetArcSaleMemoryForTests()
  process.env.ARC_VALUE_HOLD_OPPS = OPP
  try {
    const audit = await run({ fix: true })
    assert.equal(audit.held.length, 1)
    assert.equal(audit.fixed.length, 0); assert.equal(world.ingests.length, 0); assert.equal(world.uploads.length, 0); assert.equal(world.oppPuts.length, 0)
    const targets = audit.skipped_jobs.map(s => s.target).sort()
    assert.deepEqual(targets, ['calendar', 'ghl'])
    for (const s of audit.skipped_jobs) { assert.match(s.reason, /manual hold/); assert.equal(s.customer, 'Fixture Calendar'); assert.equal(s.calendar_job, 'J-77') }
  } finally { delete process.env.ARC_VALUE_HOLD_OPPS }
})

test('a disputed value (Sheet ≠ ArcSite) still gets the newest contract on the calendar, with the value left exactly as it is', async () => {
  reset({ ghl: ['old', 'new'], cal: ['old'], sheetTotal: '2500' }); resetArcSaleMemoryForTests()
  const audit = await run({ fix: true })
  assert.ok(audit.sheet_gaps.some(g => /differs/.test(g.reason)))
  assert.equal(audit.fixed.length, 1); assert.equal(audit.fixed[0].action, 'calendar_push')
  assert.equal(world.ingests.length, 1); assert.equal(world.ingests[0].newTotal, 2000); assert.equal(world.ingests[0].previousTotal, 2000)
})

test('the daily cap: a job past the cap is skipped and says so', async () => {
  reset({ ghl: ['old', 'new'], cal: ['old'] }); resetArcSaleMemoryForTests()
  const audit = await run({ fix: true, maxFix: 0 })
  assert.equal(audit.fixed.length, 0); assert.equal(world.ingests.length, 0)
  assert.equal(audit.skipped_jobs.length, 1); assert.match(audit.skipped_jobs[0].reason, /daily fix cap \(0\) reached/)
})

test('dry run: every push is planned and listed, nothing is sent, and the result is stored under its own key', async () => {
  reset({ ghl: ['old'], cal: ['old'] }); resetArcSaleMemoryForTests()
  const audit = await run({ fix: true, dry: true })
  assert.equal(audit.dry, true); assert.equal(audit.fix, false)
  assert.deepEqual(audit.would_fix.map(w => `${w.target}:${w.action}:${w.source}`), ['ghl:change_order:arcsite', 'calendar:calendar_push:arcsite'])
  assert.equal(audit.fixed.length, 0); assert.equal(world.ingests.length, 0); assert.equal(world.uploads.length, 0); assert.equal(world.oppPuts.length, 0)
  assert.ok(world.settings.has('arcsite_contract_audit_dry')); assert.ok(!world.settings.has('arcsite_contract_audit'))
  // fix:false is the same report-only run
  reset({ ghl: ['old', 'new'], cal: ['old'] }); resetArcSaleMemoryForTests()
  const ro = await run({ fix: false })
  assert.equal(ro.dry, true); assert.equal(ro.would_fix.length, 1); assert.equal(world.ingests.length, 0)
})

test('calendar and GHL both in step is ok', async () => {
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests()
  const audit = await run({ fix: true })
  assert.equal(audit.ok, 1); assert.equal(audit.gaps.length, 0); assert.equal(world.ingests.length, 0); assert.equal(audit.calendar.current, 1)
})

test('calendar job with no contract file at all is behind', async () => {
  reset({ ghl: ['old', 'new'], cal: [] }); resetArcSaleMemoryForTests()
  const audit = await run({ fix: true })
  assert.equal(audit.calendar.no_contract, 1); assert.equal(audit.fixed.length, 1); assert.equal(world.ingests.length, 1)
})

test('calendar export down: GHL checks still run and the unchecked calendar is recorded as skipped with the reason', async () => {
  reset({ ghl: ['old', 'new'], cal: ['old'], calendarDown: true }); resetArcSaleMemoryForTests()
  const audit = await run({ fix: true })
  assert.match(audit.calendar.error, /503|calendar down/); assert.equal(audit.ok, 1); assert.equal(world.ingests.length, 0)
  assert.equal(audit.skipped_jobs.length, 1); assert.equal(audit.skipped_jobs[0].target, 'calendar'); assert.match(audit.skipped_jobs[0].reason, /calendar not checked/)
})

test('a re-encoded calendar copy (size matches nothing): pushed once, the calendar reports it already had it, and later runs leave it alone', async () => {
  reset({ ghl: ['old', 'new'], cal: ['reencoded'], ingestImported: 0 }); resetArcSaleMemoryForTests()
  const first = await run({ fix: true })
  // pushed from GHL's copy, "nothing imported", then once more from ArcSite to be sure: still nothing → it really has it
  assert.equal(first.calendar.behind, 1); assert.equal(world.ingests.length, 2)
  assert.equal(first.fixed.length, 1); assert.equal(first.fixed[0].already_had_it, true); assert.match(first.fixed[0].reason, /already held it/)
  const ledger = world.settings.get('arcsite_calendar_contract_ledger')
  assert.equal(ledger[OPP].proposal_id, 'p2'); assert.equal(ledger[OPP].job, 'J-77')
  // next night: same calendar, same ledger → current by ledger, nothing sent
  reset({ ghl: ['old', 'new'], cal: ['reencoded'], ingestImported: 0, keepSettings: true }); resetArcSaleMemoryForTests()
  const second = await run({ fix: true })
  assert.equal(world.ingests.length, 0, JSON.stringify(second))
  assert.equal(second.calendar.by_ledger, 1); assert.equal(second.ok, 1); assert.equal(second.gaps.length, 0)
  // a NEWER signing (p3) makes the ledger stale again → behind
  reset({ ghl: ['old', 'new'], cal: ['reencoded'], keepSettings: true }); resetArcSaleMemoryForTests()
  world.proposals.unshift({ proposal_id: 'p3', project_id: PID, status: 'APPROVED', total: 2000, pdf_url: 'https://cdn.example/new.pdf', proposal_options: [], document_number: '1003' })
  const third = await run({ fix: true })
  // GHL is short one contract now, so the change-order path rebuilds GHL and
  // re-files the calendar — the stale ledger (p2) did not stop the push, and
  // the ledger now names p3.
  assert.equal(world.ingests.length, 1, JSON.stringify(third)); assert.equal(third.fixed[0].pdf, 'rebuilt 3')
  assert.equal(world.settings.get('arcsite_calendar_contract_ledger')[OPP].proposal_id, 'p3')
})

test('two revisions share a byte size: the calendar is never passed on size alone — a push settles it (filesImported 0 = it already had it; 1 = it was behind)', async () => {
  reset({ ghl: ['old', 'new'], cal: ['new'], sameSize: true, ingestImported: 1 }); resetArcSaleMemoryForTests()
  const a = await run({ fix: true })
  assert.equal(a.calendar.ambiguous, 1, JSON.stringify(a.calendar)); assert.equal(a.gaps.length, 1); assert.equal(a.gaps[0].ambiguous, true)
  assert.equal(world.ingests.length, 1); assert.equal(a.fixed.length, 1); assert.equal(a.fixed[0].already_had_it, undefined, 'the calendar imported it, so it WAS behind')
  reset({ ghl: ['old', 'new'], cal: ['new'], sameSize: true, ingestImported: 0 }); resetArcSaleMemoryForTests()
  const b = await run({ fix: true })
  assert.equal(world.ingests.length, 1); assert.equal(b.fixed[0].already_had_it, true)
  // and in dry mode the ambiguity is listed, nothing sent
  reset({ ghl: ['old', 'new'], cal: ['new'], sameSize: true }); resetArcSaleMemoryForTests()
  const c = await run({ fix: true, dry: true })
  assert.equal(world.ingests.length, 0); assert.equal(c.would_fix.length, 1); assert.match(c.would_fix[0].reason, /older revision has the same size/)
})

test('two revisions share a byte size on the GHL side: the count is complete but nothing proves the newest is attached → skipped and flagged, never passed', async () => {
  reset({ ghl: ['new', 'new'], cal: ['new'], sameSize: true }); resetArcSaleMemoryForTests()   // two GHL files of the shared size, neither named for a proposal
  const audit = await run({ fix: true })
  assert.equal(world.uploads.length, 0, 'nothing rebuilt on a guess')
  const sk = audit.skipped_jobs.find(s => s.target === 'ghl'); assert.ok(sk, JSON.stringify(audit)); assert.match(sk.reason, /could not verify the newest contract is attached/)
  // a hosted file named for the newest proposal proves it, with the same sizes
  reset({ ghl: ['new', 'new'], cal: ['new'], sameSize: true }); resetArcSaleMemoryForTests()
  world.opp.customFields.find(c => c.id === PDF_FIELD).fieldValueFiles[1].meta.name = 'Fixture Calendar - contract 1002.pdf'
  const ok = await run({ fix: true })
  assert.ok(!ok.skipped_jobs.some(s => s.target === 'ghl'), JSON.stringify(ok.skipped_jobs)); assert.equal(world.uploads.length, 0)
  // (the calendar side of this same-size job is ambiguous too and is settled by its own push — see the test above)
})

test('the change-order push records the ledger too, so a job fixed through GHL is not re-pushed the next night', async () => {
  reset({ ghl: ['old'], cal: ['reencoded'] }); resetArcSaleMemoryForTests()
  await run({ fix: true })
  assert.equal(world.settings.get('arcsite_calendar_contract_ledger')[OPP].source, 'change_order')
  reset({ ghl: ['old', 'new'], cal: ['reencoded'], keepSettings: true }); resetArcSaleMemoryForTests()
  const next = await run({ fix: true })
  assert.equal(world.ingests.length, 0); assert.equal(next.calendar.by_ledger, 1)
})

test('"nothing imported" from a GHL-sourced push does not confirm a job the sizes say is behind: the PDF is pushed again from ArcSite (calendar dedupe-key collision, Nov 20)', async () => {
  // Calendar still holds the old file; its dedupe wrongly answers "already have it" for GHL's copy, then imports ArcSite's.
  reset({ ghl: ['old', 'new'], cal: ['old'] }); resetArcSaleMemoryForTests()
  world.ingestImported = 0
  const orig = globalThis.fetch
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).endsWith('/api/change-orders/ingest')) { const b = JSON.parse(opts.body); world.ingestImported = b.contracts[0].url.startsWith('https://cdn.example/') ? 1 : 0 }
    return orig(url, opts)
  }
  try {
    const audit = await run({ fix: true })
    assert.equal(world.ingests.length, 2, JSON.stringify(audit))
    assert.equal(world.ingests[0].contracts[0].url, 'https://ghl.example/new-1.pdf')
    assert.equal(world.ingests[1].contracts[0].url, 'https://cdn.example/new.pdf'); assert.equal(world.ingests[1].contracts[0].meta.name, 'Fixture Calendar - contract 1002.pdf')
    assert.equal(audit.fixed.length, 1); assert.equal(audit.fixed[0].source, 'arcsite'); assert.equal(audit.fixed[0].retried, true); assert.equal(audit.fixed[0].already_had_it, undefined)
    assert.equal(world.settings.get('arcsite_calendar_contract_ledger')[OPP].source, 'arcsite')
  } finally { globalThis.fetch = orig }
  // a second "nothing imported", now from ArcSite, is the real confirmation
  reset({ ghl: ['old', 'new'], cal: ['reencoded'], ingestImported: 0 }); resetArcSaleMemoryForTests()
  const audit = await run({ fix: true })
  assert.equal(world.ingests.length, 2); assert.equal(audit.fixed[0].already_had_it, true); assert.match(audit.fixed[0].reason, /from GHL and from ArcSite/)
})

test('GHL has the right COUNT but not the newest PDF: the change order rebuilds the files (not "kept"), and "fixed" is only said after the read-back proves it', async () => {
  reset({ ghl: ['old', 'old'], cal: ['new'] }); resetArcSaleMemoryForTests()   // two files, neither the newest
  const audit = await run({ fix: true })
  assert.equal(audit.gaps.length, 1); assert.match(audit.gaps[0].reason, /newest signed PDF .* is not among them/)
  assert.equal(audit.fixed.length, 1, JSON.stringify(audit)); assert.equal(audit.fixed[0].pdf, 'rebuilt 2'); assert.equal(audit.fixed[0].verified_after, true)
  assert.equal(world.uploads.length, 2)
  // dry mode says what it would do
  reset({ ghl: ['old', 'old'], cal: ['new'] }); resetArcSaleMemoryForTests()
  const d = await run({ fix: true, dry: true })
  assert.equal(d.would_fix.length, 1); assert.equal(world.uploads.length, 0)
})

test('a rebuild GHL silently ignores is reported as FAILED, never as fixed', async () => {
  reset({ ghl: ['old', 'old'], cal: ['new'] }); resetArcSaleMemoryForTests()
  const orig = globalThis.fetch
  globalThis.fetch = async (url, opts = {}) => {
    const parsed = new URL(String(url))
    if ((opts.method || 'GET').toUpperCase() === 'PUT' && parsed.pathname === `/opportunities/${OPP}`) { world.oppPuts.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ opportunity: world.opp }), { status: 200, headers: { 'content-type': 'application/json' } }) }   // accepted, nothing changes
    return orig(url, opts)
  }
  try {
    const audit = await run({ fix: true })
    assert.equal(audit.fixed.length, 0); assert.equal(audit.failed.length, 1, JSON.stringify(audit))
    assert.match(audit.failed[0].error, /attached files unchanged after the rebuild \(rebuilt 2\)/)
  } finally { globalThis.fetch = orig }
})

test('Closed means won: a Closed-stage opp alone on its Project ID is audited; beside a live one it is the handed-off copy, not a duplicate', async () => {
  const CLOSED = '72a74bdf-a2ab-4412-89b0-52142a1e8c0b'   // the estimator pipeline's Closed stage
  const twin = stageId => ({ id: 'opp-twin', name: 'Fixture Calendar (inside copy)', contactId: 'contact-cal', status: 'open', pipelineId: 'jfhZWICxnmISGllte9Rv', pipelineStageId: stageId, monetaryValue: 2000,
    customFields: [{ id: PROJECT_FIELD, fieldValueString: PID }, { id: INSTALL_FIELD, fieldValueString: future }, { id: PDF_FIELD, fieldValueFiles: [] }] })
  // 1. the only opp, in Closed, with NO contract on it: audited, both signed PDFs attached from ArcSite
  reset({ ghl: [], cal: ['new'] }); resetArcSaleMemoryForTests()
  world.opp.pipelineStageId = CLOSED
  const alone = await run({ fix: true })
  assert.equal(alone.fixed.length, 1, JSON.stringify(alone)); assert.equal(alone.fixed[0].pdf, 'rebuilt 2'); assert.equal(alone.fixed[0].verified_after, true)
  assert.equal(world.uploads.length, 2); assert.equal(alone.checked, 1); assert.equal(alone.skipped_jobs.length, 0)
  // 2. a Closed-stage copy beside the live opp: the live one is audited, the copy is noted, nothing is called a duplicate
  reset({ ghl: ['old', 'new'], cal: ['old'] }); resetArcSaleMemoryForTests()
  world.extraOpps = [twin(CLOSED)]
  const pair = await run({ fix: true })
  assert.equal(pair.fixed.length, 1); assert.equal(pair.skipped_jobs.length, 0, JSON.stringify(pair.skipped_jobs))
  assert.deepEqual(pair.closed_copies.map(c => [c.opportunity_id, c.live_opportunity]), [['opp-twin', 'Fixture Calendar']])
  // 3. two live opps: still a duplicate, the other one named
  reset({ ghl: ['old', 'new'], cal: ['old'] }); resetArcSaleMemoryForTests()
  world.extraOpps = [twin('some-open-stage')]
  const dup = await run({ fix: true })
  assert.equal(dup.fixed.length, 0); assert.equal(dup.skipped_jobs.length, 2)
  assert.match(dup.skipped_jobs[0].reason, /more than one open opportunity carries this Project ID \(also /)
})

test('ArcSite rate-limited (429): the job is counted as NOT checked and the run says so — never "nothing signed, ok"', async () => {
  reset({ ghl: ['old'], cal: ['old'], arcsiteStatus: 429 }); resetArcSaleMemoryForTests()
  const audit = await run({ fix: true })
  assert.equal(audit.checked, 0); assert.equal(audit.ok, 0); assert.equal(audit.arcsite_errors, 1)
  assert.match(audit.skipped, /ArcSite did not answer for 1 of 1 jobs \(ArcSite 429/); assert.equal(world.ingests.length, 0); assert.equal(world.uploads.length, 0)
})

test('the contact is checked on its own: a stale Job Price / New Price is set to the consensus value and the newest contract is appended (Jonathan Kim)', async () => {
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests()
  world.contact.customFields = [{ id: 'gz5Xoix8Sd37hUbrvQuQ', value: 6200 }, { id: 'BxSAZYBEeT5iBI67CfVW', value: { 'doc-old': { meta: { name: 'old.pdf', size: OLD_SIZE }, url: 'https://ghl.example/documents/doc-old' } } }]
  const audit = await run({ fix: true })
  const fx = audit.fixed.find(f => f.target === 'contact'); assert.ok(fx, JSON.stringify(audit))
  assert.match(fx.reason, /contact Job Price \$6,200\.00 \/ New Price empty vs \$2,000\.00; contact holds 1 contract .* but not the newest signed PDF/)
  assert.equal(fx.contract, 'appended'); assert.equal(audit.contact.price_behind, 1); assert.equal(audit.contact.contract_behind, 1)
  const put = world.contactPuts.find(p => p.customFields.some(f => f.id === 'gz5Xoix8Sd37hUbrvQuQ'))
  const by = Object.fromEntries(put.customFields.map(f => [f.id, f.field_value]))
  assert.equal(by.gz5Xoix8Sd37hUbrvQuQ, 2000); assert.equal(by.X6s8Kc6QVEVyzSIISktA, 2000)
  assert.deepEqual(by.BxSAZYBEeT5iBI67CfVW, ['https://ghl.example/documents/doc-old', 'https://ghl.example/new-1.pdf'])
  assert.equal(world.oppPuts.length, 0, 'the opp itself was already right')
  // in step → nothing written; dry → planned only; held → skipped
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests()
  const ok = await run({ fix: true }); assert.equal(ok.contact.current, 1); assert.equal(world.contactPuts.length, 0)
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests()
  world.contact.customFields = [{ id: 'gz5Xoix8Sd37hUbrvQuQ', value: 6200 }]
  const d = await run({ fix: true, dry: true }); assert.equal(d.would_fix.filter(w => w.target === 'contact').length, 1); assert.equal(world.contactPuts.length, 0)
  process.env.ARC_VALUE_HOLD_OPPS = OPP
  try { reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests(); world.contact.customFields = [{ id: 'gz5Xoix8Sd37hUbrvQuQ', value: 6200 }]; const h = await run({ fix: true }); assert.ok(h.skipped_jobs.some(x => x.target === 'contact' && /manual hold/.test(x.reason))); assert.equal(world.contactPuts.length, 0) }
  finally { delete process.env.ARC_VALUE_HOLD_OPPS }
})

test('a change order through the audit appends the newest contract to the CONTACT too', async () => {
  reset({ ghl: ['old'], cal: ['new'] }); resetArcSaleMemoryForTests()
  world.contact.customFields = [{ id: 'gz5Xoix8Sd37hUbrvQuQ', value: 2000 }, { id: 'X6s8Kc6QVEVyzSIISktA', value: 2000 }, { id: 'BxSAZYBEeT5iBI67CfVW', value: { 'doc-old': { meta: { name: 'old.pdf', size: OLD_SIZE }, url: 'https://ghl.example/documents/doc-old' } } }]
  const audit = await run({ fix: true })
  assert.equal(audit.fixed[0].pdf, 'rebuilt 2')
  const put = world.contactPuts.find(p => p.customFields.some(f => f.id === 'BxSAZYBEeT5iBI67CfVW'))
  assert.ok(put, JSON.stringify(world.contactPuts))
  assert.deepEqual(put.customFields.find(f => f.id === 'BxSAZYBEeT5iBI67CfVW').field_value, ['https://ghl.example/documents/doc-old', 'https://ghl.example/hosted-2.pdf'])
})

test('a Lost opportunity is never revived: the audit does not audit it and the change-order path refuses it', async () => {
  // 1. the audit: a lost opp with a stale value and missing files is not a candidate at all
  reset({ ghl: ['old'], cal: ['old'], value: 6200 }); resetArcSaleMemoryForTests()
  world.opp.status = 'lost'
  const audit = await run({ fix: true })
  assert.equal(audit.candidates, 0); assert.equal(audit.fixed.length, 0); assert.equal(world.oppPuts.length, 0); assert.equal(world.uploads.length, 0); assert.equal(world.ingests.length, 0)
  // 2. the change-order path itself (webhook / manual / sweep callers): refused with the reason, nothing written
  const { arcsiteToGhl } = await import('../server.js')
  void arcsiteToGhl
  const mod = await import('../server.js')
  const r = await mod.arcApplyChangeOrderForTests({ projectId: PID, opp: world.opp, customer: { name: 'Fixture Calendar' }, signed: [{ proposal_id: 'p2', total: 2000, pdf_url: 'https://cdn.example/new.pdf' }], newTotal: 13896.13 })
  assert.equal(r.ok, false); assert.equal(r.lost, true); assert.match(r.error, /lost — a dead deal is never changed/)
  assert.equal(world.oppPuts.length, 0); assert.equal(world.ingests.length, 0)
})
