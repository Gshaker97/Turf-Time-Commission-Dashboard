import { useState } from 'react'
import { Search, ChevronDown, SlidersHorizontal, X } from 'lucide-react'

const inputStyle = { background: '#2a2a2a', border: '1px solid #333' }
const inputCls = 'h-9 rounded-lg text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-teal/40 transition-colors px-3'
const STATUSES = ['Deal Review', 'Pending Install', 'Pay Finalized', 'Paid', 'Sales Issue']

export default function FilterBar({
  users = [],
  repFilter, setRepFilter,
  search, setSearch,
  statusFilter, setStatusFilter,
  dateFrom, setDateFrom,
  dateTo, setDateTo,
  recordCount,
}) {
  const [open, setOpen] = useState(false)
  const reps = users.filter(u => ['rep','manager','director','vp'].includes(u.role))
  const hasFilters = repFilter || statusFilter || dateFrom || dateTo

  return (
    <div className="rounded-xl p-3 md:p-4 space-y-3" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>

      {/* Always-visible row: search + count + filter toggle */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search deal, address, ID…"
            style={inputStyle}
            className={`${inputCls} pl-8 w-full`}
          />
        </div>

        <div className="h-9 px-3 rounded-lg flex items-center gap-1.5 flex-shrink-0"
          style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
          <span className="text-[14px] font-bold text-teal">{recordCount}</span>
          <span className="text-[12px] text-white/30 hidden sm:inline">Records</span>
        </div>

        {/* Filter toggle — mobile only */}
        <button
          onClick={() => setOpen(o => !o)}
          className={`md:hidden h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${
            open || hasFilters ? 'bg-teal/15 text-teal border border-teal/25' : 'text-white/40 border border-white/10'
          }`}
        >
          {open ? <X size={15} /> : <SlidersHorizontal size={15} />}
          {hasFilters && !open && (
            <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-teal" />
          )}
        </button>
      </div>

      {/* Filters — always visible on md+, collapsible on mobile */}
      <div className={`flex flex-wrap gap-2 md:gap-3 items-center ${open ? 'flex' : 'hidden md:flex'}`}>

        {/* Rep */}
        <div className="relative">
          <select value={repFilter} onChange={e => setRepFilter(e.target.value)}
            style={inputStyle} className={`${inputCls} pr-8 min-w-[130px] md:min-w-[150px]`}>
            <option value="">All Reps</option>
            {reps.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
        </div>

        {/* Status */}
        <div className="relative">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={inputStyle} className={`${inputCls} pr-8 min-w-[130px] md:min-w-[145px]`}>
            <option value="">All Statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
        </div>

        {/* Date range */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            style={inputStyle} className={`${inputCls} w-[128px] md:w-[138px]`} />
          <span className="text-white/30 text-xs">→</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            style={inputStyle} className={`${inputCls} w-[128px] md:w-[138px]`} />
        </div>

        {/* Clear filters — mobile only */}
        {hasFilters && (
          <button onClick={() => { setRepFilter(''); setStatusFilter(''); setDateFrom(''); setDateTo('') }}
            className="md:hidden text-[12px] text-white/40 hover:text-white underline">
            Clear
          </button>
        )}
      </div>
    </div>
  )
}
