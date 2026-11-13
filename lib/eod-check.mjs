// End-of-day alignment check (Garrison, Nov 13 2026). PURE: takes the hourly
// analyst bundle's data and returns a report; the server stores it and texts
// Garrison only when something is off. Compares, per ArcSite Project ID, across
// the AI Sheet (Jobs + Schedule tabs), GHL (opportunity + contact), the install
// calendar and the commission site: name, phone, address, job price, install
// date, setter/closer where applicable, and whether the ArcSite contract is on
// the job. Commission is deliberately NOT compared (it varies by design).
// Plus: sales approved today with no GHL opportunity, calendar jobs still at $0
// or linked to a website lead, sale texts that never went out, blocked sale
// lookups, and a daily worker left running.

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const nameTokens = s => norm(String(s || '').replace(/·.*$/, '').replace(/\b(and|&)\b/g, ' ')).split(' ').filter(t => t.length > 1)
const NICK = { charles: 'charlie', charlie: 'charles', robert: 'bob', bob: 'robert', william: 'bill', bill: 'william', michael: 'mike', mike: 'michael', jonathan: 'jon', jon: 'jonathan', joseph: 'joe', joe: 'joseph', richard: 'rick', rick: 'richard', nicholas: 'nick', nick: 'nicholas', james: 'jim', jim: 'james', christopher: 'chris', chris: 'christopher', matthew: 'matt', matt: 'matthew', daniel: 'dan', dan: 'daniel', anthony: 'tony', tony: 'anthony', zackary: 'zack', zack: 'zackary', kyle: 'ky' }
const sameFirst = (a, b) => a === b || NICK[a] === b || NICK[b] === a || (a.length >= 4 && b.startsWith(a)) || (b.length >= 4 && a.startsWith(b))
/** Edit distance ≤ 1 (one typo: Hedgcock / Hedgecock). */
const close = (a, b) => { if (a === b) return true; if (Math.abs(a.length - b.length) > 1) return false; let i = 0, j = 0, d = 0; while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue } if (++d > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++ } } return d + (a.length - i) + (b.length - j) <= 1 }
/** Same person? Loose: shared surname (±1 typo), nickname-aware first name, or one name inside the other. */
export function sameName(a, b) {
  const ta = nameTokens(a), tb = nameTokens(b)
  if (!ta.length || !tb.length) return true   // nothing to compare → not a mismatch
  if (ta.join(' ') === tb.join(' ')) return true
  if (ta.length === 1 || tb.length === 1) return sameFirst(ta[0], tb[0]) || close(ta.at(-1), tb.at(-1))   // "Charles" vs "Charlie Higgins"
  if (close(ta.at(-1), tb.at(-1)) && ta.at(-1).length >= 3) return true
  const A = ta.join(' '), B = tb.join(' ')
  if ((A.length >= 4 && B.includes(A)) || (B.length >= 4 && A.includes(B))) return true
  // first + last both present in the other (e.g. "Camron & Bobbie Johnson" vs "Camron Johnson")
  return ta.filter(t => tb.includes(t)).length >= 2
}
export const phoneKey = v => String(v || '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1').slice(-10)
/** Every 10-digit US number in a cell ("480-555-1234 / 602-555-9876" holds two). */
export const phoneKeys = v => [...String(v || '').matchAll(/(?:\+?1\D{0,3})?(\d{3})\D{0,3}(\d{3})\D{0,3}(\d{4})(?!\d)/g)].map(m => m[1] + m[2] + m[3])
const phonesDiffer = (a, b) => { const A = phoneKeys(a), B = phoneKeys(b); return A.length > 0 && B.length > 0 && !A.some(x => B.includes(x)) }
/** Street key: house number + first street word, e.g. "5911 e california ct" → "5911 california". */
export function streetKey(v) {
  const s = norm(String(v || '').split(',')[0])
  // "14394W soft wind drive" and "14394 W Soft Wind Dr" are the same street: digits, an optional
  // direction letter/word (attached or not), then the first street word.
  const m = s.match(/^(\d+)\s*(?:[nsew]|north|south|east|west)?\b\s*([a-z0-9]+)/) || s.match(/^(\d+)[a-z]?\s*([a-z0-9]+)/)
  return m ? `${m[1]} ${m[2]}` : s
}
export const money = v => { if (v == null || v === '') return null; const n = Number(String(v).replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null }
const same$ = (a, b) => a != null && b != null && Math.abs(a - b) < 0.011
const ymd = v => { const s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null }
const header = (t, re) => (t && t.headers || []).find(x => re.test(String(x).toLowerCase())) || null
const col = (row, h) => h ? row[h] : undefined
const usd = n => n == null ? 'n/a' : (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const isLeadOpp = o => !(o && o.project_id) && (/website\s*estimate/i.test(String(o && o.name || '')) || !(money(o && o.value) > 0))
const setterFromLeadSource = v => { const m = String(v || '').match(/setter\s*:\s*([^|,;]+)/i); return m ? m[1].trim() : null }

/**
 * @param {object} p
 * @param {string} p.day                 YYYY-MM-DD (Phoenix)
 * @param {{headers:string[],rows:object[]}} p.sheetJobs
 * @param {{headers:string[],rows:object[]}} p.sheetSchedule
 * @param {{opportunities:object[], contacts:object|object[]}} p.ghl   analyst snapshot shapes
 * @param {object[]} p.calendarJobs      install calendar jobs (export shape)
 * @param {object[]} p.siteDeals         commission-site deals (setter/closer resolved to {name})
 * @param {object[]} [p.events]          today's sale events (arcLog ring): {at, action, ok, project_id, ignored}
 * @param {object} [p.alertStates]       {projectId: 'sent'|'intent'|'uncertain'|...}
 * @param {object} [p.worker]            verified daily worker record
 * @param {object} [p.contractAudit]     last contract audit (gaps/sheet_gaps)
 * @param {string} [p.scopeSince]        only jobs approved on/after (default 2026-10-13)
 * @param {string[]} [p.siteExcludedReps] reps the commission site never imports (default rhett, ronnie)
 */
export function buildEodReport(p) {
  const day = p.day, since = p.scopeSince || '2026-10-13'
  const excluded = (p.siteExcludedReps || ['rhett', 'ronnie', 'josh hilton']).map(s => s.toLowerCase())
  const J = p.sheetJobs || { headers: [], rows: [] }, S = p.sheetSchedule || { headers: [], rows: [] }
  const H = {
    pid: header(J, /project\s*id/), prop: header(J, /proposal\s*id/), cust: header(J, /^customer$/), phone: header(J, /customer\s*phone|phone/), addr: header(J, /install\s*address|address/),
    total: header(J, /approved\s*total/), rep: header(J, /sales\s*rep/), appr: header(J, /approved\s*date/), status: header(J, /^status$/),
  }
  const SH = { prop: header(S, /proposal\s*id/), cust: header(S, /^customer$/), inst: header(S, /install\s*date/), status: header(S, /^status$/), lead: header(S, /lead\s*source/), rep: header(S, /sales\s*rep/), notes: header(S, /^notes$/) }
  const issues = []
  const ignore = (p.ignore || []).map(x => typeof x === 'string' ? { match: norm(x), kinds: null } : { match: norm(x.match), kinds: x.kinds || null })
  const ignored = (customer, pid, kind) => ignore.some(x => (x.match === norm(customer) || x.match === String(pid)) && (!x.kinds || x.kinds.includes(kind)))
  const add = (kind, severity, ctx, detail) => { if (ignored(ctx.customer, ctx.pid, kind)) return; issues.push({ kind, severity, project_id: ctx.pid || null, customer: ctx.customer || null, job: ctx.job || null, opportunity_id: ctx.opp || null, detail }) }
  // A source that did not load (Google quota, calendar down…) is reported ONCE
  // as unavailable; the per-job comparison is skipped rather than reporting
  // every job as missing from that source.
  const errs = p.sourceErrors || {}
  const bad = Object.entries(errs).filter(([, e]) => e).concat(!J.rows.length && !errs.sheet ? [['sheet', 'no Sheet rows loaded']] : [])
  if (bad.length) {
    for (const [src, e] of bad) add('source_unavailable', 'high', {}, `${src}: ${String(e).split('\n')[0].slice(0, 120)}`)
    return finish({ day, since, checked: 0, issues, previous: p.previous })
  }

  // Sheet: newest approved row per Project ID (rows are newest first), rows per pid
  const byPid = new Map(), rowsPerPid = new Map()
  for (const r of J.rows) {
    const pid = String(col(r, H.pid) || '').trim(); if (!pid) continue
    if (H.status && !/approved/i.test(String(col(r, H.status) || ''))) continue
    rowsPerPid.set(pid, (rowsPerPid.get(pid) || 0) + 1)
    if (!byPid.has(pid)) byPid.set(pid, r)
  }
  const schedByProp = new Map(), schedByName = new Map(), cancelledByProp = new Map()
  for (const r of S.rows) {
    const prop = String(col(r, SH.prop) || '').trim()
    if (SH.status && /cancel/i.test(String(col(r, SH.status) || ''))) { if (prop && !cancelledByProp.has(prop)) cancelledByProp.set(prop, r); continue }
    if (SH.status && !/booked/i.test(String(col(r, SH.status) || ''))) continue
    if (prop && !schedByProp.has(prop)) schedByProp.set(prop, r)
    const nk = norm(col(r, SH.cust)); if (nk && !schedByName.has(nk)) schedByName.set(nk, r)
  }
  const opps = (p.ghl && p.ghl.opportunities) || []
  const contacts = Array.isArray(p.ghl && p.ghl.contacts) ? Object.fromEntries(p.ghl.contacts.map(c => [c.id, c])) : ((p.ghl && p.ghl.contacts) || {})
  const oppsByPid = new Map()
  for (const o of opps) { if (!o.project_id || o.status === 'lost' || o.status === 'abandoned') continue; const l = oppsByPid.get(o.project_id) || []; l.push(o); oppsByPid.set(o.project_id, l) }
  const cal = (p.calendarJobs || []).filter(j => !j.canceledAt)
  const calByOpp = new Map(), calByContact = new Map()
  for (const j of cal) { if (j.ghlOpportunityId) calByOpp.set(j.ghlOpportunityId, j); if (j.ghlContactId) { const l = calByContact.get(j.ghlContactId) || []; l.push(j); calByContact.set(j.ghlContactId, l) } }
  // The commission site's sheet import files a SECOND job on the same ArcSite
  // project as "<Project ID>-2" (and -3…); strip that so the exact-ID match holds.
  const sitePid = x => String(x.project_id || '').replace(/-\d+$/, '')
  const dealByPid = new Map(), canceledDealByPid = new Map()
  for (const x of p.siteDeals || []) { if (!x.project_id) continue; (/cancel/i.test(String(x.status || '')) ? canceledDealByPid : dealByPid).set(sitePid(x), x) }
  const auditGapPids = new Set((p.contractAudit && p.contractAudit.gaps || []).map(g => String(g.project_id || '')))

  let checked = 0, skippedCompleted = 0
  for (const [pid, row] of byPid) {
    const approved = ymd(col(row, H.appr)) || ''
    const inScope = approved >= since
    if (!inScope) continue
    // Installs already done are history (per Garrison): compare only jobs still
    // ahead of us, or with no install date yet.
    const prop0 = String(col(row, H.prop) || '').trim(), sched0 = schedByProp.get(prop0) || schedByName.get(norm(col(row, H.cust))) || null
    const schedDate0 = sched0 ? ymd(col(sched0, SH.inst)) : null
    if (schedDate0 && schedDate0 < day) { skippedCompleted++; continue }
    // A booking cancelled on the Schedule tab: the job is off. The only thing
    // worth saying is when GHL still shows it live.
    const cx0 = !sched0 && cancelledByProp.get(prop0)
    if (cx0) {
      const live = (oppsByPid.get(pid) || []).find(o => o.status !== 'lost' && o.status !== 'abandoned' && !/cancel|lost/i.test(String(o.stage || '')))
      if (live) add('canceled_but_open', 'medium', { pid, customer: String(col(row, H.cust) || '').trim(), opp: live.id }, `cancelled on the Schedule tab${String(col(cx0, SH.notes) || '').match(/cancelled by [^\]]+/i) ? ' (' + String(col(cx0, SH.notes)).match(/cancelled by [^\]]+/i)[0] + ')' : ''} but GHL still shows ${live.stage || 'open'}`)
      continue
    }
    checked++
    const customer = String(col(row, H.cust) || '').trim(), rep = String(col(row, H.rep) || '').replace(/\(you\)/i, '').trim()
    const total = money(col(row, H.total)), prop = String(col(row, H.prop) || '').trim()
    const ctx = { pid, customer }
    const list = oppsByPid.get(pid) || []
    if (list.length > 1) add('duplicate_opportunity', 'high', ctx, `${list.length} GHL opportunities carry this Project ID`)
    const o = list[0] || null
    if (!o) { add(approved === day ? 'missing_in_ghl_today' : 'missing_in_ghl', 'high', ctx, `approved ${approved} for ${usd(total)} (${rep}) — no GHL opportunity with this Project ID`); continue }
    ctx.opp = o.id
    const contact = contacts[o.contact_id] || null
    const job = calByOpp.get(o.id) || null; if (job) ctx.job = job.jobNumber
    const deal = dealByPid.get(pid) || null
    const siteExpected = !excluded.some(x => rep.toLowerCase().includes(x))
    const sched = schedByProp.get(prop) || schedByName.get(norm(customer)) || null
    const schedDate = sched ? ymd(col(sched, SH.inst)) : null
    // name
    const gName = String(o.name || '')
    if (!sameName(customer, gName)) add('name', 'low', ctx, `Sheet "${customer}" vs GHL "${gName.replace(/·.*$/, '').trim()}"`)
    if (job && !sameName(customer, job.customer && job.customer.name)) add('name', 'low', ctx, `Sheet "${customer}" vs calendar "${job.customer && job.customer.name}"`)
    if (deal && !sameName(customer, deal.deal_name)) add('name', 'low', ctx, `Sheet "${customer}" vs commission site "${deal.deal_name}"`)
    // phone
    const sPhone = col(row, H.phone), gPhone = contact && contact.phone, cPhone = job && job.customer && job.customer.phone
    const tail = v => phoneKeys(v).map(k => `${k.slice(0, 3)}-${k.slice(3, 6)}-${k.slice(6)}`).join(' / ')
    if (phonesDiffer(sPhone, gPhone)) add('phone', 'medium', ctx, `Sheet phone ${tail(sPhone)} vs GHL contact ${tail(gPhone)}`)
    if (phonesDiffer(gPhone, cPhone)) add('phone', 'medium', ctx, `GHL contact phone ${tail(gPhone)} vs calendar ${tail(cPhone)}`)
    // address
    const sAddr = streetKey(col(row, H.addr)), gAddr = streetKey((o.fields && o.fields.Address) || (contact && contact.address)), cAddr = streetKey(job && job.customer && job.customer.address)
    if (sAddr && gAddr && sAddr !== gAddr) add('address', 'medium', ctx, `Sheet "${col(row, H.addr)}" vs GHL "${(o.fields && o.fields.Address) || (contact && contact.address)}"`)
    if (gAddr && cAddr && gAddr !== cAddr) add('address', 'medium', ctx, `GHL "${(o.fields && o.fields.Address) || (contact && contact.address)}" vs calendar "${job.customer.address}"`)
    // price
    const gVal = money(o.value)
    if (total != null && gVal != null && !same$(total, gVal)) add('price', 'high', ctx, `Sheet ${usd(total)} vs GHL value ${usd(gVal)}`)
    if (job && total != null && money(job.value) != null && !same$(total, money(job.value))) add('price', 'high', ctx, `Sheet ${usd(total)} vs calendar ${usd(money(job.value))}`)
    if (deal && total != null && money(deal.job_price) != null && !same$(total, money(deal.job_price))) add('price', 'high', ctx, `Sheet ${usd(total)} vs commission site ${usd(money(deal.job_price))}`)
    if (job && money(job.value) === 0) add('calendar_zero_value', 'high', ctx, `calendar job ${job.jobNumber} is $0`)
    // install date
    const gDate = ymd(o.install_date), cDate = ymd(job && job.installDate), dDate = ymd(deal && deal.install_date)
    if (schedDate && gDate && schedDate !== gDate) add('install_date', 'high', ctx, `schedule ${schedDate} vs GHL ${gDate}`)
    if (schedDate && cDate && schedDate !== cDate) add('install_date', 'high', ctx, `schedule ${schedDate} vs calendar ${cDate}`)
    if (schedDate && dDate && schedDate !== dDate) add('install_date', 'medium', ctx, `schedule ${schedDate} vs commission site ${dDate}`)
    if (schedDate && !job && schedDate >= day) {
      // Same customer, different opportunity on the calendar = the calendar is
      // still showing an older sale/opportunity for this person.
      const other = (calByContact.get(o.contact_id) || []).find(j => j.ghlOpportunityId && j.ghlOpportunityId !== o.id)
      if (other) add('calendar_other_opp', 'high', { ...ctx, job: other.jobNumber }, `calendar job ${other.jobNumber} (${usd(money(other.value))}, ${ymd(other.installDate) || 'no date'}) is linked to a different GHL opportunity than this sale (${usd(total)}, booked ${schedDate})`)
      else add('missing_calendar_job', 'high', ctx, `booked for ${schedDate} on the schedule but no calendar job is linked to the GHL opportunity`)
    }
    // contract pdf
    const contracts = Number(o.contracts || 0)
    if (contracts === 0 && !/new lead/i.test(String(o.stage || ''))) add('contract', 'high', ctx, 'no ArcSite contract attached to the GHL opportunity')
    if ((rowsPerPid.get(pid) || 1) > contracts && contracts > 0) add('contract', 'medium', ctx, `${rowsPerPid.get(pid)} signed revisions on the Sheet but ${contracts} contract${contracts === 1 ? '' : 's'} attached — newest PDF may be missing`)
    if (auditGapPids.has(pid)) add('contract', 'medium', ctx, 'the contract audit flags this job (attached vs signed)')
    if (job && Array.isArray(job.contracts) && job.contracts.length === 0 && contracts > 0) add('contract', 'medium', ctx, `calendar job ${job.jobNumber} has no contract file`)
    // setter / closer (outside sales only — the site and Schedule carry them)
    const leadSetter = sched ? setterFromLeadSource(col(sched, SH.lead)) : null
    const gSetter = o.fields && o.fields.Setter, gCloser = (o.fields && (o.fields.Closer || o.fields['Sales Reps'])) || null
    const dSetter = deal && deal.setter && deal.setter.name, dCloser = deal && deal.closer && deal.closer.name
    if (rep && gCloser && !sameName(rep, gCloser)) add('closer', 'medium', ctx, `Sheet rep "${rep}" vs GHL "${gCloser}"`)
    if (rep && dCloser && !sameName(rep, dCloser)) add('closer', 'medium', ctx, `Sheet rep "${rep}" vs commission site closer "${dCloser}"`)
    if (leadSetter && gSetter && !sameName(leadSetter, gSetter)) add('setter', 'medium', ctx, `schedule setter "${leadSetter}" vs GHL "${gSetter}"`)
    if (leadSetter && dSetter && !sameName(leadSetter, dSetter)) add('setter', 'medium', ctx, `schedule setter "${leadSetter}" vs commission site "${dSetter}"`)
    // commission site presence
    if (siteExpected && !deal && approved < day) {
      const cx = canceledDealByPid.get(pid)
      if (cx) add('site_canceled', 'medium', ctx, `the commission-site deal is Canceled (sale ${cx.sale_date || '?'}) while the Sheet row is approved and GHL is ${o.stage || 'open'}`)
      else add('missing_on_site', 'medium', ctx, `approved ${approved} (${rep}) — no commission-site deal with this Project ID`)
    }
    // text alert
    if (p.alertStates && approved === day && p.alertStates[pid] && p.alertStates[pid] !== 'sent') add('text_not_sent', 'medium', ctx, `new-sale text state is "${p.alertStates[pid]}"`)
  }
  // calendar jobs linked to a website lead / empty opp, upcoming only
  const oppById = new Map(opps.map(o => [o.id, o]))
  for (const j of cal) {
    const o = j.ghlOpportunityId ? oppById.get(j.ghlOpportunityId) : null
    if (o && isLeadOpp(o) && ymd(j.installDate) >= day) add('calendar_lead_opp', 'high', { job: j.jobNumber, customer: j.customer && j.customer.name, opp: o.id }, `calendar job ${j.jobNumber} is linked to a website-lead opportunity (${usd(money(j.value))})`)
  }
  // today's blocked / failed sale events
  for (const e of p.events || []) {
    if (e.ignored || e.ok) continue
    if (String(e.at || '').slice(0, 10) < day) continue
    add('sale_blocked', 'high', { pid: e.project_id, customer: e.customer }, `sync ${e.action || 'failed'}${e.code ? ' (' + e.code + ')' : ''} at ${String(e.at || '').slice(11, 16)}Z`)
  }
  // daily worker left running
  if (p.worker && p.worker.state === 'running' && String(p.worker.day || '') < day) add('worker_stuck', 'medium', {}, `verified-Sheet daily worker still "running" since ${p.worker.day}`)

  return finish({ day, since, checked, issues, previous: p.previous, skippedCompleted })
}

const issueKey = i => `${i.kind}|${i.project_id || ''}|${i.job || ''}|${String(i.detail || '').replace(/\d{4}-\d{2}-\d{2}/g, 'D').replace(/\$[\d,.-]+/g, '$')}`
function finish({ day, since, checked, issues, previous, skippedCompleted = 0 }) {
  const sev = { high: 0, medium: 1, low: 2 }
  // Carry first_seen from the previous day's report so repeats are not re-announced as news.
  const seen = new Map(); for (const i of (previous && previous.issues) || []) seen.set(issueKey(i), i.first_seen || previous.day)
  for (const i of issues) { const fs = seen.get(issueKey(i)); i.first_seen = fs || day; i.new = !fs }
  issues.sort((a, b) => (b.new ? 1 : 0) - (a.new ? 1 : 0) || sev[a.severity] - sev[b.severity] || String(a.customer || '').localeCompare(String(b.customer || '')))
  const counts = {}; for (const i of issues) counts[i.kind] = (counts[i.kind] || 0) + 1
  const newCount = issues.filter(i => i.new).length
  return { day, at: new Date().toISOString(), read_only: true, scope_since: since, checked, skipped_completed: skippedCompleted, ok: issues.length === 0, issue_count: issues.length, new_count: newCount, carried_count: issues.length - newCount, counts, issues }
}

/** The text Garrison gets. Plain English, grouped by what is wrong, each line naming the job and
    the two values that disagree. New findings in full (capped per group), items still open from
    earlier days counted once. Empty string when there is nothing to say. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const niceDate = s => { const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : s }
const nice = t => String(t || '').replace(/\d{4}-\d{2}-\d{2}/g, niceDate).replace(/\s+—\s+/g, ': ')
const GROUPS = [
  ['missing_in_ghl_today', 'SOLD TODAY BUT NOT IN GHL', 'approved on the Sheet today, no GHL opportunity carries the Project ID'],
  ['sale_blocked', 'SALE SYNC BLOCKED TODAY', 'the ArcSite→GHL sync stopped before creating the opportunity'],
  ['missing_in_ghl', 'OLDER SALES NOT IN GHL', 'approved on the Sheet, no GHL opportunity carries the Project ID'],
  ['price', 'PRICE DOES NOT MATCH', 'the job price differs between systems'],
  ['install_date', 'INSTALL DATE DOES NOT MATCH', 'the Schedule tab date differs from another system'],
  ['missing_calendar_job', 'BOOKED BUT NO CALENDAR JOB', 'on the Schedule tab, nothing on the PM calendar'],
  ['calendar_other_opp', 'CALENDAR SHOWS A DIFFERENT OPPORTUNITY', 'the PM calendar job for this customer points at another GHL opportunity, so its value/contract are not this sale'],
  ['calendar_zero_value', 'CALENDAR JOB AT $0', 'the PM calendar job has no value'],
  ['calendar_lead_opp', 'CALENDAR JOB ON A WEBSITE LEAD', 'the PM calendar job is linked to the website-estimate lead, not the sale'],
  ['contract', 'CONTRACT PDF', 'the ArcSite contract is missing or not the newest revision'],
  ['duplicate_opportunity', 'DUPLICATE GHL OPPORTUNITIES', 'two opportunities carry the same Project ID'],
  ['missing_on_site', 'NOT ON THE COMMISSION SITE', 'approved on the Sheet, no deal with the Project ID'],
  ['canceled_but_open', 'CANCELLED BOOKING STILL LIVE IN GHL', 'the Schedule tab says cancelled but the GHL opportunity is still open'],
  ['site_canceled', 'CANCELED ON THE COMMISSION SITE ONLY', 'the site deal is Canceled while the Sheet and GHL still show the job live'],
  ['text_not_sent', 'SALE TEXT NOT SENT', 'the new-sale text to the team did not go out'],
  ['setter', 'SETTER DOES NOT MATCH', 'the setter differs between systems'],
  ['closer', 'CLOSER / REP DOES NOT MATCH', 'the rep differs between systems'],
  ['phone', 'PHONE DOES NOT MATCH', 'the customer phone differs between systems'],
  ['address', 'ADDRESS DOES NOT MATCH', 'the install address differs between systems'],
  ['name', 'NAME SPELLED DIFFERENTLY', 'the customer name differs between systems'],
  ['worker_stuck', 'DAILY WORKER STUCK', 'the verified-Sheet daily job never finished'],
  ['source_unavailable', 'A SOURCE DID NOT LOAD', 'the check could not read one of the systems, so jobs were not compared'],
]
export function eodSmsText(report, { perGroup = 5, moreAt = '/api/analyst/eod', maxChars = 1500 } = {}) {
  if (!report || !report.issues || !report.issues.length) return ''
  // GHL delivers up to ~1600 characters per SMS. Shrink the per-group detail
  // until the text fits; the group headings and counts always survive.
  for (const n of [perGroup, 3, 2, 1, 0]) { const t = composeEod(report, { perGroup: n, moreAt }); if (t.length <= maxChars || n === 0) return t }
}
function composeEod(report, { perGroup, moreAt }) {
  const fresh = report.issues.filter(i => i.new !== false), carried = report.issue_count - fresh.length
  const head = `Turf Time end-of-day check, ${niceDate(report.day)}. ${report.checked} jobs compared across the AI Sheet, GHL, the PM calendar and the commission site.`
  if (!fresh.length) return `${head} Nothing new today. ${carried} item${carried === 1 ? '' : 's'} from earlier days still open. Full list: ${moreAt}?day=${report.day}`
  const lines = [head, `${fresh.length} new problem${fresh.length === 1 ? '' : 's'}${carried ? `, plus ${carried} still open from earlier days (not repeated here)` : ''}:`]
  const byKind = new Map(); for (const i of fresh) { const l = byKind.get(i.kind) || []; l.push(i); byKind.set(i.kind, l) }
  const seenKinds = new Set()
  const emit = (kind, title, why) => {
    const items = byKind.get(kind); if (!items) return
    seenKinds.add(kind)
    lines.push('', `${title} (${items.length}) — ${why}${perGroup ? ':' : '.'}`)
    if (!perGroup) { const names = [...new Set(items.map(i => String(i.customer || i.job || i.project_id || '').replace(/·.*$/, '').trim()))]; lines.push(`- ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` and ${names.length - 5} more` : ''}`); return }
    for (const i of items.slice(0, perGroup)) {
      const who = i.customer || i.job || i.project_id || ''
      const detail = nice(i.detail)
      lines.push(`- ${who ? who + (i.job && i.customer ? ` (${i.job})` : '') + ': ' : ''}${detail}`)
    }
    if (items.length > perGroup) lines.push(`- and ${items.length - perGroup} more`)
  }
  for (const [kind, title, why] of GROUPS) emit(kind, title, why)
  for (const kind of byKind.keys()) if (!seenKinds.has(kind)) emit(kind, kind.replace(/_/g, ' ').toUpperCase(), 'see the full list')
  lines.push('', `Full list with every job: ${moreAt}?day=${report.day}`)
  return lines.join('\n')
}
