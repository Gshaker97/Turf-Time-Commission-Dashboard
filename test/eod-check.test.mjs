import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEodReport, eodSmsText, sameName, streetKey, phoneKey, phoneKeys } from '../lib/eod-check.mjs'

const J = (rows) => ({ headers: ['Approved Date', 'Customer', 'Sales Rep', 'Approved Total', 'Proposal ID', 'Project ID', 'Status', 'Customer Phone', 'Install Address'], rows })
const S = (rows) => ({ headers: ['Booked At', 'Install Date', 'Customer', 'Status', 'Proposal ID', 'Lead Source', 'Sales Rep'], rows })
const base = () => ({
  day: '2026-11-13', scopeSince: '2026-11-01',
  sheetJobs: J([{ 'Approved Date': '2026-11-10', Customer: 'Camron & Bobbie Johnson', 'Sales Rep': 'Jared Aguilar', 'Approved Total': '$19,881.77', 'Proposal ID': '624732', 'Project ID': 'P1', Status: 'APPROVED', 'Customer Phone': '602-555-1234', 'Install Address': '17511 W Southgate Ave, Goodyear' }]),
  sheetSchedule: S([{ 'Booked At': '2026-11-10', 'Install Date': '2026-11-27', Customer: 'Camron & Bobbie Johnson', Status: 'BOOKED', 'Proposal ID': '624732', 'Lead Source': 'Outside Sales - Setter: Corbin Davis', 'Sales Rep': 'Jared Aguilar' }]),
  ghl: { opportunities: [{ id: 'o1', name: 'Camron & Bobbie Johnson', contact_id: 'c1', pipeline: 'Outside Sales', stage: 'Deal Reviewed', status: 'open', value: 19881.77, project_id: 'P1', install_date: '2026-11-27', contracts: 1, fields: { Address: '17511 W Southgate Ave, Goodyear AZ 85338', Setter: 'Corbin Davis', Closer: 'Jared Aguilar' } }], contacts: { c1: { id: 'c1', phone: '+16025551234', address: '17511 W Southgate Ave, Goodyear, AZ' } } },
  calendarJobs: [{ jobNumber: 'J-1', ghlOpportunityId: 'o1', ghlContactId: 'c1', customer: { name: 'Camron Johnson', phone: '+16025551234', address: '17511 W Southgate Ave, Goodyear, AZ' }, installDate: '2026-11-27', value: 19881.77, contracts: [{ filename: 'x.pdf' }] }],
  siteDeals: [{ project_id: 'P1', deal_name: 'Camron & Bobbie Johnson', status: 'Pending Install', job_price: 19881.77, install_date: '2026-11-27', setter: { name: 'Corbin Davis' }, closer: { name: 'Jared Aguilar' } }],
  events: [], alertStates: {}, worker: null, contractAudit: null,
})

test('helpers: names, phones, streets', () => {
  assert.equal(sameName('Camron & Bobbie Johnson', 'Camron Johnson'), true)
  assert.equal(sameName('Robert Durwood', 'Robert Durward'), false)
  assert.equal(sameName('Tyler Sibold · website estimate · turf', 'Tyler Sibold'), true)
  assert.equal(sameName('', 'Anyone'), true)
  assert.equal(phoneKey('661_205_9856'), '6612059856'); assert.equal(phoneKey('+16612059856'), '6612059856')
  assert.equal(streetKey('5911 E California ct, San Tan'), streetKey('5911 E California Ct, San Tan Valley, AZ 85140, USA'))
  assert.notEqual(streetKey('5911 E California Ct'), streetKey('5912 E California Ct'))
  assert.equal(streetKey('14394W soft wind drive, Surprise'), streetKey('14394 W Soft Wind Dr'))
  assert.deepEqual(phoneKeys('480-555-1234 / 602-555-9876'), ['4805551234', '6025559876']); assert.deepEqual(phoneKeys('+16612059856'), ['6612059856']); assert.deepEqual(phoneKeys('661_205_9856'), ['6612059856'])
})

test('a fully aligned job produces no issues and no text', () => {
  const r = buildEodReport(base())
  assert.equal(r.checked, 1); assert.deepEqual(r.issues, []); assert.equal(r.ok, true); assert.equal(eodSmsText(r), '')
})

