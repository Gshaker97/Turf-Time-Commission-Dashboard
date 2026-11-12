import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { saleEventId } from '../lib/arcsite-sale-guard.mjs'

const GHL = 'https://services.leadconnectorhq.com'
const ARC = 'https://api.arcsite.com/v1'
const SB = 'http://supabase.test'
const LOC = 'loc-test'
const PROJECT_FIELD = 'OEpWsIX1eOfXHqrSI273'
const INSTALL_FIELD = 'j3gHe7eeXd2yfujzpln8'
const DURWOOD = '282300044590465'
const DURWOOD_OPP = '8zEScViwcj06XXqg31ik'
const KRISTINE = '282300041920658'
const KRISTINE_OPP = 'nwwvyCd6c4SgsYS8Uu82'
const NEW_PROJECT = '900000000000001'
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })

process.env.ARC_NO_LISTEN = '1'
process.env.ARC_DISABLE_TIMERS = '1'
process.env.ARC_SALE_TEST = '1'
process.env.GHL_LOCATION_ID = LOC
process.env.GHL_API_TOKEN = 'test-read-token'
process.env.GHL_WRITE_TOKEN = 'test-write-token'
process.env.GHL_SMS_TOKEN = 'test-sms-token'
process.env.ARCSITE_API_TOKEN = 'test-arcsite-token'
process.env.SUPABASE_URL = SB
process.env.SUPABASE_SERVICE_KEY = 'test-service-key'
process.env.SALE_ALERT_CONTACT_IDS = 'fixture-alert-contact'
process.env.GHL_OUTSIDE_PIPELINE_ID = 'pipe-outside'
process.env.GHL_OUTSIDE_CLOSED_STAGE = 'stage-closed'
process.env.GHL_OUTSIDE_CO_STAGE = 'stage-change'
process.env.INSTALL_SHEET_ID = 'sheet-test'
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  client_email: 'sheet@example.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
})
delete process.env.CALENDAR_SYNC_URL
delete process.env.ARCSITE_WEBHOOK_SECRET
delete process.env.ANALYST_API_KEY

let world
function fillers(n, contactId = 'other-contact') {
  return Array.from({ length: n }, (_, i) => ({
    id: `filler-${contactId}-${i}`, contactId, status: 'open', pipelineId: 'pipe-outside', monetaryValue: 1,
    customFields: [],
  }))
}
function makeWorld(opportunities, proposals, extra = {}) {
  return {
    opportunities: opportunities.slice(),
    proposals,
    recent: proposals.filter(item => item.recent !== false),
    contacts: extra.contacts || [],
    byPhone: extra.byPhone || {},
    settings: new Map(extra.settings || []),
    calls: [],
    upserts: [],
    creates: [],
    sms: [],
    puts: [],
    failCreate: new Set(extra.failCreate || []),
    landThenThrow: new Set(extra.landThenThrow || []),
    smsTimeout: new Set(extra.smsTimeout || []),
    upsertStatus: extra.upsertStatus || 200,
    incomplete: !!extra.incomplete,
  }
}
const creates = () => world.creates.length
const texts = () => world.sms.length
const putIds = () => world.puts.map(item => item.id)

