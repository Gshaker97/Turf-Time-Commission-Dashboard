import { useEffect, useMemo, useState } from 'react'
import { Upload, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchUsers, fetchDeals, insertDeal } from '../lib/db'
import { fmt } from '../utils/commission'

// Target deal fields + header keywords used to auto-guess the mapping.
const FIELDS = [
  { key: 'deal_name',        label: 'Deal name',          required: true, guess: ['deal', 'customer', 'client', 'lead', 'name', 'proposal'] },
  { key: 'external_id',      label: 'External ID (dedupe)', guess: ['project id', 'proposal id', 'doc', 'id'] },
  { key: 'baseline_revenue', label: 'Baseline revenue',   guess: ['baseline', 'base'] },
  { key: 'job_price',        label: 'Job price',          guess: ['pre-tax', 'job price', 'contract', 'total', 'subtotal', 'price', 'sale'] },
  { key: 'sale_date',        label: 'Sale date',          guess: ['approved date', 'sale date', 'closing', 'sold', 'date'] },
  { key: 'setter',           label: 'Setter (rep)',       guess: ['setter', 'sales rep', 'rep'] },
  { key: 'closer',           label: 'Closer',             guess: ['closer'] },
  { key: 'office',           label: 'Office',             guess: ['office', 'location', 'branch'] },
  { key: 'payment_method',   label: 'Payment method',     guess: ['payment', 'financ'] },
]

