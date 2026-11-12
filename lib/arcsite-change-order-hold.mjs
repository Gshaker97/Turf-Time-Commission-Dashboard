import { createHash } from 'node:crypto'

/** A later committed ArcSite signature on an existing opportunity.
 * Money stays on the original contract until an explicit add-on or
 * replacement decision. This module has no network, credentials, or
 * HighLevel/calendar writers — callers can append a PDF and save the
 * pending revision, and nothing else.
 *
 * `signedProposals` is oldest-first, which is the order `arcSignedContracts`
 * already returns. The earliest committed proposal is the original contract.
 * One opportunity per Project ID: this never creates or selects a second one.
 */

const MONEY_TOLERANCE_CENTS = 100

export function moneyCents(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

export function totalsDiffer(a, b) {
  const left = moneyCents(a), right = moneyCents(b)
  if (left == null || right == null) return false
  return Math.abs(left - right) > MONEY_TOLERANCE_CENTS
}

function proposalIdOf(proposal) {
  const id = String(proposal?.proposalId ?? proposal?.proposal_id ?? '').trim()
  return id || null
}

function normalizeProposal(proposal) {
  const proposalId = proposalIdOf(proposal)
  if (!proposalId) return null
  const total = proposal.total == null ? null : Number(proposal.total)
  return {
    proposalId,
    total: Number.isFinite(total) ? Math.round(total * 100) / 100 : null,
    pdfUrl: proposal.pdfUrl || proposal.pdf_url || null,
    documentNumber: proposal.documentNumber || proposal.document_number || null,
    pdfSha256: proposal.pdfSha256 || null,
    signedAt: proposal.signedAt || null,
  }
}

/** SignNow stamps "YYYY-MM-DD H:MM AM/PM UTC" beside the customer signature.
 * A timestamp anywhere else in the file is not signing evidence.
 * Returns an ISO string, or null when the stamp is absent or invalid.
 */
export function signNowSignedAt(text, now = Date.now()) {
  if (typeof text !== 'string' || !text) return null
  const matches = [...text.matchAll(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})\s+(AM|PM)\s+UTC/g)]
    .filter(m => /customer\s+signature|signnow_customer_signature/i.test(text.slice(Math.max(0, m.index - 300), m.index + m[0].length + 300)))
  const times = matches.map(m => {
    let hour = Number(m[2])
    if (hour < 1 || hour > 12 || Number(m[3]) > 59) return NaN
    hour = hour % 12 + (m[4] === 'PM' ? 12 : 0)
    const iso = `${m[1]}T${String(hour).padStart(2, '0')}:${m[3]}:00.000Z`
    const t = Date.parse(iso)
    return Number.isFinite(t) && new Date(t).toISOString() === iso ? t : NaN
  }).filter(t => Number.isFinite(t) && t <= now)
  if (!times.length) return null
  return new Date(Math.max(...times)).toISOString()
}

export function sha256Pdf(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  return createHash('sha256').update(buf).digest('hex')
}

export function classifyLaterSignature({
  projectId,
  existingOpportunity,
  signedProposals,
  incomingProposal = null,
  currentValue = null,
  listFailed = false,
} = {}) {
  const opportunityId = existingOpportunity && existingOpportunity.id
  if (!opportunityId) return { hold: false, reason: 'no_existing_opportunity' }
  const signed = (Array.isArray(signedProposals) ? signedProposals : []).map(normalizeProposal).filter(Boolean)
  const incoming = normalizeProposal(incomingProposal)
  const original = signed[0] || null
  const base = {
    projectId: String(projectId || ''),
    opportunityId: String(opportunityId),
    originalProposalId: original ? original.proposalId : null,
    originalTotal: original ? original.total : (currentValue == null ? null : Math.round(Number(currentValue) * 100) / 100),
  }
  // Two or more committed proposals: every one after the earliest is pending.
  if (!listFailed && signed.length >= 2) {
    return { ...base, hold: true, reason: 'later_committed_proposal', later: signed.slice(1) }
  }
  // The signed list could not be read. Do not guess that this event is the
  // original contract: that guess is what moved the stage to Closed and
  // rewrote money. Record a revision only when the incoming proposal is
  // identifiably not the original, or its total disagrees. A same-total
  // re-fire records nothing and still blocks money and stage writes.
  if (listFailed) {
    const later = []
    if (signed.length >= 2) later.push(...signed.slice(1))
    else if (incoming && (!original || incoming.proposalId !== original.proposalId) && (signed.length > 0 || totalsDiffer(incoming.total, currentValue))) later.push(incoming)
    return { ...base, hold: true, reason: later.length ? 'list_unread_total_disagrees' : 'list_unread', later }
  }
  // The only committed proposal is the original contract, even if its total
  // moved. That catch-up is not a change order.
  if (signed.length === 1 && (!incoming || incoming.proposalId === signed[0].proposalId)) {
    return { ...base, hold: false, reason: 'original_contract' }
  }
  // A different proposal id than the one signed contract we could see, or a
  // list we could not read while the incoming total disagrees with the
  // opportunity. Fail closed: do not replace money.
  if (incoming && (signed.length === 0 ? (listFailed && totalsDiffer(incoming.total, currentValue)) : incoming.proposalId !== signed[0].proposalId)) {
    return {
      ...base,
      hold: true,
      reason: listFailed && signed.length === 0 ? 'list_unread_total_disagrees' : 'incoming_proposal_not_original',
      later: [incoming],
    }
  }
  return { ...base, hold: false, reason: signed.length === 0 ? 'no_later_signature_proved' : 'original_contract' }
}

