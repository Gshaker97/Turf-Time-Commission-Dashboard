/**
 * HighLevel opportunity lookup for the ArcSite missed-sale path.
 *
 * A failed, short, or unreadable search must never look like "no opportunity".
 * This module only decides. It does not create opportunities, send texts, or
 * read credentials. The caller supplies `get(path)`.
 *
 * Completeness: a page shorter than its limit is the end of the list. A full
 * page is the end only when `meta.total` equals the rows in hand and the
 * response does not point at another page. Opportunity pages follow
 * `meta.nextPageUrl` (same origin, same location, same contact). Contact
 * pages follow that URL or, on a full page, a startAfter / startAfterId pair.
 * Anything else is incomplete and cannot authorize a new sale.
 */

export const GHL_API_ORIGIN = 'https://services.leadconnectorhq.com'
export const OPP_PAGE_LIMIT = 100
export const CONTACT_PAGE_LIMIT = 10
export const MAX_SEARCH_PAGES = 20

const REFUSAL = 'HighLevel opportunity lookup did not complete — no opportunity was created and no sale text was sent'

export class OppLookupError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'OppLookupError'
    this.code = code
  }
}

export function sanitizeLookupDetail(message) {
  return String(message || 'lookup failed')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 240)
}

export function asOppLookupError(error) {
  if (error instanceof OppLookupError) return error
  const message = sanitizeLookupDetail(error && error.message ? error.message : error)
  return new OppLookupError('failed', message || 'request failed')
}

export function refuseSaleSideEffects(error) {
  const err = asOppLookupError(error)
  return {
    ok: false,
    action: 'lookup_blocked',
    code: err.code === 'incomplete' || err.code === 'uncertain' || err.code === 'failed' ? err.code : 'failed',
    allowCreate: false,
    reprocess: false,
    created: false,
    opportunity_created: false,
    sendSaleText: false,
    alert: 'not_sent',
    opportunity: null,
    opportunities: null,
    error: REFUSAL,
    detail: sanitizeLookupDetail(err.message),
  }
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readTotal(meta) {
  if (!meta || meta.total == null || meta.total === '') return { total: null }
  if (typeof meta.total === 'number' && Number.isInteger(meta.total) && meta.total >= 0 && meta.total <= 1000000) {
    return { total: meta.total }
  }
  if (typeof meta.total === 'string' && /^\d+$/.test(meta.total) && Number(meta.total) <= 1000000) {
    return { total: Number(meta.total) }
  }
  return { error: 'search total was not a usable count' }
}

function continuation(meta, { kind, pageFull }) {
  if (!meta) return { next: null }
  const raw = meta.nextPageUrl
  if (typeof raw === 'string' && raw.trim()) return { next: { type: 'url', url: raw.trim() } }
  if (raw != null && raw !== '') return { error: 'search next page was not a string' }
  const nextPage = meta.nextPage
  const saysMore = nextPage != null && nextPage !== '' && nextPage !== 0 && nextPage !== '0' && nextPage !== false
  const id = meta.startAfterId
  const after = meta.startAfter
  const pair = id != null && String(id) !== '' && after != null && String(after) !== ''
  if (kind === 'contacts' && pageFull && pair) {
    return { next: { type: 'pair', startAfterId: String(id), startAfter: String(after) } }
  }
  if (saysMore) return { error: 'search reported another page without a usable cursor' }
  return { next: null }
}

/**
 * Classify one search page without throwing, so the caller can still notice
 * a matching opportunity sitting in an otherwise incomplete page.
 * `code` set means the list must not be treated as finished.
 */
export function classifySearchPage(body, { listKey, limit, collected = 0, kind }) {
  if (!isRecord(body)) {
    return { ok: false, code: 'uncertain', reason: `${listKey} search response was not an object`, rows: [], done: false, next: null }
  }
  if (!Array.isArray(body[listKey])) {
    return { ok: false, code: 'uncertain', reason: `${listKey} search response had no ${listKey} array`, rows: [], done: false, next: null }
  }
  const rows = body[listKey]
  const readable = rows.filter(isRecord)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return { ok: false, code: 'uncertain', reason: `${listKey} search limit was not usable`, rows: readable, done: false, next: null }
  }
  if (rows.length !== readable.length) {
    return { ok: false, code: 'uncertain', reason: `${listKey} search page included an unreadable record`, rows: readable, done: false, next: null }
  }
  if (rows.length > limit) {
    return { ok: false, code: 'uncertain', reason: `${listKey} search page exceeded the requested limit`, rows: readable, done: false, next: null }
  }
  if (body.meta != null && !isRecord(body.meta)) {
    return { ok: false, code: 'uncertain', reason: `${listKey} search metadata was unreadable`, rows: readable, done: false, next: null }
  }
  const totalRead = readTotal(body.meta)
  if (totalRead.error) {
    return { ok: false, code: 'uncertain', reason: totalRead.error, rows: readable, done: false, next: null }
  }
  const total = totalRead.total
  const seen = collected + rows.length
  if (total != null && seen > total) {
    return { ok: false, code: 'uncertain', reason: `${listKey} search returned more records than its total`, rows: readable, done: false, next: null }
  }
  const pageFull = rows.length === limit
  const cursor = continuation(body.meta, { kind, pageFull })
  if (cursor.error) {
    return { ok: false, code: 'incomplete', reason: cursor.error, rows: readable, done: false, next: null }
  }
  if (!pageFull) {
    if (total != null && seen < total) {
      return { ok: true, code: 'incomplete', reason: `${listKey} search ended before its total`, rows, done: false, next: null }
    }
    return { ok: true, code: null, reason: null, rows, done: true, next: null }
  }
  if (total != null && seen === total) {
    if (cursor.next) {
      return { ok: false, code: 'uncertain', reason: `${listKey} search total disagreed with its next page`, rows, done: false, next: null }
    }
    return { ok: true, code: null, reason: null, rows, done: true, next: null }
  }
  if (cursor.next) return { ok: true, code: null, reason: null, rows, done: false, next: cursor.next }
  return {
    ok: true,
    code: 'incomplete',
    reason: `${listKey} search page was full and completeness was not proven`,
    rows,
    done: false,
    next: null,
  }
}

