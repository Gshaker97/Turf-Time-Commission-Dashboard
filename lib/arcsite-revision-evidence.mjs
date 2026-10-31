import { createHash } from 'node:crypto'

/** Documented https://dev.arcsite.com/proposals/ and /pagination/:
 * page starts at 1; per_page maximum 100; response is an array.
 * A short final page establishes exhaustion, not reaching our safety cap.
 */
export async function listArcsitePages(projectId, arcGet, { maxPages = 100 } = {}) {
  if (!/^\d+$/.test(projectId) || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new Error('invalid pagination bounds')
  const pages = [], seen = new Set()
  for (let page = 1; page <= maxPages; page++) {
    const rows = await arcGet(`/proposals?project_id=${encodeURIComponent(projectId)}&page=${page}&per_page=100`)
    if (!Array.isArray(rows) || rows.length > 100) throw new Error('invalid proposal page')
    for (const row of rows) {
      const id = String(row?.proposal_id ?? '')
      if (!/^\d+$/.test(id) || seen.has(id) || (row.project_id != null && String(row.project_id) !== projectId)) throw new Error('duplicate or mismatched proposal identity across pages')
      seen.add(id)
    }
    pages.push(rows)
    if (rows.length < 100) return { pages, complete: true }
  }
  throw new Error('proposal pagination cap reached; completeness unproved')
}

/** Server-facing interface. Defaults to documented bounded pagination above.
 * fetchPdfBytes returns {status,url,bytes}, not anonymous bytes, to preserve
 * response provenance. Incomplete pagination fails closed before PDF requests.
 */
export async function readArcsiteEvidence(projectId, { arcGet, fetchPdfBytes, parsePdfText, now = Date.now, listPages, providerContract } = {}) {
  const result = await readArcsiteRevisionEvidence(projectId, {
    listPages: listPages ?? (id => listArcsitePages(id, arcGet)),
    listProposals: id => arcGet(`/proposals?project_id=${encodeURIComponent(id)}&per_page=20`),
    getProposal: id => arcGet(`/proposals/${encodeURIComponent(id)}`),
    fetchPdf: fetchPdfBytes,
    extractPdfText: parsePdfText,
  }, { now: typeof now === 'function' ? now() : now, providerContract })
  if (result.holds.some(h => /pagination completeness|single proposal page/.test(h))) throw new Error('ArcSite proposal-list completeness unsupported')
  return result
}

/** Read-only dependency-injected adapter. No HTTP client or credentials here.
 * listPages must implement documented provider pagination and return
 * {pages: Array<Array<reference>>, complete: true}. A bare single-page list is
 * accepted only with explicit providerContract.singlePageUnderLimitComplete.
 * getProposal must GET the exact proposal detail. fetchPdf must GET without
 * forwarding ArcSite credentials to storage, reject redirects to unapproved
 * hosts, enforce byte/time limits, and return {status,bytes,url}.
 * extractPdfText must extract the actual supplied PDF bytes, not metadata.
 * No replacement/add-on resolution is inferred here; core requires review.
 */
export async function readArcsiteRevisionEvidence(projectId, adapters, options = {}) {
  const now = options.now ?? Date.now()
  const out = { projectId, verifiedAt: new Date(now).toISOString(), complete: false, validSignedProposalIds: [], proposals: [], holds: [] }
  const hold = message => { out.holds.push(message); return out }
  if (typeof projectId !== 'string' || !/^\d+$/.test(projectId)) return hold('invalid exact project ID')
  try {
    let pages
    if (adapters.listPages) {
      const listing = await adapters.listPages(projectId)
      if (listing?.complete !== true || !Array.isArray(listing.pages)) return hold('proposal pagination completeness unproved')
      pages = listing.pages
    } else {
      const page = await adapters.listProposals(projectId, { perPage: 20 })
      if (!Array.isArray(page) || page.length >= 20 || options.providerContract?.singlePageUnderLimitComplete !== true) return hold('single proposal page cannot establish completeness')
      pages = [page]
    }
    if (!pages.every(Array.isArray)) return hold('invalid proposal pages')
    const refs = pages.flat(), seen = new Set()
    for (const ref of refs) {
      const proposalId = String(ref?.proposal_id ?? '')
      if (!/^\d+$/.test(proposalId) || seen.has(proposalId)) return hold('invalid or duplicate proposal identity')
      seen.add(proposalId)
      if (ref.project_id != null && String(ref.project_id) !== projectId) return hold('proposal list project identity mismatch')
      const p = await adapters.getProposal(proposalId)
      if (!p || String(p.proposal_id) !== proposalId || (p.project_id != null && String(p.project_id) !== projectId)) return hold('proposal detail identity mismatch')
      // Deliberately stricter than historical arcCommitted's substring match.
      if (p.status !== 'APPROVED') continue
      if (p.void === true || p.voided === true || p.voided_at || p.cancelled === true || p.canceled === true) continue
      let url
      try { url = new URL(p.pdf_url) } catch { return hold('approved proposal lacks proposal-level PDF URL') }
      if (url.protocol !== 'https:' || url.username || url.password) return hold('unsafe proposal PDF URL')
      const doc = await adapters.fetchPdf(url.href, { projectId, proposalId, redirect: 'manual', forwardCredentials: false })
      if (doc?.status !== 200 || doc.url !== url.href || !(doc.bytes instanceof Uint8Array) || doc.bytes.length < 5 || doc.bytes.length > (options.maxPdfBytes ?? 32 * 1024 * 1024)) return hold('signed PDF retrieval incomplete or redirected')
      const bytes = Buffer.from(doc.bytes)
      if (bytes.subarray(0, 5).toString() !== '%PDF-') return hold('document is not PDF bytes')
      const text = await adapters.extractPdfText(bytes, { projectId, proposalId })
      if (typeof text !== 'string' || !/customer\s+signature|signnow_customer_signature/i.test(text)) return hold('PDF body signature evidence absent')
      // A document creation timestamp elsewhere is not signing evidence.
      const matches = [...text.matchAll(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})\s+(AM|PM)\s+UTC/g)]
        .filter(m => /customer\s+signature|signnow_customer_signature/i.test(text.slice(Math.max(0, m.index - 300), m.index + m[0].length + 300)))
      const times = matches.map(m => {
        let hour = Number(m[2]); if (hour < 1 || hour > 12 || Number(m[3]) > 59) return NaN
        hour = hour % 12 + (m[4] === 'PM' ? 12 : 0)
        const iso = `${m[1]}T${String(hour).padStart(2, '0')}:${m[3]}:00.000Z`, t = Date.parse(iso)
        return Number.isFinite(t) && new Date(t).toISOString() === iso ? t : NaN
      })
      if (!times.length || times.some(t => !Number.isFinite(t) || t > now)) return hold('PDF body signed timestamp absent or invalid')
      const total = Number(p.total)
      if (p.total == null || !Number.isFinite(total) || total <= 0) return hold('approved total invalid')
      const bodyTotals = [...text.matchAll(/^\s*Total(?:\s+\$?|\$)((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})\s*$/gm)].map(m => Math.round(Number(m[1].replaceAll(',', '')) * 100))
      if (!bodyTotals.length || bodyTotals.some(t => t !== Math.round(total * 100))) return hold('PDF body Total absent or disagrees with proposal metadata')
      const signedAt = new Date(Math.max(...times)).toISOString()
      out.proposals.push({ projectId, proposalId, status: 'APPROVED', void: false, total, verifiedAt: out.verifiedAt, signedAt, pdf: { projectId, proposalId, signed: true, sha256: createHash('sha256').update(bytes).digest('hex'), evidence: 'proposal-detail PDF URL binding plus extracted body signature timestamp; not cryptographic validation' } })
    }
    if (!out.proposals.length) return hold('no valid signed approved proposals')
    out.proposals.sort((a, b) => b.signedAt.localeCompare(a.signedAt) || (BigInt(a.proposalId) > BigInt(b.proposalId) ? -1 : 1))
    out.validSignedProposalIds = out.proposals.map(p => p.proposalId)
    out.latestValidProposalId = out.proposals[0].proposalId
    out.revision = out.proposals[0]
    out.complete = true
    return out
  } catch { return hold('ArcSite evidence read failed; no writes') }
}
