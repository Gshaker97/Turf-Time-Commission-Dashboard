import { createHash } from 'node:crypto'

/**
 * Guards for the ArcSite → HighLevel sale path.
 *
 * A new opportunity is allowed only after a finished location-wide Project ID
 * search found nothing, the customer was resolved completely, and this process
 * inserted the durable create intent. Phone shape never grants or denies that.
 * The module does not call HighLevel and does not read credentials.
 */

export const CREATE_PREFIX = 'arcsite_opp_create_'
export const ALERT_PREFIX = 'arcsite_sale_alert_'
const KEY_RE = /^arcsite_(opp_create|sale_alert)(_evt)?_\d{6,24}(_[a-f0-9]{24})?$/

export function normalizeHighLevelPhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '')
  let national = digits
  if (national.length === 11 && national.startsWith('1')) national = national.slice(1)
  if (!/^\d{10}$/.test(national) || national === '0000000000') return { ok: false, e164: null }
  return { ok: true, e164: `+1${national}` }
}

export function saleEventId(projectId, proposalId, status) {
  return createHash('sha256')
    .update([String(projectId ?? ''), String(proposalId ?? ''), String(status ?? '')].join('\n'))
    .digest('hex')
    .slice(0, 24)
}

export function messageIdentifiers(body) {
  const ids = []
  const push = (kind, value) => {
    if (value == null || typeof value === 'object') return
    const id = String(value).trim()
    if (!id || id.length > 80 || /[\s]/.test(id)) return
    if (!ids.some(row => row.kind === kind && row.id === id)) ids.push({ kind, id })
  }
  const visit = (row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return
    push('messageId', row.messageId ?? row.message_id)
    push('id', row.id)
    push('conversationId', row.conversationId ?? row.conversation_id)
    push('emailMessageId', row.emailMessageId)
  }
  visit(body)
  if (body && typeof body === 'object') visit(body.message)
  return ids.slice(0, 20)
}

export function createOutcomeFromError(error) {
  const message = String(error?.message || error || '')
  if (/GHL opp create 4\d\d/.test(message)) return 'failed'
  return 'uncertain'
}

function assertProjectId(projectId) {
  const id = String(projectId ?? '').trim()
  if (!/^\d{6,24}$/.test(id)) {
    const error = new Error('project id rejected')
    error.code = 'uncertain'
    throw error
  }
  return id
}

function assertEventId(eventId) {
  const id = String(eventId ?? '').trim()
  if (!/^[a-f0-9]{24}$/.test(id)) {
    const error = new Error('event id rejected')
    error.code = 'uncertain'
    throw error
  }
  return id
}

export function createProjectKey(projectId) {
  const key = `${CREATE_PREFIX}${assertProjectId(projectId)}`
  if (!KEY_RE.test(key)) throw new Error('sale ledger key rejected')
  return key
}

export function createEventKey(projectId, eventId) {
  const key = `${CREATE_PREFIX}evt_${assertProjectId(projectId)}_${assertEventId(eventId)}`
  if (!KEY_RE.test(key)) throw new Error('sale ledger key rejected')
  return key
}

export function alertProjectKey(projectId) {
  const key = `${ALERT_PREFIX}${assertProjectId(projectId)}`
  if (!KEY_RE.test(key)) throw new Error('sale ledger key rejected')
  return key
}

export function alertEventKey(projectId, eventId) {
  const key = `${ALERT_PREFIX}evt_${assertProjectId(projectId)}_${assertEventId(eventId)}`
  if (!KEY_RE.test(key)) throw new Error('sale ledger key rejected')
  return key
}

function record(projectId, eventId, state, extra = {}) {
  return {
    v: 1,
    state,
    projectId,
    eventId,
    at: extra.at || new Date().toISOString(),
    opportunityId: extra.opportunityId || null,
    reason: extra.reason || null,
    messageIds: Array.isArray(extra.messageIds) ? extra.messageIds : [],
    recipients: Array.isArray(extra.recipients) ? extra.recipients : [],
  }
}

function sameRecord(a, b) {
  if (!a || !b) return false
  return a.v === b.v && a.state === b.state && a.projectId === b.projectId && a.eventId === b.eventId
    && a.at === b.at && a.opportunityId === b.opportunityId && a.reason === b.reason
    && JSON.stringify(a.messageIds) === JSON.stringify(b.messageIds)
    && JSON.stringify(a.recipients || []) === JSON.stringify(b.recipients || [])
}

