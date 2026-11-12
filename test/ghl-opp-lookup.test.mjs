import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  OppLookupError, authorizeNewSale, authorizeSaleText, classifySearchPage,
  evaluateMissedSale, guardOpportunityScan, GHL_API_ORIGIN,
} from '../lib/ghl-opp-lookup.mjs'

const LOCATION = 'test-location'
const PROPOSAL = { project_id: 'proj-1', customer_name: 'Pat Example', customer_email: 'pat@example.test' }
const CONTACT = { id: 'contact-1' }
const ORIGIN = GHL_API_ORIGIN

function noSale(result) {
  assert.equal(result.created, false)
  assert.equal(result.opportunity_created, false)
  assert.equal(result.sendSaleText, false)
  assert.equal(result.allowCreate, false)
  assert.equal(result.alert, 'not_sent')
  assert.notEqual(authorizeNewSale(result).action, 'authorized')
  assert.equal(authorizeSaleText(result, { created: true }).sendSaleText, false)
}

function sweepDeps(get, extra = {}) {
  return {
    get, locationId: LOCATION, contactLimit: 2, oppLimit: 2, maxPages: 5,
    projectIdOf: (opp) => String(opp.projectId || ''),
    ...extra,
  }
}

async function sweep(get, proposal = PROPOSAL, extra) {
  const reprocessed = []
  const decision = await evaluateMissedSale(proposal, sweepDeps(get, extra))
  if (decision.action === 'absent' && decision.reprocess === true) reprocessed.push(proposal.project_id)
  return { decision, reprocessed }
}

async function importer(get, { contactId = 'contact-1', projectId = 'proj-1', limit = 2 } = {}) {
  const created = []
  const texts = []
  const guard = await guardOpportunityScan(contactId, get, {
    locationId: LOCATION, limit, maxPages: 5,
    match: (opp) => String(opp.projectId || '') === projectId,
  })
  if (guard.action !== 'lookup_blocked') {
    const existing = guard.action === 'matched' ? guard.opportunity : null
    if (!existing && authorizeNewSale(guard).action === 'authorized') {
      created.push('opportunity')
      if (authorizeSaleText(guard, { created: true }).sendSaleText) texts.push('sale-text')
    }
  }
  return { guard, created, texts }
}

function router({ contacts, opportunities, contactError, oppError } = {}) {
  const calls = []
  const get = async (path) => {
    calls.push(path)
    if (path.includes('/contacts/')) {
      if (contactError) throw contactError
      return typeof contacts === 'function' ? contacts(path) : contacts
    }
    if (path.includes('/opportunities/search')) {
      if (oppError) throw oppError
      return typeof opportunities === 'function' ? opportunities(path) : opportunities
    }
    throw new Error('unexpected path ' + path)
  }
  return { get, calls }
}

const oneContact = { contacts: [CONTACT], meta: { total: 1 } }
const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })

