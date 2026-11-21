// Pure decisions for the daily job sync (Garrison, Nov 21 2026). Sources of
// truth: ArcSite's newest signed contract for price and PDF; the AI Sheet's
// Schedule tab for install date and cancelled / rebooked; the PM calendar job
// for the Project Manager. A manual hold freezes the opp VALUE only. Lost
// opportunities are never touched.
import { sameName } from './eod-check.mjs'

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Which opp is the LIVE one when several non-lost opps share a Project ID.
    Inside Sales / Outside Sales pair → Outside is live, Inside is the copy to
    close. Otherwise the opp the PM calendar job points to; failing that, the
    newest. Returns { live, copies, reason }. */
export function pickLiveOpp(opps, { outsidePipelineId, calendarOppIds = [] } = {}) {
  const list = (opps || []).filter(o => o && !['lost'].includes(String(o.status || '').toLowerCase()))
  if (!list.length) return { live: null, copies: [], reason: 'no opportunity' }
  if (list.length === 1) return { live: list[0], copies: [], reason: 'only one' }
  const outside = list.filter(o => o.pipelineId === outsidePipelineId), inside = list.filter(o => o.pipelineId !== outsidePipelineId)
  if (outside.length === 1 && inside.length) return { live: outside[0], copies: inside, reason: 'Outside Sales is the live opportunity; the Inside Sales copy should be closed' }
  const onCal = list.filter(o => calendarOppIds.includes(o.id))
  if (onCal.length === 1) return { live: onCal[0], copies: list.filter(o => o !== onCal[0]), reason: 'the PM calendar job points to it' }
  // Nothing decides it (same pipeline, no or several calendar jobs — e.g. two real
  // customers on one ArcSite project): no live opp, nothing is written to either.
  return { live: null, copies: list, reason: onCal.length > 1 ? 'each opportunity has its own PM calendar job — two real jobs on one Project ID, left for review' : 'same pipeline and no PM calendar job decides it — left for review' }
}

/** Does the ArcSite project really belong to this opp's customer? A Project ID
    stamped on the wrong customer (Courtney Spillers carrying Aaron Spillers'
    project, Oct 14 2026 backfill) must never pull that deal's price/contract. */
const NICK = { charles: 'charlie', charlie: 'charles', robert: 'bob', bob: 'robert', william: 'bill', bill: 'william', michael: 'mike', mike: 'michael', jonathan: 'jon', jon: 'jonathan', joseph: 'joe', joe: 'joseph', richard: 'rick', rick: 'richard', nicholas: 'nick', nick: 'nicholas', james: 'jim', jim: 'james', christopher: 'chris', chris: 'christopher', matthew: 'matt', matt: 'matthew', daniel: 'dan', dan: 'daniel', anthony: 'tony', tony: 'anthony', zackary: 'zack', zack: 'zackary' }
const tokens = s => norm(String(s || '').replace(/·.*$/, '').replace(/\b(and|&)\b/g, ' ')).split(' ').filter(t => t.length > 1)
const sameFirst = (a, b) => a === b || NICK[a] === b || NICK[b] === a || (a.length >= 4 && b.startsWith(a)) || (b.length >= 4 && a.startsWith(b))
/** Stricter than the EOD's sameName: a shared SURNAME alone is not the same person
    (Aaron Spillers is not Courtney Spillers). First names must agree, or one
    name must sit inside the other, or a single-token name must match a token. */
export function samePerson(a, b) {
  const ta = tokens(a), tb = tokens(b)
  if (!ta.length || !tb.length) return false
  const A = ta.join(' '), B = tb.join(' ')
  if (A === B || (A.length >= 4 && B.includes(A)) || (B.length >= 4 && A.includes(B))) return true
  if (ta.length === 1 || tb.length === 1) { const one = ta.length === 1 ? ta[0] : tb[0], many = ta.length === 1 ? tb : ta; return many.some(t => sameFirst(one, t)) }
  // couples: "Camron & Bobbie Johnson" vs "Camron Johnson" — any first name agrees, surnames agree
  const firstsA = ta.slice(0, -1), firstsB = tb.slice(0, -1)
  const surname = sameName(ta.at(-1), tb.at(-1))
  return surname && firstsA.some(x => firstsB.some(y => sameFirst(x, y)))
}

export function projectBelongsToOpp({ arcCustomer, arcProject, oppName, contactName }) {
  const arc = [arcCustomer, arcProject].filter(Boolean)
  const ours = [oppName, contactName].filter(Boolean)
  if (!arc.length || !ours.length) return { ok: true, reason: 'no names to compare' }
  for (const a of arc) for (const o of ours) if (samePerson(a, o)) return { ok: true, reason: null }
  return { ok: false, reason: `ArcSite project "${arcCustomer || arcProject}" is not this customer ("${oppName || contactName}")` }
}

/** Schedule-tab state for a project: { state: 'live'|'cancelled'|'none'|'ambiguous', date } */
export function scheduleState(entry) {
  if (!entry) return { state: 'none', date: null }
  if (entry.live && entry.live.length) { const dates = [...new Set(entry.live.map(r => r.date))]; return dates.length === 1 ? { state: 'live', date: dates[0], row: entry.live[entry.live.length - 1] } : { state: 'ambiguous', date: null, dates } }
  if (entry.cancelled && entry.cancelled.length) return { state: 'cancelled', date: entry.cancelled[entry.cancelled.length - 1].date, row: entry.cancelled[entry.cancelled.length - 1] }
  return { state: 'none', date: null }
}

