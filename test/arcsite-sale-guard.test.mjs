import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeHighLevelPhone, scanLocationOpportunities, resolveSaleContacts, decideUnmatchedProject,
  createSaleLedger, saleEventId, messageIdentifiers, createProjectKey, createEventKey, alertProjectKey, alertEventKey,
} from '../lib/arcsite-sale-guard.mjs'

const ORIGIN = 'https://services.leadconnectorhq.com'
const LOC = 'loc-test'
const PID = '282300044590465'
const pidOf = (opp) => {
  for (const field of opp.customFields || []) if (field.id === 'project') return String(field.value || '')
  return ''
}

test('valid phones normalize to E.164 and short or empty phones do not', () => {
  assert.deepEqual(normalizeHighLevelPhone('555_010_0199'), { ok: true, e164: '+15550100199' })
  assert.deepEqual(normalizeHighLevelPhone('+1 (555) 010-0199'), { ok: true, e164: '+15550100199' })
  assert.deepEqual(normalizeHighLevelPhone('15550100199'), { ok: true, e164: '+15550100199' })
  assert.equal(normalizeHighLevelPhone('555_010').ok, false)
  assert.equal(normalizeHighLevelPhone('').ok, false)
  assert.equal(normalizeHighLevelPhone(null).ok, false)
})

test('a full opportunity page without a cursor is not an empty result', async () => {
  let calls = 0
  const scan = await scanLocationOpportunities({
    locationId: LOC, origin: ORIGIN, projectIdOf: pidOf, stopAtProjectId: PID,
    get: async () => {
      calls++
      return { opportunities: Array.from({ length: 100 }, (_, i) => ({ id: `filler-${i}`, contactId: 'other', status: 'won', customFields: [] })) }
    },
  })
  assert.equal(calls, 1)
  assert.equal(scan.complete, false)
  assert.equal(scan.status, 'incomplete')
  assert.equal(scan.found, null)
})

test('Project ID on a later page is a match and a failed later page is not absence', async () => {
  const pages = [
    { opportunities: [{ id: 'early', contactId: 'c1', status: 'open', customFields: [{ id: 'project', value: '111111111111' }] }], meta: { nextPageUrl: `${ORIGIN}/opportunities/search?location_id=${LOC}&limit=100&page=2` } },
    { opportunities: [{ id: 'target', contactId: 'c2', status: 'won', customFields: [{ id: 'project', value: PID }] }] },
  ]
  let calls = 0
  const found = await scanLocationOpportunities({
    locationId: LOC, origin: ORIGIN, projectIdOf: pidOf, stopAtProjectId: PID, limit: 100,
    get: async () => pages[calls++],
  })
  assert.equal(found.status, 'found')
  assert.equal(found.found.id, 'target')
  assert.equal(calls, 2)

  const failed = await scanLocationOpportunities({
    locationId: LOC, origin: ORIGIN, projectIdOf: pidOf, stopAtProjectId: PID,
    get: async (path) => {
      if (path.includes('page=2')) throw new Error('GHL 500: unavailable')
      return pages[0]
    },
  })
  assert.equal(failed.complete, false)
  assert.equal(failed.found, null)
  assert.equal(failed.status, 'failed')
})

test('a finished scan with no Project ID can see a won opportunity that has none', async () => {
  const scan = await scanLocationOpportunities({
    locationId: LOC, origin: ORIGIN, projectIdOf: pidOf, stopAtProjectId: PID,
    get: async () => ({ opportunities: [{ id: '8zEScViwcj06XXqg31ik', contactId: 'contact-a', status: 'won', monetaryValue: 2570.59, customFields: [] }] }),
  })
  assert.equal(scan.complete, true)
  assert.equal(scan.status, 'absent')
  const decision = decideUnmatchedProject({
    contacts: [{ id: 'contact-a' }], opportunities: scan.opportunities, pipelineId: 'pipe',
  })
  assert.equal(decision.action, 'hold')
  assert.equal(decision.reason, 'existing_won_without_project_id')
  assert.deepEqual(decideUnmatchedProject({
    contacts: [{ id: 'someone-else' }], opportunities: scan.opportunities, pipelineId: 'pipe',
  }).action, 'create')
  const open = { ...scan.opportunities[0], status: 'open', pipelineId: 'pipe' }
  assert.equal(decideUnmatchedProject({ contacts: [{ id: 'contact-a' }], opportunities: [open], pipelineId: 'pipe' }).action, 'adopt')
})

