// ── Copy a table so it PASTES AS A TABLE ────────────────────────────────
//
// Writing only `text/plain` gets you tab-separated text, which lands in Canva
// or a slide as one ugly run-on line. Writing `text/html` too lets the target
// app paste a real table with borders and a header row, and the plain-text
// copy rides along for anything that can't take HTML (and for Sheets, which
// prefers it). `ClipboardItem` is what carries both flavours at once.
//
// Used by the Dashboard's rep leaderboard and the Competitions Record Book —
// both exist to be pasted into a meeting deck, so this is the point of those
// buttons rather than a convenience.
//
// A row may be `{ section: 'Company records' }` instead of an array: it
// renders as a full-width band, which is how one table can carry several
// groups without needing a column to name them.

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// `rightFrom` — the column index where numbers start and alignment flips.
export function buildTableHtml(cols, rows, { rightFrom = 2 } = {}) {
  const align = (i) => (i >= rightFrom ? 'right' : 'left')
  const cell = 'padding:6px 12px;border:1px solid #d1d5db'
  let body = '', stripe = 0
  for (const r of rows) {
    if (r && r.section) {
      body += `<tr style="background:#0b3b31;color:#ffffff">`
        + `<td colspan="${cols.length}" style="${cell};font-weight:700;letter-spacing:.04em">${esc(r.section)}</td></tr>`
      stripe = 0
      continue
    }
    body += `<tr style="background:${stripe++ % 2 ? '#f3f4f6' : '#ffffff'};color:#111">`
      + r.map((c, i) => `<td style="${cell};text-align:${align(i)}">${esc(c)}</td>`).join('')
      + `</tr>`
  }
  return `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">`
    + `<thead><tr style="background:#00b894;color:#0b0b0b">`
    + cols.map((c, i) => `<th style="${cell};text-align:${align(i)}">${esc(c)}</th>`).join('')
    + `</tr></thead><tbody>${body}</tbody></table>`
}

export function buildTableText(cols, rows) {
  const lines = [cols.join('\t')]
  for (const r of rows) lines.push(r && r.section ? r.section : r.join('\t'))
  return lines.join('\n')
}

// Resolves true when something reached the clipboard. Never throws: a browser
// that refuses `write` still gets the plain-text path, and one that refuses
// both returns false so the caller can leave the button alone.
export async function copyTable(cols, rows, opts = {}) {
  const html = buildTableHtml(cols, rows, opts)
  const text = buildTableText(cols, rows)
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new window.ClipboardItem({
        'text/html':  new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })])
      return true
    }
  } catch { /* fall through to plain text */ }
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}
