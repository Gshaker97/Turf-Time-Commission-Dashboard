import { ChevronUp, ChevronDown, ChevronsUpDown, Pencil, Trash2 } from 'lucide-react'
import { calcDealCommissions, fmt, fmtPct } from '../utils/commission'

const STATUS_STYLES = {
  'Deal Review':     { color: '#94a3b8', border: 'rgba(148,163,184,0.2)',  dot: '#94a3b8' },
  'Pending Install': { color: '#2dd4bf', border: 'rgba(45,212,191,0.25)', dot: '#2dd4bf' },
  'Pay Finalized':   { color: '#22d3ee', border: 'rgba(34,211,238,0.25)',  dot: '#22d3ee' },
  'Paid':            { color: '#4ade80', border: 'rgba(74,222,128,0.25)',  dot: '#4ade80' },
  'Sales Issue':     { color: '#f87171', border: 'rgba(248,113,113,0.25)', dot: '#f87171' },
}

const STATUSES = ['Deal Review', 'Pending Install', 'Pay Finalized', 'Paid', 'Sales Issue']

const COLS = [
  { key: 'deal_name',        label: 'Deal Name' },
  { key: 'office',           label: 'Office' },
  { key: 'status',           label: 'Status' },
  { key: 'sale_date',        label: 'Sale Date' },
  { key: 'install_date',     label: 'Install Date' },
  { key: 'setter',           label: 'Setter',           sortAccessor: d => d.setter?.name ?? '' },
  { key: 'closer',           label: 'Closer',           sortAccessor: d => d.closer?.name ?? '' },
  { key: 'baseline_revenue', label: 'Baseline Rev',     align: 'right' },
  { key: 'job_price',        label: 'Job Price',        align: 'right' },
  { key: 'commission',       label: 'Commission / %',   align: 'right', sortAccessor: d => calcDealCommissions(d).gross },
  { key: 'pay_date',         label: 'Pay Date' },
]

function SortIcon({ col, sortKey, sortDir }) {
  if (sortKey !== col) return <ChevronsUpDown size={12} className="text-dark/40 ml-1 flex-shrink-0" />
  return sortDir === 'asc'
    ? <ChevronUp size={12} className="text-dark ml-1 flex-shrink-0" />
    : <ChevronDown size={12} className="text-dark ml-1 flex-shrink-0" />
}

function DateCell({ value, field, dealId, canEdit, onUpdate }) {
  if (!canEdit) return <span className="text-white/50">{value ?? '—'}</span>
  return (
    <input
      type="date"
      defaultValue={value ?? ''}
      onChange={e => onUpdate(dealId, { [field]: e.target.value || null })}
      className="bg-transparent text-white/50 text-[13px] border-0 outline-none cursor-pointer hover:text-white focus:text-white transition-colors w-[112px]"
      style={{ colorScheme: 'dark' }}
    />
  )
}

function CommissionCell({ deal }) {
  const { gross, commPct, setterAmt, closerAmt } = calcDealCommissions(deal)
  const split = deal.setter_id && deal.closer_id && deal.setter_id !== deal.closer_id

  if (!split) {
    return (
      <div className="flex flex-col items-end">
        <span className="text-[13px] font-bold text-teal">{fmt(gross)}</span>
        <span className="text-[11px] text-white/30">{fmtPct(commPct)}</span>
      </div>
    )
  }

  const setterInitial = deal.setter?.name?.[0]?.toUpperCase() ?? 'S'
  const closerInitial = deal.closer?.name?.[0]?.toUpperCase() ?? 'C'

  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-bold text-white/30 w-[11px] h-[11px] rounded-full bg-white/10 flex items-center justify-center leading-none"
          style={{ fontSize: 8 }}>{setterInitial}</span>
        <span className="text-[12px] font-semibold text-teal/80">{fmt(setterAmt)}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-bold text-white/30 w-[11px] h-[11px] rounded-full bg-white/10 flex items-center justify-center leading-none"
          style={{ fontSize: 8 }}>{closerInitial}</span>
        <span className="text-[12px] font-semibold text-teal">{fmt(closerAmt)}</span>
      </div>
      <span className="text-[10px] text-white/20">{fmtPct(commPct)}</span>
    </div>
  )
}