function parseDelimited(text) {
  const t = text.replace(/\r/g, '').trim()
  if (!t) return []
  const delim = (t.split('\n')[0].includes('\t')) ? '\t' : ','
  const rows = []; let row = [], field = '', inQ = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (inQ) {
      if (c === '"') { if (t[i + 1] === '"') { field += '"'; i++ } else inQ = false }
      else field += c
    } else if (c === '"') inQ = true
    else if (c === delim) { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else field += c
  }
  row.push(field); rows.push(row)
  return rows
}
const parseMoney = (v) => {
  if (v == null || v === '') return null
  const raw = String(v).trim(); const neg = /^\(.*\)$/.test(raw)
  const n = parseFloat(raw.replace(/[$,\s()]/g, ''))
  return isNaN(n) ? null : (neg ? -n : n)
}
const parseDate = (v) => {
  const s = String(v || '').trim(); if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) { let [, mo, d, y] = m; if (y.length === 2) y = '20' + y; return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` }
  return s
}
const cleanName = (s) => String(s || '').replace(/\s*\(.*$/, '').trim().toLowerCase()

export default function ImportDeals() {
  const { profile } = useAuth()
  const [text, setText] = useState('')
  const [table, setTable] = useState({ headers: [], rows: [] })
  const [mapping, setMapping] = useState({})
  const [users, setUsers] = useState([])
  const [existing, setExisting] = useState({ ids: new Set(), names: new Set() })
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    fetchUsers().then(({ data }) => setUsers(data || []))
    fetchDeals().then(({ data }) => setExisting({
      ids: new Set((data || []).map(d => String(d.project_id || '')).filter(Boolean)),
      names: new Set((data || []).map(d => String(d.deal_name || '').trim().toLowerCase()).filter(Boolean)),
    }))
  }, [])

  const usersByName = useMemo(() => {
    const m = {}; users.forEach(u => { if (u.name) m[u.name.trim().toLowerCase()] = u }); return m
  }, [users])

  function parse(input) {
    const rows = parseDelimited(input)
    if (rows.length < 2) { setTable({ headers: [], rows: [] }); setMapping({}); return }
    const headers = rows[0].map(h => String(h).trim())
    const body = rows.slice(1).filter(r => r.some(c => String(c).trim() !== ''))
    // auto-guess mapping
    const map = {}
    FIELDS.forEach(f => {
      const i = headers.findIndex(h => f.guess.some(g => h.toLowerCase().includes(g)))
      map[f.key] = i
    })
    setTable({ headers, rows: body }); setMapping(map); setResult(null)
  }

  function onFile(e) {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = () => { setText(String(reader.result)); parse(String(reader.result)) }
    reader.readAsText(file)
  }

  const get = (row, key) => mapping[key] >= 0 ? row[mapping[key]] : ''
  function rowStatus(row) {
    const name = String(get(row, 'deal_name') || '').trim()
    if (!name) return 'invalid'
    const ext = String(get(row, 'external_id') || '').trim()
    if (ext && existing.ids.has(ext)) return 'dup'
    if (!ext && existing.names.has(name.toLowerCase())) return 'dup'
    return 'new'
  }
  const stats = useMemo(() => {
    const s = { new: 0, dup: 0, invalid: 0, unmatched: new Set() }
    for (const row of table.rows) {
      const st = rowStatus(row); s[st === 'new' ? 'new' : st]++
      ;['setter', 'closer'].forEach(k => {
        const v = get(row, k); if (v && !usersByName[cleanName(v)]) s.unmatched.add(String(v).trim())
      })
    }
    return s
  }, [table, mapping, existing, usersByName])

  async function runImport() {
    setImporting(true)
    let created = 0, skipped = 0, errors = 0; const errs = []
    const batch = new Set()
    for (const row of table.rows) {
      const name = String(get(row, 'deal_name') || '').trim()
      if (!name) { skipped++; continue }
      const ext = String(get(row, 'external_id') || '').trim()
      if (ext && (existing.ids.has(ext) || batch.has(ext))) { skipped++; continue }
      if (!ext && existing.names.has(name.toLowerCase())) { skipped++; continue }

      const setterId = usersByName[cleanName(get(row, 'setter'))]?.id || null
      const closerVal = get(row, 'closer')
      const closerId = (closerVal ? usersByName[cleanName(closerVal)]?.id : setterId) || setterId || null
      const payload = {
        deal_name: name,
        baseline_revenue: parseMoney(get(row, 'baseline_revenue')),
        job_price: parseMoney(get(row, 'job_price')),
        sale_date: parseDate(get(row, 'sale_date')) || null,
        setter_id: setterId, closer_id: closerId,
        setter_split_pct: setterId && closerId ? (setterId === closerId ? 1 : 0.5) : null,
        status: 'Deal Review',
        office: String(get(row, 'office') || '').trim() || null,
        payment_method: String(get(row, 'payment_method') || '').trim() || null,
        project_id: ext || null,
      }
      const res = await insertDeal(payload, profile?.id)
      if (res?.error) { errors++; errs.push(`${name}: ${res.error.message}`) }
      else { created++; if (ext) batch.add(ext) }
    }
    setResult({ created, skipped, errors, errs })
    setImporting(false)
    // refresh existing so a second run dedupes against what we just added
    fetchDeals().then(({ data }) => setExisting({
      ids: new Set((data || []).map(d => String(d.project_id || '')).filter(Boolean)),
      names: new Set((data || []).map(d => String(d.deal_name || '').trim().toLowerCase()).filter(Boolean)),
    }))
  }

  const hasTable = table.headers.length > 0
  const opt = (i) => <option value={i}>{i === -1 ? '—' : table.headers[i]}</option>

  return (
    <div style={{ background: '#1a1a1a', color: '#fff', minHeight: '100%' }}>
      <div className="mb-4">
        <h1 className="text-lg md:text-xl font-bold text-white flex items-center gap-2"><Upload size={18} className="text-teal" /> Import Deals</h1>
        <p className="text-[12px] text-white/40 mt-0.5">Bring deals in from any spreadsheet or CRM — export a CSV, drop it here, map the columns, import.</p>
      </div>

      {/* Step 1: input */}
      <div className="rounded-xl p-4 mb-3" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] uppercase tracking-wider text-white/30 font-semibold">1 · Paste or upload</p>
          <label className="text-[12px] font-semibold text-teal cursor-pointer hover:underline">
            Upload CSV<input type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={onFile} />
          </label>
        </div>
        <textarea value={text} onChange={e => { setText(e.target.value); parse(e.target.value) }}
          rows={5} placeholder="Paste rows from a spreadsheet (with a header row) or CSV…"
          className="w-full px-3 py-2 rounded-lg text-[12px] text-white placeholder-white/20 focus:outline-none resize-y font-mono"
          style={{ background: '#141414', border: '1px solid #2a2a2a' }} />
      </div>

      {hasTable && (
        <>
          {/* Step 2: mapping */}
          <div className="rounded-xl p-4 mb-3" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
            <p className="text-[11px] uppercase tracking-wider text-white/30 font-semibold mb-3">2 · Map columns</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {FIELDS.map(f => (
                <div key={f.key}>
                  <label className="block text-[11px] text-white/50 mb-1">{f.label}{f.required && <span className="text-teal"> *</span>}</label>
                  <select value={mapping[f.key] ?? -1} onChange={e => setMapping(m => ({ ...m, [f.key]: Number(e.target.value) }))}
                    className="w-full px-2 py-1.5 rounded-lg text-[12px] text-white focus:outline-none"
                    style={{ background: '#141414', border: '1px solid #2a2a2a' }}>
                    {opt(-1)}{table.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Step 3: preview */}
          <div className="rounded-xl overflow-hidden mb-3" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
            <div className="px-4 py-2.5 border-b border-white/5 flex flex-wrap items-center gap-3 text-[12px]">
              <span className="text-[11px] uppercase tracking-wider text-white/30 font-semibold">3 · Preview</span>
              <span className="text-teal font-semibold">{stats.new} new</span>
              <span className="text-amber-400">{stats.dup} duplicate</span>
              {stats.invalid > 0 && <span className="text-red-400">{stats.invalid} missing name</span>}
              <span className="text-white/40 ml-auto">{table.rows.length} rows</span>
            </div>
            {stats.unmatched.size > 0 && (
              <div className="px-4 py-2 text-[11px] text-amber-400/90 flex items-start gap-1.5 border-b border-white/5">
                <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                <span>Unmatched rep names (will import with no rep): {[...stats.unmatched].slice(0, 8).join(', ')}{stats.unmatched.size > 8 ? '…' : ''}</span>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead><tr className="text-white/30 text-[10px] uppercase">
                  {['', 'Deal', 'Baseline', 'Job', 'Sale date', 'Setter', 'Closer', 'Ext ID'].map(h => <th key={h} className="px-3 py-1.5 text-left font-semibold">{h}</th>)}
                </tr></thead>
                <tbody>
                  {table.rows.slice(0, 8).map((row, i) => {
                    const st = rowStatus(row)
                    const dot = st === 'new' ? '#00b894' : st === 'dup' ? '#fdcb6e' : '#f87171'
                    return (
                      <tr key={i} className="border-t border-white/5">
                        <td className="px-3 py-1.5"><span className="inline-block w-2 h-2 rounded-full" style={{ background: dot }} title={st} /></td>
                        <td className="px-3 py-1.5 text-white/80 whitespace-nowrap">{String(get(row, 'deal_name') || '—')}</td>
                        <td className="px-3 py-1.5 text-white/60">{get(row, 'baseline_revenue') ? fmt(parseMoney(get(row, 'baseline_revenue'))) : '—'}</td>
                        <td className="px-3 py-1.5 text-white/60">{get(row, 'job_price') ? fmt(parseMoney(get(row, 'job_price'))) : '—'}</td>
                        <td className="px-3 py-1.5 text-white/60 whitespace-nowrap">{parseDate(get(row, 'sale_date')) || '—'}</td>
                        <td className="px-3 py-1.5 text-white/60 whitespace-nowrap">{String(get(row, 'setter') || '—')}</td>
                        <td className="px-3 py-1.5 text-white/60 whitespace-nowrap">{String(get(row, 'closer') || '—')}</td>
                        <td className="px-3 py-1.5 text-white/40 whitespace-nowrap">{String(get(row, 'external_id') || '—')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Step 4: import */}
          <div className="flex items-center gap-3">
            <button onClick={runImport} disabled={importing || mapping.deal_name == null || mapping.deal_name < 0 || stats.new === 0}
              className="px-4 py-2.5 rounded-xl text-[14px] font-bold text-dark bg-teal hover:bg-teal-dark disabled:opacity-50 transition-colors">
              {importing ? 'Importing…' : `Import ${stats.new} deal${stats.new === 1 ? '' : 's'}`}
            </button>
            {(mapping.deal_name == null || mapping.deal_name < 0) && <span className="text-[12px] text-white/40">Map a “Deal name” column to continue.</span>}
            {mapping.external_id == null || mapping.external_id < 0 ? <span className="text-[12px] text-amber-400/80">No ID column mapped — deduping by deal name.</span> : null}
          </div>

          {result && (
            <div className="mt-4 rounded-xl p-4" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
              <p className="text-[13px] font-semibold text-white flex items-center gap-2"><CheckCircle2 size={15} className="text-teal" /> Import complete</p>
              <p className="text-[12px] text-white/60 mt-1">Created {result.created} · Skipped {result.skipped} · Errors {result.errors}</p>
              {result.errs.length > 0 && (
                <div className="mt-2 text-[11px] text-red-400/90 space-y-0.5 max-h-40 overflow-y-auto">
                  {result.errs.slice(0, 20).map((e, i) => <p key={i}>{e}</p>)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
