// Pure view builders for the read-only analyst "arcsite" views (Jarvis). No I/O.
//
// Contract
//   • Every view takes READ RESULTS { ok, value, error } (plain values are accepted too) and returns
//       available:true  + data                         the row exists
//       available:false, reason:'missing'              the row does not exist (genuinely empty)
//       available:false, reason:'error', error:<msg>   the read FAILED, or the stored record is not
//                                                      safe to project — never shown as empty data
//   • Output is built by an explicit ALLOWLIST (`project`): only named fields with the named scalar
//     type pass; everything else is dropped. There is no blacklist to get past. As defence in depth,
//     any allowed STRING that looks like a bearer string / JWT / URL / vendor key is still redacted.
//   • A stored record nested deeper than MAX_DEPTH fails closed (reason:'error'), it is not trimmed.
//   • Every list is a page: { total, offset, limit (≤ 200), rows, next_offset } so nothing is unreachable.
export const MAX_LIMIT = 200, DEFAULT_LIMIT = 50, MAX_DEPTH = 8
const SECRET_VALUE = /^(bearer\s+\S+|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}|https?:\/\/\S+|sk-[A-Za-z0-9_-]{16,}|pit-[A-Za-z0-9_-]{16,})$/i
const REDACTED = '[redacted]'

export const read = (value, error = null) => error ? { ok: false, value: null, error: String(error && error.message || error) } : { ok: true, value, error: null }
const unwrap = r => (r && typeof r === 'object' && 'ok' in r && 'value' in r) ? r : { ok: true, value: r, error: null }
const failed = r => ({ available: false, reason: 'error', error: (r && r.error) || 'storage read failed' })
const missing = extra => ({ available: false, reason: 'missing', ...extra })

export function clampPage({ offset, limit } = {}) {
  const o = Math.max(0, Number.parseInt(String(offset ?? 0), 10) || 0)
  const l = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(String(limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT))
  return { offset: o, limit: l }
}

/** Depth of a raw value: scalars 0, {} / [] 1, {a:{}} 2 … Cycles count as too deep. */
export function depthOf(v, seen = new Set()) {
  if (v == null || typeof v !== 'object') return 0
  if (seen.has(v)) return Infinity
  seen.add(v)
  let d = 0
  for (const x of Array.isArray(v) ? v : Object.values(v)) { d = Math.max(d, depthOf(x, seen)); if (d === Infinity) break }
  seen.delete(v)
  return d + 1
}

const scalar = (v, type) => {
  if (type === 'string') return typeof v === 'string' ? (SECRET_VALUE.test(v.trim()) ? REDACTED : v) : undefined
  if (type === 'number') return typeof v === 'number' && Number.isFinite(v) ? v : undefined
  if (type === 'boolean') return typeof v === 'boolean' ? v : undefined
  if (type === 'scalar') return typeof v === 'string' ? scalar(v, 'string') : (typeof v === 'number' || typeof v === 'boolean') ? v : v === null ? null : undefined
  return undefined
}

/** Allowlist projection. schema: 'string'|'number'|'boolean'|'scalar' | { key: schema } | [itemSchema] | { __record: schema }.
    Unlisted keys are dropped; a listed key whose value has the wrong shape is dropped; nothing else is copied. */
export function project(value, schema) {
  if (typeof schema === 'string') { const s = scalar(value, schema); return s === undefined ? undefined : s }
  if (value == null) return undefined
  if (Array.isArray(schema)) { if (!Array.isArray(value)) return undefined; return value.map(x => project(x, schema[0])).filter(x => x !== undefined) }
  if (typeof value !== 'object' || Array.isArray(value)) return undefined
  const out = {}
  if (schema.__record) { for (const [k, v] of Object.entries(value)) { const p = project(v, schema.__record); if (p !== undefined) out[k] = p }; return out }
  for (const [k, sub] of Object.entries(schema)) { if (!(k in value)) continue; const p = project(value[k], sub); if (p !== undefined) out[k] = p }
  return out
}

