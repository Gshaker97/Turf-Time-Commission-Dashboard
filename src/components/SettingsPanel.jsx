import { useState, useEffect } from 'react'
import { Plus, Trash2, GripVertical, Check, AlertTriangle, ChevronUp, ChevronDown } from 'lucide-react'
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
  useEffect(() => { setRows(current) }, [JSON.stringify(current)]) // eslint-disable-line

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

// Editor for the new-deal checklist: { key, label } items, reorderable. The
// `key` is kept stable across renames so deals' saved progress isn't lost.
const slug = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
function ChecklistEditor() {
  const { checklistItems, save } = useSettings()
  const [rows, setRows]   = useState(checklistItems)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState('')
  useEffect(() => { setRows(checklistItems) }, [JSON.stringify(checklistItems)]) // eslint-disable-line

  const dirty = JSON.stringify(rows) !== JSON.stringify(checklistItems)
  const update = (i, label) => setRows(rs => rs.map((r, j) => j === i ? { ...r, label } : r))
  const remove = (i) => setRows(rs => rs.filter((_, j) => j !== i))
  const add    = () => setRows(rs => [...rs, { key: 'c_' + Math.random().toString(36).slice(2, 8), label: '' }])
  const move   = (i, dir) => setRows(rs => {
    const j = i + dir
    if (j < 0 || j >= rs.length) return rs
    const next = [...rs]; [next[i], next[j]] = [next[j], next[i]]; return next
  })
  async function onSave() {
    // Drop blanks; ensure each item has a stable, unique key.
    const used = new Set()
    const clean = rows.filter(r => r.label.trim()).map(r => {
      let key = r.key || slug(r.label) || ('c_' + Math.random().toString(36).slice(2, 8))
      while (used.has(key)) key += '_' + Math.random().toString(36).slice(2, 4)
      used.add(key)
      return { key, label: r.label.trim() }
    })
    setError(''); setSaving(true)
    const { error: err } = (await save('checklist_items', clean)) || {}
    setSaving(false)
    if (err) { setError(err.message || 'Could not save.'); return }
    setSaved(true); setTimeout(() => setSaved(false), 1800)
  }

  return (
    <div className="rounded-xl p-4 md:p-5 space-y-3" style={card}>
      <div>
        <h3 className="text-[13px] font-bold text-white">New-Deal Checklist</h3>
        <p className="text-[11px] text-white/40 mt-0.5">The items in the checklist next to each deal name, in order. Completing every item moves a deal from Deal Review to Pending Install.</p>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.key ?? i} className="flex items-center gap-2">
            <div className="flex flex-col flex-shrink-0">
              <button onClick={() => move(i, -1)} disabled={i === 0}
                className="text-white/25 hover:text-white disabled:opacity-20 leading-none"><ChevronUp size={14} /></button>
              <button onClick={() => move(i, 1)} disabled={i === rows.length - 1}
                className="text-white/25 hover:text-white disabled:opacity-20 leading-none"><ChevronDown size={14} /></button>
            </div>
            <input value={r.label} onChange={e => update(i, e.target.value)}
              style={inputStyle} className={`${inputCls} flex-1`} placeholder="Checklist item" />
            <button onClick={() => remove(i)} className="p-2 rounded-lg text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {rows.length === 0 && <p className="text-[12px] text-white/30">None yet — add one below.</p>}
      </div>
      <button onClick={add} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-teal hover:text-teal-light">
        <Plus size={14} /> Add item
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
      <StatusEditor />
      <ListEditor title="Payment Methods" settingKey="payment_methods"
        hint="Shown on every deal and in the create/edit form."
        placeholder="e.g. Self-Pay + Goodleap" />
      <ListEditor title="Offices" settingKey="offices"
        hint="Selectable office locations on deals."
        placeholder="e.g. Phoenix" />
      <ChecklistEditor />
    </div>
  )
}
