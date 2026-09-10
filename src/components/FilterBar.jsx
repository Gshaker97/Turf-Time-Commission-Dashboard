import { Search, ChevronDown, X } from 'lucide-react'
import DateRangeFilter from './DateRangeFilter'
import RepMultiSelect from './RepMultiSelect'
import { DATE_FIELDS } from './DealTable'
import { useSettings } from '../contexts/SettingsContext'

const inputStyle = { background: '#2a2a2a', border: '1px solid #333' }
const inputCls = 'h-9 rounded-lg text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-teal/40 transition-colors px-3'

// Top bar for the Deals page — laid out like the Dashboard's filter row.
//   Row 1: date-range preset pills (always visible, one click) + which date
//          they apply to + the SCOPE dropdown (whose deals you're looking at).
//   Row 2: search + the rep / status / office / payment selects.
//   Row 3: active-filter chips, so a filter set from a column header is
//          visible and undoable up here too.
// Everything is always on screen — the old sliders toggle that hid the date
// controls behind an icon is gone (per Keaton: quick-click like the Dashboard).
//
// `scopeOptions` is built by the page from the viewer's role — admins pick
// any team, managers get All / My team, reps get My deals / All — and the bar
// simply renders whatever it's handed.
export default function FilterBar({
  users = [],
  repFilters = [], setRepFilters,
  search, setSearch,
  statusFilter, setStatusFilter,
  officeFilter, setOfficeFilter,
  paymentFilter, setPaymentFilter,
  dateField, setDateField,
  dateFrom, dateTo,
  datePreset, setDateRange,
  scope, setScope, scopeOptions = [],
  recordCount,
}) {
  const { statusLabels, offices, paymentMethods } = useSettings()
  const reps = users.filter(u => ['rep','manager','director','vp'].includes(u.role))
  const repName = (id) => reps.find(r => r.id === id)?.name ?? '—'
  const dateFieldLabel = DATE_FIELDS.find(f => f.value === dateField)?.label ?? 'Date'

  const clearAll = () => {
    setRepFilters([]); setStatusFilter(''); setOfficeFilter(''); setPaymentFilter('')
    setDateRange('', '', 'all')
  }

  // Chips cover the filters that don't announce themselves — the date pills
  // and scope dropdown already show their own state, so they're left out.
  const chips = []
  // One chip per selected rep, each removable on its own.
  for (const id of repFilters) chips.push({ key: `rep-${id}`, label: `Rep: ${repName(id)}`, clear: () => setRepFilters(repFilters.filter(r => r !== id)) })
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

      {/* Row 1 — date pills (Dashboard-style) + which date + scope */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-2">
        <DateRangeFilter
          from={dateFrom}
          to={dateTo}
          preset={datePreset}
          onChange={({ from, to, preset }) => setDateRange(from, to, preset)}
          count={recordCount}
          countLabel="deals"
        />
        <div className="flex items-center gap-2 flex-wrap lg:flex-nowrap lg:self-start">
          <Select value={dateField} onChange={setDateField} minW="130px" title="Which date the range applies to">
            {DATE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </Select>
          {scopeOptions.length > 1 && (
            <Select value={scope} onChange={setScope} minW="140px" title="Whose deals to show">
              {scopeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          )}
        </div>
      </div>

      {/* Row 2 — search + the field selects, always visible */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
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
        <RepMultiSelect users={reps} value={repFilters} onChange={setRepFilters} minW="150px" />
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

      {/* Row 3 — active-filter chips */}
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
    </div>
  )
}

function Select({ value, onChange, minW, title, children }) {
  return (
    <div className="relative">
      {/* appearance-none hides the browser's own arrow — otherwise it draws
          underneath our chevron and shows as a faint second one. */}
      <select value={value} onChange={e => onChange(e.target.value)} title={title}
        style={{ ...inputStyle, minWidth: minW }} className={`${inputCls} pr-8 appearance-none`}>
        {children}
      </select>
      <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
    </div>
  )
}