export function StatusBadge({ status }) {
  const s = STATUS_STYLES[status]
  if (!s) return <span className="text-white/20 text-[11px]">—</span>
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium"
      style={{ color: s.color, border: `1px solid ${s.border}`, background: 'transparent' }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: s.dot }} />
      {status}
    </span>
  )
}

function StatusCell({ status, canEdit, dealId, onUpdate }) {
  if (!canEdit) return <StatusBadge status={status} />
  const s = STATUS_STYLES[status] ?? STATUS_STYLES['Deal Review']
  return (
    <div className="relative inline-block">
      <StatusBadge status={status} />
      <select
        value={status ?? ''}
        onChange={e => onUpdate(dealId, { status: e.target.value })}
        className="absolute inset-0 opacity-0 cursor-pointer w-full"
        title="Change status"
      >
        {STATUSES.map(st => (
          <option key={st} value={st}>{st}</option>
        ))}
      </select>
    </div>
  )
}

export default function DealTable({
  deals, profile,
  sortKey, sortDir, onSort,
  onEdit, onDelete, onUpdate, loading,
}) {
  const canEdit = ['admin', 'manager', 'director', 'vp'].includes(profile?.role)

  if (loading) return (
    <div className="rounded-xl p-16 text-center text-white/30 text-[13px]"
      style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
      Loading deals…
    </div>
  )

  if (!deals.length) return (
    <div className="rounded-xl p-16 text-center text-white/30 text-[13px]"
      style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
      No deals match your filters.
    </div>
  )

  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr style={{ background: '#00b894' }}>
              {COLS.map(col => (
                <th key={col.key}
                  onClick={() => onSort(col.key)}
                  className={`px-4 py-3 text-[11px] font-bold text-dark uppercase tracking-wider cursor-pointer select-none hover:bg-black/10 whitespace-nowrap ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  }`}>
                  <span className={`flex items-center ${col.align === 'right' ? 'justify-end' : ''}`}>
                    {col.label}
                    <SortIcon col={col.key} sortKey={sortKey} sortDir={sortDir} />
                  </span>
                </th>
              ))}
              {canEdit && (
                <th className="px-4 py-3 text-[11px] font-bold text-dark uppercase tracking-wider text-right w-20">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {deals.map((deal, i) => {
              const baseline = parseFloat(deal.baseline_revenue) || 0
              const jobPrice = parseFloat(deal.job_price)        || 0
              const isEven   = i % 2 === 0

              return (
                <tr key={deal.id}
                  style={{ background: isEven ? '#242424' : '#262626' }}
                  className="hover:bg-white/[0.03] transition-colors">
                  <td className="px-4 py-3 text-[13px] font-semibold text-white whitespace-nowrap">
                    {deal.deal_name}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-white/50 whitespace-nowrap">
                    {deal.office ?? '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <StatusCell status={deal.status} canEdit={canEdit} onUpdate={onUpdate} dealId={deal.id} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <DateCell value={deal.sale_date} field="sale_date" dealId={deal.id} canEdit={canEdit} onUpdate={onUpdate} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <DateCell value={deal.install_date} field="install_date" dealId={deal.id} canEdit={canEdit} onUpdate={onUpdate} />
                  </td>
                  <td className="px-4 py-3 text-[13px] text-white/70 whitespace-nowrap">
                    {deal.setter?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-white/70 whitespace-nowrap">
                    {deal.closer?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-white/60 text-right whitespace-nowrap">
                    {fmt(baseline)}
                  </td>
                  <td className="px-4 py-3 text-[13px] font-semibold text-white text-right whitespace-nowrap">
                    {fmt(jobPrice)}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <CommissionCell deal={deal} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <DateCell value={deal.pay_date} field="pay_date" dealId={deal.id} canEdit={canEdit} onUpdate={onUpdate} />
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1.5 justify-end">
                        <button onClick={() => onEdit(deal)}
                          className="p-1.5 rounded text-white/30 hover:text-teal hover:bg-teal/10 transition-colors">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => onDelete(deal.id)}
                          className="p-1.5 rounded text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