globalThis.fetch = async (url, opts = {}) => {
  const href = String(url)
  const method = (opts.method || 'GET').toUpperCase()
  const parsed = new URL(href)
  world.calls.push({ method, href })
  const bodyText = opts.body ? (typeof opts.body === 'string' ? opts.body : await new Response(opts.body).text()) : ''
  const body = bodyText && (bodyText.startsWith('{') || bodyText.startsWith('[')) ? JSON.parse(bodyText) : null
  const send = (status, payload) => new Response(JSON.stringify(payload ?? {}), { status, headers: { 'content-type': 'application/json' } })

  if (parsed.origin === 'https://oauth2.googleapis.com') return send(200, { access_token: 'sheet-token', expires_in: 3600 })
  if (parsed.hostname === 'sheets.googleapis.com') {
    return send(200, { valueRanges: [
      { range: 'Jobs!A1:E5', values: [
        ['Project ID', 'Baseline Cost', 'Approved Total', 'Pre-Tax Sale', 'Commission'],
        [NEW_PROJECT, '800', '1500', '1400', '200'],
        ['900000000000003', '800', '1600', '1500', '200'],
        ['900000000000004', '800', '1900', '1800', '200'],
      ] },
      { range: 'Schedule!A1:A1', values: [['Project ID']] },
    ] })
  }
  if (parsed.origin + parsed.pathname === `${ARC}/projects/${parsed.pathname.split('/').at(-1)}` || parsed.pathname.startsWith('/v1/projects/')) {
    const id = decodeURIComponent(parsed.pathname.split('/').at(-1))
    const project = world.proposals.find(item => item.project_id === id)
    if (!project) return send(404, { message: 'missing project' })
    return send(200, project.project)
  }
  if (parsed.pathname.startsWith('/v1/proposals/')) {
    const id = decodeURIComponent(parsed.pathname.split('/').at(-1))
    const hit = world.proposals.find(item => String(item.proposal.proposal_id) === id)
    return hit ? send(200, hit.proposal) : send(404, {})
  }
  if (parsed.pathname === '/v1/proposals') {
    const projectId = parsed.searchParams.get('project_id')
    if (projectId) return send(200, world.proposals.filter(item => item.project_id === projectId).map(item => item.proposal))
    const page = Number(parsed.searchParams.get('page') || 1)
    return send(200, page > 1 ? [] : world.recent.map(item => item.proposal))
  }
  if (parsed.hostname === 'cdn.example') return send(404, {})

  if (parsed.origin === SB) {
    if (parsed.pathname.startsWith('/rest/v1/deals')) return send(200, [])
    if (parsed.pathname === '/rest/v1/app_settings' && method === 'POST' && !parsed.searchParams.has('on_conflict')) {
      if (!Array.isArray(body) || body.some(row => world.settings.has(row.key))) return send(409, { message: 'duplicate key' })
      for (const row of body) world.settings.set(row.key, row.value)
      return send(201, body.map(row => ({ key: row.key, value: row.value })))
    }
    if (parsed.pathname === '/rest/v1/app_settings' && method === 'POST') {
      world.settings.set(body.key, body.value)
      return send(201, {})
    }
    if (parsed.pathname === '/rest/v1/app_settings' && method === 'PATCH') {
      const key = decodeURIComponent(parsed.searchParams.get('key') || '').replace(/^eq\./, '')
      const from = decodeURIComponent(parsed.searchParams.get('value->>state') || '').replace(/^eq\./, '')
      const current = world.settings.get(key)
      if (!current || current.state !== from) return send(200, [])
      world.settings.set(key, body.value)
      return send(200, [{ key, value: body.value }])
    }
    if (parsed.pathname === '/rest/v1/app_settings' && method === 'GET') {
      const key = decodeURIComponent(parsed.searchParams.get('key') || '').replace(/^eq\./, '')
      const value = world.settings.get(key)
      return send(200, value === undefined ? [] : [{ key, value }])
    }
    return send(404, { message: 'unexpected supabase ' + parsed.pathname })
  }

  if (parsed.origin !== GHL) return send(404, { message: 'unexpected ' + href })
  if (parsed.pathname.startsWith('/opportunities/search')) {
    if (world.incomplete) return send(200, { opportunities: world.opportunities.slice(0, 100) })
    const start = parsed.searchParams.get('startAfterId') === 'page2' ? 100 : 0
    const rows = world.opportunities.slice(start, start + 100)
    const more = start + rows.length < world.opportunities.length
    const meta = more
      ? { nextPageUrl: `${GHL}/opportunities/search?location_id=${LOC}&limit=100&startAfterId=page2&startAfter=100` }
      : { total: world.opportunities.length }
    return send(200, { opportunities: rows, meta })
  }
  if (parsed.pathname === '/opportunities/' && method === 'POST') {
    const projectId = String((body.customFields || []).find(field => field.id === PROJECT_FIELD)?.field_value || '')
    world.creates.push({ projectId, body })
    if (world.failCreate.has(projectId)) return send(400, { message: 'rejected' })
    const id = `created-${projectId}`
    world.opportunities.push({
      id, contactId: body.contactId, status: 'open', pipelineId: body.pipelineId, monetaryValue: body.monetaryValue,
      customFields: (body.customFields || []).map(field => ({ ...field, fieldValueString: field.field_value == null ? '' : String(field.field_value), value: field.field_value })),
    })
    if (world.landThenThrow.has(projectId)) throw new Error('network timeout')
    return send(200, { opportunity: { id } })
  }
  if (method === 'PUT' && parsed.pathname.startsWith('/opportunities/')) {
    const id = decodeURIComponent(parsed.pathname.split('/').at(-1))
    world.puts.push({ id, body })
    return send(200, { opportunity: { id } })
  }
  if (method === 'GET' && parsed.pathname.startsWith('/opportunities/')) {
    const id = decodeURIComponent(parsed.pathname.split('/').at(-1))
    const opp = world.opportunities.find(item => item.id === id)
    return opp ? send(200, { opportunity: opp }) : send(404, {})
  }
  if (parsed.pathname.startsWith('/contacts/search/duplicate')) {
    return send(200, { contact: world.byPhone[parsed.searchParams.get('number')] || null })
  }
  if (parsed.pathname.startsWith('/contacts/') && method === 'GET') {
    const query = parsed.searchParams.get('query') || ''
    const contacts = world.contacts.filter(contact => contact.email === query.toLowerCase() || contact.contactName === query)
    return send(200, { contacts })
  }
  if (parsed.pathname === '/contacts/upsert' && method === 'POST') {
    world.upserts.push(body)
    if (String(body.phone || '').includes('_')) return send(400, { message: 'invalid phone' })
    if (world.upsertStatus !== 200) return send(world.upsertStatus, { message: 'upsert failed' })
    return send(200, { contact: { id: world.upsertContactId || 'upserted-contact' } })
  }
  if (method === 'PUT' && parsed.pathname.startsWith('/contacts/')) return send(200, { contact: { id: parsed.pathname.split('/').at(-1) } })
  if (parsed.pathname === '/conversations/messages' && method === 'POST') {
    world.smsAttempts = world.smsAttempts || []
    world.smsAttempts.push(body.contactId)
    if (world.smsTimeout.has(body.contactId)) throw new Error('network timeout')
    const message = { messageId: `msg-${world.sms.length + 1}`, conversationId: 'conv-1' }
    world.sms.push({ ...message, contactId: body.contactId })
    return send(200, message)
  }
  if (parsed.pathname.startsWith('/users/')) return send(200, { users: [] })
  if (parsed.pathname.includes('/customFields')) return send(200, { customFields: [] })
  return send(404, { message: 'unexpected ghl ' + method + ' ' + parsed.pathname })
}