test('every mismatch kind is detected and commission is ignored', () => {
  const p = base()
  p.ghl.opportunities[0].value = 19000; p.ghl.opportunities[0].install_date = '2026-11-28'; p.ghl.opportunities[0].fields.Closer = 'Someone Else'; p.ghl.opportunities[0].fields.Commission = 999999
  p.ghl.contacts.c1.phone = '+16025559999'
  p.calendarJobs[0].value = 0; p.calendarJobs[0].customer.address = '999 Other Rd, Mesa, AZ'; p.calendarJobs[0].contracts = []
  p.siteDeals[0].deal_name = 'Totally Different'; p.siteDeals[0].install_date = '2026-12-01'
  const r = buildEodReport(p)
  const kinds = new Set(r.issues.map(i => i.kind))
  for (const k of ['price', 'install_date', 'closer', 'phone', 'address', 'calendar_zero_value', 'name', 'contract']) assert.ok(kinds.has(k), k)
  assert.ok(!r.issues.some(i => i.kind === 'commission' || /commission field/i.test(i.detail)), 'commission never compared')
  assert.equal(r.issues[0].severity, 'high', 'worst first')
  const sms = eodSmsText(r)
  assert.ok(sms.startsWith('Turf Time end-of-day check, Nov 13.')); assert.match(sms, /PRICE DOES NOT MATCH \(\d\)/); assert.match(sms, /- Camron & Bobbie Johnson \(J-1\): Sheet \$19,881\.77 vs GHL value \$19,000\.00/)
  assert.match(sms, /INSTALL DATE DOES NOT MATCH[^\n]*\n- Camron & Bobbie Johnson \(J-1\): schedule Nov 27 vs GHL Nov 28/); assert.match(sms, /Full list with every job: \/api\/analyst\/eod\?day=2026-11-13/)
})

test('a sale approved today with no GHL opportunity is the top finding', () => {
  const p = base(); p.ghl.opportunities = []
  p.sheetJobs.rows[0]['Approved Date'] = '2026-11-13'
  const r = buildEodReport(p)
  assert.equal(r.issues[0].kind, 'missing_in_ghl_today'); assert.match(eodSmsText(r), /SOLD TODAY BUT NOT IN GHL \(1\)[^\n]*\n- Camron & Bobbie Johnson: approved Nov 13 for \$19,881\.77 \(Jared Aguilar\): no GHL opportunity/)
})

test('calendar job linked to a website lead, blocked sale events, stuck worker, unsent text', () => {
  const p = base()
  p.ghl.opportunities.push({ id: 'o2', name: 'Jake Carter · website estimate · turf', contact_id: 'c2', pipeline: 'Inside Sales (Estimators)', stage: 'New Leads', status: 'open', value: 0, project_id: null, contracts: 0, fields: {} })
  p.calendarJobs.push({ jobNumber: 'J-2', ghlOpportunityId: 'o2', customer: { name: 'Jake Carter' }, installDate: '2026-11-20', value: 0, contracts: [] })
  p.events = [{ at: '2026-11-13T02:37:00Z', action: 'lookup_blocked', ok: false, project_id: 'P9', code: 'incomplete' }, { at: '2026-11-12T02:37:00Z', action: 'lookup_blocked', ok: false, project_id: 'P8' }, { at: '2026-11-13T03:00:00Z', ignored: true, ok: true }]
  p.worker = { state: 'running', day: '2026-11-05' }
  p.sheetJobs.rows[0]['Approved Date'] = '2026-11-13'; p.alertStates = { P1: 'intent' }
  const r = buildEodReport(p)
  const kinds = r.issues.map(i => i.kind)
  assert.ok(kinds.includes('calendar_lead_opp')); assert.equal(kinds.filter(k => k === 'sale_blocked').length, 1, 'only today, only failures'); assert.ok(kinds.includes('worker_stuck')); assert.ok(kinds.includes('text_not_sent'))
})

test('reps the commission site never imports are not flagged as missing there; duplicates flagged', () => {
  const p = base(); p.siteDeals = []; p.sheetJobs.rows[0]['Sales Rep'] = 'Rhett Tenney'; p.sheetJobs.rows[0]['Approved Date'] = '2026-11-10'
  p.ghl.opportunities[0].fields.Closer = 'Rhett Tenney'
  assert.ok(!buildEodReport(p).issues.some(i => i.kind === 'missing_on_site'))
  p.sheetJobs.rows[0]['Sales Rep'] = 'Jared Aguilar'; p.ghl.opportunities[0].fields.Closer = 'Jared Aguilar'
  assert.ok(buildEodReport(p).issues.some(i => i.kind === 'missing_on_site'))
  p.ghl.opportunities.push({ ...p.ghl.opportunities[0], id: 'o1b' })
  assert.ok(buildEodReport(p).issues.some(i => i.kind === 'duplicate_opportunity'))
})

test('many issues: each group is capped with an "and N more" line', () => {
  const p = base(); p.sheetJobs.rows = Array.from({ length: 60 }, (_, i) => ({ ...p.sheetJobs.rows[0], Customer: 'Customer Number' + i, 'Project ID': 'P' + i, 'Approved Date': '2026-11-13' })); p.ghl.opportunities = []
  const sms = eodSmsText(buildEodReport(p)); assert.ok(sms.length <= 1500, sms.length); assert.match(sms, /SOLD TODAY BUT NOT IN GHL \(60\)/)
})

test('when a source failed to load, the report says so instead of flagging every job as missing', () => {
  const p = base(); p.sourceErrors = { sheet: 'Install sheet read failed (429)' }; p.sheetJobs = { headers: [], rows: [] }; p.sheetSchedule = { headers: [], rows: [] }
  const r = buildEodReport(p)
  assert.equal(r.checked, 0); assert.deepEqual(r.issues.map(i => i.kind), ['source_unavailable'])
  assert.match(eodSmsText(r), /A SOURCE DID NOT LOAD \(1\)[^\n]*\n- sheet: Install sheet read failed/)
  const q = base(); q.sourceErrors = { ghl: 'failed' }
  assert.deepEqual(buildEodReport(q).issues.map(i => i.kind), ['source_unavailable'])
})