test('lookup module cannot call HighLevel or read credentials by itself', () => {
  const src = readFileSync(new URL('../lib/ghl-opp-lookup.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /\bfetch\s*\(/)
  assert.doesNotMatch(src, /process\.env/)
  assert.doesNotMatch(src, /GHL_API_TOKEN|GHL_WRITE_TOKEN|GHL_SMS_TOKEN|GHL_MEDIA_TOKEN/)
  assert.doesNotMatch(src, /282300036920450/)
})

test('timeout during contact search does not reprocess, create, or text', async () => {
  const fake = router({ contactError: timeout })
  const { decision, reprocessed } = await sweep(fake.get)
  assert.equal(decision.action, 'lookup_blocked')
  assert.equal(decision.code, 'failed')
  assert.equal(decision.reprocess, false)
  noSale(decision)
  assert.deepEqual(reprocessed, [])
  assert.equal(fake.calls.some(path => path.includes('/opportunities/')), false)
  const imported = await importer(async () => { throw timeout })
  assert.equal(imported.guard.code, 'failed')
  assert.deepEqual(imported.created, [])
  assert.deepEqual(imported.texts, [])
})

test('timeout during opportunity search does not reprocess, create, or text', async () => {
  const fake = router({ contacts: oneContact, oppError: timeout })
  const { decision, reprocessed } = await sweep(fake.get)
  assert.equal(decision.action, 'lookup_blocked')
  assert.equal(decision.code, 'failed')
  assert.match(decision.detail, /timeout/i)
  noSale(decision)
  assert.deepEqual(reprocessed, [])
  const imported = await importer(fake.get)
  assert.equal(imported.guard.action, 'lookup_blocked')
  assert.equal(imported.guard.opportunities, null)
  assert.deepEqual(imported.created, [])
  assert.deepEqual(imported.texts, [])
})

test('HTTP 500 during opportunity search does not reprocess, create, or text', async () => {
  const fake = router({ contacts: oneContact, oppError: new Error('GHL 503: upstream unavailable') })
  const { decision, reprocessed } = await sweep(fake.get)
  assert.equal(decision.code, 'failed')
  assert.match(decision.detail, /503/)
  noSale(decision)
  assert.deepEqual(reprocessed, [])
  const imported = await importer(fake.get)
  assert.deepEqual(imported.created, [])
  assert.deepEqual(imported.texts, [])
})

test('HTTP 401 during opportunity search does not reprocess, create, or text, and redacts the bearer token', async () => {
  const fake = router({ contacts: oneContact, oppError: new Error('GHL 401: Bearer super-secret-token') })
  const { decision, reprocessed } = await sweep(fake.get)
  assert.equal(decision.code, 'failed')
  assert.match(decision.detail, /401/)
  assert.match(decision.detail, /Bearer \[redacted\]/)
  assert.doesNotMatch(decision.detail, /super-secret-token/)
  assert.doesNotMatch(JSON.stringify(decision), /super-secret-token/)
  noSale(decision)
  assert.deepEqual(reprocessed, [])
  const imported = await importer(fake.get)
  assert.deepEqual(imported.created, [])
  assert.deepEqual(imported.texts, [])
  assert.doesNotMatch(JSON.stringify(imported.guard), /super-secret-token/)
})

test('missing, null, or non-array opportunity results are uncertain and do not create or text', async () => {
  for (const body of [undefined, null, {}, { opportunities: null }, { opportunities: 'none' }, { ok: true }]) {
    const fake = router({ contacts: oneContact, opportunities: body })
    const { decision, reprocessed } = await sweep(fake.get)
    assert.equal(decision.action, 'lookup_blocked', JSON.stringify(body))
    assert.equal(decision.code, 'uncertain', JSON.stringify(body))
    noSale(decision)
    assert.deepEqual(reprocessed, [])
    const imported = await importer(async (path) => path.includes('/opportunities/') ? body : oneContact)
    assert.equal(imported.guard.action, 'lookup_blocked')
    assert.deepEqual(imported.created, [])
    assert.deepEqual(imported.texts, [])
  }
})

test('a contact search with no contacts array is not treated as no opportunity', async () => {
  for (const body of [undefined, {}, { contacts: null }]) {
    const fake = router({ contacts: body })
    const { decision, reprocessed } = await sweep(fake.get)
    assert.equal(decision.action, 'lookup_blocked')
    assert.equal(decision.code, 'uncertain')
    noSale(decision)
    assert.deepEqual(reprocessed, [])
    assert.equal(fake.calls.some(path => path.includes('/opportunities/')), false)
  }
})

test('a finished empty contact search authorizes a reprocess decision but does not itself create or text', async () => {
  const fake = router({ contacts: { contacts: [], meta: { total: 0 } } })
  const { decision, reprocessed } = await sweep(fake.get)
  assert.equal(decision.action, 'absent')
  assert.equal(decision.reprocess, true)
  assert.deepEqual(reprocessed, ['proj-1'])
  noSale(decision)
  assert.equal(fake.calls.some(path => path.includes('/opportunities/')), false)
})

test('a finished empty opportunity list authorizes create, and a sale text only after that create', async () => {
  const fake = router({ contacts: oneContact, opportunities: { opportunities: [], meta: { total: 0 } } })
  const imported = await importer(fake.get)
  assert.equal(imported.guard.action, 'clear')
  assert.equal(imported.guard.allowCreate, true)
  assert.equal(authorizeSaleText(imported.guard, { created: false }).sendSaleText, false)
  assert.deepEqual(imported.created, ['opportunity'])
  assert.deepEqual(imported.texts, ['sale-text'])
  const matched = await importer(router({
    opportunities: { opportunities: [{ id: 'opp-1', projectId: 'proj-1' }], meta: { total: 1 } },
  }).get)
  assert.equal(matched.guard.action, 'matched')
  assert.deepEqual(matched.created, [])
  assert.deepEqual(matched.texts, [])
  assert.equal(authorizeSaleText(matched.guard, { created: true }).sendSaleText, false)
})

test('a name match still counts when the email query returns other people', async () => {
  const fake = router({
    contacts: (path) => path.includes('pat%40example.test')
      ? { contacts: [{ id: 'someone-else' }], meta: { total: 1 } }
      : oneContact,
    opportunities: (path) => path.includes('contact_id=contact-1')
      ? { opportunities: [{ id: 'opp-1', projectId: 'proj-1' }], meta: { total: 1 } }
      : { opportunities: [], meta: { total: 0 } },
  })
  const { decision, reprocessed } = await sweep(fake.get)
  assert.equal(decision.action, 'found')
  assert.equal(decision.opportunity.id, 'opp-1')
  assert.deepEqual(reprocessed, [])
  noSale(decision)
})

test('a failed name search is not an empty result when the email contacts do not hold the project', async () => {
  const fake = router({
    contacts: (path) => {
      if (path.includes('pat%40example.test')) return { contacts: [{ id: 'someone-else' }], meta: { total: 1 } }
      throw new Error('GHL 500: name search failed')
    },
    opportunities: { opportunities: [{ id: 'other', projectId: 'other-project' }], meta: { total: 1 } },
  })
  const { decision, reprocessed } = await sweep(fake.get)
  assert.equal(decision.action, 'lookup_blocked')
  assert.equal(decision.code, 'failed')
  noSale(decision)
  assert.deepEqual(reprocessed, [])
})

test('a full opportunity page with no cursor and no total is incomplete and cannot create or text', async () => {
  const rows = [{ id: 'opp-a', projectId: 'other-a' }, { id: 'opp-b', projectId: 'other-b' }]
  const fake = router({ contacts: oneContact, opportunities: { opportunities: rows } })
  const { decision, reprocessed } = await sweep(fake.get)
  assert.equal(decision.action, 'lookup_blocked')
  assert.equal(decision.code, 'incomplete')
  noSale(decision)
  assert.deepEqual(reprocessed, [])
  const imported = await importer(fake.get)
  assert.equal(imported.guard.code, 'incomplete')
  assert.equal(imported.guard.opportunities, null)
  assert.deepEqual(imported.created, [])
  assert.deepEqual(imported.texts, [])
})

test('the same capped page still matches an opportunity it actually contains and does not create or text', async () => {
  const rows = [{ id: 'opp-a', projectId: 'other-a' }, { id: 'opp-keep', projectId: 'proj-1' }]
  const fake = router({ contacts: oneContact, opportunities: { opportunities: rows } })
  const { decision, reprocessed } = await sweep(fake.get)
  assert.equal(decision.action, 'found')
  assert.equal(decision.opportunity.id, 'opp-keep')
  assert.deepEqual(reprocessed, [])
  noSale(decision)
  const imported = await importer(fake.get)
  assert.equal(imported.guard.action, 'matched')
  assert.deepEqual(imported.created, [])
  assert.deepEqual(imported.texts, [])
})

test('one hundred opportunities with no cursor and no total are incomplete; the same page with a confirming total is complete', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: 'opp-' + i }))
  const open = classifySearchPage({ opportunities: rows }, { listKey: 'opportunities', limit: 100, collected: 0, kind: 'opportunities' })
  assert.equal(open.code, 'incomplete')
  assert.equal(open.done, false)
  const closed = classifySearchPage({ opportunities: rows, meta: { total: 100 } }, { listKey: 'opportunities', limit: 100, collected: 0, kind: 'opportunities' })
  assert.equal(closed.code, null)
  assert.equal(closed.done, true)
  const shortTotal = classifySearchPage(
    { opportunities: [{ id: 'only' }], meta: { total: 5 } },
    { listKey: 'opportunities', limit: 100, collected: 0, kind: 'opportunities' },
  )
  assert.equal(shortTotal.code, 'incomplete')
})

