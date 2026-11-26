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
delete process.env.ARC_AUDIT_SKIP_OPPS; delete process.env.ARC_AUDIT_SKIP_CONTACTS

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
      customFields: [{ id: PROJECT_FIELD, fieldValueString: PID }, { id: INSTALL_FIELD, fieldValueString: future }, { id: 'dScpoYWZbeghBsAMBR4o', fieldValueNumber: value }, { id: 'rI6UeVz5CTQcXsssBqIm', fieldValueNumber: 1000 }, { id: 'Vi6FxBjJ1iVcSPEH8tFE', fieldValueNumber: Number(sheetTotal) - 1000 }, { id: 'P5PdaF8CnR4ru4Xru3UA', fieldValueNumber: 200 }, { id: PDF_FIELD, fieldValueFiles: ghl.map(ghlFile) }] },
    proposals: [
      { proposal_id: 'p2', project_id: PID, status: 'APPROVED', total: 2000, pdf_url: 'https://cdn.example/new.pdf', proposal_options: [], document_number: '1002' },
      { proposal_id: 'p1', project_id: PID, status: 'APPROVED', total: 1500, pdf_url: 'https://cdn.example/old.pdf', proposal_options: [], document_number: '1001' },
    ],
    calendarJobs: cal === null ? [] : [{ jobNumber: 'J-77', ghlOpportunityId: OPP, canceledAt: null, value, contracts: cal.map(calFile) }],
    sheetTotal, ingests: [], uploads: [], oppPuts: [], contactPuts: [], settings, deals: [{ id: 'deal-1', project_id: PID }], dealPosts: [], dealPatches: [], installRows: [],
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
    { range: 'Jobs!A1:G2', values: [['Project ID', 'Baseline Cost', 'Approved Total', 'Pre-Tax Sale', 'Commission', 'Proposal ID', 'Customer'], [PID, '1000', world.sheetTotal, world.sheetTotal, '200', 'p2', world.sheetCustomer || 'Fixture Calendar']] },
    { range: 'Schedule!A1:E9', values: [['Booked At', 'Install Date', 'Customer', 'Status', 'Proposal ID'], ...((world.scheduleRows && world.scheduleRows.length) ? world.scheduleRows : [['', '', '', '', '']])] },   // parseTab needs a data row to keep the headers
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
    if (parsed.pathname === '/api/install-dates/ingest' && method === 'POST') { world.installRows.push(body); return send(200, { results: (body.rows || []).map(r => ({ ghlOpportunityId: r.ghlOpportunityId, outcome: body.dry ? 'dry' : 'moved', after: r.installDate })) }) }
    if (parsed.pathname === '/api/change-orders/ingest' && method === 'POST') { world.ingests.push(body); return send(200, { ok: true, matched: true, job: { jobNumber: 'J-77', filesImported: world.ingestImported, valueChanged: false } }) }
    return send(404, {})
  }
  if (parsed.hostname === 'api.arcsite.com') {
    if (world.arcsiteStatus !== 200) return send(world.arcsiteStatus, { error: 'Too Many Requests' })
    if (parsed.pathname === '/v1/proposals') return send(200, parsed.searchParams.get('project_id') === PID ? world.proposals : [])
    if (parsed.pathname.startsWith('/v1/proposals/')) { const id = parsed.pathname.split('/').pop(); world.proposalGets = (world.proposalGets || []).concat(id); const p = [...world.proposals, ...(world.hiddenProposals || [])].find(x => String(x.proposal_id) === id); return p ? send(200, p) : send(404, {}) }
    if (parsed.pathname.startsWith('/v1/projects/')) return send(200, { name: 'Fixture Calendar', created_at: world.arcCreated || '2026-10-01T00:00:00.000000Z', customer: { name: 'Fixture Calendar', phone: '5550100100', address: { street: '1 Example St', city: 'Phoenix', state: 'AZ', zip_code: '85001' } } })
    return send(404, {})
  }
  if (parsed.origin === SB) {
    if (parsed.pathname === '/rest/v1/app_settings' && method === 'POST') { if (body && body.key) world.settings.set(body.key, body.value); return send(201, {}) }
    if (parsed.pathname === '/rest/v1/app_settings') { const k = decodeURIComponent(parsed.searchParams.get('key') || '').replace(/^eq\./, ''); const v = world.settings.get(k); return send(200, v === undefined ? [] : [{ key: k, value: v }]) }
    if (parsed.pathname === '/rest/v1/deals' && method === 'PATCH') { const id = decodeURIComponent(parsed.searchParams.get('id') || '').replace(/^eq\./, ''); world.dealPatches.push({ id, ...body }); const d = world.deals.find(x => x.id === id); if (d) Object.assign(d, body); return send(200, [d]) }
    if (parsed.pathname === '/rest/v1/deals' && parsed.searchParams.get('id')) { const id = decodeURIComponent(parsed.searchParams.get('id') || '').replace(/^eq\./, ''); return send(200, world.deals.filter(x => x.id === id)) }
    if (parsed.pathname === '/rest/v1/deals' && method === 'POST') { world.dealPosts.push(body); world.deals.push({ id: 'deal-' + (world.deals.length + 1), ...body }); return send(201, {}) }
    if (parsed.pathname === '/rest/v1/deals') {
      const q = parsed.searchParams.get('project_id') || ''
      if (q.startsWith('like.')) { const re = new RegExp('^' + q.slice(5).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'); return send(200, world.deals.filter(d => re.test(String(d.project_id || '')))) }
      const pid = q.replace(/^eq\./, ''); return send(200, world.deals.filter(d => !pid || d.project_id === pid))
    }
    if (parsed.pathname === '/rest/v1/profiles') return send(200, [{ id: 'prof-1', name: 'Fixture Rep', email: 'rep@example.com' }])
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
  if (method === 'PUT' && /^\/opportunities\/[^/]+$/.test(parsed.pathname)) {
    const id = parsed.pathname.split('/').pop(); const extra = (world.extraOpps || []).find(o => o.id === id)
    if (extra) { world.oppPuts.push({ id, ...body }); for (const f of (body && body.customFields) || []) { const cf = extra.customFields.find(c => c.id === f.id); if (cf) cf.fieldValueString = f.field_value; else extra.customFields.push({ id: f.id, fieldValueString: f.field_value }) } if (body && body.status) extra.status = body.status; return send(200, { opportunity: extra }) }
  }
  if (method === 'GET' && /^\/opportunities\/[^/]+$/.test(parsed.pathname)) { const extra = (world.extraOpps || []).find(o => o.id === parsed.pathname.split('/').pop()); if (extra) return send(200, { opportunity: extra }) }
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

test('a manual hold freezes nothing: value, contact prices, contracts and fields all flow; the hold is only reported', async () => {
  reset({ ghl: ['old'], cal: ['old'], value: 1500 }); resetArcSaleMemoryForTests()   // value $1,500 vs signed $2,000, files behind
  world.contact.customFields = [{ id: 'gz5Xoix8Sd37hUbrvQuQ', value: 1500 }, { id: 'X6s8Kc6QVEVyzSIISktA', value: 1500 }]
  process.env.ARC_VALUE_HOLD_OPPS = OPP
  try {
    const audit = await run({ fix: true })
    assert.equal(audit.held.length, 1, 'still listed as on hold')
    const co = audit.fixed.find(f => f.action === 'change_order'); assert.ok(co, JSON.stringify(audit)); assert.equal(co.pdf, 'rebuilt 2')
    assert.equal(world.uploads.length, 2)
    assert.ok(world.oppPuts.some(p => p.monetaryValue === 2000), 'value written despite the hold: ' + JSON.stringify(world.oppPuts))
    assert.ok(world.contactPuts.some(p => p.customFields.some(f => f.id === 'gz5Xoix8Sd37hUbrvQuQ' && Number(f.value ?? f.field_value) === 2000)), 'contact prices written')
    assert.ok(!audit.skipped_jobs.some(s => /manual hold/.test(s.reason)), JSON.stringify(audit.skipped_jobs))
    assert.equal(world.ingests.length, 1); assert.equal(world.ingests[0].newTotal, 2000, 'calendar gets the contract and the value')
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
  assert.equal(world.uploads.length, 2); assert.equal(alone.checked, 1); assert.equal(alone.skipped_jobs.length, 0, JSON.stringify(alone.skipped_jobs))
  // 2. a Closed-stage copy beside the live opp: the live one is audited, the copy is noted, nothing is called a duplicate
  reset({ ghl: ['old', 'new'], cal: ['old'] }); resetArcSaleMemoryForTests()
  world.extraOpps = [twin(CLOSED)]
  const pair = await run({ fix: true })
  assert.equal(pair.fixed.length, 1); assert.equal(pair.skipped_jobs.length, 0, JSON.stringify(pair.skipped_jobs))
  assert.deepEqual(pair.closed_copies.map(c => [c.opportunity_id, c.live_opportunity]), [['opp-twin', 'Fixture Calendar']])
  // 3. two live opps: the one the PM calendar job points to is live and is fixed; the other is reported as a copy to close, nothing written to it
  reset({ ghl: ['old', 'new'], cal: ['old'] }); resetArcSaleMemoryForTests()
  world.extraOpps = [twin('some-open-stage')]
  const dup = await run({ fix: true })
  assert.equal(dup.fixed.length, 1); assert.equal(dup.fixed[0].opportunity_id, OPP); assert.equal(dup.skipped_jobs.length, 0, JSON.stringify(dup.skipped_jobs))
  assert.equal(dup.duplicate_copies.length, 1); assert.equal(dup.duplicate_copies[0].opportunity_id, 'opp-twin'); assert.match(dup.duplicate_copies[0].reason, /calendar job points to it/)
  assert.ok(dup.fixed[0].shared_project_id, 'the live opp carries a note about the copy')
  // 4. two live opps, neither on the calendar, same pipeline: unresolved — nothing written, both reported
  reset({ ghl: ['old', 'new'], cal: null }); resetArcSaleMemoryForTests()
  world.extraOpps = [{ ...twin('some-open-stage'), pipelineId: world.opp.pipelineId }]
  const un = await run({ fix: true })
  assert.equal(un.fixed.length, 0); assert.equal(un.skipped_jobs.length, 2); assert.match(un.skipped_jobs[0].reason, /left for review/)
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
  const fx = audit.fixed.find(f => f.action === 'sync_fields'); assert.ok(fx, JSON.stringify(audit))
  assert.match(fx.reason, /contact Job\/New Price 6200 \/ empty → 2000/)
  // the contract on the contact is REPORTED, never written (GHL stores an API-written URL as a bare string)
  assert.equal(audit.contact.contract.behind, 1)
  const put = world.contactPuts.find(p => p.customFields.some(f => f.id === 'gz5Xoix8Sd37hUbrvQuQ'))
  const by = Object.fromEntries(put.customFields.map(f => [f.id, f.field_value]))
  assert.equal(by.gz5Xoix8Sd37hUbrvQuQ, 2000); assert.equal(by.X6s8Kc6QVEVyzSIISktA, 2000)
  assert.equal(by.BxSAZYBEeT5iBI67CfVW, undefined, 'contract field never written')
  assert.equal(world.oppPuts.length, 0, 'the opp itself was already right')
  // in step → nothing written; dry → planned only; held → written all the same
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests()
  const ok = await run({ fix: true }); assert.equal(world.contactPuts.length, 0); assert.equal(ok.fixed.length, 0)
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests()
  world.contact.customFields = [{ id: 'gz5Xoix8Sd37hUbrvQuQ', value: 6200 }]
  const d = await run({ fix: true, dry: true }); assert.equal(d.would_fix.filter(w => w.target === 'fields').length, 1); assert.equal(world.contactPuts.length, 0)
  process.env.ARC_VALUE_HOLD_OPPS = OPP
  try { reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests(); world.contact.customFields = [{ id: 'gz5Xoix8Sd37hUbrvQuQ', value: 6200 }]; const h = await run({ fix: true }); assert.ok(!h.skipped_jobs.some(x => /manual hold/.test(x.reason))); assert.equal(world.contactPuts.length, 1, 'a hold freezes nothing: the contact prices are written') }
  finally { delete process.env.ARC_VALUE_HOLD_OPPS }
})

test('a change order never writes the CONTACT contract field (GHL stores an API-written URL as a bare string; the Nov 21 run turned documents into strings)', async () => {
  reset({ ghl: ['old'], cal: ['new'] }); resetArcSaleMemoryForTests()
  world.contact.customFields = [{ id: 'gz5Xoix8Sd37hUbrvQuQ', value: 2000 }, { id: 'X6s8Kc6QVEVyzSIISktA', value: 2000 }, { id: 'BxSAZYBEeT5iBI67CfVW', value: { 'doc-old': { meta: { name: 'old.pdf', size: OLD_SIZE }, url: 'https://ghl.example/documents/doc-old' } } }]
  const audit = await run({ fix: true })
  assert.equal(audit.fixed[0].pdf, 'rebuilt 2')
  assert.ok(!world.contactPuts.some(p => p.customFields.some(f => f.id === 'BxSAZYBEeT5iBI67CfVW')), JSON.stringify(world.contactPuts))
})

test('a contact whose contract field holds bare URL strings (as GHL stores API writes) is unverified — never "no contract", never pushed again', async () => {
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests()
  world.contact.customFields = [{ id: 'gz5Xoix8Sd37hUbrvQuQ', value: 2000 }, { id: 'X6s8Kc6QVEVyzSIISktA', value: 2000 }, { id: 'BxSAZYBEeT5iBI67CfVW', value: ['https://ghl.example/documents/doc-old', 'https://ghl.example/new-1.pdf'] }]
  const audit = await run({ fix: true })
  assert.equal(audit.contact.contract.unverified, 1); assert.equal(audit.contact.contract.no_contract, 0)
  assert.equal(audit.fixed.length, 0); assert.equal(world.contactPuts.length, 0); assert.equal(audit.ok, 1)
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

test('Schedule tab cancelled → status abandoned and the Install Date comes off the opp and the contact; rebooked → open + Deal Reviewed and the dates flow again', async () => {
  reset({ ghl: ['old', 'new'], cal: ['old'] }); resetArcSaleMemoryForTests()
  world.contact.customFields = [{ id: 'gz5Xoix8Sd37hUbrvQuQ', value: 6200 }]
  world.scheduleRows = [['2026-11-10', '2026-11-27', 'Fixture Calendar', 'CANCELLED', 'p2']]
  world.contact.customFields.push({ id: 'IMYajaM4Jv4eOG65exQZ', value: future })
  const audit = await run({ fix: true })
  const c = audit.fixed.find(f => f.action === 'cancel'); assert.ok(c, JSON.stringify(audit)); assert.deepEqual(c.after, { status: 'abandoned' }); assert.deepEqual(c.before, { status: 'open', stage: undefined, stage_name: 'none' })
  assert.ok(world.oppPuts.some(p => p.status === 'abandoned')); assert.equal(world.ingests.length, 0); assert.equal(world.uploads.length, 0)
  assert.equal(audit.status_changes.length, 1)
  // the Install Date comes off the opp and the contact until the job is rebooked; nothing else is written to the contact
  const ci = audit.fixed.find(f => f.action === 'clear_install_date'); assert.ok(ci, JSON.stringify(audit.fixed)); assert.deepEqual(ci.before, { oppInstall: future, contactInstall: future })
  assert.ok(world.oppPuts.some(p => (p.customFields || []).some(f => f.id === INSTALL_FIELD && f.field_value === '')), JSON.stringify(world.oppPuts))
  assert.deepEqual(world.contactPuts.map(p => p.customFields.map(f => [f.id, f.value ?? f.field_value])), [[['IMYajaM4Jv4eOG65exQZ', '']]])
  assert.equal(audit.cancelled_bookings[0].install_date, 'removed from opp and contact')
  // dry mode plans it
  reset({ ghl: ['old', 'new'], cal: ['old'] }); resetArcSaleMemoryForTests(); world.scheduleRows = [['2026-11-10', '2026-11-27', 'Fixture Calendar', 'CANCELLED', 'p2']]
  const d = await run({ fix: true, dry: true }); assert.ok(d.would_fix.some(w => w.action === 'cancel')); assert.ok(d.would_fix.some(w => w.action === 'clear_install_date')); assert.equal(world.oppPuts.length, 0); assert.equal(world.contactPuts.length, 0)
  // rebooked: a live row after the cancelled one, opp abandoned → open + Closed, then fields and contracts
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests()
  world.opp.status = 'abandoned'; world.opp.pipelineId = 'EWGmXwXP63Da5eBMNiDU'   // Outside Sales: the real pipeline, so Deal Reviewed is known
  world.scheduleRows = [['2026-11-10', '2026-11-27', 'Fixture Calendar', 'CANCELLED', 'p2'], ['2026-11-15', '2026-12-05', 'Fixture Calendar', 'BOOKED', 'p2']]
  const r = await run({ fix: true })
  // rebooked → open + Deal Reviewed in its own pipeline, always
  const rb = r.fixed.find(f => f.action === 'rebook'); assert.ok(rb, JSON.stringify(r)); assert.deepEqual(rb.after, { status: 'open', pipelineStageId: '72691282-63f0-451b-9e38-a244dc9d3678' })
  const fs = r.fixed.find(f => f.action === 'sync_fields'); assert.ok(fs, JSON.stringify(r.fixed)); assert.equal(fs.after.opp.install, '2026-12-05'); assert.equal(fs.after.contact.install, '2026-12-05')
  assert.equal(world.installRows.length, 1); assert.equal(world.installRows[0].rows[0].installDate, '2026-12-05')
})

test('a one-day cap override applies on its day only and falls back to the normal cap by itself', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const mod = await import('../server.js')
  // the constants are read at import; this harness imported with no override, so the day-cap is the base cap
  assert.equal(mod.arcAuditCapForDayForTests(today), 60)
  assert.equal(mod.arcAuditCapForDayForTests('2000-01-01'), 60)
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests()
  const audit = await run({ fix: true, maxFix: 7 })
  assert.equal(audit.max_fix, 7)
})

test('rebooking always goes to Deal Reviewed in the opp\'s own pipeline — never the stage it had before (Closed / Pending Payment fire customer workflows); a pipeline without Deal Reviewed is reported, nothing written', async () => {
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests()
  world.opp.pipelineId = 'EWGmXwXP63Da5eBMNiDU'; world.opp.pipelineStageId = '7f686159-9e37-4ffb-9311-3f10106cf250'   // Outside Sales / Closed
  world.scheduleRows = [['2026-11-10', '2026-11-27', 'Fixture Calendar', 'CANCELLED', 'p2']]
  const c = await run({ fix: true }); const cx = c.fixed.find(f => f.action === 'cancel'); assert.ok(cx); assert.equal(cx.before.stage_name, 'Closed')
  assert.equal(world.settings.get('arcsite_status_ledger')[OPP].stage_before, '7f686159-9e37-4ffb-9311-3f10106cf250', 'the ledger still remembers, for the record')
  // rebooked from Closed: Outside Sales → Deal Reviewed, not back to Closed
  reset({ ghl: ['old', 'new'], cal: ['new'], keepSettings: true }); resetArcSaleMemoryForTests()
  world.opp.status = 'abandoned'; world.opp.pipelineId = 'EWGmXwXP63Da5eBMNiDU'; world.opp.pipelineStageId = '7f686159-9e37-4ffb-9311-3f10106cf250'
  world.scheduleRows = [['2026-11-10', '2026-11-27', 'Fixture Calendar', 'CANCELLED', 'p2'], ['2026-11-15', '2026-12-05', 'Fixture Calendar', 'BOOKED', 'p2']]
  const r = await run({ fix: true })
  const rb = r.fixed.find(f => f.action === 'rebook'); assert.ok(rb, JSON.stringify(r.fixed))
  assert.deepEqual(rb.after, { status: 'open', pipelineStageId: '72691282-63f0-451b-9e38-a244dc9d3678' }); assert.equal(rb.before.stage_name, 'Closed')
  const fs = r.fixed.find(f => f.action === 'sync_fields'); assert.ok(fs); assert.equal(fs.after.opp.install, '2026-12-05', 'Install Date refilled from the calendar / Schedule tab')
  // Inside Sales → its own Deal Reviewed
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests()
  world.opp.status = 'abandoned'; world.opp.pipelineId = 'jfhZWICxnmISGllte9Rv'; world.opp.pipelineStageId = '6852e765-eb65-4a0f-b22e-5c9a63bc803b'   // Pending Payment
  world.scheduleRows = [['2026-11-10', '2026-11-27', 'Fixture Calendar', 'CANCELLED', 'p2'], ['2026-11-15', '2026-12-05', 'Fixture Calendar', 'BOOKED', 'p2']]
  const i = await run({ fix: true })
  assert.deepEqual(i.fixed.find(f => f.action === 'rebook').after, { status: 'open', pipelineStageId: 'c3f66652-edf5-49bf-8c24-1c10a2860da7' })
  // a pipeline this audit knows no Deal Reviewed stage for: reported, nothing written
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests()
  world.opp.status = 'abandoned'; world.opp.pipelineId = 'pipe-unknown'; world.opp.pipelineStageId = 'x'
  world.scheduleRows = [['2026-11-10', '2026-11-27', 'Fixture Calendar', 'CANCELLED', 'p2'], ['2026-11-15', '2026-12-05', 'Fixture Calendar', 'BOOKED', 'p2']]
  const u = await run({ fix: true })
  assert.ok(!u.fixed.some(f => f.action === 'rebook')); assert.equal(world.oppPuts.length, 0)
  assert.ok(u.skipped_jobs.some(s => /has no Deal Reviewed stage — nothing written/.test(s.reason)), JSON.stringify(u.skipped_jobs))
})

test('identity pass, any date: a $0 opp whose Project ID belongs to another customer loses the Project ID and its carried-over prices (Courtney Spillers)', async () => {
  reset({ ghl: [], cal: null, value: 0 }); resetArcSaleMemoryForTests()
  world.opp.name = 'Courtney Spillers'; world.opp.createdAt = '2026-08-13T00:00:00.000Z'; world.opp.customFields = world.opp.customFields.filter(c => c.id !== INSTALL_FIELD)
  world.contact.customFields = [{ id: 'gz5Xoix8Sd37hUbrvQuQ', value: 9164.27 }]
  world.sheetCustomer = 'Aaron Spillers'
  const d = await run({ fix: true, dry: true })
  const w = d.would_fix.find(x => x.action === 'clear_project_id'); assert.ok(w, JSON.stringify(d.would_fix)); assert.match(w.reason, /is not this customer/); assert.match(w.reason, /cleared/)
  assert.equal(world.oppPuts.length, 0)
  const live = await run({ fix: true })
  assert.ok(live.fixed.some(x => x.action === 'clear_project_id'))
  assert.ok(world.oppPuts.some(p => p.customFields && p.customFields.some(f => f.id === PROJECT_FIELD && f.field_value === '')))
  assert.ok(world.contactPuts.some(p => p.customFields.some(f => f.id === 'gz5Xoix8Sd37hUbrvQuQ' && f.field_value === '')))
})

test('identity pass: a $0 opp carrying the Project ID while the same contact has a won deal without one → the Project ID moves to the won deal (Cassandra Bojarski)', async () => {
  reset({ ghl: [], cal: null, value: 0 }); resetArcSaleMemoryForTests()
  world.opp.createdAt = '2026-05-15T00:00:00.000Z'; world.opp.customFields = world.opp.customFields.filter(c => c.id !== INSTALL_FIELD)
  world.extraOpps = [{ id: 'opp-won', name: 'Fixture Calendar', contactId: 'contact-cal', status: 'won', pipelineId: 'jfhZWICxnmISGllte9Rv', pipelineStageId: 'x', monetaryValue: 7281, customFields: [] }]
  const live = await run({ fix: true })
  const mv = live.fixed.find(x => x.action === 'move_project_id'); assert.ok(mv, JSON.stringify(live))
  assert.equal(mv.after.to, 'opp-won'); assert.equal(mv.after.to_project_id, PID)
})

test('a $0 duplicate copy with no calendar job loses its Project ID (Todd Vietzen Turf Replacement); a copy with a value is only reported', async () => {
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests()
  world.extraOpps = [{ id: 'opp-repair', name: 'Fixture Calendar Turf Replacement', contactId: 'contact-cal', status: 'open', pipelineId: 'jfhZWICxnmISGllte9Rv', pipelineStageId: 'x', monetaryValue: 0, createdAt: '2026-10-05T00:00:00.000Z', customFields: [{ id: PROJECT_FIELD, fieldValueString: PID }, { id: INSTALL_FIELD, fieldValueString: future }] }]
  const r = await run({ fix: true })
  const cl = r.fixed.find(x => x.action === 'clear_project_id' && x.opportunity_id === 'opp-repair'); assert.ok(cl, JSON.stringify(r.fixed)); assert.match(cl.reason, /not a sale/)
  assert.equal(r.duplicate_copies.length, 1)
})

test('coverage: a duplicate copy\'s live twin is audited in its place even outside the date window; a calendar install date qualifies an opp; cancelled bookings count as checked', async () => {
  // 1. the Outside copy is in the window; the live Inside twin (calendar job) was created in September with no Install Date —
  //    Dhan Harnanan / Samer Darraj / Pamela Thompson. The twin is audited: its Install Date comes from the Schedule tab.
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests()
  world.extraOpps = [{ id: 'opp-twin', name: 'Fixture Calendar', contactId: 'contact-cal', status: 'open', pipelineId: 'jfhZWICxnmISGllte9Rv', pipelineStageId: 'some-open-stage', monetaryValue: 2000, createdAt: '2026-09-01T00:00:00.000Z',
    customFields: [{ id: PROJECT_FIELD, fieldValueString: PID }, { id: PDF_FIELD, fieldValueFiles: ['old', 'new'].map(ghlFile) }] }]
  world.calendarJobs[0].ghlOpportunityId = 'opp-twin'; world.calendarJobs[0].installDate = future
  world.scheduleRows = [['2026-11-10', future, 'Fixture Calendar', 'BOOKED', 'p2']]
  world.deals = []
  const a = await run({ fix: true, dry: true })
  assert.equal(a.candidates, 2, JSON.stringify(a)); assert.equal(a.checked, 1); assert.deepEqual(a.not_checked, [])
  assert.equal(a.duplicate_copies.length, 1); assert.equal(a.duplicate_copies[0].opportunity_id, OPP); assert.equal(a.duplicate_copies[0].live_opportunity_id, 'opp-twin'); assert.equal(a.duplicate_copies[0].live_listed, undefined)
  const sf = a.would_fix.find(w => w.opportunity_id === 'opp-twin' && w.action === 'sync_fields'); assert.ok(sf, JSON.stringify(a.would_fix))
  assert.equal(sf.after.opp.install, future); assert.match(sf.reason, /Install Date empty → .* \(Schedule tab\)/)
  assert.ok(!a.would_fix.some(w => w.opportunity_id === OPP && w.action === 'sync_fields'), 'nothing planned for the copy itself')
  // no commission-site deal: the live twin is an Inside Sales opp (deals are Outside Sales only) — listed, not created; never for the copy either
  assert.deepEqual(a.would_fix.filter(w => w.action === 'create_deal'), []); assert.deepEqual(a.deals_skipped.map(d => [d.opportunity_id, d.pipeline]), [['opp-twin', 'Inside Sales']])
  // 1b. the live twin does not qualify on its own (no Install Date, no calendar install date, created in September — Todd Vietzen's
  //     July job behind an October $0 copy): it is listed for review in the copy's place, nothing written, no deal, no hole
  delete world.calendarJobs[0].installDate
  const a2 = await run({ fix: true, dry: true })
  assert.equal(a2.candidates, 2); assert.equal(a2.checked, 0); assert.deepEqual(a2.not_checked, [])
  assert.equal(a2.duplicate_copies[0].live_listed, true)
  const rv = a2.skipped_jobs.find(s => s.opportunity_id === 'opp-twin'); assert.ok(rv, JSON.stringify(a2.skipped_jobs)); assert.match(rv.reason, /outside the audit window on its own/)
  assert.ok(!a2.would_fix.some(w => w.opportunity_id === 'opp-twin')); assert.ok(!a2.would_fix.some(w => w.action === 'create_deal'))
  // 2. an opp with no Install Date and an old created date qualifies through its calendar job's install date — and not without one
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests()
  world.opp.customFields = world.opp.customFields.filter(c => c.id !== INSTALL_FIELD); world.opp.createdAt = '2026-09-01T00:00:00.000Z'
  world.calendarJobs[0].installDate = future
  const b = await run({ fix: true, dry: true }); assert.equal(b.candidates, 1, JSON.stringify(b)); assert.equal(b.checked, 1)
  delete world.calendarJobs[0].installDate
  const c = await run({ fix: true, dry: true }); assert.equal(c.candidates, 0)
  // 3. a cancelled booking is a checked job, listed under its own heading
  reset({ ghl: ['old', 'new'], cal: ['old'] }); resetArcSaleMemoryForTests()
  world.scheduleRows = [['2026-11-10', '2026-11-27', 'Fixture Calendar', 'CANCELLED', 'p2']]
  world.deals = []
  const d = await run({ fix: true, dry: true })
  assert.equal(d.candidates, 1); assert.equal(d.checked, 1); assert.equal(d.ok, 1); assert.deepEqual(d.not_checked, [])
  assert.ok(!d.would_fix.some(w => w.action === 'create_deal'), 'a cancelled booking never gets a commission-site deal')
  assert.deepEqual(d.cancelled_bookings.map(x => [x.opportunity_id, x.outcome]), [[OPP, 'would move to abandoned']])
  world.opp.status = 'abandoned'
  const e = await run({ fix: true, dry: true })
  assert.equal(e.checked, 1); assert.equal(e.cancelled_bookings[0].outcome, 'already abandoned'); assert.deepEqual(e.would_fix.map(w => w.action), ['clear_install_date'], 'only the Install Date comes off')
})

test('a finished job never takes a later project\'s Project Manager from its reused calendar job (Jacob Bietsch, Laura Otero): reported, nothing written', async () => {
  const past = '2026-10-23'
  // installed Oct 23 (Schedule tab and opp agree); the calendar job's PM was later switched to Eli Larson for a second project
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests()
  world.opp.customFields = world.opp.customFields.map(c => c.id === INSTALL_FIELD ? { id: INSTALL_FIELD, fieldValueString: past } : c)
  world.opp.customFields.push({ id: 'AhZIAHEvjwpCdNadOhpO', fieldValueString: 'Eddie Mendoza' })
  world.contact.customFields.push({ id: 'IMYajaM4Jv4eOG65exQZ', value: past }, { id: 'TaIA7I6tkXzCmOGnfxHV', value: 'Eddie Mendoza' })
  world.calendarJobs[0].installDate = past; world.calendarJobs[0].pm = { name: 'Eli Larson' }
  world.scheduleRows = [['2026-10-10', past, 'Fixture Calendar', 'BOOKED', 'p2']]
  const a = await run({ fix: true, dry: true, since: '2026-10-01' })   // the window must reach the October install
  assert.ok(!a.would_fix.some(w => w.action === 'sync_fields' && (w.after.opp.pm || w.after.contact.pm)), JSON.stringify(a.would_fix))
  assert.equal(a.later_projects.length, 1); assert.match(a.later_projects[0].reason, /installed 2026-10-23; the calendar job J-77 now shows Project Manager Eli Larson \(the opp has Eddie Mendoza\) — a later project/)
  assert.equal(a.checked, 1)
  // the same switch on a job that has NOT installed yet is a real PM change and is written
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests()
  world.opp.customFields.push({ id: 'AhZIAHEvjwpCdNadOhpO', fieldValueString: 'Eddie Mendoza' })
  world.calendarJobs[0].installDate = future; world.calendarJobs[0].pm = { name: 'Eli Larson' }
  world.scheduleRows = [['2026-11-10', future, 'Fixture Calendar', 'BOOKED', 'p2']]
  const b = await run({ fix: true, dry: true })
  const sf = b.would_fix.find(w => w.action === 'sync_fields'); assert.ok(sf, JSON.stringify(b.would_fix)); assert.equal(sf.after.opp.pm, 'Eli Larson'); assert.equal(b.later_projects.length, 0)
})

test('commission-site deals: Outside Sales only, and never for a job sold before the site\'s first deal (March 2 2026) by the earliest evidence — a re-sign date does not make it new', async () => {
  const OUTSIDE = 'EWGmXwXP63Da5eBMNiDU'
  // 1. Outside opp sold in October (ArcSite project Oct 1, no opp created date, no Sheet Approved Date) → deal planned
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests(); world.deals = []; world.opp.pipelineId = OUTSIDE
  const a = await run({ fix: true, dry: true })
  const d = a.would_fix.find(w => w.action === 'create_deal'); assert.ok(d, JSON.stringify(a.would_fix)); assert.equal(d.after.deal_name, 'Fixture Calendar'); assert.deepEqual(a.deals_skipped, [])
  // 2. same opp, but the ArcSite project was created Feb 25 2026 (Heidi Kinney: re-signed in July) → no deal, listed with the earliest evidence
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests(); world.deals = []; world.opp.pipelineId = OUTSIDE; world.arcCreated = '2026-02-25T02:00:25.000000Z'
  const b = await run({ fix: true, dry: true })
  assert.ok(!b.would_fix.some(w => w.action === 'create_deal')); assert.equal(b.deals_skipped.length, 1)
  assert.equal(b.deals_skipped[0].sold, '2026-02-25'); assert.equal(b.deals_skipped[0].sold_evidence, 'ArcSite project created'); assert.match(b.deals_skipped[0].reason, /before the commission site's first deal on 2026-03-02/)
  // 2b. the GHL opp created date counts too
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests(); world.deals = []; world.opp.pipelineId = OUTSIDE; world.opp.createdAt = '2026-02-28T00:00:00.000Z'
  const b2 = await run({ fix: true, dry: true }); assert.equal(b2.deals_skipped.length, 1); assert.equal(b2.deals_skipped[0].sold_evidence, 'GHL opp created')
  // 3. an Inside Sales opp never gets a deal — listed
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests(); world.deals = []; world.opp.pipelineId = 'jfhZWICxnmISGllte9Rv'
  const c = await run({ fix: true, dry: true })
  assert.ok(!c.would_fix.some(w => w.action === 'create_deal')); assert.equal(c.deals_skipped.length, 1); assert.equal(c.deals_skipped[0].pipeline, 'Inside Sales'); assert.match(c.deals_skipped[0].reason, /Outside Sales only/)
  // live mode writes nothing to the site in either skipped case
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests(); world.deals = []; world.opp.pipelineId = 'jfhZWICxnmISGllte9Rv'
  await run({ fix: true }); assert.equal(world.dealPosts.length, 0)
})

test('ARC_AUDIT_SKIP_OPPS: an excluded opp is not audited and nothing is written to it, its contact, the calendar or the commission site (Anna Lee)', async () => {
  // value $1,500 vs signed $2,000, files behind on GHL and the calendar, contact prices stale, no deal — everything would be fixed
  reset({ ghl: ['old'], cal: ['old'], value: 1500 }); resetArcSaleMemoryForTests(); world.deals = []; world.opp.pipelineId = 'EWGmXwXP63Da5eBMNiDU'
  world.contact.customFields = [{ id: 'gz5Xoix8Sd37hUbrvQuQ', value: 1500 }, { id: 'X6s8Kc6QVEVyzSIISktA', value: 1500 }]
  process.env.ARC_AUDIT_SKIP_OPPS = OPP; process.env.ARC_AUDIT_SKIP_CONTACTS = 'contact-cal'
  try {
    const audit = await run({ fix: true })
    assert.equal(audit.checked, 0); assert.equal(audit.fixed.length, 0); assert.equal(audit.failed.length, 0); assert.deepEqual(audit.not_checked, [])
    assert.ok(audit.skipped_jobs.some(s => s.opportunity_id === OPP && /excluded by ARC_AUDIT_SKIP_OPPS/.test(s.reason)), JSON.stringify(audit.skipped_jobs))
    assert.equal(world.oppPuts.length, 0); assert.equal(world.contactPuts.length, 0); assert.equal(world.ingests.length, 0); assert.equal(world.uploads.length, 0); assert.equal(world.dealPosts.length, 0)
    assert.equal(world.opp.monetaryValue, 1500)
    // the write guards hold on their own too (any other path that reaches them)
    const mod = await import('../server.js')
    await assert.rejects(() => mod.ghlUpdateOppForTests(OPP, { monetaryValue: 2000 }), /excluded by ARC_AUDIT_SKIP_OPPS/)
    assert.equal(world.oppPuts.length, 0)
  } finally { delete process.env.ARC_AUDIT_SKIP_OPPS; delete process.env.ARC_AUDIT_SKIP_CONTACTS }
  // without the setting the same job is fixed as usual
  reset({ ghl: ['old'], cal: ['old'], value: 1500 }); resetArcSaleMemoryForTests(); world.opp.pipelineId = 'EWGmXwXP63Da5eBMNiDU'
  const again = await run({ fix: true }); assert.ok(again.fixed.some(f => f.action === 'change_order')); assert.equal(world.opp.monetaryValue, 2000)
})

test('change order → commission-site deal: a deal that is not Paid gets the Sheet\'s newest job price and baseline; a Paid deal is listed with old and new, never rewritten; Outside Sales only', async () => {
  const OUTSIDE = 'EWGmXwXP63Da5eBMNiDU'
  // two signed proposals (p1 $1,500 → p2 $2,000); the Sheet's newest row (p2): Approved Total 2000, Baseline 1000, Commission 200
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests(); world.opp.pipelineId = OUTSIDE
  world.deals = [{ id: 'deal-1', project_id: PID, deal_name: 'Fixture Calendar', job_price: 1500, baseline_revenue: 900, status: 'Pending Install' }]
  const d = await run({ fix: true, dry: true })
  const u = d.would_fix.find(w => w.action === 'update_deal'); assert.ok(u, JSON.stringify(d.would_fix))
  const noAmts = { setter_amount: null, closer_amount: null, manager_amount: null, director_amount: null, vp_amount: null }
  assert.deepEqual(u.before, { job_price: 1500, baseline_revenue: 900, commission: null, ...noAmts }); assert.deepEqual(u.after, { job_price: 2000, baseline_revenue: 1000, commission: 200, ...noAmts })
  assert.equal(u.deal_status, 'Pending Install'); assert.equal(world.dealPatches.length, 0, 'dry run writes nothing')
  // live: the deal is patched and read back
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests(); world.opp.pipelineId = OUTSIDE
  world.deals = [{ id: 'deal-1', project_id: PID, deal_name: 'Fixture Calendar', job_price: 1500, baseline_revenue: 900, status: 'Pending Install' }]
  const l = await run({ fix: true })
  const f = l.fixed.find(w => w.action === 'update_deal'); assert.ok(f, JSON.stringify(l.failed)); assert.deepEqual(world.dealPatches, [{ id: 'deal-1', job_price: 2000, baseline_revenue: 1000, setter_amount: null, closer_amount: null, manager_amount: null, director_amount: null, vp_amount: null }]); assert.equal(f.read_back.job_price, 2000)
  assert.equal(world.dealPosts.length, 0, 'no second deal created')
  // Paid: listed under deals_paid_changed, nothing patched
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests(); world.opp.pipelineId = OUTSIDE
  world.deals = [{ id: 'deal-1', project_id: PID, deal_name: 'Fixture Calendar', job_price: 1500, baseline_revenue: 900, status: 'Paid' }]
  const pd = await run({ fix: true })
  assert.equal(world.dealPatches.length, 0); assert.ok(!pd.fixed.some(w => w.action === 'update_deal')); assert.equal(pd.deals_paid_changed.length, 1); assert.match(pd.deals_paid_changed[0].reason, /^PAID deal — not rewritten/)
  // in step → nothing; Inside Sales → nothing (listed under deals_skipped by the pipeline rule)
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests(); world.opp.pipelineId = OUTSIDE
  world.deals = [{ id: 'deal-1', project_id: PID, deal_name: 'Fixture Calendar', job_price: 2000, baseline_revenue: 1000, status: 'Pending Install' }]
  const ok = await run({ fix: true }); assert.equal(world.dealPatches.length, 0); assert.ok(!ok.fixed.some(w => w.action === 'update_deal'))
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests(); world.opp.pipelineId = 'jfhZWICxnmISGllte9Rv'
  world.deals = [{ id: 'deal-1', project_id: PID, deal_name: 'Fixture Calendar', job_price: 1500, baseline_revenue: 900, status: 'Pending Install' }]
  const ins = await run({ fix: true }); assert.equal(world.dealPatches.length, 0); assert.equal(ins.deals_skipped.length, 1)
})

test('change order → deal: stored per-person amounts are cleared with the new numbers (they win over the computed split), the before-image keeps them, and a stored amount that survives the write is FAILED not fixed', async () => {
  const OUTSIDE = 'EWGmXwXP63Da5eBMNiDU'
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests(); world.opp.pipelineId = OUTSIDE
  world.deals = [{ id: 'deal-1', project_id: PID, deal_name: 'Fixture Calendar', job_price: 1500, baseline_revenue: 900, status: 'Pending Install', setter_amount: 300, closer_amount: 300, manager_amount: 45, director_amount: null, vp_amount: null }]
  const d = await run({ fix: true, dry: true })
  const u = d.would_fix.find(w => w.action === 'update_deal'); assert.ok(u, JSON.stringify(d.would_fix))
  assert.deepEqual(u.before, { job_price: 1500, baseline_revenue: 900, commission: null, setter_amount: 300, closer_amount: 300, manager_amount: 45, director_amount: null, vp_amount: null })
  assert.deepEqual(u.after, { job_price: 2000, baseline_revenue: 1000, commission: 200, setter_amount: null, closer_amount: null, manager_amount: null, director_amount: null, vp_amount: null })
  assert.deepEqual(u.patch, { job_price: 2000, baseline_revenue: 1000, setter_amount: null, closer_amount: null, manager_amount: null, director_amount: null, vp_amount: null })
  assert.equal(world.dealPatches.length, 0)
  // live: cleared and read back
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests(); world.opp.pipelineId = OUTSIDE
  world.deals = [{ id: 'deal-1', project_id: PID, deal_name: 'Fixture Calendar', job_price: 1500, baseline_revenue: 900, status: 'Pending Install', setter_amount: 300, closer_amount: 300 }]
  const l = await run({ fix: true })
  const f = l.fixed.find(w => w.action === 'update_deal'); assert.ok(f, JSON.stringify(l.failed))
  assert.equal(world.deals[0].setter_amount, null); assert.equal(world.deals[0].closer_amount, null); assert.equal(f.read_back.setter_amount, null)
  // a database that keeps the amount (a lock trigger, a column default…) is a FAILED fix, never "fixed"
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests(); world.opp.pipelineId = OUTSIDE
  world.deals = [{ id: 'deal-1', project_id: PID, deal_name: 'Fixture Calendar', job_price: 1500, baseline_revenue: 900, status: 'Pending Install', setter_amount: 300 }]
  const keep = world.deals[0]; Object.defineProperty(keep, 'setter_amount', { get: () => 300, set: () => {}, enumerable: true })
  const bad = await run({ fix: true })
  assert.ok(!bad.fixed.some(w => w.action === 'update_deal')); const fl = bad.failed.find(w => w.action === 'update_deal'); assert.ok(fl); assert.match(fl.error, /stored amount is still set/)
})

test('change order → deal: when a SPLIT deal (<pid>-2) already carries the add-on, the parent is held, listed with both deals, and never re-priced to the ArcSite sum (the double-pay bug, Nov 22 2026)', async () => {
  const OUTSIDE = 'EWGmXwXP63Da5eBMNiDU'
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests(); world.opp.pipelineId = OUTSIDE
  world.deals = [
    { id: 'deal-1', project_id: PID, deal_name: 'Fixture Calendar', job_price: 1500, baseline_revenue: 900, status: 'Paid' },
    { id: 'deal-2', project_id: PID + '-2', deal_name: 'Fixture Calendar (add-on)', job_price: 500, baseline_revenue: 100, status: 'Deal Review' },
    { id: 'deal-9', project_id: PID + '9', deal_name: 'Other customer', job_price: 1, baseline_revenue: 1, status: 'Paid' },   // a longer Project ID that merely starts the same is NOT a split
  ]
  const l = await run({ fix: true })
  assert.equal(world.dealPatches.length, 0, 'nothing written'); assert.equal(world.dealPosts.length, 0)
  assert.ok(!l.fixed.some(w => w.action === 'update_deal')); assert.equal(l.deals_paid_changed.length, 0)
  assert.equal(l.deals_split_held.length, 1); const h = l.deals_split_held[0]
  assert.equal(h.action, 'hold_split_deal'); assert.equal(h.parent.deal_id, 'deal-1'); assert.deepEqual(h.splits.map(s => s.project_id), [PID + '-2']); assert.equal(h.arcsite_total, 2000)
  assert.match(h.reason, /split deal .*-2 .*not re-priced/)
  // dry run lists the same hold and writes nothing
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests(); world.opp.pipelineId = OUTSIDE
  world.deals = [{ id: 'deal-1', project_id: PID, deal_name: 'Fixture Calendar', job_price: 1500, baseline_revenue: 900, status: 'Pending Install' }, { id: 'deal-2', project_id: PID + '-2', deal_name: 'add-on', job_price: 500, baseline_revenue: 100, status: 'Deal Review' }]
  const d = await run({ fix: true, dry: true }); assert.equal(d.deals_split_held.length, 1); assert.ok(!d.would_fix.some(w => w.action === 'update_deal')); assert.equal(world.dealPatches.length, 0)
  // no split → the parent is updated as before
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests(); world.opp.pipelineId = OUTSIDE
  world.deals = [{ id: 'deal-1', project_id: PID, deal_name: 'Fixture Calendar', job_price: 1500, baseline_revenue: 900, status: 'Pending Install' }, { id: 'deal-9', project_id: PID + '9', deal_name: 'Other', job_price: 1, baseline_revenue: 1, status: 'Paid' }]
  const ok = await run({ fix: true }); assert.ok(ok.fixed.some(w => w.action === 'update_deal')); assert.equal(ok.deals_split_held.length, 0)
})

test('one opportunity = one signed proposal: an add-on signed inside the project is never summed — the opp keeps its own proposal\'s value, is not "behind", and the other proposal is reported for the 9 PM text (Amanda Pogorzelski)', async () => {
  const OUTSIDE = 'EWGmXwXP63Da5eBMNiDU'
  // the project: original $15,895.75 (drawing A, older) + add-on $1,802.60 (drawing B, newest); the opp holds the ADD-ON at $1,802.60 with both PDFs attached
  reset({ ghl: ['old', 'new'], cal: ['new'], value: 1802.6, sheetTotal: '1802.60' }); resetArcSaleMemoryForTests(); world.opp.pipelineId = OUTSIDE
  world.proposals = [
    { proposal_id: 'p2', project_id: PID, status: 'APPROVED', total: 1802.6, pdf_url: 'https://cdn.example/new.pdf', proposal_options: [{ drawing_id: 'B' }], document_number: '1002' },
    { proposal_id: 'p1', project_id: PID, status: 'APPROVED', total: 15895.75, pdf_url: 'https://cdn.example/old.pdf', proposal_options: [{ drawing_id: 'A' }], document_number: '1001' },
  ]
  world.deals = [{ id: 'deal-1', project_id: PID, deal_name: 'Fixture Calendar', job_price: 15895.75, baseline_revenue: 12227.5, status: 'Paid' }]
  const d = await run({ fix: true, dry: true })
  assert.equal(d.values[PID].total, 1802.6, 'the opp\'s own proposal, never the $17,698.35 sum'); assert.equal(d.values[PID].owned_kind, 'add-on'); assert.equal(d.values[PID].signed, 1); assert.equal(d.values[PID].signed_on_project, 2)
  assert.ok(!d.would_fix.some(w => w.action === 'change_order'), JSON.stringify(d.would_fix)); assert.equal(d.gaps.length, 0)
  assert.equal(d.proposals_without_opp.length, 1); assert.match(d.proposals_without_opp[0].reason, /original proposal 1001 \(\$15,895\.75\) signed inside this ArcSite project with no opportunity of its own/)
  assert.ok(!d.would_fix.some(w => w.action === 'update_deal') && d.deals_paid_changed.length === 0, 'the Paid deal is not touched: no re-signing of the owned proposal')
  // live run: nothing written anywhere
  reset({ ghl: ['old', 'new'], cal: ['new'], value: 1802.6, sheetTotal: '1802.60' }); resetArcSaleMemoryForTests(); world.opp.pipelineId = OUTSIDE
  world.proposals = [
    { proposal_id: 'p2', project_id: PID, status: 'APPROVED', total: 1802.6, pdf_url: 'https://cdn.example/new.pdf', proposal_options: [{ drawing_id: 'B' }], document_number: '1002' },
    { proposal_id: 'p1', project_id: PID, status: 'APPROVED', total: 15895.75, pdf_url: 'https://cdn.example/old.pdf', proposal_options: [{ drawing_id: 'A' }], document_number: '1001' },
  ]
  const l = await run({ fix: true })
  assert.equal(world.opp.monetaryValue, 1802.6); assert.equal(world.oppPuts.length, 0); assert.equal(world.ingests.length, 0); assert.equal(world.dealPatches.length, 0)
  assert.equal(l.proposals_without_opp.length, 1)
  // the opp holding the ORIGINAL ($15,895.75) with only the old PDF: it owns the original — not behind for the add-on's PDF, value stays, the add-on is reported
  reset({ ghl: ['old'], cal: ['old'], value: 15895.75, sheetTotal: '15895.75' }); resetArcSaleMemoryForTests(); world.opp.pipelineId = OUTSIDE
  world.proposals = [
    { proposal_id: 'p2', project_id: PID, status: 'APPROVED', total: 1802.6, pdf_url: 'https://cdn.example/new.pdf', proposal_options: [{ drawing_id: 'B' }], document_number: '1002' },
    { proposal_id: 'p1', project_id: PID, status: 'APPROVED', total: 15895.75, pdf_url: 'https://cdn.example/old.pdf', proposal_options: [{ drawing_id: 'A' }], document_number: '1001' },
  ]
  const o = await run({ fix: true })
  assert.equal(world.opp.monetaryValue, 15895.75); assert.equal(world.oppPuts.length, 0); assert.equal(world.ingests.length, 0)
  assert.equal(o.values[PID].total, 15895.75); assert.equal(o.values[PID].owned_kind, 'original'); assert.match(o.proposals_without_opp[0].reason, /add-on proposal 1002 \(\$1,802\.60\)/)
  // an opp still at the old SUM ($17,698.35) matches no proposal: it takes the MAIN contract ($15,895.75) — never the sum — and that is a change order down, listed in the dry run
  reset({ ghl: ['old', 'new'], cal: ['new'], value: 17698.35, sheetTotal: '15895.75' }); resetArcSaleMemoryForTests(); world.opp.pipelineId = OUTSIDE
  world.proposals = [
    { proposal_id: 'p2', project_id: PID, status: 'APPROVED', total: 1802.6, pdf_url: 'https://cdn.example/new.pdf', proposal_options: [{ drawing_id: 'B' }], document_number: '1002' },
    { proposal_id: 'p1', project_id: PID, status: 'APPROVED', total: 15895.75, pdf_url: 'https://cdn.example/old.pdf', proposal_options: [{ drawing_id: 'A' }], document_number: '1001' },
  ]
  const s = await run({ fix: true, dry: true })
  const co = s.would_fix.find(w => w.action === 'change_order'); assert.ok(co, JSON.stringify(s.would_fix)); assert.match(co.note, /value → \$15,895\.75/)
})

test('hidden signed proposal: a change-order DRAFT replaces the signed original in ArcSite\'s per-project list — the original is fetched through initial_proposal_id, so the job is signed, nothing is cleared and the contact prices follow the signed value (Quinn Macdonald, Nov 23 2026)', async () => {
  reset({ ghl: ['old'], cal: ['old'], value: 6765.11, sheetTotal: '6765.11' }); resetArcSaleMemoryForTests()
  // what the list shows: the unsigned change-order draft (naming its parent) and an older unsigned first draft
  world.proposals = [
    { proposal_id: 'co1', project_id: PID, status: 'PENDING', initial_proposal_id: 'p1', proposal_options: [{ drawing_id: 'A', total: 7325.11 }], document_number: null },
    { proposal_id: 'p0', project_id: PID, status: 'PENDING', proposal_options: [{ drawing_id: 'A', total: 9211.56 }], document_number: null },
  ]
  // what the list hides: the signed original
  world.hiddenProposals = [{ proposal_id: 'p1', project_id: PID, status: 'APPROVED', total: 6765.11, pdf_url: 'https://cdn.example/old.pdf', proposal_options: [{ drawing_id: 'A', total: 6765.11 }], document_number: '1001' }]
  // the 6 AM run had already cleared the contact prices
  world.contact.customFields = world.contact.customFields.filter(f => f.id !== 'gz5Xoix8Sd37hUbrvQuQ' && f.id !== 'X6s8Kc6QVEVyzSIISktA')
  const d = await run({ fix: true, dry: true })
  assert.deepEqual(world.proposalGets, ['p1'], 'the parent is fetched directly, exactly once')
  assert.equal(d.unsigned_closed.length, 0, JSON.stringify(d.unsigned_closed))
  assert.ok(!d.would_fix.some(w => w.action === 'clear_contact_prices'), JSON.stringify(d.would_fix))
  assert.equal(d.values[PID].total, 6765.11); assert.equal(d.values[PID].signed, 1); assert.equal(d.gaps.length, 0)
  const sf = d.would_fix.find(w => w.action === 'sync_fields')
  assert.ok(sf && sf.after.contact.jobPrice === 6765.11 && sf.after.contact.newPrice === 6765.11 && sf.before.contactJobPrice === null, 'contact Job Price and New Price go back to the signed $6,765.11: ' + JSON.stringify(sf))
})

test('hidden signed proposal: a parent already in the list is not fetched twice, and a parent ArcSite cannot return counts as an ArcSite error — never as \"nothing signed\"', async () => {
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests()
  world.proposals = [
    { proposal_id: 'p2', project_id: PID, status: 'APPROVED', total: 2000, pdf_url: 'https://cdn.example/new.pdf', initial_proposal_id: 'p1', proposal_options: [], document_number: '1002' },
    { proposal_id: 'p1', project_id: PID, status: 'APPROVED', total: 1500, pdf_url: 'https://cdn.example/old.pdf', proposal_options: [], document_number: '1001' },
  ]
  let d = await run({ fix: true, dry: true })
  assert.deepEqual(world.proposalGets || [], [], 'parent in the list: no direct fetch'); assert.equal(d.values[PID].signed, 2)
  // ArcSite cannot return the parent (rate limit / outage / 404): the job is NOT checked — counted as an ArcSite error, never read as unsigned, nothing cleared
  reset({ ghl: ['old'], cal: ['old'] }); resetArcSaleMemoryForTests()
  world.proposals = [{ proposal_id: 'co1', project_id: PID, status: 'PENDING', initial_proposal_id: 'gone', proposal_options: [{ total: 1 }] }]
  d = await run({ fix: true, dry: true })
  assert.deepEqual(world.proposalGets, ['gone']); assert.equal(d.unsigned_closed.length, 0); assert.equal(d.arcsite_errors, 1)
  assert.ok(!d.would_fix.some(w => w.action === 'clear_contact_prices'))
})

test('sheet money re-stamp: a stale Baseline Price / Mark Up on the opp is set from the AI sheet rollup; matching fields and a disputed value are left alone', async () => {
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests()
  // Quinn Macdonald / Freedom Law (Nov 24 2026): the row landed after the signing, so the fields kept the old numbers.
  for (const c of world.opp.customFields) { if (c.id === 'rI6UeVz5CTQcXsssBqIm') c.fieldValueNumber = 1400; if (c.id === 'Vi6FxBjJ1iVcSPEH8tFE') c.fieldValueNumber = 600 }
  const audit = await run({ fix: true })
  const fix = audit.fixed.find(f => f.action === 'sync_fields')
  assert.ok(fix, JSON.stringify(audit.fixed))
  assert.deepEqual(fix.after.opp, { baseline: 1000, markup: 1000 }, 'only the two stale money fields, from the sheet (baseline 1000, pre-tax 2000)')
  assert.deepEqual(fix.after.contact, {}); assert.deepEqual(fix.after.calendar, {})
  assert.match(fix.reason, /Baseline Price field 1400 → 1000/); assert.match(fix.reason, /Mark Up field 600 → 1000/)
  assert.equal(audit.gaps.length, 0, 'contracts and value were already right')
  // disputed: the sheet total disagrees with ArcSite → nothing re-stamped
  reset({ ghl: ['old', 'new'], cal: ['new'], sheetTotal: '2500' }); resetArcSaleMemoryForTests()
  for (const c of world.opp.customFields) if (c.id === 'rI6UeVz5CTQcXsssBqIm') c.fieldValueNumber = 1400
  const audit2 = await run({ fix: true })
  assert.equal(audit2.fixed.filter(f => f.action === 'sync_fields').length, 0, JSON.stringify(audit2.fixed))
  // a finished job (install day in the past): listed under money_behind, never written
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests()
  const past = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10)
  for (const c of world.opp.customFields) { if (c.id === 'rI6UeVz5CTQcXsssBqIm') c.fieldValueNumber = 1400; if (c.id === INSTALL_FIELD) c.fieldValueString = past }
  world.calendarJobs[0].installDate = past
  const audit3 = await run({ fix: true })
  assert.equal(audit3.fixed.filter(f => f.action === 'sync_fields' && f.after.opp.baseline != null).length, 0, JSON.stringify(audit3.fixed))
  assert.equal(audit3.money_behind.length, 1, JSON.stringify(audit3.money_behind)); assert.match(audit3.money_behind[0].reason, /Baseline Price field 1400 → 1000/)
})

test('a PM calendar job cancelled while the Schedule tab is not: listed under calendar_cancelled, opp left open, nothing written', async () => {
  reset({ ghl: ['old', 'new'], cal: ['new'] }); resetArcSaleMemoryForTests()
  world.calendarJobs[0].canceledAt = '2026-11-24T17:41:00.000Z'
  const audit = await run({ fix: true })
  assert.equal(audit.calendar_cancelled.length, 1, JSON.stringify(audit.calendar_cancelled))
  assert.equal(audit.calendar_cancelled[0].opportunity_id, OPP); assert.match(audit.calendar_cancelled[0].reason, /cancelled but the Schedule tab/)
  assert.equal(world.oppPuts.filter(p => p.status).length, 0, 'status never changed')
  assert.equal(audit.cancelled_bookings.length, 0)
})
