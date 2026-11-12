// Pure view builders for the read-only analyst "arcsite" views (Jarvis). No I/O.
// Every view: bounded page sizes, redacted (no tokens/secrets/links), explicit
// `available:false` when the underlying row is missing.
const MAX_LIMIT = 200, DEFAULT_LIMIT = 50
const SECRET_KEYS = /^(token|secret|password|authorization|apikey|api_key|x-api-key|cookie|signature|pdf_?url|url|link)$/i

export function clampPage({ offset, limit } = {}) {
  const o = Math.max(0, Number.parseInt(String(offset ?? 0), 10) || 0)
  const l = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(String(limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT))
  return { offset: o, limit: l }
}

/** Deep copy with secret-looking keys removed (value replaced by '[redacted]'). Arrays and nesting preserved. */
export function redact(value, depth = 0) {
  if (value == null || typeof value !== 'object' || depth > 12) return value
  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1))
  const out = {}
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1)
  return out
}

/** A list page: { available, total, offset, limit, rows, next_offset|null }. Accepts a missing list. */
export function pageView(list, opts = {}) {
  if (!Array.isArray(list)) return { available: false, total: 0, offset: 0, limit: clampPage(opts).limit, rows: [], next_offset: null }
  const { offset, limit } = clampPage(opts)
  let rows = list
  if (opts.q) { const q = String(opts.q).toLowerCase(); rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q)) }
  const total = rows.length, slice = rows.slice(offset, offset + limit)
  return { available: true, total, offset, limit, rows: redact(slice), next_offset: offset + limit < total ? offset + limit : null }
}

/** The 10-minute sweep's "seen" stamp map {projectId:{p,t}} → rows, filterable by project id. */
export function sweepSeenView(map, opts = {}) {
  if (!map || typeof map !== 'object') return { available: false, meaning: 'projects the value sweep has already processed; it will not revisit them', total: 0, rows: [] }
  let rows = Object.entries(map).map(([project_id, v]) => ({ project_id, proposal_id: v && v.p != null ? String(v.p) : null, total: v && v.t != null ? v.t : null }))
  if (opts.q) rows = rows.filter(r => r.project_id.includes(String(opts.q)) || (r.proposal_id || '').includes(String(opts.q)))
  const page = pageView(rows, opts)
  return { meaning: 'projects the value sweep has already processed (stamped seen by newest proposal id + total); it will not revisit them', ...page }
}

/** A stored run result (contract audit, install-date sync): summary fields + paged list fields. */
export function runView(run, opts = {}) {
  if (!run || typeof run !== 'object') return { available: false }
  const listKeys = opts.listKeys || ['changes', 'holds', 'flags']
  const out = { available: true }
  for (const [k, v] of Object.entries(run)) if (!Array.isArray(v)) out[k] = redact(v)
  for (const k of listKeys) if (Array.isArray(run[k])) out[k] = pageView(run[k], opts)
  for (const [k, v] of Object.entries(run)) if (Array.isArray(v) && !listKeys.includes(k)) out[k + '_count'] = v.length
  return out
}

/** Verified daily sweep: available days, the chosen day's job states, worker status (token redacted). */
export function dailyView({ days = [], day = null, worker = null, sweep = null } = {}) {
  const jobs = sweep && Array.isArray(sweep.jobs) ? sweep.jobs : null
  const states = {}
  if (jobs) for (const j of jobs) states[j.state || 'unknown'] = (states[j.state || 'unknown'] || 0) + 1
  return {
    available: Boolean(sweep || worker),
    days, day,
    worker: worker ? redact(worker) : null,
    sweep: sweep ? { ...redact({ ...sweep, jobs: undefined }), job_states: states, jobs: pageView(jobs || [], { limit: MAX_LIMIT }) } : null,
    note: sweep ? null : (day ? `no sweep record stored for ${day}` : 'no daily sweep records stored'),
  }
}

/** Batch / retry receipts: list of summaries, or one full redacted receipt by exact id. */
export function receiptsView(rows, prefix, opts = {}) {
  const list = (Array.isArray(rows) ? rows : []).map(r => ({ id: String(r.key || '').slice(prefix.length), value: r.value }))
  if (opts.id) {
    const hit = list.find(r => r.id === String(opts.id))
    return hit ? { available: true, id: hit.id, receipt: redact(hit.value) } : { available: false, id: String(opts.id) }
  }
  const summaries = list.map(r => {
    const v = r.value || {}
    const report = v.report || {}
    return { id: r.id, state: v.state ?? null, at: v.at ?? null, finished_at: v.finishedAt ?? null, dry_run: report.dryRun ?? null, results: Array.isArray(report.results) ? report.results.length : (Array.isArray(v.jobs) ? v.jobs.length : null), approved_plans: Array.isArray(v.approvedPlanHashes) ? v.approvedPlanHashes.length : null }
  }).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
  return pageView(summaries, opts)
}

/** Signed-PDF retry queue + failures: who/what is waiting, never the links. */
export function pdfQueueView(pending, failures) {
  const strip = e => ({ customer: e.customer ?? null, project_id: e.projectId ?? null, opportunity_id: e.oppId ?? null, proposal: e.proposalId ?? null, since: e.since ?? null, tries: e.tries ?? null, last_error: e.last_error ?? null, failed_at: e.failed_at ?? null, reason: e.reason ?? null })
  return {
    available: Array.isArray(pending) || Array.isArray(failures),
    pending: Array.isArray(pending) ? pending.map(strip) : [],
    failures: Array.isArray(failures) ? failures.map(strip) : [],
  }
}