test('a 100-row page that contains the project is a match and does not authorize create', async () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: 'opp-' + i, projectId: i === 99 ? 'proj-1' : 'other-' + i }))
  const imported = await importer(async () => ({ opportunities: rows }), { limit: 100 })
  assert.equal(imported.guard.action, 'matched')
  assert.equal(imported.guard.opportunity.id, 'opp-99')
  assert.deepEqual(imported.created, [])
  assert.deepEqual(imported.texts, [])
  const missed = await importer(async () => ({ opportunities: rows.map(row => ({ ...row, projectId: 'other' })) }), { limit: 100 })
  assert.equal(missed.guard.action, 'lookup_blocked')
  assert.equal(missed.guard.code, 'incomplete')
  assert.deepEqual(missed.created, [])
  assert.deepEqual(missed.texts, [])
})

test('a match on the next opportunity page is found and does not create or text', async () => {
  const next = `${ORIGIN}/opportunities/search?location_id=${LOCATION}&contact_id=contact-1&limit=2&page=2`
  const fake = router({
    contacts: oneContact,
    opportunities: (path) => path.includes('page=2')
      ? { opportunities: [{ id: 'opp-2', projectId: 'proj-1' }], meta: { total: 3 } }
      : { opportunities: [{ id: 'opp-0', projectId: 'other-0' }, { id: 'opp-1', projectId: 'other-1' }], meta: { total: 3, nextPageUrl: next } },
  })
  const { decision, reprocessed } = await sweep(fake.get)
  assert.equal(decision.action, 'found')
  assert.equal(decision.opportunity.id, 'opp-2')
  assert.deepEqual(reprocessed, [])
  noSale(decision)
  assert.equal(fake.calls.filter(path => path.includes('page=2')).length, 1)
})