function limitOf(path, fallback) {
  try {
    const url = new URL(path, GHL_API_ORIGIN)
    const n = Number(url.searchParams.get('limit'))
    if (Number.isInteger(n) && n >= 1 && n <= 100) return n
  } catch { /* the request path is still checked by the caller */ }
  return fallback
}

function scopedPath(raw, ctx) {
  let url
  try { url = new URL(raw, GHL_API_ORIGIN) } catch { throw new OppLookupError('uncertain', 'search cursor was not a usable url') }
  if (url.origin !== GHL_API_ORIGIN) throw new OppLookupError('uncertain', 'search cursor was off-origin')
  if (url.username || url.password) throw new OppLookupError('uncertain', 'search cursor included credentials')
  const location = url.searchParams.get('location_id') || url.searchParams.get('locationId')
  if (location !== ctx.locationId) throw new OppLookupError('uncertain', 'search cursor changed location')
  if (ctx.kind === 'opportunities') {
    if (url.pathname.replace(/\/$/, '') !== '/opportunities/search') throw new OppLookupError('uncertain', 'search cursor left opportunity search')
    if (url.searchParams.get('contact_id') !== ctx.contactId) throw new OppLookupError('uncertain', 'search cursor changed contact')
  } else if (url.pathname.replace(/\/$/, '') !== '/contacts' || url.searchParams.get('query') !== ctx.query) {
    throw new OppLookupError('uncertain', 'search cursor left the contact query')
  }
  return url.pathname + url.search
}

function applyContinuation(next, ctx) {
  if (!next) throw new OppLookupError('incomplete', 'search reported more rows without a cursor')
  if (next.type === 'url') return scopedPath(next.url, ctx)
  const params = new URLSearchParams()
  if (ctx.kind === 'opportunities') {
    params.set('location_id', ctx.locationId)
    params.set('contact_id', ctx.contactId)
  } else {
    params.set('locationId', ctx.locationId)
    params.set('query', ctx.query)
  }
  params.set('limit', String(ctx.pageLimit))
  params.set('startAfterId', next.startAfterId)
  params.set('startAfter', next.startAfter)
  return (ctx.kind === 'opportunities' ? '/opportunities/search?' : '/contacts/?') + params.toString()
}

async function fetchJson(get, path) {
  if (typeof get !== 'function') throw new OppLookupError('uncertain', 'lookup had no reader')
  try {
    return await get(path)
  } catch (error) {
    throw asOppLookupError(error)
  }
}

function requireScope(locationId) {
  if (typeof locationId !== 'string' || !locationId.trim() || locationId.length > 80) {
    throw new OppLookupError('uncertain', 'lookup had no location')
  }
}

