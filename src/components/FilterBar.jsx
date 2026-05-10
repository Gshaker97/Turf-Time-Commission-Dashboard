import { Search, ChevronDown } from 'lucide-react'

const inputStyle = { background: '#2a2a2a', border: '1px solid #333' }
const inputCls =
  'h-9 rounded-lg text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-teal/40 transition-colors px-3'

const STATUSES = ['', 'Sold', 'Scheduled', 'Installed', 'Paid']

export default function FilterBar({
  users = [],
  repFilter, setRepFilter,
  search, setSearch,
  statusFilter, setStatusFilter,
  dateFrom, setDateFrom,
  dateTo, setDateTo,
  recordCount,
}) {
  const reps = users.filter(u =>
    ['rep', 'manager', 'director', 'vp'].includes(u.role)
  )

  return (
    <div
      className="rounded-xl p-4 flex flex-wrap gap-3 items-center"
      style={{ background: '#242424', border: '1px solid #2e2e2e' }}
    >
      {/* Rep selector */}
      <div className="relative">
        <select
          value={repFilter}
          onChange={e => setRepFilter(e.target.value)}
          style={inputStyle}
          className={`${inputCls} pr-8 min-w-[150px]`}
        >
          <option value="">All Reps</option>
          {reps.map(u => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
        <ChevronDown
          size={13}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none"
        />
      </div>

      {/* Search */}
      <div className="relative flex-1 min-w-[180px]">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none"
        />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search deal, address, project ID…"
          style={inputStyle}
          className={`${inputCls} pl-8 w-full`}
        />
      </div>

      {/* Status */}
      <div className="relative">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={inputStyle}
          className={`${inputCls} pr-8 min-w-[145px]`}
        >
          <option value="">All Statuses</option>
          {STATUSES.filter(Boolean).map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <ChevronDown
          size={13}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none"
        />
      </div>

      {/* Record count */}
      <div
        className="h-9 px-3.5 rounded-lg flex items-center gap-1.5 flex-shrink-0"
        style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}
      >
        <span className="text-[14px] font-bold text-teal">{recordCount}</span>
        <span className="text-[12px] text-white/30">Records</span>
      </div>

      {/* Date range */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          style={inputStyle}
          className={`${inputCls} w-[138px]`}
          title="From date"
        />
        <span className="text-white/30 text-xs">→</span>
        <input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          style={inputStyle}
          className={`${inputCls} w-[138px]`}
          title="To date"
        />
      </div>
    </div>
  )
}