const { arcsiteToGhl, arcValueSweep, arcContractAudit, sendSaleAlert, resetArcSaleMemoryForTests } = await import('../server.js')

function projectFixture({ projectId, proposalId, total, phone, email, name, pdf = false, monetaryValue = null, opp = null, recent = true }) {
  const proposal = {
    proposal_id: proposalId, project_id: projectId, status: 'APPROVED', total, pdf_url: pdf ? 'https://cdn.example/contract.pdf' : null,
    proposal_options: [], customer_name: name, customer_email: email,
  }
  return {
    project_id: projectId,
    recent,
    proposal,
    project: {
      name, sales_rep: { name: 'Alex Example' },
      customer: { name, phone, email, address: { street: '1 Example St', city: 'Phoenix', state: 'AZ', zip_code: '85001' } },
    },
    opp, monetaryValue,
  }
}

function reset(next) {
  world = next
  resetArcSaleMemoryForTests()
}

test('existing won opportunity without the Project ID is not created or texted again', async () => {
  const phone = '555_010_0199'
  const fixture = projectFixture({
    projectId: DURWOOD, proposalId: '621393', total: 2570.59, phone, email: 'fixture-a@example.com', name: 'Fixture A',
  })
  const won = {
    id: DURWOOD_OPP, contactId: 'contact-a', status: 'won', pipelineId: 'pipe-outside', monetaryValue: 2570.59, customFields: [],
  }
  const seen = { [DURWOOD]: { t: 2570.59, p: '621393' } }
  reset(makeWorld([...fillers(100), won], [fixture], {
    contacts: [{ id: 'contact-a', email: 'fixture-a@example.com', contactName: 'Fixture A' }],
    byPhone: { '+15550100199': { id: 'contact-a', email: 'fixture-a@example.com', contactName: 'Fixture A' } },
    settings: [['arcsite_value_seen', seen]],
  }))
  const seeded = await arcValueSweep()
  assert.equal(creates(), 0)
  assert.equal(texts(), 0)
  assert.deepEqual(world.settings.get('arcsite_value_seen'), seen)
  assert.equal(seeded.reprocessed.length, 0)

  world.settings.delete('arcsite_value_seen')
  resetArcSaleMemoryForTests()
  const webhook = await arcsiteToGhl(JSON.stringify({ status: 'APPROVED', project_id: DURWOOD, proposal_id: '621393' }))
  assert.equal(webhook.action, 'held')
  assert.equal(creates(), 0)
  assert.equal(texts(), 0)
  assert.equal(world.upserts.length, 0)
  assert.ok(world.calls.some(call => call.href.includes('/opportunities/search')))
  assert.ok(world.calls.some(call => call.href.includes('startAfterId=page2')))
  assert.equal(world.settings.get(`arcsite_opp_create_${DURWOOD}`).state, 'uncertain')
  assert.equal(world.settings.get(`arcsite_opp_create_${DURWOOD}`).reason, 'existing_won_without_project_id')

  fixture.project.customer.phone = '5550100199'
  resetArcSaleMemoryForTests()
  const fixedPhone = await arcsiteToGhl(JSON.stringify({ status: 'APPROVED', project_id: DURWOOD, proposal_id: '621393' }))
  assert.notEqual(fixedPhone.action, 'created')
  assert.equal(creates(), 0)
  assert.equal(texts(), 0)
  assert.equal(world.upserts.length, 0)

  world.opportunities = world.opportunities.filter(item => item.id !== DURWOOD_OPP)
  resetArcSaleMemoryForTests()
  const afterPhoneOnly = await arcsiteToGhl(JSON.stringify({ status: 'APPROVED', project_id: DURWOOD, proposal_id: '621393' }))
  assert.equal(afterPhoneOnly.action, 'create_blocked')
  assert.equal(creates(), 0)
  assert.equal(texts(), 0)

  resetArcSaleMemoryForTests()
  await arcValueSweep()
  resetArcSaleMemoryForTests()
  await arcContractAudit({ fix: true })
  assert.equal(creates(), 0)
  assert.equal(texts(), 0)
  assert.equal(putIds().includes(DURWOOD_OPP), false)
  assert.equal(world.settings.has('arcsite_value_seen'), false)
})