test('a failure on the next opportunity page discards the partial list and does not create or text', async () => {
  const next = `${ORIGIN}/opportunities/search?location_id=${LOCATION}&contact_id=contact-1&limit=2&page=2`
  const fake = router({
    contacts: oneContact,
    opportunities: (path) => {
      if (path.includes('page=2')) throw new Error('GHL 500: page 2 failed')
      return { opportunities: [{ id: 'opp-0', projectId: 'other-0' }, { id: 'opp-1', projectId: 'other-1' }], meta: { total: 3, nextPageUrl: next } }
    },
  })
  const { decision, reprocessed } = await sweep(fake.get)
  assert.equal(decision.action, 'lookup_blocked')
  assert.equal(decision.code, 'failed')
  assert.equal(decision.opportunities, null)
  noSale(decision)
  assert.deepEqual(reprocessed, [])
  const imported = await importer(fake.get)
  assert.equal(imported.guard.opportunities, null)
  assert.deepEqual(imported.created, [])
  assert.deepEqual(imported.texts, [])
})

test('an off-origin or widened opportunity cursor is not followed and does not create or text', async () => {
  for (const next of [
    'https://evil.example/opportunities/search?location_id=test-location&contact_id=contact-1&limit=2',
    `${ORIGIN}/opportunities/search?location_id=${LOCATION}&contact_id=someone-else&limit=2`,
    `${ORIGIN}/contacts/?locationId=${LOCATION}&query=Pat%20Example&limit=2`,
  ]) {
    const calls = []
    const get = async (path) => {
      calls.push(path)
      if (path.includes('/contacts/')) return oneContact
      if (path.startsWith('/opportunities/search') && !path.includes('contact_id=someone-else') && !path.includes('evil')) {
        return { opportunities: [{ id: 'a', projectId: 'other-a' }, { id: 'b', projectId: 'other-b' }], meta: { total: 3, nextPageUrl: next } }
      }
      throw new Error('cursor was followed: ' + path)
    }
    const { decision, reprocessed } = await sweep(get)
    assert.equal(decision.action, 'lookup_blocked', next)
    assert.equal(decision.code, 'uncertain', next)
    noSale(decision)
    assert.deepEqual(reprocessed, [])
    assert.equal(calls.some(path => path.includes('evil.example') || path.includes('someone-else')), false)
  }
})

