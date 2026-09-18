// ============================================================
// Field activity (door knocking) from the CRM feed — migration 048.
//
// One `field_activity` row per rep per ARIZONA day: doors_knocked,
// first_knock_at / last_knock_at (timestamptz), field_minutes (when the CRM
// reports time in field; else derived last − first). This module turns those
// day rows into the per-rep figures the Performance page shows — the ONE
// place that math lives.
//
// `activity_date` is a plain DATE column, so it is safe to compare as a
// string. The knock timestamps are timestamptz → clock times are read with
// LOCAL getters (the viewer's zone = Arizona for this company), never sliced.
// ============================================================

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

// Minutes after local midnight for a timestamp, or null.
export function minutesOfDay(ts) {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return d.getHours() * 60 + d.getMinutes()
}

// "1:21 pm" for minutes-after-midnight; "—" for null.
export function fmtClock(mins) {
  if (mins == null || !Number.isFinite(mins)) return '—'
  const m = Math.round(mins) % (24 * 60)
  const h24 = Math.floor(m / 60), mm = m % 60
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(mm).padStart(2, '0')} ${h24 < 12 ? 'am' : 'pm'}`
}

// "4.7h" for minutes; "—" for null/0.
export function fmtHours(mins) {
  if (mins == null || !Number.isFinite(mins)) return '—'
  return `${(mins / 60).toFixed(1)}h`
}

// Time in the field for ONE day row: the CRM's own figure when present,
// otherwise last knock − first knock (a single knock = 0 minutes).
export function dayFieldMinutes(row) {
  if (row.field_minutes != null && row.field_minutes !== '') return Math.max(0, num(row.field_minutes))
  const a = row.first_knock_at ? new Date(row.first_knock_at).getTime() : NaN
  const b = row.last_knock_at  ? new Date(row.last_knock_at).getTime()  : NaN
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null
  return Math.round((b - a) / 60000)
}

export const emptyActivity = () => ({
  doors: 0, knockDays: 0, fieldMinutes: 0, doorsPerDay: null,
  firstKnock: null, lastKnock: null, rows: 0,
})

// Aggregate day rows (already filtered to the rows you care about) into one
// figure set. first/last knock are AVERAGE clock times across knock days —
// "when does this rep typically start and stop" — which is what the field
// report's First Door Knock / Last Door Knock columns mean.
export function summarizeActivity(rows = []) {
  const out = emptyActivity()
  let firstSum = 0, firstN = 0, lastSum = 0, lastN = 0, minSum = 0, minN = 0
  for (const r of rows) {
    out.rows += 1
    const doors = num(r.doors_knocked)
    out.doors += doors
    if (doors > 0) out.knockDays += 1
    const fm = minutesOfDay(r.first_knock_at)
    if (fm != null) { firstSum += fm; firstN += 1 }
    const lm = minutesOfDay(r.last_knock_at)
    if (lm != null) { lastSum += lm; lastN += 1 }
    const mins = dayFieldMinutes(r)
    if (mins != null) { minSum += mins; minN += 1 }
  }
  out.fieldMinutes = minN ? minSum : (out.rows ? 0 : null)
  out.doorsPerDay  = out.knockDays ? out.doors / out.knockDays : (out.rows ? 0 : null)
  out.firstKnock   = firstN ? firstSum / firstN : null
  out.lastKnock    = lastN  ? lastSum  / lastN  : null
  return out
}

// Day rows inside [from, to] (ISO dates, inclusive; blank = open-ended).
export function activityInRange(rows = [], from, to) {
  return rows.filter(r => {
    const d = r.activity_date
    if (!d) return false
    if (from && d < from) return false
    if (to && d > to) return false
    return true
  })
}

// ── CSV import (admin fallback until the webhook is wired) ────────────────
// Accepts the common report shapes: one row per rep per day with a doors
// count. Header matching is lenient (case/spacing/punctuation-insensitive);
// unknown columns are ignored. Returns { rows, errors } where rows are ready
// for upsertFieldActivity() — people resolved by email, then name.
const HEADER_ALIASES = {
  rep_name:       ['rep', 'rep name', 'user', 'name', 'salesperson', 'agent', 'knocker'],
  rep_email:      ['email', 'rep email', 'user email'],
  activity_date:  ['date', 'day', 'activity date', 'knock date'],
  doors_knocked:  ['doors', 'doors knocked', 'knocks', 'door knocks', 'doors_knocked'],
  first_knock_at: ['first knock', 'first door knock', 'first', 'start', 'first_knock'],
  last_knock_at:  ['last knock', 'last door knock', 'last', 'end', 'last_knock'],
  field_minutes:  ['minutes', 'field minutes', 'time in field', 'time spent in field', 'hours', 'field hours'],
  office:         ['office', 'location', 'market'],
}
const normHeader = (h) => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function splitCsvLine(line) {
  const out = []; let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++ } else q = !q }
    else if (c === ',' && !q) { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out.map(s => s.trim())
}

// "1:21 PM" / "13:21" / "2026-09-10T20:21:00Z" on a given day → ISO timestamp
// in the viewer's LOCAL zone (Arizona), or null.
function toTimestamp(dayISO, v) {
  if (!v) return null
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) { const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d.toISOString() }
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?$/i)
  if (!m) return null
  let h = Number(m[1]); const mm = Number(m[2] || 0)
  if (m[4]) { const pm = m[4].toLowerCase() === 'pm'; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12 }
  const d = new Date(`${dayISO}T12:00:00`)
  d.setHours(h, mm, Number(m[3] || 0), 0)
  return d.toISOString()
}

// "9/10/2026", "2026-09-10", "Sep 10, 2026" → 'yyyy-MM-dd' (local), or null.
function toDayISO(v) {
  if (!v) return null
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (us) {
    const y = us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3])
    return `${y}-${String(us[1]).padStart(2, '0')}-${String(us[2]).padStart(2, '0')}`
  }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function csvToFieldActivity(text, profiles = [], { source = 'repcard' } = {}) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return { rows: [], errors: ['The file needs a header row and at least one data row.'] }
  const headers = splitCsvLine(lines[0]).map(normHeader)
  const col = {}
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = headers.findIndex(h => aliases.includes(h))
    if (idx >= 0) col[field] = idx
  }
  const errors = []
  if (col.activity_date == null) errors.push('No date column found (expected a header like "Date").')
  if (col.doors_knocked == null) errors.push('No doors column found (expected a header like "Doors Knocked").')
  if (col.rep_name == null && col.rep_email == null) errors.push('No rep column found (expected "Rep", "User" or "Email").')
  if (errors.length) return { rows: [], errors }

  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
  const byEmail = {}, byName = {}, dupes = new Set()
  for (const p of profiles) {
    if (p.email) byEmail[norm(p.email)] = p.id
    const n = norm(p.name)
    if (!n) continue
    if (byName[n] && byName[n] !== p.id) dupes.add(n)
    byName[n] = p.id
  }
  for (const n of dupes) delete byName[n]

  const rows = []
  const unmatched = new Set()
  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i])
    const get = (f) => (col[f] == null ? '' : c[col[f]] ?? '')
    const day = toDayISO(get('activity_date'))
    if (!day) { errors.push(`Row ${i + 1}: unreadable date "${get('activity_date')}".`); continue }
    const email = norm(get('rep_email')), name = String(get('rep_name') || '').trim()
    const profileId = (email && byEmail[email]) || byName[norm(name)] || null
    if (!profileId) unmatched.add(name || email)
    const mins = get('field_minutes')
    const isHours = col.field_minutes != null && /hour/.test(headers[col.field_minutes])
    const row = {
      source,
      profile_id: profileId,
      rep_name: name || email || null,
      rep_email: email || null,
      activity_date: day,
      doors_knocked: Math.max(0, Math.round(num(get('doors_knocked')))),
      first_knock_at: toTimestamp(day, get('first_knock_at')),
      last_knock_at: toTimestamp(day, get('last_knock_at')),
      field_minutes: mins === '' ? null : Math.round(isHours ? num(mins) * 60 : num(mins)),
      office: get('office') || null,
    }
    rows.push(row)
  }
  return { rows, errors, unmatched: [...unmatched].filter(Boolean) }
}