test('a later signed proposal updates the opportunity that already has the Project ID', async () => {
  const fixture = projectFixture({
    projectId: KRISTINE, proposalId: '700002', total: 4200, phone: '555_010_0188', email: 'fixture-b@example.com', name: 'Fixture B', pdf: true,
  })
  const existing = {
    id: KRISTINE_OPP, contactId: 'contact-b', status: 'open', pipelineId: 'pipe-outside', monetaryValue: 3000,
    customFields: [
      { id: PROJECT_FIELD, fieldValueString: KRISTINE },
      { id: INSTALL_FIELD, fieldValueDate: Date.now() },
    ],
  }
  reset(makeWorld([...fillers(100, 'contact-b'), existing], [fixture], {
    contacts: [{ id: 'contact-b', email: 'fixture-b@example.com', contactName: 'Fixture B' }],
    byPhone: { '+15550100188': { id: 'contact-b', email: 'fixture-b@example.com', contactName: 'Fixture B' } },
    upsertStatus: 200,
  }))
  world.upsertContactId = 'contact-b'
  const webhook = await arcsiteToGhl(JSON.stringify({ status: 'APPROVED', project_id: KRISTINE, proposal_id: '700002' }))
  assert.equal(webhook.action, 'change_order')
  assert.equal(webhook.opportunity_id, KRISTINE_OPP)
  assert.equal(creates(), 0)
  assert.equal(texts(), 0)
  assert.equal(world.upserts[0].phone, '+15550100188')
  assert.equal(putIds().includes(KRISTINE_OPP), true)

  const putsAfterWebhook = world.puts.length
  resetArcSaleMemoryForTests()
  await arcValueSweep()
  assert.equal(creates(), 0)
  assert.equal(texts(), 0)
  assert.ok(world.puts.length > putsAfterWebhook)
  assert.ok(putIds().includes(KRISTINE_OPP))

  resetArcSaleMemoryForTests()
  const audit = await arcContractAudit({ fix: true })
  assert.equal(creates(), 0)
  assert.equal(texts(), 0)
  assert.ok(audit.fixed.length + audit.failed.length + audit.gaps.length > 0)
  assert.ok(putIds().filter(id => id === KRISTINE_OPP).length >= 2)
})

