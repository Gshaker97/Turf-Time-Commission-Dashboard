import { useState } from 'react'
import { Search, ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import DateRangeFilter from './DateRangeFilter'
import { DATE_FIELDS } from './DealTable'
import { useSettings } from '../contexts/SettingsContext'

const inputStyle = { background: '#2a2a2a', border: '1px solid #333' }
const inputCls = 'h-9 rounded-lg text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-teal/40 transition-colors px-3'

// Top bar for the Deals page. Search + record count + active-filter chips are
// always shown; the sliders toggle expands the full filter controls (rep /
// status / office / payment / date) on every screen size. The same filters
// also live in the desktop table's column headers — both places work.
export default function FilterBar({
  users = [],
  repFilter, setRepFilter,
  search, setSearch,
  statusFilter, setStatusFilter,
  officeFilter, setOfficeFilter,
  paymentFilter, setPaymentFilter,
  dateField, setDateField,
  dateFrom, dateTo,
  datePreset, setDateRange,
  recordCount,
}) {
  const [open, setOpen] = useState(false)
  const { statusLabels, offices, paymentMethods } = useSettings()
  const reps = users.filter(u => ['rep','manager','director','vp'].includes(u.role))
  const repName = (id) => reps.find(r => r.id === id)?.name ?? '—'
  const dateFieldLabel = DATE_FIELDS.find(f => f.value === dateField)?.label ?? 'Date'

  const hasFilters = repFilter || statusFilter || officeFilter || paymentFilter || dateFrom || dateTo
  const clearAll = () => {
    setRepFilter(''); setStatusFilter(''); setOfficeFilter(''); setPaymentFilter('')
    setDateRange('', '', 'all')
  }

  // Active-filter chips (shown on every screen size).
  const chips = []
  if (repFilter)     chips.push({ key: 'rep',     label: `Rep: ${repName(repFilter)}`,  clear: () => setRepFilter('') })
  if (statusFilter)  chips.push({ key: 'status',  label: `Status: ${statusFilter}`,      clear: () => setStatusFilter('') })
  if (officeFilter)  chips.push({ key: 'office',  label: `Office: ${officeFilter}`,      clear: () => setOfficeFilter('') })
  if (paymentFilter) chips.push({ key: 'payment', label: `Payment: ${paymentFilter}`,    clear: () => setPaymentFilter('') })
  if (dateFrom || dateTo) chips.push({
    key: 'date',
    label: `${dateFieldLabel}: ${dateFrom || '…'} → ${dateTo || '…'}`,
    clear: () => setDateRange('', '', 'all'),
  })

  return (
    <div className="rounded-xl p-3 md:p-4 space-y-3" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>

      {/* Always-visible row: search + count + filter toggle (mobile) */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search deal, address, ID…"
            style={inputStyle}
            className={`${inputCls} pl-8 pr-8 w-full`}
          />
          {search && (
            <button onClick={() => setSearch('')} title="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-white/35 hover:text-white hover:bg-white/10 transition-colors">
              <X size={13} />
            </button>
          )}
        </div>

        <div className="h-9 px-3 rounded-lg flex items-center gap-1.5 flex-shrink-0"
          style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
          <span className="text-[14px] font-bold text-teal">{recordCount}</span>
          <span className="text-[12px] text-white/30 hidden sm:inline">Records</span>
        </div>

        {/* Filter toggle — all sizes (the same filters also live in the column
            headers on desktop; this is the expanded, everything-at-once view) */}
        <button
          onClick={() => setOpen(o => !o)}
          className={`relative h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${
            open || hasFilters ? 'bg-teal/15 text-teal border border-teal/25' : 'text-white/40 border border-white/10'
          }`}
        >
          {open ? <X size={15} /> : <SlidersHorizontal size={15} />}
          {hasFilters && !open && (
            <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-teal" />
          )}
        </button>
      </div>

      {/* Active-filter chips — all sizes. On desktop this is how you see/undo a
          filter set from a column header. */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="hidden lg:inline text-[10px] uppercase tracking-wider text-white/25 font-semibold">Filtered by</span>
          {chips.map(c => (
            <button key={c.key} onClick={c.clear}
              className="group inline-flex items-center gap-1.5 h-7 pl-2.5 pr-2 rounded-full text-[12px] text-teal transition-colors"
              style={{ background: '#0e3b35', border: '1px solid #1c5a50' }}>
              {c.label}
              <X size={12} className="text-teal/60 group-hover:text-teal" />
            </button>
          ))}
          <button onClick={clearAll} className="text-[12px] text-white/40 hover:text-white underline">Clear all</button>
        </div>
      )}

      {/* Dropdown filter controls — toggle open on any screen size */}
      <div className={`${open ? 'flex' : 'hidden'} flex-wrap gap-2 items-center`}>
        <Select value={repFilter} onChange={setRepFilter} minW="130px">
          <option value="">All Reps</option>
          {reps.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <Select value={statusFilter} onChange={setStatusFilter} minW="130px">
          <option value="">All Statuses</option>
          {statusLabels.map(s => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Select value={officeFilter} onChange={setOfficeFilter} minW="120px">
          <option value="">All Offices</option>
          {offices.map(o => <option key={o} value={o}>{o}</option>)}
        </Select>
        <Select value={paymentFilter} onChange={setPaymentFilter} minW="130px">
          <option value="">All Payments</option>
          {paymentMethods.map(p => <option key={p} value={p}>{p}</option>)}
        </Select>
      </div>

      {/* Date range — pick which date, then the range. */}
      <div className={`${open ? 'block' : 'hidden'} space-y-2`}>
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-white/30 font-semibold">Filter by</span>
          <Select value={dateField} onChange={setDateField} minW="140px">
            {DATE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </Select>
        </div>
        <DateRangeFilter
          from={dateFrom}
          to={dateTo}
          preset={datePreset}
          onChange={({ from, to, preset }) => setDateRange(from, to, preset)}
        />
      </div>
    </div>
  )
}

function Select({ value, onChange, minW, children }) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ ...inputStyle, minWidth: minW }} className={`${inputCls} pr-8`}>
        {children}
      </select>
      <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
    </div>
  )
}