/** What the opp's status/stage should be from the Schedule tab.
    cancelled → GHL status 'abandoned' (GHL has no cancelled STAGE; a stage id can
    be configured instead); rebooked (live row, opp abandoned) → open + Closed. */
export function statusPlan({ schedule, opp, closedStageId, cancelledStageId = null }) {
  const status = String(opp.status || '').toLowerCase()
  if (status === 'lost') return { action: null, reason: 'lost — never touched' }
  if (schedule.state === 'cancelled') {
    if (cancelledStageId) return opp.pipelineStageId === cancelledStageId ? { action: null } : { action: 'cancel', write: { pipelineStageId: cancelledStageId }, reason: `cancelled on the Schedule tab (${schedule.date}) → cancelled stage` }
    return status === 'abandoned' ? { action: null } : { action: 'cancel', write: { status: 'abandoned' }, reason: `cancelled on the Schedule tab (${schedule.date}) → status abandoned (GHL has no cancelled stage)` }
  }
  if (schedule.state === 'live' && (status === 'abandoned' || (cancelledStageId && opp.pipelineStageId === cancelledStageId))) {
    return { action: 'rebook', write: { status: 'open', pipelineStageId: closedStageId }, reason: `rebooked on the Schedule tab for ${schedule.date} → open, Closed` }
  }
  return { action: null }
}

/** The field writes a job needs on the opp and the contact, from the sources of truth.
    cur = { oppInstall, contactInstall, oppPm, contactPm, oppPrice, contactJobPrice, contactNewPrice, calendarInstall }
    want = { install, pm, value } (null = unknown / not to be written). held freezes value. */
export function fieldPlan(cur, want, { held = false, disputed = false } = {}) {
  const plan = { opp: {}, contact: {}, calendar: {}, reasons: [], frozen: [] }
  const same = (a, b) => (a == null ? '' : String(a)).trim() === (b == null ? '' : String(b)).trim()
  const money = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null }
  if (want.install) {
    if (!same(cur.oppInstall, want.install)) { plan.opp.install = want.install; plan.reasons.push(`Install Date ${cur.oppInstall || 'empty'} → ${want.install} (Schedule tab)`) }
    if (!same(cur.contactInstall, want.install)) { plan.contact.install = want.install }
    if (cur.calendarInstall !== undefined && !same(cur.calendarInstall, want.install)) { plan.calendar.install = want.install; plan.reasons.push(`calendar install ${cur.calendarInstall || 'empty'} → ${want.install}`) }
  }
  if (want.pm) {
    if (!same(cur.oppPm, want.pm)) { plan.opp.pm = want.pm; plan.reasons.push(`Project Manager ${cur.oppPm || 'empty'} → ${want.pm} (calendar)`) }
    if (!same(cur.contactPm, want.pm)) plan.contact.pm = want.pm
  }
  if (want.value != null && !disputed) {
    const v = money(want.value)
    const diff = x => { const m = money(x); return m == null || Math.abs(m - v) > 1 }
    const needs = { oppPrice: diff(cur.oppPrice), contactJobPrice: diff(cur.contactJobPrice), contactNewPrice: diff(cur.contactNewPrice) }
    if (held) { for (const k of Object.keys(needs)) if (needs[k]) plan.frozen.push(k) }
    else {
      if (needs.oppPrice) { plan.opp.price = v; plan.reasons.push(`Price field ${cur.oppPrice == null ? 'empty' : cur.oppPrice} → ${v}`) }
      if (needs.contactJobPrice || needs.contactNewPrice) { plan.contact.jobPrice = v; plan.contact.newPrice = v; plan.reasons.push(`contact Job/New Price ${cur.contactJobPrice == null ? 'empty' : cur.contactJobPrice} / ${cur.contactNewPrice == null ? 'empty' : cur.contactNewPrice} → ${v}`) }
    }
  }
  plan.any = Object.keys(plan.opp).length + Object.keys(plan.contact).length + Object.keys(plan.calendar).length > 0
  return plan
}

/** A contact price that belongs to another deal (Courtney Spillers carrying
    Aaron Spillers' $9,164.27): when this opp has no signed contract of its own,
    the contact's Job/New Price must be cleared so a PM workflow cannot copy it. */
export function carryoverPlan({ contactJobPrice, contactNewPrice, hasSignedContract, otherDealValues = [] }) {
  const money = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null }
  const jp = money(contactJobPrice), np = money(contactNewPrice)
  if (jp == null && np == null) return { action: null }
  if (hasSignedContract) return { action: null }
  const matches = [jp, np].filter(Boolean).some(v => otherDealValues.some(o => Math.abs(Number(o) - v) <= 1))
  return { action: 'clear', reason: matches ? `contact Job Price ${jp ?? np} matches another deal and this opportunity has no signed contract — cleared` : `contact Job Price ${jp ?? np} with no signed contract on this opportunity — cleared` }
}

/** A Closed-stage (won) opp with nothing signed: reported every day. */
export function unsignedClosed({ isClosedStage, signedCount, proposalsCount, voidOnly, installDate }) {
  if (!isClosedStage) return null
  if (signedCount > 0) return null
  if (voidOnly) return 'the only ArcSite proposal is VOID — no signed contract'
  if (!installDate) return `no signed ArcSite contract and no install date (${proposalsCount} proposal${proposalsCount === 1 ? '' : 's'}, none approved)`
  return `no signed ArcSite contract (${proposalsCount} proposal${proposalsCount === 1 ? '' : 's'}, none approved)`
}

export { norm }
