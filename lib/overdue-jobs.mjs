// Jobs still owing money 45+ days after install — read from the office's
// "Turf Time Check List" sheet, enriched with the customer's address, phone and
// PM from the install calendar (AI sheet as fallback), and texted to Tanner as a
// PDF through GHL (Garrison, Nov 23 2026).
//
// Rules, all from that request:
//  • "Overdue" = Still Due > 0 on the Check List and the install date is at least
//    OVERDUE_DAYS (45) days ago, Phoenix time. The Check List is the only place the
//    office records payments, so a job drops off the moment it is marked paid.
//  • Only installs on/after SINCE (2026-07-01). The few older stragglers were
//    dropped on purpose.
//  • Each job is texted ONCE, the first morning it crosses the line. The first
//    list (9 jobs) was sent by hand on Nov 23 and is seeded as already sent.
//
// Pure functions only; server.js does the reading, storing and sending.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export const OVERDUE_DAYS = 45
export const SINCE = '2026-07-01'
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

const iso = d => d.toISOString().slice(0, 10)
const utc = s => new Date(s + 'T00:00:00Z')
export const daysBetween = (fromIso, toIso) => Math.round((utc(toIso) - utc(fromIso)) / 86400000)

/** "October 2026" → '2026-10'. Summary tabs ("October 2026 PRO", "MASTER") and
 *  tabs without a month name return null. */
export function tabMonth(name) {
  const s = String(name || '')
  if (/\bPRO\b|MASTER/i.test(s)) return null
  const m = new RegExp(`\\b(${MONTHS.join('|')})\\b`, 'i').exec(s)
  const y = /\b(20\d{2})\b/.exec(s)
  if (!m || !y) return null
  return `${y[1]}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0')}`
}

function parseDate(raw, defaultYear) {
  const s = String(raw || '').trim()
  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(s)
  if (m) {
    const year = m[3] === undefined ? defaultYear : m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    if (!year) return null
    const d = new Date(Date.UTC(year, Number(m[1]) - 1, Number(m[2])))
    return d.getUTCMonth() === Number(m[1]) - 1 && d.getUTCDate() === Number(m[2]) ? iso(d) : null
  }
  if (/^\d{5}$/.test(s)) return iso(new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000))
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return null
}

export function parseMoney(raw) {
  const s = String(raw ?? '').replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1')
  if (s === '' || s === '-') return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

/** The month a Mon–Sun week belongs to: the month holding its Thursday. */
function weekMonth(dateIso) {
  const d = utc(dateIso), dow = (d.getUTCDay() + 6) % 7
  const thu = new Date(d.getTime() + (3 - dow) * 86400000)
  return iso(thu).slice(0, 7)
}
function mondayMonth(dateIso) {
  const d = utc(dateIso), dow = (d.getUTCDay() + 6) % 7
  return iso(new Date(d.getTime() - dow * 86400000)).slice(0, 7)
}
/** A tab holds whole fiscal weeks of its month, plus a straddling week the
 *  office starts on it. Anything else is a mistyped date (same rule as the
 *  expense tracker's import). */
export const belongsOnTab = (dateIso, month) => weekMonth(dateIso) === month || mondayMonth(dateIso) === month

/** One monthly tab's rows (array of arrays of cell strings) → jobs. The header
 *  row sits under a banner block, so it is found by scanning, as the tracker does. */
export function parseTab(rows, month) {
  const defaultYear = Number(month.slice(0, 4))
  let h = -1, col = null
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const c = (rows[i] || []).map(x => String(x ?? '').trim().toUpperCase())
    const date = c.findIndex(x => x === 'DATE' || x.startsWith('DATE'))
    const client = c.findIndex(x => x.includes('CLIENT') || x.includes('CUSTOMER') || x === 'NAME')
    const amount = c.findIndex(x => x.includes('TOTAL') || x.includes('AMOUNT'))
    if (date < 0 || client < 0 || amount < 0) continue
    const paidExact = c.findIndex(x => x === 'PAID')
    const stillDue = c.findIndex(x => x.includes('STILL DUE')), dueExact = c.findIndex(x => x === 'DUE')
    col = {
      date, client, amount,
      paid: paidExact >= 0 ? paidExact : c.findIndex(x => x.includes('PAID')),
      due: stillDue >= 0 ? stillDue : dueExact >= 0 ? dueExact : c.findIndex(x => x.includes('DUE') || x.includes('BALANCE')),
    }
    h = i
    break
  }
  if (!col) return []
  const out = []
  for (const r of rows.slice(h + 1)) {
    const date = parseDate(r[col.date], defaultYear)
    const client = String(r[col.client] ?? '').trim()
    const amount = parseMoney(r[col.amount])
    if (!date || !client || amount === null) continue
    if (!belongsOnTab(date, month)) continue
    out.push({ date, client, amount, paid: col.paid >= 0 ? parseMoney(r[col.paid]) : null, due: (col.due >= 0 ? parseMoney(r[col.due]) : null) ?? 0 })
  }
  return out
}