async function* searchPages({ firstPath, get, limit, maxPages, listKey, kind, scope }) {
  let path = firstPath
  let collected = 0
  const seen = new Set()
  for (let page = 0; page < maxPages; page++) {
    if (seen.has(path)) throw new OppLookupError('uncertain', `${listKey} search cursor repeated`)
    seen.add(path)
    const pageLimit = limitOf(path, limit)
    const body = await fetchJson(get, path)
    const classified = classifySearchPage(body, { listKey, limit: pageLimit, collected, kind })
    collected += classified.rows.length
    yield classified
    if (!classified.ok || classified.code || classified.done) return
    const added = classified.rows.length
    if (!added) throw new OppLookupError('uncertain', `${listKey} search cursor made no progress`)
    path = applyContinuation(classified.next, { ...scope, kind, pageLimit })
  }
  throw new OppLookupError('incomplete', `${listKey} search hit the page cap before the list ended`)
}

function takeMatch(rows, match) {
  for (const row of rows) {
    let hit = false
    try { hit = match(row) === true } catch { throw new OppLookupError('uncertain', 'opportunity match could not be read') }
    if (hit) {
      if (!row.id) throw new OppLookupError('uncertain', 'matching opportunity had no id')
      return row
    }
  }
  return null
}

async function searchContacts(query, get, { locationId, limit, maxPages }) {
  const q = String(query || '').trim()
  if (!q) return { rows: [], complete: true, failure: null }
  const rows = []
  const seenIds = new Set()
  const pages = searchPages({
    firstPath: `/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(q)}&limit=${limit}`,
    get, limit, maxPages, listKey: 'contacts', kind: 'contacts',
    scope: { locationId, query: q },
  })
  try {
    for await (const page of pages) {
      for (const row of page.rows) {
        if (!row.id) throw new OppLookupError('uncertain', 'contact search returned a record without an id')
        if (!seenIds.has(row.id)) { seenIds.add(row.id); rows.push(row) }
      }
      if (!page.ok || page.code) {
        return { rows, complete: false, failure: new OppLookupError(page.code || 'uncertain', page.reason || 'contact search did not finish') }
      }
      if (page.done) return { rows, complete: true, failure: null }
    }
  } catch (error) {
    return { rows, complete: false, failure: asOppLookupError(error) }
  }
  return { rows, complete: false, failure: new OppLookupError('incomplete', 'contact search did not finish') }
}

/**
 * Scan one contact's opportunities. A match returns immediately, even when
 * later pages are unread. No match returns only after the list is proven
 * complete. A failed or unfinished scan throws — it does not return the
 * pages gathered so far.
 */
export async function scanContactOpportunities(contactId, get, { locationId, limit = OPP_PAGE_LIMIT, maxPages = MAX_SEARCH_PAGES, match } = {}) {
  requireScope(locationId)
  const id = String(contactId || '').trim()
  if (!id || id.length > 80) throw new OppLookupError('uncertain', 'opportunity lookup had no contact')
  if (typeof match !== 'function') throw new OppLookupError('uncertain', 'opportunity lookup had no match')
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new OppLookupError('uncertain', 'opportunity lookup limit was not usable')
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 50) throw new OppLookupError('uncertain', 'opportunity lookup page cap was not usable')
  const opportunities = []
  const seenIds = new Set()
  const pages = searchPages({
    firstPath: `/opportunities/search?location_id=${encodeURIComponent(locationId)}&contact_id=${encodeURIComponent(id)}&limit=${limit}`,
    get, limit, maxPages, listKey: 'opportunities', kind: 'opportunities',
    scope: { locationId, contactId: id },
  })
  for await (const page of pages) {
    const fresh = []
    for (const row of page.rows) {
      if (row.id && seenIds.has(row.id)) continue
      if (row.id) seenIds.add(row.id)
      fresh.push(row)
    }
    const hit = takeMatch(fresh, match)
    if (hit) return { outcome: 'matched', opportunity: hit, opportunities: opportunities.concat(fresh) }
    opportunities.push(...fresh)
    if (!page.ok || page.code) throw new OppLookupError(page.code || 'uncertain', page.reason || 'opportunity lookup did not finish')
    if (!page.done && fresh.length === 0) throw new OppLookupError('uncertain', 'opportunity search cursor made no progress')
    if (page.done) return { outcome: 'complete', opportunity: null, opportunities }
  }
  throw new OppLookupError('incomplete', 'opportunity lookup did not finish')
}

