import { useState, useEffect } from 'react'
import { Plus, Trash2, GripVertical, Check, AlertTriangle } from 'lucide-react'
import { useSettings } from '../contexts/SettingsContext'
import { DEMO_MODE } from '../lib/supabase'

const card = { background: '#242424', border: '1px solid #2e2e2e' }
const inputStyle = { background: '#1a1a1a', border: '1px solid #3a3a3a' }
const inputCls = 'px-3 py-2 rounded-lg text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-teal/40 transition-colors'

function SaveBar({ dirty, saving, saved, error, onSave }) {
  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center gap-3">
        <button onClick={onSave} disabled={!dirty || saving}
          className="px-4 py-2 rounded-xl text-[12px] font-bold text-dark bg-teal disabled:opacity-40 transition-colors">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {saved && <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-400"><Check size={13} /> Saved</span>}
        {dirty && !saving && !saved && !error && <span className="text-[11px] text-white/30">Unsaved changes</span>}
      </div>
      {error && (
        <div className="rounded-lg px-3 py-2 flex items-start gap-2 text-[12px] text-red-300"
          style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{error}{!DEMO_MODE && ' — make sure migration 006_settings.sql has been run on your database.'}</span>
        </div>
      )}
    </div>
  )
}

// Editor for a list of { label, color } status objects.
function StatusEditor() {
  const { statuses, save } = useSettings()
  const [rows, setRows]   = useState(statuses)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState('')
  useEffect(() => { setRows(statuses) }, [statuses])

  const dirty = JSON.stringify(rows) !== JSON.stringify(statuses)
  const update = (i, patch) => setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r))
  const remove = (i) => setRows(rs => rs.filter((_, j) => j !== i))
  const add    = () => setRows(rs => [...rs, { label: 'New Status', color: '#94a3b8' }])
  async function onSave() {
    const clean = rows.filter(r => r.label.trim()).map(r => ({ label: r.label.trim(), color: r.color || '#94a3b8' }))
    setError(''); setSaving(true)
    const { error: err } = (await save('deal_statuses', clean)) || {}
    setSaving(false)
    if (err) { setError(err.message || 'Could not save.'); return }
    setSaved(true); setTimeout(() => setSaved(false), 1800)
  }

  return (
    <div className="rounded-xl p-4 md:p-5 space-y-3" style={card}>
      <div>
        <h3 className="text-[13px] font-bold text-white">Deal Statuses</h3>
        <p className="text-[11px] text-white/40 mt-0.5">These drive the status dropdowns, filters, and pipeline colors everywhere.</p>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <GripVertical size={14} className="text-white/15 flex-shrink-0" />
            <input type="color" value={r.color} onChange={e => update(i, { color: e.target.value })}
              className="w-9 h-9 rounded-lg bg-transparent border border-white/10 cursor-pointer flex-shrink-0" />
            <input value={r.label} onChange={e => update(i, { label: e.target.value })}
              style={inputStyle} className={`${inputCls} flex-1`} placeholder="Status name" />
            <button onClick={() => remove(i)} className="p-2 rounded-lg text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <button onClick={add} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-teal hover:text-teal-light">
        <Plus size={14} /> Add status
      </button>
      <SaveBar dirty={dirty} saving={saving} saved={saved} error={error} onSave={onSave} />
    </div>
  )
}

// Editor for a list of plain strings.
function ListEditor({ title, hint, settingKey, placeholder }) {
  const { settings, save } = useSettings()
  const current = settings[settingKey] ?? []
  const [rows, setRows]     = useState(current)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState('')
  useEffect(() => { setRows(current) }, [JSON.stringify(current)])

  const dirty = JSON.stringify(rows) !== JSON.stringify(current)
  const update = (i, v) => setRows(rs => rs.map((r, j) => j === i ? v : r))
  const remove = (i) => setRows(rs => rs.filter((_, j) => j !== i))
  const add    = () => setRows(rs => [...rs, ''])
  async function onSave() {
    const clean = rows.map(r => r.trim()).filter(Boolean)
    setError(''); setSaving(true)
    const { error: err } = (await save(settingKey, clean)) || {}
    setSaving(false)
    if (err) { setError(err.message || 'Could not save.'); return }
    setSaved(true); setTimeout(() => setSaved(false), 1800)
  }

  return (
    <div className="rounded-xl p-4 md:p-5 space-y-3" style={card}>
      <div>
        <h3 className="text-[13px] font-bold text-white">{title}</h3>
        {hint && <p className="text-[11px] text-white/40 mt-0.5">{hint}</p>}
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <GripVertical size={14} className="text-white/15 flex-shrink-0" />
            <input value={r} onChange={e => update(i, e.target.value)}
              style={inputStyle} className={`${inputCls} flex-1`} placeholder={placeholder} />
            <button onClick={() => remove(i)} className="p-2 rounded-lg text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {rows.length === 0 && <p className="text-[12px] text-white/30">None yet — add one below.</p>}
      </div>
      <button onClick={add} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-teal hover:text-teal-light">
        <Plus size={14} /> Add option
      </button>
      <SaveBar dirty={dirty} saving={saving} saved={saved} error={error} onSave={onSave} />
    </div>
  )
}