function acceptedRecipient(row) {
  return Array.isArray(row?.messageIds) && row.messageIds.length > 0
}

function allRecipientsAccepted(value) {
  const rows = value?.recipients
  return Array.isArray(rows) && rows.length > 0 && rows.every(acceptedRecipient)
}

async function load(read, key) {
  const row = await read(key)
  if (!row || row.ok === false) return { ok: false, value: null }
  return { ok: true, value: row.value ?? null }
}

export function createSaleLedger({ read, insert, patch, now = () => new Date().toISOString() }) {
  if (typeof read !== 'function' || typeof insert !== 'function' || typeof patch !== 'function') {
    throw new Error('sale ledger store is incomplete')
  }

  async function transition(projectKey, eventKey, fromStates, next) {
    const current = await load(read, projectKey)
    if (!current.ok || !current.value) return { ok: false, record: current?.value || null }
    if (current.value.state === 'created' && next.state === 'created') return { ok: true, record: current.value }
    if (current.value.state === 'sent' && next.state === 'sent') return { ok: true, record: current.value }
    if (current.value.state === next.state && current.value.opportunityId === next.opportunityId && current.value.reason === next.reason
      && JSON.stringify(current.value.messageIds) === JSON.stringify(next.messageIds)
      && JSON.stringify(current.value.recipients || []) === JSON.stringify(next.recipients || [])) {
      return { ok: true, record: current.value }
    }
    if (current.value.state === 'created' || current.value.state === 'sent') return { ok: true, record: current.value, unchanged: true }
    if (!fromStates.includes(current.value.state)) return { ok: false, record: current.value }
    const projectWrite = await patch(projectKey, current.value.state, next)
    if (!projectWrite?.ok) {
      const again = await load(read, projectKey)
      return { ok: false, record: again.value }
    }
    const back = await load(read, projectKey)
    if (!back.ok || !sameRecord(back.value, next)) return { ok: false, record: back.value }
    const eventCurrent = await load(read, eventKey)
    if (eventCurrent.ok && !eventCurrent.value) await insert([{ key: eventKey, value: next }])
    else if (eventCurrent.ok && fromStates.includes(eventCurrent.value.state)) await patch(eventKey, eventCurrent.value.state, next)
    return { ok: true, record: back.value }
  }

  return {
    async holdCreate({ projectId, eventId, reason }) {
      const pid = assertProjectId(projectId)
      const eid = assertEventId(eventId)
      const projectKey = createProjectKey(pid)
      const eventKey = createEventKey(pid, eid)
      const existing = await load(read, projectKey)
      if (!existing.ok) return { ok: false, record: null }
      if (existing.value?.state) {
        const eventValue = record(pid, eid, existing.value.state, { ...existing.value, reason: existing.value.reason || reason, at: existing.value.at })
        try { await insert([{ key: eventKey, value: eventValue }]) } catch { /* project gate already blocks a create */ }
        return { ok: true, held: true, record: existing.value }
      }
      const value = record(pid, eid, 'uncertain', { reason: reason || 'existing_won_without_project_id', at: now() })
      const inserted = await insert([{ key: projectKey, value }, { key: eventKey, value }])
      if (!inserted?.ok) {
        const raced = await load(read, projectKey)
        if (raced.ok && raced.value?.state) return { ok: true, held: true, record: raced.value }
        return { ok: false, record: null }
      }
      const back = await load(read, projectKey)
      const eventBack = await load(read, eventKey)
      if (!back.ok || !eventBack.ok || !sameRecord(back.value, value) || !sameRecord(eventBack.value, value)) {
        return { ok: false, record: back.value }
      }
      return { ok: true, held: true, record: back.value }
    },

    async claimCreate({ projectId, eventId }) {
      const pid = assertProjectId(projectId)
      const eid = assertEventId(eventId)
      const projectKey = createProjectKey(pid)
      const eventKey = createEventKey(pid, eid)
      const existing = await load(read, projectKey)
      if (!existing.ok) return { proceed: false, record: null }
      if (existing.value?.state) {
        const eventValue = record(pid, eid, existing.value.state, existing.value)
        await insert([{ key: eventKey, value: eventValue }])
        return { proceed: false, record: existing.value }
      }
      const value = record(pid, eid, 'intent', { at: now() })
      const inserted = await insert([{ key: projectKey, value }, { key: eventKey, value }])
      if (!inserted?.ok) {
        const raced = await load(read, projectKey)
        return { proceed: false, record: raced.ok ? raced.value : null }
      }
      const back = await load(read, projectKey)
      const eventBack = await load(read, eventKey)
      if (!back.ok || !eventBack.ok || !sameRecord(back.value, value) || !sameRecord(eventBack.value, value)) {
        return { proceed: false, record: back.value }
      }
      return { proceed: true, record: back.value }
    },

    async finishCreate({ projectId, eventId, state, opportunityId = null, reason = null }) {
      const pid = assertProjectId(projectId)
      const eid = assertEventId(eventId)
      if (!['created', 'failed', 'uncertain'].includes(state)) return { ok: false, record: null }
      if (state === 'created' && !opportunityId) return { ok: false, record: null }
      const next = record(pid, eid, state, { opportunityId, reason, at: now() })
      return transition(createProjectKey(pid), createEventKey(pid, eid), ['intent', 'uncertain', 'failed'], next)
    },

    async claimAlert({ projectId, eventId, recipients = [] }) {
      const pid = assertProjectId(projectId)
      const eid = assertEventId(eventId)
      const projectKey = alertProjectKey(pid)
      const eventKey = alertEventKey(pid, eid)
      const existing = await load(read, projectKey)
      if (!existing.ok) return { send: false, pending: [], reason: 'unreadable' }
      if (existing.value && allRecipientsAccepted(existing.value)) {
        if (existing.value.state !== 'sent') {
          const next = record(pid, eid, 'sent', { ...existing.value, reason: 'reconciled', at: now() })
          await transition(projectKey, eventKey, ['intent', 'uncertain', 'failed'], next)
        }
        return { send: false, pending: [], reason: 'sent', record: existing.value }
      }
      if (existing.value?.state) {
        // A partial or uncertain alert stays unresolved. Recipients that already
        // have acceptance evidence are not returned, and recipients without it
        // are not offered for another send.
        return { send: false, pending: [], reason: 'unresolved', record: existing.value }
      }
      const intended = []
      for (const contactId of recipients) {
        const id = String(contactId || '').trim()
        if (id && !intended.some(row => row.contactId === id)) intended.push({ contactId: id, state: 'intent', messageIds: [] })
      }
      if (!intended.length) return { send: false, pending: [], reason: 'no_recipients' }
      const value = record(pid, eid, 'intent', { recipients: intended, at: now() })
      const inserted = await insert([{ key: projectKey, value }, { key: eventKey, value }])
      if (!inserted?.ok) {
        const raced = await load(read, projectKey)
        return { send: false, pending: [], reason: raced.value?.state || 'conflict', record: raced.value }
      }
      const back = await load(read, projectKey)
      const eventBack = await load(read, eventKey)
      if (!back.ok || !eventBack.ok || !sameRecord(back.value, value) || !sameRecord(eventBack.value, value)) {
        return { send: false, pending: [], reason: 'readback', record: back.value }
      }
      return { send: true, pending: intended.map(row => row.contactId), record: back.value }
    },

    async finishAlert({ projectId, eventId, outcomes = [], reason = null }) {
      const pid = assertProjectId(projectId)
      const eid = assertEventId(eventId)
      const projectKey = alertProjectKey(pid)
      const current = await load(read, projectKey)
      if (!current.ok || !current.value) return { ok: false, record: null }
      const byId = new Map((current.value.recipients || []).map(row => [row.contactId, { ...row, messageIds: row.messageIds || [] }]))
      for (const outcome of outcomes) {
        const contactId = String(outcome?.contactId || '').trim()
        if (!contactId || !byId.has(contactId)) continue
        const prev = byId.get(contactId)
        if (acceptedRecipient(prev)) continue
        const ids = Array.isArray(outcome?.messageIds) ? outcome.messageIds : []
        if (outcome?.ok === true && ids.length) byId.set(contactId, { contactId, state: 'accepted', messageIds: ids })
        else byId.set(contactId, { contactId, state: 'uncertain', messageIds: [], reason: outcome?.reason || 'no_acceptance' })
      }
      const recipients = [...byId.values()]
      const messageIds = recipients.flatMap(row => row.messageIds || [])
      const resolved = recipients.length > 0 && recipients.every(acceptedRecipient)
      const next = record(pid, eid, resolved ? 'sent' : 'uncertain', {
        recipients, messageIds, reason: resolved ? null : (reason || 'unresolved'), at: now(),
      })
      return transition(projectKey, alertEventKey(pid, eid), ['intent', 'uncertain', 'failed'], next)
    },
  }
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readTotal(meta) {
  if (!isRecord(meta) || meta.total == null || meta.total === '') return { value: null }
  const total = typeof meta.total === 'number' ? meta.total : Number(meta.total)
  if (!Number.isInteger(total) || total < 0 || total > 1000000) return { error: 'search total was not usable' }
  return { value: total }
}

function safeCursor(raw, { origin, locationId, kind, query }) {
  let url
  try { url = new URL(raw, origin) } catch { return { error: 'search cursor was not a url' } }
  if (url.origin !== origin) return { error: 'search cursor left HighLevel' }
  if (url.username || url.password) return { error: 'search cursor included credentials' }
  if (kind === 'opportunities') {
    if (url.pathname.replace(/\/$/, '') !== '/opportunities/search') return { error: 'search cursor left opportunity search' }
    if (url.searchParams.get('location_id') !== locationId) return { error: 'search cursor changed location' }
  } else {
    if (url.pathname.replace(/\/$/, '') !== '/contacts') return { error: 'search cursor left contact search' }
    if (url.searchParams.get('locationId') !== locationId) return { error: 'search cursor changed location' }
    if (query != null && url.searchParams.get('query') !== query) return { error: 'search cursor changed query' }
  }
  return { path: `${url.pathname}${url.search}` }
}

function continuation(meta, { pageFull, origin, locationId, kind, query, limit }) {
  if (meta == null) return { cursor: null }
  if (!isRecord(meta)) return { error: 'search metadata was unreadable' }
  if (typeof meta.nextPageUrl === 'string' && meta.nextPageUrl.trim()) {
    return { cursor: safeCursor(meta.nextPageUrl.trim(), { origin, locationId, kind, query }) }
  }
  if (meta.nextPageUrl != null && meta.nextPageUrl !== '') return { error: 'search next page was not a string' }
  const id = meta.startAfterId
  const after = meta.startAfter
  const pair = id != null && String(id) !== '' && after != null && String(after) !== ''
  if (pageFull && pair) {
    const params = new URLSearchParams()
    if (kind === 'opportunities') {
      params.set('location_id', locationId)
      params.set('limit', String(limit))
      params.set('startAfterId', String(id))
      params.set('startAfter', String(after))
      return { cursor: { path: `/opportunities/search?${params}` } }
    }
    params.set('locationId', locationId)
    if (query != null) params.set('query', query)
    params.set('limit', String(limit))
    params.set('startAfterId', String(id))
    params.set('startAfter', String(after))
    return { cursor: { path: `/contacts/?${params}` } }
  }
  const saysMore = meta.nextPage != null && meta.nextPage !== '' && meta.nextPage !== 0 && meta.nextPage !== '0' && meta.nextPage !== false
  if (saysMore) return { error: 'search reported another page without a usable cursor' }
  return { cursor: null }
}

export function classifySearchPage(body, { listKey, limit, collected = 0, origin, locationId, kind, query }) {
  if (!isRecord(body) || !Array.isArray(body[listKey])) {
    return { code: 'uncertain', rows: [], done: false, next: null, reason: `${listKey} search was unreadable` }
  }
  const rows = body[listKey]
  if (rows.some(row => !isRecord(row) || !row.id)) {
    return { code: 'uncertain', rows: [], done: false, next: null, reason: `${listKey} search row was unreadable` }
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || rows.length > limit) {
    return { code: 'uncertain', rows, done: false, next: null, reason: `${listKey} search page exceeded its limit` }
  }
  const total = readTotal(body.meta)
  if (total.error) return { code: 'uncertain', rows, done: false, next: null, reason: total.error }
  const seen = collected + rows.length
  if (total.value != null && seen > total.value) {
    return { code: 'uncertain', rows, done: false, next: null, reason: `${listKey} search exceeded its total` }
  }
  const pageFull = rows.length === limit
  const next = continuation(body.meta, { pageFull, origin, locationId, kind, query, limit })
  // GoHighLevel's LAST search page carries a stale hint (meta.nextPage: 2 with no
  // nextPageUrl and no startAfter pair) even when every row has been returned.
  // When this page brings `seen` exactly to GHL's own `total`, the list is
  // provably complete, so the hint is noise, not a missing cursor. Without this
  // every brand-new sale was 'incomplete' → lookup_blocked (Nov 12 2026: three
  // sales never reached GHL). Any other continuation error still blocks.
  if (next.error && total.value != null && seen === total.value && /without a usable cursor/.test(next.error)) {
    return { code: null, rows, done: true, next: null, reason: null }
  }
  if (next.error) return { code: 'incomplete', rows, done: false, next: null, reason: next.error }
  if (next.cursor?.error) return { code: 'uncertain', rows, done: false, next: null, reason: next.cursor.error }
  if (!pageFull) {
    if (next.cursor?.path) return { code: null, rows, done: false, next: next.cursor.path, reason: null }
    if (total.value != null && seen < total.value) {
      return { code: 'incomplete', rows, done: false, next: null, reason: `${listKey} search ended before its total` }
    }
    return { code: null, rows, done: true, next: null, reason: null }
  }
  if (total.value != null && seen === total.value) {
    if (next.cursor) return { code: 'uncertain', rows, done: false, next: null, reason: `${listKey} search total disagreed with its next page` }
    return { code: null, rows, done: true, next: null, reason: null }
  }
  if (next.cursor?.path) return { code: null, rows, done: false, next: next.cursor.path, reason: null }
  return { code: 'incomplete', rows, done: false, next: null, reason: `${listKey} search page was full and completeness was not proven` }
}

function transportCode(error) {
  const message = String(error?.message || error || '')
  if (/timeout|aborted|network|ECONN|ETIMEDOUT/i.test(message)) return 'failed'
  if (/\b5\d\d\b/.test(message)) return 'failed'
  if (/\b401\b|\b403\b/.test(message)) return 'failed'
  return 'uncertain'
}

function lightOpportunity(opp, projectIdOf) {
  let projectId = ''
  try { projectId = String(projectIdOf(opp) || '').trim() } catch { return { error: true } }
  return {
    raw: opp,
    id: String(opp.id),
    contactId: opp.contactId || opp.contact_id || null,
    status: opp.status || '',
    pipelineId: opp.pipelineId || opp.pipeline_id || null,
    monetaryValue: opp.monetaryValue,
    projectId,
  }
}

export async function scanLocationOpportunities({
  get, locationId, origin, projectIdOf, limit = 100, maxPages = 300, stopAtProjectId = null,
} = {}) {
  const empty = (status, reason) => ({ status, complete: false, found: null, opportunities: [], byProject: new Map(), reason })
  if (typeof get !== 'function' || typeof projectIdOf !== 'function') return empty('uncertain', 'opportunity lookup had no reader')
  if (typeof locationId !== 'string' || !locationId.trim() || locationId.length > 80) return empty('uncertain', 'opportunity lookup had no location')
  if (typeof origin !== 'string' || !origin.startsWith('https://')) return empty('uncertain', 'opportunity lookup had no origin')
  const want = stopAtProjectId ? String(stopAtProjectId).trim() : ''
  const opportunities = []
  const byProject = new Map()
  const seenIds = new Set()
  const seenPaths = new Set()
  let path = `/opportunities/search?location_id=${encodeURIComponent(locationId)}&limit=${limit}`
  let collected = 0
  for (let page = 0; page < maxPages; page++) {
    if (seenPaths.has(path)) return { status: 'uncertain', complete: false, found: null, opportunities, byProject, reason: 'opportunity search cursor repeated' }
    seenPaths.add(path)
    let body
    try { body = await get(path) } catch (error) {
      return { status: transportCode(error), complete: false, found: null, opportunities, byProject, reason: 'opportunity search failed' }
    }
    const classified = classifySearchPage(body, { listKey: 'opportunities', limit, collected, origin, locationId, kind: 'opportunities' })
    collected += classified.rows.length
    for (const row of classified.rows) {
      if (seenIds.has(row.id)) continue
      seenIds.add(row.id)
      const light = lightOpportunity(row, projectIdOf)
      if (light.error) return { status: 'uncertain', complete: false, found: null, opportunities, byProject, reason: 'opportunity project id was unreadable' }
      opportunities.push(light)
      if (light.projectId) {
        const list = byProject.get(light.projectId) || []
        list.push(light)
        byProject.set(light.projectId, list)
      }
    }
    const wanted = want ? (byProject.get(want) || []) : []
    // Two matches are already ambiguous. One match is not usable until the list ends.
    if (wanted.length > 1) {
      return { status: 'ambiguous', complete: false, found: null, opportunities, byProject, reason: 'multiple opportunities share this project id' }
    }
    if (classified.code) return { status: classified.code, complete: false, found: null, opportunities, byProject, reason: classified.reason }
    if (classified.done) {
      if (wanted.length === 1) return { status: 'found', complete: true, found: wanted[0].raw, opportunities, byProject, reason: null }
      return { status: 'absent', complete: true, found: null, opportunities, byProject, reason: null }
    }
    if (!classified.next) return { status: 'incomplete', complete: false, found: null, opportunities, byProject, reason: 'opportunity search did not finish' }
    path = classified.next
  }
  return { status: 'incomplete', complete: false, found: null, opportunities, byProject, reason: 'opportunity search hit the page cap' }
}

function exactContact(contact, { email, name }) {
  if (!contact?.id) return false
  if (email) return String(contact.email || '').trim().toLowerCase() === email
  const got = String(contact.contactName || `${contact.firstName || ''} ${contact.lastName || ''}`).replace(/\s+/g, ' ').trim().toLowerCase()
  return !!name && got === name
}

export async function resolveSaleContacts({ phone, email, name, get, locationId, origin, limit = 100, maxPages = 20 } = {}) {
  const rows = []
  const seen = new Set()
  const add = (contact) => {
    if (contact?.id && !seen.has(contact.id)) {
      seen.add(contact.id)
      rows.push(contact)
    }
  }
  if (typeof get !== 'function') return { complete: false, status: 'uncertain', rows, reason: 'contact lookup had no reader' }
  const normalized = normalizeHighLevelPhone(phone)
  if (normalized.ok) {
    const path = `/contacts/search/duplicate?locationId=${encodeURIComponent(locationId)}&number=${encodeURIComponent(normalized.e164)}`
    try {
      const body = await get(path)
      if (body?.contact) add(body.contact)
    } catch (error) {
      const message = String(error?.message || error || '')
      if (!/\b404\b/.test(message)) return { complete: false, status: transportCode(error), rows, reason: 'phone lookup failed' }
    }
  }
  const queries = []
  const emailQuery = String(email || '').trim().toLowerCase()
  const nameQuery = String(name || '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (emailQuery) queries.push({ query: emailQuery, email: emailQuery, name: '' })
  if (nameQuery) queries.push({ query: String(name).replace(/\s+/g, ' ').trim(), email: '', name: nameQuery })
  for (const item of queries) {
    let path = `/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(item.query)}&limit=${limit}`
    const seenPaths = new Set()
    let collected = 0
    let finished = false
    for (let page = 0; page < maxPages; page++) {
      if (seenPaths.has(path)) return { complete: false, status: 'uncertain', rows, reason: 'contact search cursor repeated' }
      seenPaths.add(path)
      let body
      try { body = await get(path) } catch (error) {
        return { complete: false, status: transportCode(error), rows, reason: 'contact search failed' }
      }
      const classified = classifySearchPage(body, {
        listKey: 'contacts', limit, collected, origin, locationId, kind: 'contacts', query: item.query,
      })
      collected += classified.rows.length
      for (const contact of classified.rows) if (exactContact(contact, item)) add(contact)
      if (classified.code) return { complete: false, status: classified.code, rows, reason: classified.reason }
      if (classified.done) { finished = true; break }
      if (!classified.next) return { complete: false, status: 'incomplete', rows, reason: 'contact search did not finish' }
      path = classified.next
    }
    if (!finished) return { complete: false, status: 'incomplete', rows, reason: 'contact search hit the page cap' }
  }
  return { complete: true, status: 'complete', rows, reason: null }
}

export function decideUnmatchedProject({ contacts, opportunities, pipelineId }) {
  const ids = new Set((contacts || []).map(contact => contact?.id).filter(Boolean))
  const mine = (opportunities || []).filter(opp => opp?.contactId && ids.has(opp.contactId))
  const blanks = mine.filter(opp => {
    if (!opp?.id || opp.projectId) return false
    const status = String(opp.status || '').toLowerCase()
    return status === 'won' || (status === 'open' && opp.pipelineId === pipelineId)
  })
  if (blanks.length > 1) {
    return { action: 'ambiguous', reason: 'ambiguous_blank_project_id', opportunityIds: blanks.map(opp => opp.id) }
  }
  if (blanks.length === 1 && String(blanks[0].status || '').toLowerCase() === 'won') {
    return { action: 'hold', reason: 'existing_won_without_project_id', opportunityIds: [blanks[0].id] }
  }
  if (blanks.length === 1) return { action: 'adopt', opportunity: blanks[0] }
  return { action: 'create' }
}