test('a full contact page with no cursor is incomplete and does not create or text', async () => {
  const proposal = { project_id: 'proj-1', customer_name: 'Pat Example', customer_email: '' }
  const fake = router({
    contacts: { contacts: [{ id: 'c1' }, { id: 'c2' }] },
    opportunities: { opportunities: [], meta: { total: 0 } },
  })
  const { decision, reprocessed } = await sweep(fake.get, proposal)
  assert.equal(decision.action, 'lookup_blocked')
  assert.equal(decision.code, 'incomplete')
  noSale(decision)
  assert.deepEqual(reprocessed, [])
})

test('the contact who holds the opportunity can be on the second contact page', async () => {
  const proposal = { project_id: 'proj-1', customer_name: 'Pat Example', customer_email: '' }
  const next = `${ORIGIN}/contacts/?locationId=${LOCATION}&query=Pat%20Example&limit=2&startAfterId=c2&startAfter=2`
  const fake = router({
    contacts: (path) => path.includes('startAfterId=c2')
      ? { contacts: [{ id: 'contact-1' }], meta: { total: 3 } }
      : { contacts: [{ id: 'c1' }, { id: 'c2' }], meta: { total: 3, nextPageUrl: next } },
    opportunities: (path) => path.includes('contact_id=contact-1')
      ? { opportunities: [{ id: 'opp-1', projectId: 'proj-1' }], meta: { total: 1 } }
      : { opportunities: [], meta: { total: 0 } },
  })
  const { decision, reprocessed } = await sweep(fake.get, proposal)
  assert.equal(decision.action, 'found')
  assert.equal(decision.opportunity.id, 'opp-1')
  assert.deepEqual(reprocessed, [])
  noSale(decision)
})

test('a failed second contact page does not turn the first page into a missed sale', async () => {
  const proposal = { project_id: 'proj-1', customer_name: 'Pat Example', customer_email: '' }
  const next = `${ORIGIN}/contacts/?locationId=${LOCATION}&query=Pat%20Example&limit=2&startAfterId=c2&startAfter=2`
  const fake = router({
    contacts: (path) => {
      if (path.includes('startAfterId=c2')) throw new Error('GHL 500: contact page 2 failed')
      return { contacts: [{ id: 'c1' }, { id: 'c2' }], meta: { total: 3, nextPageUrl: next } }
    },
    opportunities: { opportunities: [], meta: { total: 0 } },
  })
  const { decision, reprocessed } = await sweep(fake.get, proposal)
  assert.equal(decision.action, 'lookup_blocked')
  assert.equal(decision.code, 'failed')
  noSale(decision)
  assert.deepEqual(reprocessed, [])
})

test('hitting the opportunity page cap before the list ends does not create or text', async () => {
  const next = `${ORIGIN}/opportunities/search?location_id=${LOCATION}&contact_id=contact-1&limit=2&page=2`
  const fake = router({
    contacts: oneContact,
    opportunities: { opportunities: [{ id: 'a', projectId: 'other-a' }, { id: 'b', projectId: 'other-b' }], meta: { total: 4, nextPageUrl: next } },
  })
  const { decision, reprocessed } = await sweep(fake.get, PROPOSAL, { maxPages: 1 })
  assert.equal(decision.action, 'lookup_blocked')
  assert.equal(decision.code, 'incomplete')
  noSale(decision)
  assert.deepEqual(reprocessed, [])
  assert.equal(fake.calls.some(path => path.includes('page=2')), false)
})

