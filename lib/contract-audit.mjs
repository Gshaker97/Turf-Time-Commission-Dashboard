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

/** Is the newest signed PDF's byte size unique among this project's signed
    PDFs? Only then does a size match PROVE a file is the newest revision; two
    revisions can share a size (same drawing, one line changed). sizes = the
    HEAD content-length of every signed PDF, oldest → newest. */
export function newestSizeUnique(sizes) {
  const list = (sizes || []).map(sizeOf)
  const newest = list[list.length - 1]
  return !!newest && list.slice(0, -1).every(n => n !== newest)
}

/** A GHL file entry hosted by this server is named "<customer> - contract <proposal>.pdf",
    so the proposal id in the name is a second identity, independent of size. */
export const entryNamesProposal = (entry, newest) => {
  const ids = [newest && newest.document_number, newest && newest.proposal_id].filter(Boolean).map(String)
  const name = String((entry && entry.name) || '')
  // GHL slugs an uploaded name ("Derick Jones - contract 622746.pdf" is stored as
  // "derick-jones-contract-622746.pdf"), so either spelling counts.
  return ids.some(id => new RegExp(`contract[ -]${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\.pdf$`, 'i').test(name))
}

/** Does GHL's Contract/PDF field hold every signed contract, the newest included?
    entries: oppContractEntries() shape ({url, name, size}). Identity = byte size
    when the newest size is unique on the project, else the proposal id in the
    file name; with neither, the count rule alone decides and `verified` is false. */
export function ghlContractState({ signed, entries, newestSize, sizeUnique = true, newest }) {
  const attached = (entries || []).length, count = (signed || []).length
  if (count > attached) return { behind: true, verified: true, reason: `${attached} attached / ${count} signed` }
  const byName = !!newest && (entries || []).some(e => entryNamesProposal(e, newest))
  if (byName) return { behind: false, verified: true, reason: null }
  const sizes = (entries || []).map(e => sizeOf(e.size)).filter(Boolean)
  if (newestSize && sizes.length) {
    if (sizes.includes(newestSize)) return sizeUnique ? { behind: false, verified: true, reason: null } : { behind: false, verified: false, reason: `a file of the newest PDF's size (${newestSize} bytes) is attached, but an older revision has the same size and no file name carries proposal ${newest && (newest.document_number || newest.proposal_id)}` }
    return { behind: true, verified: true, reason: `${attached} attached / ${count} signed, but the newest signed PDF (${newestSize} bytes) is not among them` }
  }
  // Only when BOTH sides carry sizes can the newest be identified; otherwise the
  // count rule is all there is (older GHL uploads sometimes lack meta.size).
  return { behind: false, verified: false, reason: 'file sizes unknown — only the count could be checked' }
}

/** Does the PM calendar job hold the newest signed contract?
    job: a /api/export/jobs row ({jobNumber, contracts:[{filename,sizeBytes,url}]}).
    ledger: this server's own record of the last contract it pushed to that job
    ({proposal_id, job}) — the second identity when size cannot decide: the
    calendar names files by order, not by proposal, and may hold a re-encoded
    copy of a different size, so without it a job would be pushed every night.
    state: no_job | no_contract | behind | current | current_by_ledger | ambiguous | unverified */
export function calendarContractState({ signed, newestSize, sizeUnique = true, job, ledger, newest }) {
  if (!job) return { state: 'no_job', reason: 'no PM calendar job is linked to this opportunity' }
  if (!(signed || []).length) return { state: 'current', reason: null }
  const files = Array.isArray(job.contracts) ? job.contracts : []
  if (!files.length) return { state: 'no_contract', reason: `calendar job ${job.jobNumber || '?'} has no contract file` }
  const newestId = newest ? String(newest.proposal_id || '') : ''
  const pushed = !!(ledger && newestId && String(ledger.proposal_id || '') === newestId && (!ledger.job || !job.jobNumber || ledger.job === job.jobNumber))
  if (pushed) return { state: 'current_by_ledger', reason: `proposal ${newest.document_number || newest.proposal_id} was pushed to calendar job ${job.jobNumber || '?'} on ${String(ledger.at || '').slice(0, 10) || 'an earlier run'} and the job still holds a contract` }
  if (!newestSize) return { state: 'unverified', reason: `the newest signed PDF's size is unknown, so calendar job ${job.jobNumber || '?'} could not be checked` }
  const sizes = files.map(f => sizeOf(f.sizeBytes ?? f.size)).filter(Boolean)
  if (!sizes.length) return { state: 'unverified', reason: `calendar job ${job.jobNumber || '?'} reports no file sizes, so it could not be checked` }
  if (sizes.includes(newestSize)) {
    if (sizeUnique) return { state: 'current', reason: null }
    return { state: 'ambiguous', reason: `calendar job ${job.jobNumber || '?'} holds a file of the newest PDF's size (${newestSize} bytes), but an older revision has the same size — a push settles it (the calendar ignores a file it already has)` }
  }
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
  if (out.arcsite_errors) parts.push(`arcsite_errors=${out.arcsite_errors}`)
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