export async function guardOpportunityScan(contactId, get, options = {}) {
  try {
    const scan = await scanContactOpportunities(contactId, get, options)
    if (scan.outcome === 'matched' && scan.opportunity && scan.opportunity.id) {
      return {
        ok: true,
        action: 'matched',
        opportunity: scan.opportunity,
        opportunities: scan.opportunities,
        allowCreate: false,
        reprocess: false,
        created: false,
        opportunity_created: false,
        sendSaleText: false,
        alert: 'not_sent',
      }
    }
    if (scan.outcome === 'complete' && Array.isArray(scan.opportunities)) {
      return {
        ok: true,
        action: 'clear',
        opportunity: null,
        opportunities: scan.opportunities,
        allowCreate: true,
        reprocess: false,
        created: false,
        opportunity_created: false,
        sendSaleText: false,
        alert: 'not_sent',
      }
    }
    return refuseSaleSideEffects(new OppLookupError('uncertain', 'opportunity scan ended without a complete list'))
  } catch (error) {
    return refuseSaleSideEffects(error)
  }
}

async function findOpportunityForProposal(proposal, deps) {
  const pid = String(proposal && (proposal.project_id || proposal.projectId) || '').trim()
  if (!pid) throw new OppLookupError('uncertain', 'proposal had no project id')
  if (typeof deps.projectIdOf !== 'function') throw new OppLookupError('uncertain', 'opportunity match was not configured')
  requireScope(deps.locationId)
  const limit = deps.contactLimit || CONTACT_PAGE_LIMIT
  const maxPages = deps.maxPages || MAX_SEARCH_PAGES
  const queries = []
  for (const value of [proposal.customer_email, proposal.customer_name]) {
    const query = String(value || '').trim()
    if (query && !queries.includes(query)) queries.push(query)
  }
  if (!queries.length) throw new OppLookupError('uncertain', 'proposal had no customer email or name to search')
  const byId = new Map()
  let contactFailure = null
  for (const query of queries) {
    const found = await searchContacts(query, deps.get, { locationId: deps.locationId, limit, maxPages })
    for (const contact of found.rows) byId.set(contact.id, contact)
    if (!found.complete) contactFailure = found.failure || new OppLookupError('incomplete', 'contact search did not finish')
  }
  for (const contact of byId.values()) {
    const scan = await scanContactOpportunities(contact.id, deps.get, {
      locationId: deps.locationId,
      limit: deps.oppLimit || OPP_PAGE_LIMIT,
      maxPages,
      match: (opp) => deps.projectIdOf(opp) === pid,
    })
    if (scan.outcome === 'matched') return scan.opportunity
    if (scan.outcome !== 'complete') throw new OppLookupError('incomplete', 'opportunity lookup did not finish')
  }
  // A short contact list must not count as "nobody has this sale" when another
  // page failed or was cut off — that contact may hold the opportunity.
  if (contactFailure) throw contactFailure
  return null
}

/**
 * Sweep decision for one approved proposal.
 * `reprocess: true` is the only signal that may enter the importer, and only
 * after a finished search found no contact or no matching opportunity.
 * The decision itself never creates an opportunity and never sends a text.
 */
export async function evaluateMissedSale(proposal, deps = {}) {
  try {
    const opportunity = await findOpportunityForProposal(proposal, deps)
    if (opportunity) {
      return {
        ok: true,
        action: 'found',
        opportunity,
        reprocess: false,
        allowCreate: false,
        created: false,
        opportunity_created: false,
        sendSaleText: false,
        alert: 'not_sent',
        opportunities: null,
      }
    }
    return {
      ok: true,
      action: 'absent',
      opportunity: null,
      reprocess: true,
      allowCreate: false,
      created: false,
      opportunity_created: false,
      sendSaleText: false,
      alert: 'not_sent',
      opportunities: null,
    }
  } catch (error) {
    return { ...refuseSaleSideEffects(error), opportunity: null }
  }
}

/** Caller may create only when this returns action `authorized`. */
export function authorizeNewSale(guard) {
  if (guard && guard.action === 'clear' && guard.allowCreate === true && Array.isArray(guard.opportunities)) {
    return {
      ok: true,
      action: 'authorized',
      allowCreate: true,
      created: false,
      opportunity_created: false,
      sendSaleText: false,
      alert: 'not_sent',
    }
  }
  const code = guard && (guard.code === 'failed' || guard.code === 'incomplete' || guard.code === 'uncertain') ? guard.code : 'uncertain'
  return refuseSaleSideEffects(new OppLookupError(code, 'create was not authorized after the opportunity lookup'))
}

/** A sale text is allowed only after a create that itself was authorized. */
export function authorizeSaleText(guard, { created = false } = {}) {
  if (created === true && guard && guard.action === 'clear' && guard.allowCreate === true) return { sendSaleText: true }
  return { sendSaleText: false }
}