test('a new Project ID is created once and texted once, including after the in-memory flags are cleared', async () => {
  const fixture = projectFixture({
    projectId: NEW_PROJECT, proposalId: '900001', total: 1500, phone: '555_010_0177', email: 'fixture-c@example.com', name: 'Fixture C',
  })
  reset(makeWorld([], [fixture], { contacts: [], byPhone: {} }))
  const webhook = await arcsiteToGhl(JSON.stringify({ status: 'APPROVED', project_id: NEW_PROJECT, proposal_id: '900001' }))
  assert.equal(webhook.action, 'created')
  assert.equal(webhook.opportunity_id, `created-${NEW_PROJECT}`)
  assert.equal(creates(), 1)
  assert.equal(texts(), 1)
  assert.equal(world.upserts[0].phone, '+15550100177')
  assert.equal(world.settings.get(`arcsite_opp_create_${NEW_PROJECT}`).state, 'created')
  assert.equal(world.settings.get(`arcsite_sale_alert_${NEW_PROJECT}`).state, 'sent')
  assert.equal(world.settings.get(`arcsite_sale_alert_${NEW_PROJECT}`).messageIds[0].id, 'msg-1')

  world.opportunities.forEach(item => { item.customFields = [] })
  resetArcSaleMemoryForTests()
  const retry = await arcsiteToGhl(JSON.stringify({ status: 'APPROVED', project_id: NEW_PROJECT, proposal_id: '900001' }))
  assert.notEqual(retry.deduped, true)
  assert.notEqual(retry.action, 'created')
  assert.equal(creates(), 1)
  assert.equal(texts(), 1)

  resetArcSaleMemoryForTests()
  await arcValueSweep()
  resetArcSaleMemoryForTests()
  await arcContractAudit({ fix: true })
  assert.equal(creates(), 1)
  assert.equal(texts(), 1)
})

test('an unfinished location search does not create, and a create error is not retried', async () => {
  const blocked = projectFixture({
    projectId: '900000000000002', proposalId: '900002', total: 1800, phone: '+15550100166', email: 'fixture-d@example.com', name: 'Fixture D',
  })
  reset(makeWorld(fillers(100), [blocked], { incomplete: true }))
  const missed = await arcsiteToGhl(JSON.stringify({ status: 'APPROVED', project_id: blocked.project_id, proposal_id: '900002' }))
  assert.equal(missed.action, 'lookup_blocked')
  assert.equal(creates(), 0)
  assert.equal(texts(), 0)
  assert.equal(world.upserts.length, 0)
  resetArcSaleMemoryForTests()
  await arcValueSweep()
  assert.equal(creates(), 0)
  assert.equal(texts(), 0)

  const failing = projectFixture({
    projectId: '900000000000004', proposalId: '900004', total: 1900, phone: '555_010_0166', email: 'fixture-e@example.com', name: 'Fixture E',
  })
  reset(makeWorld([], [failing], { failCreate: ['900000000000004'] }))
  const first = await arcsiteToGhl(JSON.stringify({ status: 'APPROVED', project_id: failing.project_id, proposal_id: '900004' }))
  assert.equal(first.action, 'create_blocked')
  assert.equal(creates(), 1)
  assert.equal(texts(), 0)
  assert.equal(world.settings.get('arcsite_opp_create_900000000000004').state, 'failed')
  failing.project.customer.phone = '+15550100166'
  world.failCreate.clear()
  resetArcSaleMemoryForTests()
  const second = await arcsiteToGhl(JSON.stringify({ status: 'APPROVED', project_id: failing.project_id, proposal_id: '900004' }))
  assert.equal(second.action, 'create_blocked')
  assert.equal(creates(), 1)
  assert.equal(texts(), 0)
})

test('a create that lands without a response is reconciled and not repeated', async () => {
  const fixture = projectFixture({
    projectId: '900000000000003', proposalId: '900003', total: 1600, phone: '5550100155', email: 'fixture-f@example.com', name: 'Fixture F',
  })
  reset(makeWorld([], [fixture], { landThenThrow: ['900000000000003'] }))
  const first = await arcsiteToGhl(JSON.stringify({ status: 'APPROVED', project_id: fixture.project_id, proposal_id: '900003' }))
  assert.equal(creates(), 1)
  assert.equal(texts(), 1)
  assert.equal(first.opportunity_id, 'created-900000000000003')
  assert.equal(world.settings.get('arcsite_opp_create_900000000000003').state, 'created')
  world.landThenThrow.clear()
  world.opportunities.forEach(item => { item.customFields = [] })
  resetArcSaleMemoryForTests()
  await arcsiteToGhl(JSON.stringify({ status: 'APPROVED', project_id: fixture.project_id, proposal_id: '900003' }))
  assert.equal(creates(), 1)
  assert.equal(texts(), 1)
})

