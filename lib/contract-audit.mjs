// The daily contract audit's decisions, pure (no I/O) so they can be tested.
//
// Why this exists (Nov 20 2026): three PM calendar jobs (Isaac Rosas J-1575,
// Jared Morris J-1647, Tyler Sibold J-1696) still held the contract from BEFORE
// their change order, days after the 6 AM audit and the 9 PM check had run.
// The audit read the calendar's analyst export, which carries no contract
// files at all, so its "calendar behind" test could never be true and every
// run reported behind: 0. And a calendar job holding ONE file is normal — the
// calendar replaces an older contract when a new one lands — so a file COUNT
// says nothing about whether it is the newest.
//
// The rule now: ArcSite's newest signed PDF is the truth. A PDF is the same
// file wherever it is hosted (ArcSite → GHL → the calendar copy the bytes
// unchanged), so its BYTE SIZE identifies it: GHL's file entries carry
// meta.size, the calendar's jobs export carries sizeBytes, and ArcSite's
// download answers a HEAD with content-length. GHL and the calendar are each
// judged against that newest PDF on their own, and whichever is behind gets
// it pushed — the calendar never waits for GHL to be right first.

/** The newest signed proposal (arcSignedContracts order is oldest → newest). */
export const newestSigned = signed => (signed && signed.length ? signed[signed.length - 1] : null)

const sizeOf = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null }

/** Does GHL's Contract/PDF field hold every signed contract, the newest included?
    entries: oppContractEntries() shape ({url, name, size}). */
export function ghlContractState({ signed, entries, newestSize }) {
  const attached = (entries || []).length, count = (signed || []).length
  if (count > attached) return { behind: true, reason: `${attached} attached / ${count} signed` }
  const sizes = (entries || []).map(e => sizeOf(e.size)).filter(Boolean)
  // Only when BOTH sides carry sizes can the newest be identified; otherwise the
  // count rule is all there is (older GHL uploads sometimes lack meta.size).
  if (newestSize && sizes.length && !sizes.includes(newestSize)) return { behind: true, reason: `${attached} attached / ${count} signed, but the newest signed PDF (${newestSize} bytes) is not among them` }
  return { behind: false, reason: null }
}

/** Does the PM calendar job hold the newest signed contract?
    job: a /api/export/jobs row ({jobNumber, contracts:[{filename,sizeBytes,url}]}).
    state: no_job | no_contract | behind | current | unverified */
export function calendarContractState({ signed, newestSize, job }) {
  if (!job) return { state: 'no_job', reason: 'no PM calendar job is linked to this opportunity' }
  if (!(signed || []).length) return { state: 'current', reason: null }
  const files = Array.isArray(job.contracts) ? job.contracts : []
  if (!files.length) return { state: 'no_contract', reason: `calendar job ${job.jobNumber || '?'} has no contract file` }
  if (!newestSize) return { state: 'unverified', reason: `the newest signed PDF's size is unknown, so calendar job ${job.jobNumber || '?'} could not be checked` }
  const sizes = files.map(f => sizeOf(f.sizeBytes ?? f.size)).filter(Boolean)
  if (!sizes.length) return { state: 'unverified', reason: `calendar job ${job.jobNumber || '?'} reports no file sizes, so it could not be checked` }
  if (sizes.includes(newestSize)) return { state: 'current', reason: null }
  return { state: 'behind', reason: `calendar job ${job.jobNumber || '?'} holds ${files.length} contract${files.length === 1 ? '' : 's'} (${sizes.join(', ')} bytes) but not the newest signed PDF (${newestSize} bytes)` }
}

/** Where to fetch the newest signed PDF from when pushing it to the calendar:
    GHL's own hosted copy when GHL demonstrably has it (the calendar then files
    it under the same key its 6h GHL import would), else straight from ArcSite. */
export function calendarPushSource({ entries, newestSize, newest, customerName }) {
  const fromGhl = newestSize ? (entries || []).find(e => sizeOf(e.size) === newestSize) : null
  if (fromGhl && fromGhl.url) return { source: 'ghl', url: fromGhl.url, name: fromGhl.name || 'contract.pdf' }
  if (newest && newest.pdf_url) return { source: 'arcsite', url: newest.pdf_url, name: `${customerName || 'Customer'} - contract ${newest.document_number || newest.proposal_id}.pdf`.replace(/[\/\\]/g, '-') }
  return null
}

/** One stdout line per run for Railway logs. */
export function auditSummaryLine(out) {
  const parts = [`day=${out.day}`, out.dry ? 'mode=DRY-RUN (nothing sent)' : (out.fix ? 'mode=fix' : 'mode=report-only'), `since=${out.floor || out.since || '-'}`,
    `scanned=${out.scanned}`, `candidates=${out.candidates}`, `checked=${out.checked}`, `ok=${out.ok}`, `gaps=${(out.gaps || []).length}`,
    `fixed=${(out.fixed || []).length}`, `failed=${(out.failed || []).length}`, `skipped=${(out.skipped_jobs || []).length}`, `held=${(out.held || []).length}`,
    `would_fix=${(out.would_fix || []).length}`]
  if (out.calendar && out.calendar.error) parts.push(`calendar_error="${out.calendar.error}"`)
  if (out.skipped) parts.push(`run_skipped="${out.skipped}"`)
  return parts.join(' ')
}

/** One stdout line per job the audit touched or deliberately left. */
export function auditItemLine(kind, item) {
  const who = `${item.customer || '?'}${item.calendar_job ? ` (${item.calendar_job})` : ''} project ${item.project_id || '?'}`
  const what = item.target ? `${item.target} behind` : (item.action || 'gap')
  const why = item.reason || item.error || item.contracts || ''
  return `${kind} ${who}: ${what}${why ? ` — ${why}` : ''}${item.source ? ` [pushed from ${item.source}]` : ''}`
}
