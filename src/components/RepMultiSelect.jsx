import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, ChevronDown, Check, X } from 'lucide-react'

// Multi-select rep filter, searchable. Two exports that share one list body:
//   RepPickList   — the search box + checkbox rows. Drop it inside any popover
//                   (the Deals table's column-header menu uses it directly).
//   RepMultiSelect — a trigger button that opens RepPickList in its own
//                   popover. The filter bar uses this.
// `value` is an ARRAY of profile ids; empty = everyone. The two surfaces share
// state through the page, so ticking a rep in the header also ticks it here.

const sortByName = (users) => [...users].sort((a, b) => (a.name || '').localeCompare(b.name || ''))

export function RepPickList({ users = [], value = [], onChange, autoFocus = false }) {
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)
  useEffect(() => { if (autoFocus) inputRef.current?.focus() }, [autoFocus])
  const sorted = useMemo(() => sortByName(users), [users])
  const q = query.trim().toLowerCase()
  const matches = q ? sorted.filter(u => (u.name || '').toLowerCase().includes(q)) : sorted
  const selected = new Set(value)
  const toggle = (id) => onChange(selected.has(id) ? value.filter(v => v !== id) : [...value, id])

  return (
    <div className="space-y-1">
      <div className="relative px-1">
        <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
        <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search reps…"
          onKeyDown={e => {
            // Enter toggles the first match — type a few letters, hit Enter, done.
            if (e.key === 'Enter' && matches.length) { e.preventDefault(); toggle(matches[0].id) }
            if (e.key === 'Escape' && query) { e.preventDefault(); setQuery('') }
          }}
          style={{ background: '#1e1e1e', border: '1px solid #333' }}
          className="h-8 w-full rounded-lg text-[12px] text-white placeholder-white/25 pl-7 pr-2 focus:outline-none focus:border-teal/50" />
      </div>
      <div className="max-h-60 overflow-auto">
        <Row label="All reps" active={value.length === 0} onClick={() => onChange([])} />
        {matches.length === 0
          ? <p className="px-2 py-1.5 text-[12px] text-white/30">No one matches “{query}”.</p>
          : matches.map(u => (
            <Row key={u.id} label={u.name} sub={u.role} active={selected.has(u.id)} box onClick={() => toggle(u.id)} />
          ))}
      </div>
      {value.length > 0 && (
        <div className="flex items-center justify-between px-2 pt-1 border-t border-white/5">
          <span className="text-[11px] text-white/40">{value.length} selected</span>
          <button type="button" onClick={() => onChange([])} className="text-[11px] text-white/40 hover:text-white underline">Clear</button>
        </div>
      )}
    </div>
  )
}

function Row({ label, sub, active, box, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-white/[0.04] transition-colors">
      {box && (
        <span className="w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0"
          style={{ background: active ? '#00b894' : 'transparent', border: `1px solid ${active ? '#00b894' : '#444'}` }}>
          {active && <Check size={10} className="text-dark" strokeWidth={3} />}
        </span>
      )}
      <span className="text-[12px] truncate flex-1" style={{ color: active ? '#2dd4bf' : 'rgba(255,255,255,0.85)' }}>{label}</span>
      {sub && <span className="text-[10px] text-white/30 uppercase flex-shrink-0">{sub}</span>}
      {!box && active && <Check size={12} className="text-teal flex-shrink-0" />}
    </button>
  )
}

export default function RepMultiSelect({ users = [], value = [], onChange, minW = '150px' }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  const names = value.map(id => users.find(u => u.id === id)?.name).filter(Boolean)
  const label = names.length === 0 ? 'All Reps'
    : names.length <= 2 ? names.join(', ')
    : `${names[0]} +${names.length - 1}`

  return (
    <div ref={wrapRef} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ background: '#2a2a2a', border: `1px solid ${value.length ? 'rgba(0,184,148,0.5)' : '#333'}`, minWidth: minW }}
        className={`h-9 rounded-lg text-[13px] px-3 pr-8 text-left w-full flex items-center gap-1.5 focus:outline-none focus:border-teal/40 transition-colors ${value.length ? 'text-teal' : 'text-white'}`}>
        <span className="truncate">{label}</span>
        {value.length > 0 && (
          <span onClick={e => { e.stopPropagation(); onChange([]) }} title="Clear reps"
            className="ml-auto -mr-1 p-0.5 rounded text-teal/60 hover:text-white hover:bg-white/10"><X size={12} /></span>
        )}
      </button>
      <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
      {open && (
        <div className="absolute left-0 z-50 mt-1 rounded-xl shadow-2xl p-1.5 min-w-[240px]"
          style={{ background: '#242424', border: '1px solid #3a3a3a' }}>
          <RepPickList users={users} value={value} onChange={onChange} autoFocus />
        </div>
      )}
    </div>
  )
}
