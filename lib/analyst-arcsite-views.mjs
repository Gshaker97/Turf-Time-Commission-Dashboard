// Pure view builders for the read-only analyst "arcsite" views (Jarvis). No I/O.
// Contract: every view takes a READ RESULT { ok, value, error } (or a plain value) and returns
//   • available:true  + data            when the row exists
//   • available:false, reason:'missing' when the row does not exist (genuinely empty)
//   • available:false, reason:'error', error:<message> when the read FAILED — never shown as empty
// Pages are bounded (limit ≤ 200) and every list carries total/offset/limit/next_offset so a caller
// can always fetch the rest. Redaction is key-based (substring match) AND value-based.
const MAX_LIMIT = 200, DEFAULT_LIMIT = 50
const SECRET_KEY = /(token|secret|passw|credential|authori[sz]ation|api[-_]?key|cookie|session|signature|bearer|private|url|link|href)/i
const SECRET_VALUE = /^(bearer\s+\S+|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}|https?:\/\/\S+|sk-[A-Za-z0-9_-]{16,}|pit-[A-Za-z0-9_-]{16,})$/i
const REDACTED = '[redacted]'

export const read = (value, error = null) => error ? { ok: false, value: null, error: String(error && error.message || error) } : { ok: true, value, error: null }
const unwrap = r => (r && typeof r === 'object' && 'ok' in r && 'value' in r) ? r : { ok: true, value: r, error: null }
const failed = r => ({ available: false, reason: 'error', error: r.error || 'storage read failed' })
const missing = extra => ({ available: false, reason: 'missing', ...extra })

export function clampPage({ offset, limit } = {}) {
  const o = Math.max(0, Number.parseInt(String(offset ?? 0), 10) || 0)
  const l = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(String(limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT))
  return { offset: o, limit: l }
}

/** Deep copy: any key whose name CONTAINS a secret-like word, or any string VALUE that looks like a
    bearer token / JWT / URL / vendor key, becomes '[redacted]'. Arrays and nesting preserved. */
export function redact(value, depth = 0) {
  if (depth > 12) return REDACTED
  if (typeof value === 'string') return SECRET_VALUE.test(value.trim()) ? REDACTED : value
  if (value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1))
  const out = {}
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? REDACTED : redact(v, depth + 1)
  return out
}

/** A list page. Accepts a read result or a plain array. */
export function pageView(input, opts = {}) {
  const r = unwrap(input); if (!r.ok) return failed(r)
  if (!Array.isArray(r.value)) return missing({ total: 0, offset: 0, limit: clampPage(opts).limit, rows: [], next_offset: null })
  const { offset, limit } = clampPage(opts)
  let rows = r.value
  if (opts.q) { const q = String(opts.q).toLowerCase(); rows = rows.filter(x => JSON.stringify(x).toLowerCase().includes(q)) }
  const total = rows.length
  return { available: true, total, offset, limit, rows: redact(rows.slice(offset, offset + limit)), next_offset: offset + limit < total ? offset + limit : null }
}

const MEANING = 'projects the value sweep has already processed (stamped seen by newest proposal id + total); it will not revisit them'
/** The 10-minute sweep's "seen" stamp map {projectId:{p,t}} → rows, filterable by project or proposal id. */
export function sweepSeenView(input, opts = {}) {
  const r = unwrap(input); if (!r.ok) return failed(r)
  if (!r.value || typeof r.value !== 'object') return missing({ meaning: MEANING, total: 0, rows: [] })
  let rows = Object.entries(r.value).map(([project_id, v]) => ({ project_id, proposal_id: v && v.p != null ? String(v.p) : null, total: v && v.t != null ? v.t : null }))
  if (opts.q) rows = rows.filter(x => x.project_id.includes(String(opts.q)) || (x.proposal_id || '').includes(String(opts.q)))
  return { meaning: MEANING, ...pageView(rows, { ...opts, q: undefined }) }
}