/** Project a whole stored record, failing closed when it nests too deep. */
function safe(raw, schema) {
  if (depthOf(raw) > MAX_DEPTH) return { ok: false, error: `stored record nests deeper than ${MAX_DEPTH} levels; not returned` }
  return { ok: true, value: project(raw, schema) }
}

/** A list page from an array of RAW rows; each row is projected through itemSchema. */
export function pageView(input, itemSchema, opts = {}) {
  const r = unwrap(input); if (!r.ok) return failed(r)
  if (!Array.isArray(r.value)) return missing({ total: 0, offset: 0, limit: clampPage(opts).limit, rows: [], next_offset: null })
  if (depthOf(r.value) > MAX_DEPTH) return failed({ error: `stored list nests deeper than ${MAX_DEPTH} levels; not returned` })
  const { offset, limit } = clampPage(opts)
  let rows = r.value.map(x => project(x, itemSchema)).filter(x => x !== undefined)
  if (opts.q) { const q = String(opts.q).toLowerCase(); rows = rows.filter(x => JSON.stringify(x).toLowerCase().includes(q)) }
  const total = rows.length
  return { available: true, total, offset, limit, rows: rows.slice(offset, offset + limit), next_offset: offset + limit < total ? offset + limit : null }
}

// ── schemas (the allowlists) ─────────────────────────────────────────────────────────────────────
const S = {
  sweepSeen: { project_id: 'string', proposal_id: 'string', total: 'scalar' },
  idsChange: { customer: 'string', opportunity_id: 'string', project_id: 'string', pipeline: 'string', stage: 'string', ghl: 'scalar', pm_job: 'scalar', pm: 'scalar', pm_canceled: 'boolean', source: 'string', revision: 'scalar', kind: 'string', from: 'scalar', to: 'scalar', outcome: 'string', stale: 'boolean', ghl_written: 'boolean', ghl_verified: 'boolean', ghl_read_back: 'scalar', ghl_note: 'string', ghl_error: 'string', reason: 'string', flag: 'string' },
  idsRun: { at: 'string', dry: 'boolean', fill_empty: 'boolean', test: 'boolean', excluded: 'number', checked: 'number', in_sync: 'number', moves: 'number', fills: 'number', cancels: 'number', pm_only: 'number', stale_skipped: 'number', snapshot_at: 'string', writes_disabled: 'boolean', errors: ['string'], skipped: { __record: 'number' } },
  idsLog: { at: 'string', opp: 'string', project: 'string', customer: 'string', kind: 'string', from: 'scalar', to: 'scalar', pm_job: 'scalar', pm_from: 'scalar', source: 'string', revision: 'scalar', outcome: 'string', test: 'boolean' },
  auditGap: { project_id: 'string', customer: 'string', install: 'scalar', contracts: 'string', value: 'scalar', signed_total: 'scalar', sheet_price: 'scalar', arcsite_total: 'scalar', ghl_value: 'scalar', reason: 'string', error: 'string', outcome: 'string', fixed: 'boolean', new_value: 'scalar' },
  auditRun: { at: 'string', day: 'string', fix: 'boolean', days_back: 'number', scanned: 'number', candidates: 'number', checked: 'number', ok: 'number', skipped: 'scalar' },
  dailyWorker: { day: 'string', state: 'string', at: 'string', finishedAt: 'string', outcome: { day: 'string', complete: 'boolean', ok: 'boolean' } },
  dailySweep: { day: 'string', savedAt: 'string', complete: 'boolean', ok: 'boolean', state: 'string', reason: 'string', uncertain: 'boolean' },
  dailyJob: { projectId: 'string', opportunityId: 'string', state: 'string', reason: 'string', holds: ['string'], attemptId: 'string', planHash: 'string' },
  receiptSummary: { id: 'string', state: 'string', at: 'string', finished_at: 'string', dry_run: 'boolean', results: 'number', approved_plans: 'number' },
  plan: { projectId: 'string', opportunityId: 'string', planHash: 'string', changes: [{ field: 'string', wasCents: 'number', wantCents: 'number' }], holds: ['string'] },
  result: { projectId: 'string', opportunityId: 'string', dryRun: 'boolean', ok: 'boolean', fields: [{ field: 'string', state: 'string', expectedCents: 'number', observedCents: 'number', writeError: 'string' }] },
  receiptJob: { projectId: 'string', opportunityId: 'string', state: 'string', reason: 'string', planHash: 'string', attemptId: 'string' },
  receipt: { state: 'string', reason: 'string', meaning: 'string', at: 'string', finishedAt: 'string', batchId: 'string', retryId: 'string', fieldStates: { __record: 'number' }, report: { dryRun: 'boolean', fullScope: 'boolean' } },
  pdfEntry: { customer: 'string', projectId: 'string', oppId: 'string', proposalId: 'scalar', since: 'string', tries: 'number', last_error: 'string', failed_at: 'string', reason: 'string' },
}
export const SCHEMAS = S