test('nicknames and one-letter typos are the same person; repeats carry first_seen and are not news', () => {
  assert.equal(sameName('Charles', 'Charlie Higgins'), true)
  assert.equal(sameName('Kyltan Hedgcock', 'Kyltan Hedgecock'), true)
  assert.equal(sameName('Kyltan Hedgcock', 'Brady McKay'), false)
  const p = base(); p.ghl.opportunities[0].value = 19000
  const day1 = buildEodReport(p)
  assert.equal(day1.issues[0].new, true); assert.equal(day1.new_count, 1)
  const p2 = base(); p2.day = '2026-11-14'; p2.ghl.opportunities[0].value = 19000; p2.previous = day1
  const day2 = buildEodReport(p2)
  assert.equal(day2.new_count, 0); assert.equal(day2.carried_count, 1); assert.equal(day2.issues[0].first_seen, '2026-11-13')
  assert.match(eodSmsText(day2), /Nothing new today\. 1 item from earlier days still open/)
})

test('a sold job whose opportunity still carries the website-estimate name is NOT a lead opp once it has a Project ID', () => {
  const p = base(); p.ghl.opportunities[0].name = 'Camron Johnson · website estimate · turf'
  assert.ok(!buildEodReport(p).issues.some(i => i.kind === 'calendar_lead_opp'))
})

test('completed installs are skipped; the ignore list drops a job or just a kind; a -2 site id matches; a canceled site deal is its own finding', () => {
  const done = base(); done.sheetSchedule.rows[0]['Install Date'] = '2026-11-01'; done.ghl.opportunities = []
  const r1 = buildEodReport(done); assert.equal(r1.checked, 0); assert.equal(r1.skipped_completed, 1); assert.deepEqual(r1.issues, [])
  const ig = base(); ig.ghl.opportunities[0].value = 1; ig.siteDeals[0].deal_name = 'Other Person'; ig.ignore = [{ match: 'Camron & Bobbie Johnson', kinds: ['name'] }]
  const r2 = buildEodReport(ig); assert.ok(r2.issues.some(i => i.kind === 'price')); assert.ok(!r2.issues.some(i => i.kind === 'name'))
  ig.ignore = ['Camron & Bobbie Johnson']; assert.deepEqual(buildEodReport(ig).issues, [])
  const two = base(); two.siteDeals[0].project_id = 'P1-2'; assert.ok(!buildEodReport(two).issues.some(i => i.kind === 'missing_on_site'))
  const cx = base(); cx.sheetJobs.rows[0]['Approved Date'] = '2026-11-10'; cx.siteDeals[0].status = 'Canceled'
  assert.deepEqual(buildEodReport(cx).issues.map(i => i.kind), ['site_canceled'])
})

test('a booking cancelled on the Schedule tab is not compared, but a GHL opportunity still live is flagged once', () => {
  const p = base(); p.sheetSchedule.rows[0].Status = 'CANCELLED'; p.sheetSchedule.rows[0].Notes = ' [cancelled by Keaton 11/06: Failed credit ]'; p.sheetSchedule.headers.push('Notes')
  p.ghl.opportunities[0].value = 1   // would be a price mismatch if compared
  const r = buildEodReport(p)
  assert.deepEqual(r.issues.map(i => i.kind), ['canceled_but_open']); assert.match(r.issues[0].detail, /cancelled by Keaton 11\/06/); assert.equal(r.checked, 0)
  p.ghl.opportunities[0].status = 'lost'; p.calendarJobs[0].canceledAt = '2026-11-06T00:00:00Z'; assert.deepEqual(buildEodReport(p).issues, [])
})

test('a calendar job for the same contact but another opportunity is reported as such, with both values', () => {
  const p = base(); p.calendarJobs[0].ghlOpportunityId = 'old-opp'; p.calendarJobs[0].value = 6200
  const r = buildEodReport(p)
  const k = r.issues.find(i => i.kind === 'calendar_other_opp'); assert.ok(k); assert.equal(k.job, 'J-1'); assert.match(k.detail, /\$6,200\.00.*\$19,881\.77/)
  assert.ok(!r.issues.some(i => i.kind === 'missing_calendar_job'))
})

test('a calendar job linked to a LOST opportunity is flagged like a website lead', () => {
  const p = base(); p.ghl.opportunities.push({ id: 'dead', name: 'Jon Kim', contact_id: 'c9', pipeline: 'Outside Sales', stage: 'Ready For Install', status: 'lost', value: 6200, project_id: null, contracts: 0, fields: {} })
  p.calendarJobs.push({ jobNumber: 'J-9', ghlOpportunityId: 'dead', ghlContactId: 'c9', customer: { name: 'Jonathan Kim' }, installDate: '2026-11-27', value: 6200, contracts: [] })
  assert.ok(buildEodReport(p).issues.some(i => i.kind === 'calendar_lead_opp' && i.job === 'J-9'))
})