// Upload a site logo without touching code: the image is downscaled to 256px
// and stored as a data URL in app_settings ('site_logo'), which the Logo
// component renders everywhere inside the app. (The login screen loads before
// sign-in, so it can't read settings — it uses public/logo.png or the
// built-in mark.)
// Erase the white background around a logo: flood-fill from the canvas edges,
// turning connected near-white pixels transparent. White INSIDE the artwork
// (letters, highlights) isn't touched because it isn't connected to the edge.
function stripWhiteBackground(canvas) {
  const ctx = canvas.getContext('2d')
  const w = canvas.width, h = canvas.height
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const nearWhite = (i) => d[i] > 232 && d[i + 1] > 232 && d[i + 2] > 232
  const seen = new Uint8Array(w * h)
  const stack = []
  for (let x = 0; x < w; x++) { stack.push(x, 0, x, h - 1) }
  for (let y = 0; y < h; y++) { stack.push(0, y, w - 1, y) }
  while (stack.length) {
    const y = stack.pop(), x = stack.pop()
    if (x < 0 || y < 0 || x >= w || y >= h) continue
    const p = y * w + x
    if (seen[p]) continue
    seen[p] = 1
    const i4 = p * 4
    if (d[i4 + 3] === 0 || !nearWhite(i4)) continue
    d[i4 + 3] = 0
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1)
  }
  ctx.putImageData(img, 0, 0)
}