test('two finished empty lookups both still authorize reprocess; concurrent create is not guarded here', async () => {
  const get = async (path) => path.includes('/contacts/')
    ? { contacts: [], meta: { total: 0 } }
    : { opportunities: [], meta: { total: 0 } }
  const first = await sweep(get)
  const second = await sweep(get)
  assert.equal(first.decision.reprocess, true)
  assert.equal(second.decision.reprocess, true)
  noSale(first.decision)
  noSale(second.decision)
  assert.deepEqual(first.reprocessed, ['proj-1'])
  assert.deepEqual(second.reprocessed, ['proj-1'])
})

test('a lookup error is an OppLookupError and not an empty list', () => {
  const error = new OppLookupError('incomplete', 'page was full')
  assert.equal(error.name, 'OppLookupError')
  assert.equal(error.code, 'incomplete')
  assert.equal(Array.isArray(error), false)
})

test('server.js wires the sweep and the importer through the fail-closed lookup', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8')
  assert.doesNotMatch(server, /ghlContactOpps/)
  assert.doesNotMatch(server, /contact_id=\$\{contactId\}&limit=100/)
  const sweep = server.slice(server.indexOf('async function arcValueSweep'), server.indexOf('async function arcDuplicateOppScan'))
  const absentAt = sweep.indexOf("decision.action === 'absent' && decision.reprocess === true")
  const importAt = sweep.indexOf('arcsiteToGhl(')
  assert.ok(absentAt > 0 && importAt > absentAt)
  const reprocessBranch = sweep.slice(absentAt, sweep.indexOf("const opp = decision.action === 'found'"))
  assert.match(reprocessBranch, /arcsiteToGhl\(/)
  assert.match(sweep, /out\.blocked\.push/)
  assert.doesNotMatch(reprocessBranch, /ghlCreateOpp|sendSaleAlert/)
  const fn = server.slice(server.indexOf('async function arcsiteToGhl'), server.indexOf('\nconst app = express()'))
  const blockedPre = fn.indexOf("if (pre.action === 'lookup_blocked')")
  const upsert = fn.indexOf('ghlUpsertContact')
  const blockedGuard = fn.indexOf("if (guard.action === 'lookup_blocked')")
  const authorize = fn.indexOf('authorizeNewSale(guard)')
  const create = fn.indexOf('ghlCreateOpp')
  const textAuth = fn.indexOf('authorizeSaleText(guard')
  const text = fn.indexOf('sendSaleAlert')
  assert.ok(blockedPre > 0 && blockedPre < upsert, 'failed customer lookup returns before contact upsert')
  assert.ok(blockedGuard > upsert && blockedGuard < authorize, 'failed contact opportunity lookup returns before create is authorized')
  assert.ok(authorize > 0 && authorize < create, 'create is behind authorizeNewSale')
  assert.ok(textAuth > 0 && textAuth < text, 'sale text is behind authorizeSaleText')
  const createBranch = fn.slice(authorize, create)
  assert.match(createBranch, /authorized\.action !== 'authorized'/)
  assert.match(createBranch, /return/)
  assert.match(fn, /isNewSale && saleText\.sendSaleText && fieldsOk && moneyKnown/)
  assert.match(fn, /saleText\.sendSaleText && !alert/)
  assert.match(fn, /saleText\.sendSaleText \? 'deferred'/)
  assert.doesNotMatch(fn, /ghlContactOpps|opportunities \|\| \[\]/)
  assert.doesNotMatch(sweep, /opportunities \|\| \[\]|contacts \|\| \[\]/)
  const changeOrder = server.slice(server.indexOf('async function arcChangeOrderForProject'), server.indexOf('async function arcContractAudit'))
  assert.match(changeOrder, /decision\.action === 'lookup_blocked'/)
  assert.doesNotMatch(changeOrder.slice(0, changeOrder.indexOf('lookup_blocked')), /reprocess creates one/)
})