/** A stored run result (contract audit, install-date sync): scalar fields + paged list fields. */
export function runView(input, opts = {}) {
  const r = unwrap(input); if (!r.ok) return failed(r)
  const run = r.value
  if (!run || typeof run !== 'object') return missing({})
  const listKeys = opts.listKeys || ['changes', 'holds', 'flags']
  const out = { available: true }
  for (const [k, v] of Object.entries(run)) if (!Array.isArray(v)) out[k] = redact(v)
  for (const k of listKeys) if (Array.isArray(run[k])) out[k] = pageView(run[k], opts)
  for (const [k, v] of Object.entries(run)) if (Array.isArray(v) && !listKeys.includes(k)) out[k + '_count'] = v.length
  return out
}

/** Verified daily sweep: available days, the chosen day's job states, worker status. Jobs are PAGED (offset/limit). */
export function dailyView({ days = [], day = null, worker = null, sweep = null, daysError = null } = {}, opts = {}) {
  if (daysError) return failed({ error: daysError })
  const w = unwrap(worker), s = unwrap(sweep)
  if (!w.ok) return failed(w)
  if (!s.ok) return failed(s)
  const jobs = s.value && Array.isArray(s.value.jobs) ? s.value.jobs : null
  const states = {}
  if (jobs) for (const j of jobs) states[j.state || 'unknown'] = (states[j.state || 'unknown'] || 0) + 1
  return {
    available: Boolean(s.value || w.value),
    reason: s.value || w.value ? undefined : 'missing',
    days, day,
    worker: w.value ? redact(w.value) : null,
    sweep: s.value ? { ...redact({ ...s.value, jobs: undefined }), job_states: states, jobs: pageView(jobs || [], opts) } : null,
    note: s.value ? null : (day ? `no sweep record stored for ${day}` : 'no daily sweep records stored'),
  }
}

/** Batch / retry receipts: paged list of summaries, or one full redacted receipt by exact id. */
export function receiptsView(input, prefix, opts = {}) {
  const r = unwrap(input); if (!r.ok) return failed(r)
  const list = (Array.isArray(r.value) ? r.value : []).map(x => ({ id: String(x.key || '').slice(prefix.length), value: x.value }))
  if (opts.id) {
    const hit = list.find(x => x.id === String(opts.id))
    return hit ? { available: true, id: hit.id, receipt: redact(hit.value) } : missing({ id: String(opts.id) })
  }
  const summaries = list.map(x => {
    const v = x.value || {}, report = v.report || {}
    return { id: x.id, state: v.state ?? null, at: v.at ?? null, finished_at: v.finishedAt ?? null, dry_run: report.dryRun ?? null, results: Array.isArray(report.results) ? report.results.length : (Array.isArray(v.jobs) ? v.jobs.length : null), approved_plans: Array.isArray(v.approvedPlanHashes) ? v.approvedPlanHashes.length : null }
  }).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
  return pageView(summaries, opts)
}

/** Signed-PDF retry queue + failures: who/what is waiting, never the links. */
export function pdfQueueView(pendingIn, failuresIn) {
  const p = unwrap(pendingIn), f = unwrap(failuresIn)
  if (!p.ok) return failed(p)
  if (!f.ok) return failed(f)
  const strip = e => ({ customer: e.customer ?? null, project_id: e.projectId ?? null, opportunity_id: e.oppId ?? null, proposal: e.proposalId ?? null, since: e.since ?? null, tries: e.tries ?? null, last_error: e.last_error ?? null, failed_at: e.failed_at ?? null, reason: e.reason ?? null })
  if (!Array.isArray(p.value) && !Array.isArray(f.value)) return missing({ pending: [], failures: [] })
  return { available: true, pending: Array.isArray(p.value) ? p.value.map(strip) : [], failures: Array.isArray(f.value) ? f.value.map(strip) : [] }
}
