import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, ChevronDown, Check, X } from 'lucide-react'
import { SURFACE, POPOVER, GOLD_WASH } from './ui'

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
        <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-bank-fa pointer-events-none" />
        <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search reps…" aria-label="Search reps"
          onKeyDown={e => {
            // Enter toggles the first match — type a few letters, hit Enter, done.
            if (e.key === 'Enter' && matches.length) { e.preventDefault(); toggle(matches[0].id) }
            if (e.key === 'Escape' && query) { e.preventDefault(); setQuery('') }
          }}
          style={SURFACE.raise}
          className="h-11 md:h-9 w-full rounded-lg text-[13px] text-bank-tx placeholder-bank-fa pl-7 pr-2 focus:outline-none" />
      </div>
      <div className="max-h-60 overflow-auto">
        <Row label="All reps" active={value.length === 0} onClick={() => onChange([])} />
        {matches.length === 0
          ? <p className="px-2 py-1.5 text-[13px] text-bank-mu">No one matches “{query}”.</p>
          : matches.map(u => (
            <Row key={u.id} label={u.name} sub={u.role} active={selected.has(u.id)} box onClick={() => toggle(u.id)} />
          ))}
      </div>
      {value.length > 0 && (
        <div className="flex items-center justify-between px-2 pt-1 border-t border-bank-line">
          <span className="text-[13px] text-bank-mu">{value.length} selected</span>
          <button type="button" onClick={() => onChange([])} className="text-[13px] min-h-[44px] md:min-h-0 text-bank-mu hover:text-bank-tx underline">Clear</button>
        </div>
      )}
    </div>
  )
}

function Row({ label, sub, active, box, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className="w-full flex items-center gap-2 px-2 py-1.5 min-h-[44px] md:min-h-0 rounded-lg text-left hover:bg-bank-raise transition-colors">
      {box && (
        <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
          style={{ background: active ? 'var(--gold)' : 'transparent', border: `1px solid ${active ? 'var(--gold)' : 'var(--mu)'}` }}>
          {active && <Check size={11} strokeWidth={3} style={{ color: 'var(--gold-ink)' }} />}
        </span>
      )}
      <span className={`text-[13px] truncate flex-1 ${active ? 'text-bank-gold-tx font-semibold' : 'text-bank-tx'}`}>{label}</span>
      {sub && <span className="text-[12px] text-bank-fa uppercase flex-shrink-0">{sub}</span>}
      {!box && active && <Check size={12} className="text-bank-gold-tx flex-shrink-0" />}
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
        style={{ ...(value.length ? GOLD_WASH : SURFACE.raise), minWidth: minW }}
        className={`h-11 md:h-9 rounded-lg text-[13px] px-3 pr-8 text-left w-full flex items-center gap-1.5 focus:outline-none transition-colors ${value.length ? 'text-bank-gold-tx' : 'text-bank-tx'}`}>
        <span className="truncate">{label}</span>
        {value.length > 0 && (
          <span onClick={e => { e.stopPropagation(); onChange([]) }} title="Clear reps" role="button"
            className="ml-auto -mr-1 p-1 rounded text-bank-gold-tx hover:text-bank-tx hover:bg-bank-raise"><X size={12} /></span>
        )}
      </button>
      <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-bank-fa pointer-events-none" />
      {open && (
        <div className="absolute left-0 z-50 mt-1 p-1.5 min-w-[260px] max-w-[calc(100vw-2rem)]" style={POPOVER}>
          <RepPickList users={users} value={value} onChange={onChange} autoFocus />
        </div>
      )}
    </div>
  )
}