export const clientKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
export const jobKey = j => `${j.date}|${clientKey(j.client)}`

/** Overdue jobs as of `today` (YYYY-MM-DD, Phoenix), oldest install first. */
export function overdueJobs(jobs, today, { days = OVERDUE_DAYS, since = SINCE } = {}) {
  const seen = new Set(), out = []
  for (const j of jobs) {
    if (j.date < since || !(j.due > 0)) continue
    const age = daysBetween(j.date, today)
    if (age < days) continue
    const k = jobKey(j)
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ ...j, key: k, days: age })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.client.localeCompare(b.client))
}

const words = s => String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(w => w && w !== 'and')

/** Address, phone and PM for a Check List row. The Check List carries only a
 *  name, sometimes only a first name, so: calendar job whose name holds every
 *  word of it, closest install date within 10 days wins; else the AI sheet's
 *  Jobs tab for address/phone (it has no PM). Nothing found = blanks, never a guess. */
export function contactFor(job, calendarJobs, sheetRows = []) {
  const want = words(job.client)
  if (!want.length) return { name: job.client, address: '', phone: '', pm: '', matched: null }
  const hits = (calendarJobs || []).filter(c => {
    if (!c || c.canceledAt) return false
    const have = new Set(words(c.customer && c.customer.name))
    return want.every(w => have.has(w)) && c.installDate && Math.abs(daysBetween(c.installDate.slice(0, 10), job.date)) <= 10
  }).sort((a, b) => Math.abs(daysBetween(a.installDate.slice(0, 10), job.date)) - Math.abs(daysBetween(b.installDate.slice(0, 10), job.date)))
  // Two different customers fit the name (a first name only, and two people
  // with that first name a week apart): take the closest install date only when it is the
  // exact day, or when the name had more than one word. Otherwise say so
  // rather than text Tanner the wrong customer's phone.
  const dist = c => Math.abs(daysBetween(c.installDate.slice(0, 10), job.date))
  const names = new Set(hits.map(c => clientKey(c.customer.name)))
  if (names.size > 1) {
    const atBest = new Set(hits.filter(c => dist(c) === dist(hits[0])).map(c => clientKey(c.customer.name)))
    if (atBest.size > 1 || (want.length === 1 && dist(hits[0]) > 0)) return { name: job.client, address: '', phone: '', pm: '', matched: 'ambiguous' }
  }
  if (hits.length) {
    const c = hits[0]
    return { name: c.customer.name || job.client, address: c.customer.address || '', phone: c.customer.phone || '', pm: (c.pm && c.pm.name) || '', matched: 'calendar', jobNumber: c.jobNumber || null }
  }
  const row = (sheetRows || []).find(r => { const have = new Set(words(r.Customer)); return want.every(w => have.has(w)) })
  if (row) return { name: row.Customer || job.client, address: row['Install Address'] || '', phone: row['Customer Phone'] || '', pm: '', matched: 'sheet' }
  return { name: job.client, address: '', phone: '', pm: '', matched: null }
}