test('contact search failure is incomplete and does not become no customer', async () => {
  const resolved = await resolveSaleContacts({
    phone: '555_010_0199', email: 'fixture-a@example.com', name: 'Fixture A',
    locationId: LOC, origin: ORIGIN,
    get: async (path) => {
      if (path.includes('/contacts/search/duplicate')) return { contact: { id: 'contact-a', email: 'fixture-a@example.com', contactName: 'Fixture A' } }
      if (decodeURIComponent(path).includes('fixture-a@example.com')) throw new Error('GHL 500: contact search failed')
      return { contacts: [] }
    },
  })
  assert.equal(resolved.complete, false)
  const badPhone = await resolveSaleContacts({
    phone: '555_010', email: 'fixture-a@example.com', name: 'Fixture A',
    locationId: LOC, origin: ORIGIN,
    get: async (path) => {
      assert.equal(path.includes('/contacts/search/duplicate'), false)
      if (decodeURIComponent(path).includes('fixture-a@example.com')) return { contacts: [{ id: 'contact-a', email: 'fixture-a@example.com' }] }
      if (path.includes('Fixture')) return { contacts: [{ id: 'contact-a', contactName: 'Fixture A' }] }
      return { contacts: [] }
    },
  })
  assert.equal(badPhone.complete, true)
  assert.equal(badPhone.rows[0].id, 'contact-a')
})

function memoryStore() {
  const db = new Map()
  let chain = Promise.resolve()
  const serial = (fn) => {
    const run = chain.then(fn, fn)
    chain = run.then(() => {}, () => {})
    return run
  }
  return {
    db,
    read: (key) => serial(async () => ({ ok: true, value: db.has(key) ? structuredClone(db.get(key)) : null })),
    insert: (rows) => serial(async () => {
      if (rows.some(row => db.has(row.key))) return { ok: false, conflict: true }
      for (const row of rows) db.set(row.key, structuredClone(row.value))
      return { ok: true }
    }),
    patch: (key, from, value) => serial(async () => {
      const current = db.get(key)
      if (!current || current.state !== from) return { ok: false }
      db.set(key, structuredClone(value))
      return { ok: true, value: structuredClone(value) }
    }),
  }
}

test('create and alert ledgers are per project and per event and do not retry', async () => {
  const eventId = saleEventId(PID, '621393', 'approved')
  assert.equal(createProjectKey(PID), `arcsite_opp_create_${PID}`)
  assert.equal(createEventKey(PID, eventId), `arcsite_opp_create_evt_${PID}_${eventId}`)
  assert.equal(alertProjectKey(PID), `arcsite_sale_alert_${PID}`)
  assert.equal(alertEventKey(PID, eventId), `arcsite_sale_alert_evt_${PID}_${eventId}`)
  const store = memoryStore()
  const ledger = createSaleLedger({ ...store, now: () => '2026-11-12T00:00:00.000Z' })
  const [first, second] = await Promise.all([
    ledger.claimCreate({ projectId: PID, eventId }),
    ledger.claimCreate({ projectId: PID, eventId }),
  ])
  assert.equal([first, second].filter(row => row.proceed).length, 1)
  const winner = first.proceed ? first : second
  assert.equal(winner.record.state, 'intent')
  assert.equal(store.db.get(createEventKey(PID, eventId)).state, 'intent')
  await ledger.finishCreate({ projectId: PID, eventId, state: 'uncertain', reason: 'create_error' })
  const retry = await ledger.claimCreate({ projectId: PID, eventId: saleEventId(PID, '621393', 'retry') })
  assert.equal(retry.proceed, false)
  assert.equal(retry.record.state, 'uncertain')
  const held = await ledger.holdCreate({ projectId: '282300041920658', eventId, reason: 'existing_won_without_project_id' })
  assert.equal(held.held, true)
  assert.equal((await ledger.claimCreate({ projectId: '282300041920658', eventId })).proceed, false)

  const alertDb = memoryStore()
  const alert = createSaleLedger({ ...alertDb, now: () => '2026-11-12T00:00:00.000Z' })
  const send = await alert.claimAlert({ projectId: PID, eventId, recipients: ['recipient-a', 'recipient-b'] })
  assert.equal(send.send, true)
  assert.deepEqual(send.pending, ['recipient-a', 'recipient-b'])
  const ids = messageIdentifiers({ messageId: 'msg-1', conversationId: 'conv-1', message: 'Customer Name: hidden' })
  assert.deepEqual(ids, [{ kind: 'messageId', id: 'msg-1' }, { kind: 'conversationId', id: 'conv-1' }])
  await alert.finishAlert({
    projectId: PID, eventId, reason: 'send_error',
    outcomes: [
      { contactId: 'recipient-a', ok: true, messageIds: ids },
      { contactId: 'recipient-b', ok: false, messageIds: [], reason: 'send_error' },
    ],
  })
  const partial = alertDb.db.get(alertProjectKey(PID))
  assert.equal(partial.state, 'uncertain')
  assert.equal(partial.recipients.find(row => row.contactId === 'recipient-a').messageIds[0].id, 'msg-1')
  assert.equal(partial.recipients.find(row => row.contactId === 'recipient-b').state, 'uncertain')
  const again = await alert.claimAlert({ projectId: PID, eventId, recipients: ['recipient-a', 'recipient-b'] })
  assert.equal(again.send, false)
  assert.deepEqual(again.pending, [])
  assert.equal(again.reason, 'unresolved')
  assert.notEqual(again.record.state, 'sent')
})