test('a partial sale alert stays unresolved and is not sent again', async () => {
  reset(makeWorld([], [], { smsTimeout: ['recipient-b'] }))
  const eventId = saleEventId('900000000000009', '900009', 'approved')
  const first = await sendSaleAlert('900000000000009', {
    eventId, recipients: ['recipient-a', 'recipient-b'], customer: 'Fixture G', price: 10, baseline: 4, markup: 1,
  })
  assert.equal(first.uncertain, true)
  assert.equal(world.smsAttempts.length, 2)
  assert.deepEqual(world.sms.map(row => row.contactId), ['recipient-a'])
  const row = world.settings.get('arcsite_sale_alert_900000000000009')
  assert.equal(row.state, 'uncertain')
  assert.notEqual(row.state, 'sent')
  assert.equal(row.recipients.find(item => item.contactId === 'recipient-a').messageIds.length > 0, true)
  assert.equal(row.recipients.find(item => item.contactId === 'recipient-b').messageIds.length, 0)
  resetArcSaleMemoryForTests()
  const second = await sendSaleAlert('900000000000009', {
    eventId, recipients: ['recipient-a', 'recipient-b'], customer: 'Fixture G', price: 10, baseline: 4, markup: 1,
  })
  assert.equal(second.uncertain, true)
  assert.equal(second.skipped, 'unresolved')
  assert.equal(world.smsAttempts.length, 2)
  assert.equal(world.sms.length, 1)
  assert.equal(world.settings.get('arcsite_sale_alert_900000000000009').state, 'uncertain')
})

test('multiple opportunities with one Project ID are not chosen, created, or texted', async () => {
  const projectId = '900000000000010'
  const fixture = projectFixture({
    projectId, proposalId: '900010', total: 2100, phone: '555_010_0144', email: 'fixture-g@example.com', name: 'Fixture G', pdf: true,
  })
  const match = (id) => ({
    id, contactId: 'contact-g', status: 'open', pipelineId: 'pipe-outside', monetaryValue: 1000,
    customFields: [{ id: PROJECT_FIELD, fieldValueString: projectId }, { id: INSTALL_FIELD, fieldValueDate: Date.now() }],
  })
  reset(makeWorld([...fillers(99, 'other-contact'), match('match-a'), match('match-b')], [fixture], {
    contacts: [{ id: 'contact-g', email: 'fixture-g@example.com', contactName: 'Fixture G' }],
    byPhone: { '+15550100144': { id: 'contact-g', email: 'fixture-g@example.com', contactName: 'Fixture G' } },
  }))
  const webhook = await arcsiteToGhl(JSON.stringify({ status: 'APPROVED', project_id: projectId, proposal_id: '900010' }))
  assert.equal(webhook.action, 'ambiguous')
  assert.equal(creates(), 0)
  assert.equal(texts(), 0)
  assert.equal(world.puts.length, 0)
  assert.equal(world.upserts.length, 0)
  assert.ok(world.calls.some(call => call.href.includes('startAfterId=page2')))
  resetArcSaleMemoryForTests()
  await arcValueSweep()
  resetArcSaleMemoryForTests()
  await arcContractAudit({ fix: true })
  assert.equal(creates(), 0)
  assert.equal(texts(), 0)
  assert.equal(world.puts.length, 0)
})

test('multiple blank Project ID candidates are not chosen, created, or texted', async () => {
  const projectId = '900000000000011'
  const fixture = projectFixture({
    projectId, proposalId: '900011', total: 2200, phone: '555_010_0133', email: 'fixture-h@example.com', name: 'Fixture H',
  })
  const blank = (id, status) => ({
    id, contactId: 'contact-h', status, pipelineId: 'pipe-outside', monetaryValue: 500, customFields: [],
  })
  reset(makeWorld([blank('blank-open', 'open'), blank('blank-won', 'won')], [fixture], {
    contacts: [{ id: 'contact-h', email: 'fixture-h@example.com', contactName: 'Fixture H' }],
    byPhone: { '+15550100133': { id: 'contact-h', email: 'fixture-h@example.com', contactName: 'Fixture H' } },
  }))
  const webhook = await arcsiteToGhl(JSON.stringify({ status: 'APPROVED', project_id: projectId, proposal_id: '900011' }))
  assert.equal(webhook.action, 'ambiguous')
  assert.equal(webhook.reason, 'ambiguous_blank_project_id')
  assert.equal(creates(), 0)
  assert.equal(texts(), 0)
  assert.equal(world.puts.length, 0)
  assert.equal(world.upserts.length, 0)
  resetArcSaleMemoryForTests()
  await arcValueSweep()
  assert.equal(creates(), 0)
  assert.equal(texts(), 0)
  assert.equal(world.puts.length, 0)
})
