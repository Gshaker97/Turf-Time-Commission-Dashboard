import { useEffect, useMemo, useState } from 'react'
import { Upload, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchUsers, fetchDeals, insertDeal } from '../lib/db'
import { fmt } from '../utils/commission'
import { SURFACE, Card, Eyebrow, FieldLabel, Select, TextArea, PrimaryButton } from '../components/ui'

// Row status tones: new = sage, duplicate = amber, missing name = rose.
const DOT = { new: 'var(--pos)', dup: 'var(--warn)', invalid: 'var(--neg)' }

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
  const PREVIEW_COLS = ['', 'Deal', 'Baseline', 'Job', 'Sale date', 'Setter', 'Closer', 'Ext ID']
  const cell = (row, key, money = false) => {
    const v = get(row, key)
    if (money) return v ? fmt(parseMoney(v)) : '—'
    if (key === 'sale_date') return parseDate(v) || '—'
    return String(v || '—')
  }

  return (
    <div className="space-y-3 pb-8 max-w-[1400px] mx-auto" style={{ color: 'var(--tx)' }}>
      <div className="mb-1">
        <h1 className="text-lg md:text-xl font-bold text-bank-tx flex items-center gap-2"><Upload size={18} className="text-bank-mu" /> Import Deals</h1>
        <p className="text-[13px] text-bank-mu mt-0.5">Bring deals in from any spreadsheet or CRM — export a CSV, drop it here, map the columns, import.</p>
      </div>

      {/* Step 1: input */}
      <Card>
        <div className="flex items-center justify-between gap-3 mb-2">
          <Eyebrow>1 · Paste or upload</Eyebrow>
          <label className="text-[13px] font-semibold text-bank-gold-tx cursor-pointer hover:underline min-h-[44px] md:min-h-0 inline-flex items-center">
            Upload CSV<input type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={onFile} />
          </label>
        </div>
        <TextArea value={text} onChange={e => { setText(e.target.value); parse(e.target.value) }}
          rows={5} placeholder="Paste rows from a spreadsheet (with a header row) or CSV…" aria-label="CSV rows"
          style={SURFACE.well} className="font-mono" />
      </Card>

      {hasTable && (
        <>
          {/* Step 2: mapping */}
          <Card>
            <Eyebrow className="mb-3">2 · Map columns</Eyebrow>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {FIELDS.map(f => (
                <div key={f.key}>
                  <FieldLabel htmlFor={`map-${f.key}`}>{f.label}{f.required && <span className="text-bank-gold-tx"> *</span>}</FieldLabel>
                  <Select id={`map-${f.key}`} value={mapping[f.key] ?? -1} onChange={e => setMapping(m => ({ ...m, [f.key]: Number(e.target.value) }))}>
                    {opt(-1)}{table.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </Select>
                </div>
              ))}
            </div>
          </Card>

          {/* Step 3: preview */}
          <Card padded={false}>
            <div className="px-4 py-2.5 border-b border-bank-line flex flex-wrap items-center gap-3 text-[13px]">
              <Eyebrow>3 · Preview</Eyebrow>
              <span className="font-semibold" style={{ color: DOT.new }}>{stats.new} new</span>
              <span style={{ color: DOT.dup }}>{stats.dup} duplicate</span>
              {stats.invalid > 0 && <span style={{ color: DOT.invalid }}>{stats.invalid} missing name</span>}
              <span className="text-bank-mu ml-auto">{table.rows.length} rows</span>
            </div>
            {stats.unmatched.size > 0 && (
              <div className="px-4 py-2 text-[13px] flex items-start gap-1.5 border-b border-bank-line" style={{ color: 'var(--warn)' }}>
                <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                <span>Unmatched rep names (will import with no rep): {[...stats.unmatched].slice(0, 8).join(', ')}{stats.unmatched.size > 8 ? '…' : ''}</span>
              </div>
            )}
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr className="text-bank-fa text-[13px] uppercase tracking-wide">
                  {PREVIEW_COLS.map(h => <th key={h} className="px-3 py-1.5 text-left font-semibold">{h}</th>)}
                </tr></thead>
                <tbody>
                  {table.rows.slice(0, 8).map((row, i) => {
                    const st = rowStatus(row)
                    return (
                      <tr key={i} className="border-t border-bank-line">
                        <td className="px-3 py-1.5"><span className="inline-block w-2 h-2 rounded-full" style={{ background: DOT[st] }} title={st} /><span className="sr-only">{st}</span></td>
                        <td className="px-3 py-1.5 text-bank-tx whitespace-nowrap">{cell(row, 'deal_name')}</td>
                        <td className="px-3 py-1.5 text-bank-mu tabular-nums">{cell(row, 'baseline_revenue', true)}</td>
                        <td className="px-3 py-1.5 text-bank-mu tabular-nums">{cell(row, 'job_price', true)}</td>
                        <td className="px-3 py-1.5 text-bank-mu whitespace-nowrap">{cell(row, 'sale_date')}</td>
                        <td className="px-3 py-1.5 text-bank-mu whitespace-nowrap">{cell(row, 'setter')}</td>
                        <td className="px-3 py-1.5 text-bank-mu whitespace-nowrap">{cell(row, 'closer')}</td>
                        <td className="px-3 py-1.5 text-bank-fa whitespace-nowrap">{cell(row, 'external_id')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {/* Phones: one stacked row per deal */}
            <div className="md:hidden">
              {table.rows.slice(0, 8).map((row, i) => {
                const st = rowStatus(row)
                return (
                  <div key={i} className="px-4 py-3 border-t border-bank-line text-[13px]">
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: DOT[st] }} />
                      <span className="font-semibold text-bank-tx truncate">{cell(row, 'deal_name')}</span>
                      <span className="ml-auto text-bank-fa capitalize">{st === 'dup' ? 'duplicate' : st === 'invalid' ? 'missing name' : st}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-bank-mu">
                      <span>Baseline <b className="text-bank-tx font-semibold tabular-nums">{cell(row, 'baseline_revenue', true)}</b></span>
                      <span>Job <b className="text-bank-tx font-semibold tabular-nums">{cell(row, 'job_price', true)}</b></span>
                      <span>Sale date <b className="text-bank-tx font-semibold">{cell(row, 'sale_date')}</b></span>
                      <span>Ext ID <b className="text-bank-tx font-semibold">{cell(row, 'external_id')}</b></span>
                      <span>Setter <b className="text-bank-tx font-semibold">{cell(row, 'setter')}</b></span>
                      <span>Closer <b className="text-bank-tx font-semibold">{cell(row, 'closer')}</b></span>
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>

          {/* Step 4: import */}
          <div className="flex items-center gap-3 flex-wrap">
            <PrimaryButton onClick={runImport} disabled={importing || mapping.deal_name == null || mapping.deal_name < 0 || stats.new === 0} className="text-[14px]">
              {importing ? 'Importing…' : `Import ${stats.new} deal${stats.new === 1 ? '' : 's'}`}
            </PrimaryButton>
            {(mapping.deal_name == null || mapping.deal_name < 0) && <span className="text-[13px] text-bank-mu">Map a “Deal name” column to continue.</span>}
            {mapping.external_id == null || mapping.external_id < 0 ? <span className="text-[13px]" style={{ color: 'var(--warn)' }}>No ID column mapped — deduping by deal name.</span> : null}
          </div>

          {result && (
            <Card className="mt-1" role="status">
              <p className="text-[13px] font-semibold text-bank-tx flex items-center gap-2"><CheckCircle2 size={15} style={{ color: 'var(--pos)' }} /> Import complete</p>
              <p className="text-[13px] text-bank-mu mt-1">Created {result.created} · Skipped {result.skipped} · Errors {result.errors}</p>
              {result.errs.length > 0 && (
                <div className="mt-2 text-[13px] space-y-0.5 max-h-40 overflow-y-auto" style={{ color: 'var(--neg)' }}>
                  {result.errs.slice(0, 20).map((e, i) => <p key={i}>{e}</p>)}
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  )
}