test('a second Project ID match is ambiguous and a single match waits until the list ends', async () => {
  const page = (rows, next) => ({ opportunities: rows, meta: next ? { nextPageUrl: `${ORIGIN}/opportunities/search?location_id=${LOC}&limit=100&${next}` } : {} })
  const one = (id, project) => ({ id, contactId: 'c', status: 'open', customFields: [{ id: 'project', value: project }] })
  let calls = 0
  const ambiguous = await scanLocationOpportunities({
    locationId: LOC, origin: ORIGIN, projectIdOf: pidOf, stopAtProjectId: PID,
    get: async () => {
      calls++
      return calls === 1 ? page([one('first', PID)], 'page=2') : page([one('second', PID)])
    },
  })
  assert.equal(calls, 2)
  assert.equal(ambiguous.status, 'ambiguous')
  assert.equal(ambiguous.found, null)
  assert.equal(ambiguous.byProject.get(PID).length, 2)

  const blanks = [
    { id: 'blank-1', contactId: 'contact-a', status: 'open', projectId: '', pipelineId: 'pipe' },
    { id: 'blank-2', contactId: 'contact-a', status: 'won', projectId: '', pipelineId: 'pipe' },
  ]
  const decision = decideUnmatchedProject({ contacts: [{ id: 'contact-a' }], opportunities: blanks, pipelineId: 'pipe' })
  assert.equal(decision.action, 'ambiguous')
  assert.deepEqual(decision.opportunityIds, ['blank-1', 'blank-2'])
  assert.equal(decideUnmatchedProject({
    contacts: [{ id: 'contact-a' }], opportunities: [blanks[0]], pipelineId: 'pipe',
  }).action, 'adopt')
})

test('a final page that reaches GHL\'s own total is complete even when meta.nextPage lies (live GHL shape, Nov 12 2026)', async () => {
  // GHL returns 14 full pages then a short page (92 rows) whose meta says nextPage: 2 with no cursor: 1400 + 92 = total 1492.
  const row = i => ({ id: 'o' + i, contactId: 'c' + i, status: 'open', customFields: [] })
  const TOTAL = 1492
  const pages = []
  for (let p = 0; p < 14; p++) pages.push({ opportunities: Array.from({ length: 100 }, (_, i) => row(p * 100 + i)), meta: { total: TOTAL, nextPageUrl: `${ORIGIN}/opportunities/search?location_id=${LOC}&limit=100&startAfterId=o${p * 100 + 99}&startAfter=${p + 1}` } })
  pages.push({ opportunities: Array.from({ length: 92 }, (_, i) => row(1500 + i)), meta: { total: TOTAL, nextPageUrl: null, startAfterId: null, startAfter: null, currentPage: 1, nextPage: 2, prevPage: null } })
  let n = 0
  const get = async () => pages[Math.min(n++, pages.length - 1)]
  const s = await scanLocationOpportunities({ get, locationId: LOC, origin: ORIGIN, projectIdOf: () => '', limit: 100, maxPages: 300, stopAtProjectId: '282300045519074' })
  assert.equal(s.complete, true); assert.equal(s.status, 'absent'); assert.equal(s.opportunities.length, TOTAL); assert.equal(n, 15)
  // the same lie BEFORE the total is reached is still a real gap and still blocks
  const short = [{ opportunities: Array.from({ length: 50 }, (_, i) => row(i)), meta: { total: 200, nextPageUrl: null, startAfterId: null, startAfter: null, nextPage: 2 } }]
  const s2 = await scanLocationOpportunities({ get: async () => short[0], locationId: LOC, origin: ORIGIN, projectIdOf: () => '', limit: 100, maxPages: 300, stopAtProjectId: 'x' })
  assert.equal(s2.complete, false); assert.equal(s2.status, 'incomplete')
})