/** Record later proposals and append their PDFs. Does not accept money,
 * stage, contact, calendar, or PDF-clear operations — those keys are not
 * read, so a caller cannot pass them in and have this function use them.
 */
export async function commitPendingRevisionHold(decision, {
  store = {},
  loadEvidence,
  appendPdf,
  saveStore,
  now = () => new Date().toISOString(),
} = {}) {
  if (!decision || decision.hold !== true) return { applied: false, held: false, moneyWritten: false, stageMoved: false, clearedPdfs: false }
  const next = store && typeof store === 'object' ? { ...store } : {}
  const projectId = String(decision.projectId || '')
  const bucket = {
    opportunityId: String(decision.opportunityId),
    originalProposalId: decision.originalProposalId || null,
    originalTotal: decision.originalTotal ?? null,
    revisions: Array.isArray(next[projectId]?.revisions) ? next[projectId].revisions.map(r => ({ ...r })) : [],
  }
  // Keep the opportunity this project already has. Never switch ids.
  if (next[projectId]?.opportunityId) bucket.opportunityId = String(next[projectId].opportunityId)
  const waiting = []
  for (const proposal of decision.later || []) {
    const proposalId = proposalIdOf(proposal)
    if (!proposalId) continue
    let rev = bucket.revisions.find(r => r.proposalId === proposalId)
    const needsEvidence = !rev || !rev.pdfSha256 || !rev.signedAt || !rev.pdfAppended
    let evidence = null
    if (needsEvidence && typeof loadEvidence === 'function') {
      evidence = await loadEvidence(proposal)
    }
    if (!rev) {
      rev = {
        proposalId,
        pdfSha256: evidence?.pdfSha256 || proposal.pdfSha256 || null,
        signedAt: evidence?.signedAt || proposal.signedAt || null,
        total: proposal.total ?? evidence?.total ?? null,
        status: 'pending',
        decision: null,
        recordedAt: now(),
        pdfAppended: false,
      }
      bucket.revisions.push(rev)
    } else if (rev.status === 'pending' && rev.decision == null) {
      if (evidence?.pdfSha256) rev.pdfSha256 = evidence.pdfSha256
      if (evidence?.signedAt) rev.signedAt = evidence.signedAt
      if (proposal.total != null) rev.total = proposal.total
    }
    const hostedUrl = evidence?.hostedUrl || null
    if (!rev.pdfAppended && hostedUrl && rev.signedAt) waiting.push({ rev, url: hostedUrl, name: evidence.name || `contract ${proposalId}.pdf` })
  }
  // The pending record is durable before the file is attached. A failed
  // attach retries later; it does not fall through to a money write.
  next[projectId] = bucket
  if (typeof saveStore === 'function') await saveStore(next)
  const appended = []
  for (const item of waiting) {
    if (typeof appendPdf === 'function') await appendPdf(bucket.opportunityId, { url: item.url, name: item.name })
    item.rev.pdfAppended = true
    appended.push({ url: item.url, name: item.name })
  }
  if (appended.length && typeof saveStore === 'function') await saveStore(next)
  return {
    applied: true,
    held: true,
    action: 'pending_revision',
    projectId,
    opportunityId: bucket.opportunityId,
    originalProposalId: bucket.originalProposalId,
    originalTotal: bucket.originalTotal,
    pending: bucket.revisions.filter(r => r.status === 'pending' && r.decision == null).map(publicRevision),
    revisions: bucket.revisions.map(publicRevision),
    pdf: appended.length ? 'appended' : 'already recorded or awaiting signed render',
    appended,
    effects: { appendPdfs: appended },
    moneyWritten: false,
    stageMoved: false,
    clearedPdfs: false,
    stageWrite: null,
    revisionRecorded: true,
    store: next,
  }
}

function publicRevision(rev) {
  return {
    proposalId: rev.proposalId,
    pdfSha256: rev.pdfSha256 || null,
    signedAt: rev.signedAt || null,
    total: rev.total ?? null,
    status: rev.status || 'pending',
    decision: rev.decision ?? null,
    pdfAppended: !!rev.pdfAppended,
  }
}

/** Sweep "seen" marker. `t` stays the opportunity's current value.
 * The later total is stored separately so a skip cannot be read as
 * "money was confirmed at the new total".
 */
export function seenEntryForHold(currentValue, proposalId, pendingTotal) {
  return {
    t: moneyCents(currentValue) == null ? null : moneyCents(currentValue) / 100,
    p: String(proposalId || ''),
    hold: 'pending_revision',
    pendingTotal: moneyCents(pendingTotal) == null ? null : moneyCents(pendingTotal) / 100,
  }
}

export function sweepSkipsProject(seenEntry, want, proposalId) {
  if (!seenEntry || typeof seenEntry !== 'object') return false
  if (seenEntry.p !== String(proposalId || '')) return false
  if (seenEntry.hold === 'pending_revision') return moneyCents(seenEntry.pendingTotal) === moneyCents(want)
  return moneyCents(seenEntry.t) === moneyCents(want)
}