export function formatPhone(p) {
  const d = String(p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(p || '')
}
const usd = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const usd0 = n => '$' + Math.round(Number(n || 0)).toLocaleString('en-US')
const nice = d => utc(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

/** The text that goes with the PDF. */
export function smsText(rows, today) {
  const total = rows.reduce((s, r) => s + r.due, 0)
  const head = rows.length === 1 ? `1 job just passed ${OVERDUE_DAYS} days since install with a balance due (${usd(total)}):` : `${rows.length} jobs just passed ${OVERDUE_DAYS} days since install with a balance due (${usd(total)} total):`
  const lines = rows.map(r => `• ${r.contact.name} — installed ${nice(r.date)} — PM ${r.contact.pm || 'n/a'} — owes ${usd(r.due)}`)
  return [head, ...lines, `Full details in the PDF. (Turf Time Check List, ${nice(today)})`].join('\n')
}

// PDF: landscape letter, one table. Helvetica covers plain ASCII only, so text
// is reduced to it (a curly quote or accent would otherwise throw).
const ascii = s => String(s ?? '').normalize('NFKD').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7e]/g, '')

export async function buildPdf(rows, today, { title = `Unpaid jobs: ${OVERDUE_DAYS}+ days since install` } = {}) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const W = 792, H = 612, M = 36, green = rgb(0.12, 0.32, 0.19), grey = rgb(0.35, 0.35, 0.35)
  const cols = [
    { h: 'Customer', w: 120, v: r => r.contact.name },
    { h: 'Address', w: 176, v: r => r.contact.address || '-' },
    { h: 'Phone', w: 78, v: r => formatPhone(r.contact.phone) || '-' },
    { h: 'PM', w: 92, v: r => r.contact.pm || '-' },
    { h: 'Installed', w: 64, v: r => nice(r.date) },
    { h: 'Days', w: 30, v: r => String(r.days), right: true },
    { h: 'Job total', w: 50, v: r => usd0(r.amount), right: true },
    { h: 'Paid', w: 44, v: r => usd0(r.paid), right: true },
    { h: 'Still owed', w: 66, v: r => usd(r.due), right: true, bold: true },
  ]
  const fit = (t, f, size, w) => { let s = ascii(t); while (s && f.widthOfTextAtSize(s, size) > w - 6) s = s.slice(0, -1); return s }
  const total = rows.reduce((s, r) => s + r.due, 0)
  let page = doc.addPage([W, H]), y = H - M
  const header = () => {
    let x = M
    page.drawRectangle({ x: M, y: y - 16, width: W - 2 * M, height: 18, color: green })
    for (const c of cols) { const t = fit(c.h, bold, 8, c.w); page.drawText(t, { x: c.right ? x + c.w - 3 - bold.widthOfTextAtSize(t, 8) : x + 3, y: y - 11, size: 8, font: bold, color: rgb(1, 1, 1) }); x += c.w }
    y -= 18
  }
  page.drawText(ascii(title), { x: M, y: y - 14, size: 15, font: bold })
  y -= 30
  page.drawText(ascii(`As of ${nice(today)}  -  ${rows.length} job${rows.length === 1 ? '' : 's'}  -  ${usd(total)} still owed  -  oldest install first  -  source: Turf Time Check List`), { x: M, y, size: 8.5, font, color: grey })
  y -= 14
  header()
  rows.forEach((r, i) => {
    if (y < M + 40) { page = doc.addPage([W, H]); y = H - M; header() }
    if (i % 2) page.drawRectangle({ x: M, y: y - 16, width: W - 2 * M, height: 18, color: rgb(0.96, 0.97, 0.96) })
    let x = M
    for (const c of cols) { const f = c.bold ? bold : font, t = fit(c.v(r), f, 8, c.w); page.drawText(t, { x: c.right ? x + c.w - 3 - f.widthOfTextAtSize(t, 8) : x + 3, y: y - 11, size: 8, font: f }); x += c.w }
    y -= 18
  })
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.5 })
  y -= 13
  page.drawText('Total', { x: M + 3, y, size: 8.5, font: bold })
  const tt = usd(total)
  page.drawText(tt, { x: W - M - 3 - bold.widthOfTextAtSize(tt, 8.5), y, size: 8.5, font: bold })
  y -= 18
  page.drawText('"Paid" is what the office has entered on the Check List. PM, address and phone come from the install calendar (AI sheet when the calendar has no match).', { x: M, y, size: 7.5, font, color: grey })
  return Buffer.from(await doc.save())
}