// ── views ────────────────────────────────────────────────────────────────────────────────────────
const MEANING = 'projects the value sweep has already processed (stamped seen by newest proposal id + total); it will not revisit them'
/** The 10-minute sweep's "seen" stamp map {projectId:{p,t}} → rows, filterable by project or proposal id. */
export function sweepSeenView(input, opts = {}) {
  const r = unwrap(input); if (!r.ok) return failed(r)
  if (!r.value || typeof r.value !== 'object' || Array.isArray(r.value)) return missing({ meaning: MEANING, total: 0, rows: [] })
  if (depthOf(r.value) > MAX_DEPTH) return failed({ error: 'stored record nests too deep; not returned' })
  let rows = Object.entries(r.value).map(([project_id, v]) => ({ project_id, proposal_id: v && v.p != null ? String(v.p) : null, total: v && v.t != null ? v.t : null }))
  if (opts.q) rows = rows.filter(x => x.project_id.includes(String(opts.q)) || (x.proposal_id || '').includes(String(opts.q)))
  return { meaning: MEANING, ...pageView(rows, S.sweepSeen, { ...opts, q: undefined }) }
}

/** A stored run result: allowlisted scalar fields + paged list fields. kind = 'install-date' | 'contract-audit'. */
export function runView(input, kind, opts = {}) {
  const r = unwrap(input); if (!r.ok) return failed(r)
  const run = r.value
  if (!run || typeof run !== 'object' || Array.isArray(run)) return missing({})
  const spec = kind === 'contract-audit'
    ? { scalars: S.auditRun, lists: { gaps: S.auditGap, sheet_gaps: S.auditGap, fixed: S.auditGap, failed: S.auditGap } }
    : { scalars: S.idsRun, lists: { changes: S.idsChange, holds: S.idsChange, flags: S.idsChange } }
  const s = safe(run, spec.scalars); if (!s.ok) return failed(s)
  // the audit's own "ok" is a COUNT of jobs that checked out; it must not shadow the envelope's ok:true
  if ('ok' in s.value) { s.value.ok_count = s.value.ok; delete s.value.ok }
  const out = { available: true, ...s.value }
  for (const [k, itemSchema] of Object.entries(spec.lists)) if (Array.isArray(run[k])) { const p = pageView(run[k], itemSchema, opts); if (p.reason === 'error') return failed(p); out[k] = p }
  return out
}

/** The install-date change log: a paged list of allowlisted entries. */
export const logView = (input, opts = {}) => pageView(input, S.idsLog, opts)