function LogoEditor() {
  const { settings, save } = useSettings()
  const current = settings?.site_logo || null
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState('')
  const [stripBg, setStripBg] = useState(true)

  async function apply(value) {
    setError(''); setSaving(true)
    const { error: err } = (await save('site_logo', value)) || {}
    setSaving(false)
    if (err) { setError(err.message || 'Could not save.'); return }
    setSaved(true); setTimeout(() => setSaved(false), 1800)
  }

  function onPick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return setError('Pick an image file (PNG with transparency works best).')
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      // Downscale so the stored data URL stays small (~20–60KB).
      const max = 256
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      if (stripBg) stripWhiteBackground(canvas)
      const dataUrl = canvas.toDataURL('image/png')
      if (dataUrl.length > 400000) return setError('That image is too complex even after resizing — try a simpler PNG.')
      apply(dataUrl)
    }
    img.onerror = () => { URL.revokeObjectURL(url); setError('Could not read that image.') }
    img.src = url
  }

  return (
    <div className="rounded-xl p-4 md:p-5 space-y-3" style={card}>
      <div>
        <h3 className="text-[13px] font-bold text-white">Logo</h3>
        <p className="text-[11px] text-white/40 mt-0.5">
          Shown in the header across the site. PNG with a transparent background looks best.
          (The login screen is pre-sign-in, so it keeps the default unless a logo file is added to the code.)
        </p>
      </div>
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-xl flex items-center justify-center overflow-hidden"
          style={{ background: '#1a1a1a', border: '1px solid #333' }}>
          {current
            ? <img src={current} alt="Logo" className="max-w-full max-h-full object-contain" />
            : <span className="text-[10px] text-white/25 text-center px-1">default mark</span>}
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className="px-3 py-2 rounded-xl text-[12px] font-bold text-dark bg-teal cursor-pointer">
              {current ? 'Replace logo' : 'Upload logo'}
              <input type="file" accept="image/*" onChange={onPick} className="hidden" />
            </label>
            {current && (
              <button onClick={() => apply(null)} disabled={saving}
                className="px-3 py-2 rounded-xl text-[12px] font-semibold text-white/50 hover:text-white transition-colors"
                style={{ border: '1px solid #3a3a3a' }}>
                Remove
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 text-[12px] text-white/55 cursor-pointer select-none">
            <input type="checkbox" checked={stripBg} onChange={e => setStripBg(e.target.checked)}
              className="accent-teal w-3.5 h-3.5" />
            Make white background transparent
            <span className="text-white/25">(applied on upload — re-upload to change)</span>
          </label>
        </div>
      </div>
      {saving && <p className="text-[11px] text-white/30">Saving…</p>}
      {saved && <p className="text-[11px] text-emerald-400 flex items-center gap-1"><Check size={12} /> Saved — live everywhere now</p>}
      {error && (
        <div className="rounded-lg px-3 py-2 flex items-start gap-2 text-[12px] text-red-300"
          style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}

// One-line text setting (e.g. the site name in the header + browser tab).
function TextSetting({ title, hint, settingKey, placeholder }) {
  const { settings, save } = useSettings()
  const current = settings[settingKey] ?? ''
  const [value, setValue]   = useState(current)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState('')
  useEffect(() => { setValue(current) }, [current])

  const dirty = value !== current
  async function onSave() {
    setError(''); setSaving(true)
    const { error: err } = (await save(settingKey, value.trim() || null)) || {}
    setSaving(false)
    if (err) { setError(err.message || 'Could not save.'); return }
    setSaved(true); setTimeout(() => setSaved(false), 1800)
  }

  return (
    <div className="rounded-xl p-4 md:p-5 space-y-3" style={card}>
      <div>
        <h3 className="text-[13px] font-bold text-white">{title}</h3>
        {hint && <p className="text-[11px] text-white/40 mt-0.5">{hint}</p>}
      </div>
      <input value={value} onChange={e => setValue(e.target.value)} placeholder={placeholder}
        style={inputStyle} className={`${inputCls} w-full max-w-sm`} />
      <SaveBar dirty={dirty} saving={saving} saved={saved} error={error} onSave={onSave} />
    </div>
  )
}

// A single date value (stored as YYYY-MM-DD in app_settings).
function DateSetting({ title, hint, settingKey, fallback }) {
  const { settings, save } = useSettings()
  const current = settings[settingKey] ?? fallback ?? ''
  const [value, setValue]   = useState(current)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState('')
  useEffect(() => { setValue(current) }, [current])

  const dirty = value !== current
  async function onSave() {
    setError(''); setSaving(true)
    const { error: err } = (await save(settingKey, value || null)) || {}
    setSaving(false)
    if (err) { setError(err.message || 'Could not save.'); return }
    setSaved(true); setTimeout(() => setSaved(false), 1800)
  }

  return (
    <div className="rounded-xl p-4 md:p-5 space-y-3" style={card}>
      <div>
        <h3 className="text-[13px] font-bold text-white">{title}</h3>
        {hint && <p className="text-[11px] text-white/40 mt-0.5">{hint}</p>}
      </div>
      <input type="date" value={value} onChange={e => setValue(e.target.value)}
        style={inputStyle} className={`${inputCls} w-full max-w-[12rem]`} />
      <SaveBar dirty={dirty} saving={saving} saved={saved} error={error} onSave={onSave} />
    </div>
  )
}

// ── Override-rate schedule — effective-dated commission rate "eras" ──────────
// Each era: { effective, manager, default, byOffice: { <office lc>: pct } }.
// Percent values are HUMAN numbers (3.75 = 3.75%). A deal uses the era in
// force on its SALE DATE, so adding a new era re-prices nothing historical.
const LEGACY_ERA = { effective: '2000-01-01', manager: 3, default: 5, byOffice: { tucson: 3.75 } }

function OverrideRatesEditor() {
  const { settings, offices, save } = useSettings()
  const current = Array.isArray(settings.override_rates) && settings.override_rates.length
    ? settings.override_rates : [LEGACY_ERA]
  const [rows, setRows]     = useState(current)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState('')
  useEffect(() => { setRows(current) }, [JSON.stringify(current)])

  const dirty = JSON.stringify(rows) !== JSON.stringify(current)
  const setEra = (i, patch) => setRows(rs => rs.map((r, x) => x === i ? { ...r, ...patch } : r))
  const setOffice = (i, office, v) => setRows(rs => rs.map((r, x) =>
    x === i ? { ...r, byOffice: { ...(r.byOffice || {}), [office.toLowerCase()]: v } } : r))

  function addEra() {
    const last = rows[rows.length - 1] || LEGACY_ERA
    setRows(rs => [...rs, { ...last, byOffice: { ...(last.byOffice || {}) }, effective: new Date().toISOString().slice(0, 10) }])
  }
  async function onSave() {
    setError(''); setSaving(true)
    const clean = rows
      .filter(r => r.effective)
      .map(r => ({
        effective: r.effective,
        manager: Math.max(0, parseFloat(r.manager) || 0),
        default: Math.max(0, parseFloat(r.default) || 0),
        byOffice: Object.fromEntries(Object.entries(r.byOffice || {})
          .filter(([, v]) => v !== '' && v != null && Number.isFinite(parseFloat(v)))
          .map(([k, v]) => [k, Math.max(0, parseFloat(v))])),
      }))
      .sort((a, b) => a.effective.localeCompare(b.effective))
    const { error: err } = (await save('override_rates', clean)) || {}
    setSaving(false)
    if (err) { setError(err.message || 'Could not save.'); return }
    setSaved(true); setTimeout(() => setSaved(false), 1800)
  }

  const numInp = (value, onChange) => (
    <input type="number" min="0" step="0.01" value={value ?? ''} onChange={onChange}
      style={inputStyle} className={`${inputCls} w-20 text-center`} />
  )

  return (
    <div className="rounded-xl p-4 md:p-5 space-y-3" style={card}>
      <div>
        <h3 className="text-[13px] font-bold text-white">Override Rates</h3>
        <p className="text-[11px] text-white/40 mt-0.5">
          The default Manager / Director / VP override % stamped on new deals (and used when a deal has no
          explicit %). Each row takes effect for deals <span className="text-white/60">closed on or after</span> its
          effective date — older deals keep the rates in force when they closed. A deal's own edited % always wins.
        </p>
      </div>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="rounded-lg p-3 space-y-2" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1">Effective from</p>
                <input type="date" value={r.effective || ''} onChange={e => setEra(i, { effective: e.target.value })}
                  style={{ ...inputStyle, colorScheme: 'dark' }} className={`${inputCls} w-40`} />
              </div>
              <div>
                <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1">Manager %</p>
                {numInp(r.manager, e => setEra(i, { manager: e.target.value }))}
              </div>
              {offices.map(o => (
                <div key={o}>
                  <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1">Dir/VP % · {o}</p>
                  {numInp(r.byOffice?.[o.toLowerCase()] ?? r.default, e => setOffice(i, o, e.target.value))}
                </div>
              ))}
              <div>
                <p className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-1">Dir/VP % · other</p>
                {numInp(r.default, e => setEra(i, { default: e.target.value }))}
              </div>
              {rows.length > 1 && (
                <button onClick={() => setRows(rs => rs.filter((_, x) => x !== i))}
                  className="p-2 rounded-lg text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-colors mb-0.5" title="Remove this rate era">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <button onClick={addEra}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white/60 hover:text-white transition-colors"
        style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
        <Plus size={13} /> Add a rate change
      </button>
      <SaveBar dirty={dirty} saving={saving} saved={saved} error={error} onSave={onSave} />
    </div>
  )
}

export default function SettingsPanel() {
  return (
    <div className="space-y-4">
      <p className="text-[12px] text-white/40">
        Changes here apply across the site immediately for everyone — no redeploy needed.
      </p>
      <LogoEditor />
      <TextSetting title="Site Name" settingKey="site_name"
        hint="Shown in the header next to the logo and as the browser-tab title."
        placeholder="Turf Time Dashboard" />
      <StatusEditor />
      <ListEditor title="Payment Methods" settingKey="payment_methods"
        hint="Shown on every deal and in the create/edit form."
        placeholder="e.g. Self-Pay + Goodleap" />
      <ListEditor title="Offices" settingKey="offices"
        hint="Selectable office locations on deals."
        placeholder="e.g. Phoenix" />
      <OverrideRatesEditor />
      <DateSetting title="Data Start Date" settingKey="data_start_date" fallback="2026-06-01"
        hint="Deals closed before this date are treated as legacy: they still count in historical totals, but they're left out of the Needs-review staging list, the payroll overdue nag, and the Watchdog's background alerts. You'll still be prompted as they reach their pay-date run." />
    </div>
  )
}