/** Verified daily sweep: paged day list, the chosen day's job states, worker status. Jobs are PAGED (offset/limit). */
export function dailyView({ days = [], day = null, worker = null, sweep = null, daysError = null } = {}, opts = {}) {
  if (daysError) return failed({ error: daysError })
  const w = unwrap(worker), s = unwrap(sweep)
  if (!w.ok) return failed(w)
  if (!s.ok) return failed(s)
  const ws = w.value ? safe(w.value, S.dailyWorker) : { ok: true, value: null }; if (!ws.ok) return failed(ws)
  const ss = s.value ? safe(s.value, S.dailySweep) : { ok: true, value: null }; if (!ss.ok) return failed(ss)
  const jobs = s.value && Array.isArray(s.value.jobs) ? s.value.jobs : null
  const states = {}
  if (jobs) for (const j of jobs) { const st = typeof j.state === 'string' ? j.state : 'unknown'; states[st] = (states[st] || 0) + 1 }
  const jobPage = jobs ? pageView(jobs, S.dailyJob, opts) : null
  if (jobPage && jobPage.reason === 'error') return failed(jobPage)
  const dayList = pageView(days.map(d => ({ day: d })), { day: 'string' }, { offset: opts.days_offset, limit: opts.days_limit ?? MAX_LIMIT })
  return {
    available: Boolean(s.value || w.value),
    reason: s.value || w.value ? undefined : 'missing',
    days: dayList, day,
    worker: ws.value,
    sweep: ss.value ? { ...ss.value, job_states: states, jobs: jobPage || pageView([], S.dailyJob, opts) } : null,
    note: s.value ? null : (day ? `no sweep record stored for ${day}` : 'no daily sweep records stored'),
  }
}

/** Batch / retry receipts: paged list of summaries, or one allowlisted receipt by exact id (its lists paged). */
export function receiptsView(input, prefix, opts = {}) {
  const r = unwrap(input); if (!r.ok) return failed(r)
  const list = (Array.isArray(r.value) ? r.value : []).map(x => ({ id: String(x.key || '').slice(prefix.length), value: x.value }))
  if (opts.id) {
    const hit = list.find(x => x.id === String(opts.id))
    if (!hit) return missing({ id: String(opts.id) })
    const v = hit.value || {}
    const s = safe(v, S.receipt); if (!s.ok) return failed(s)
    const report = v.report && typeof v.report === 'object' ? v.report : {}
    const page = (arr, schema) => { const p = pageView(Array.isArray(arr) ? arr : [], schema, opts); return p }
    const plans = page(report.plans, S.plan), results = page(report.results, S.result), jobs = page(v.jobs, S.receiptJob)
    for (const p of [plans, results, jobs]) if (p.reason === 'error') return failed(p)
    return { available: true, id: hit.id, receipt: { ...s.value, approved_plans: Array.isArray(v.approvedPlanHashes) ? v.approvedPlanHashes.length : null, report: { ...(s.value.report || {}), plans, results }, jobs } }
  }
  const summaries = list.map(x => {
    const v = x.value || {}, report = v.report || {}
    return { id: x.id, state: v.state ?? null, at: v.at ?? null, finished_at: v.finishedAt ?? null, dry_run: report.dryRun ?? null, results: Array.isArray(report.results) ? report.results.length : (Array.isArray(v.jobs) ? v.jobs.length : null), approved_plans: Array.isArray(v.approvedPlanHashes) ? v.approvedPlanHashes.length : null }
  }).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
  return pageView(summaries, S.receiptSummary, opts)
}

/** Signed-PDF retry queue + failures: who/what is waiting, never the links. Both lists paged. */
export function pdfQueueView(pendingIn, failuresIn, opts = {}) {
  const p = unwrap(pendingIn), f = unwrap(failuresIn)
  if (!p.ok) return failed(p)
  if (!f.ok) return failed(f)
  if (!Array.isArray(p.value) && !Array.isArray(f.value)) return missing({ pending: null, failures: null })
  const pending = pageView(Array.isArray(p.value) ? p.value : [], S.pdfEntry, opts), failures = pageView(Array.isArray(f.value) ? f.value : [], S.pdfEntry, opts)
  if (pending.reason === 'error') return failed(pending)
  if (failures.reason === 'error') return failed(failures)
  return { available: true, pending, failures }
}
