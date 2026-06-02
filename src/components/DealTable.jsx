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

// Consolidated columns — related fields are stacked inside one cell so the
// whole table fits on screen without horizontal scrolling.
const COLS = [
  { key: 'deal_name',  label: 'Deal' },
  { key: 'status',     label: 'Status' },
  { key: 'setter',     label: 'People',     sortAccessor: d => d.setter?.name ?? '' },
  { key: 'sale_date',  label: 'Dates' },
  { key: 'job_price',  label: 'Revenue',    align: 'right' },
  { key: 'commission', label: 'Commission', align: 'right', sortAccessor: d => calcDealCommissions(d).gross },
]

function SortIcon({ col, sortKey, sortDir }) {
  if (sortKey !== col) return <ChevronsUpDown size={12} className="text-dark/40 ml-1 flex-shrink-0" />
  return sortDir === 'asc'
    ? <ChevronUp size={12} className="text-dark ml-1 flex-shrink-0" />
    : <ChevronDown size={12} className="text-dark ml-1 flex-shrink-0" />
}

// Compact inline date control with a leading label.
function DateField({ label, value, field, dealId, canEdit, onUpdate }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-white/30 text-[10px] uppercase tracking-wide w-8 flex-shrink-0">{label}</span>
      {canEdit ? (
        <input
          type="date"
          defaultValue={value ?? ''}
          onChange={e => onUpdate(dealId, { [field]: e.target.value || null })}
          className="bg-transparent text-white/55 text-[12px] border-0 outline-none cursor-pointer hover:text-white focus:text-white transition-colors w-[104px]"
          style={{ colorScheme: 'dark' }}
        />
      ) : (
        <span className="text-white/55 text-[12px]">{value ?? '—'}</span>
      )}
    </div>
  )
}

function PeopleCell({ deal }) {
  return (
    <div className="flex flex-col gap-0.5 text-[12px]">
      <span className="text-white/80"><span className="text-white/30 text-[10px] uppercase mr-1.5">Set</span>{deal.setter?.name ?? '—'}</span>
      <span className="text-white/60"><span className="text-white/30 text-[10px] uppercase mr-1.5">Cls</span>{deal.closer?.name ?? '—'}</span>
    </div>
  )
}

function RevenueCell({ baseline, jobPrice }) {
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="text-[13px] font-semibold text-white">{fmt(jobPrice)}</span>
      <span className="text-[11px] text-white/40">base {fmt(baseline)}</span>
    </div>
  )
}

function CommissionCell({ deal }) {
  const { gross, commPct, setterAmt, closerAmt } = calcDealCommissions(deal)
  const split = deal.setter_id && deal.closer_id && deal.setter_id !== deal.closer_id

  if (!split) {
    return (
      <div className="flex flex-col items-end leading-tight">
        <span className="text-[13px] font-bold text-teal">{fmt(gross)}</span>
        <span className="text-[11px] text-white/30">{fmtPct(commPct)}</span>
      </div>
    )
  }

  const setterInitial = deal.setter?.name?.[0]?.toUpperCase() ?? 'S'
  const closerInitial = deal.closer?.name?.[0]?.toUpperCase() ?? 'C'

  return (
    <div className="flex flex-col items-end gap-0.5 leading-tight">
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
      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap"
      style={{ color: s.color, border: `1px solid ${s.border}`, background: 'transparent' }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: s.dot }} />
      {status}
    </span>
  )
}

function StatusCell({ status, canEdit, dealId, onUpdate }) {
  if (!canEdit) return <StatusBadge status={status} />
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

function ActionButtons({ deal, onEdit, onDelete }) {
  return (
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
  )
}

// ── Mobile card (below lg) ────────────────────────────────────
function DealCard({ deal, canEdit, onEdit, onDelete, onUpdate }) {
  const baseline = parseFloat(deal.baseline_revenue) || 0
  const jobPrice = parseFloat(deal.job_price)        || 0
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-white truncate">{deal.deal_name}</p>
          <p className="text-[11px] text-white/40">{deal.office ?? '—'}</p>
        </div>
        <StatusCell status={deal.status} canEdit={canEdit} onUpdate={onUpdate} dealId={deal.id} />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3">
        <PeopleCell deal={deal} />
        <div className="flex flex-col items-end justify-center">
          <RevenueCell baseline={baseline} jobPrice={jobPrice} />
        </div>
        <div className="flex flex-col gap-0.5">
          <DateField label="Sale"    value={deal.sale_date}    field="sale_date"    dealId={deal.id} canEdit={canEdit} onUpdate={onUpdate} />
          <DateField label="Inst"    value={deal.install_date} field="install_date" dealId={deal.id} canEdit={canEdit} onUpdate={onUpdate} />
          <DateField label="Pay"     value={deal.pay_date}     field="pay_date"     dealId={deal.id} canEdit={canEdit} onUpdate={onUpdate} />
        </div>
        <div className="flex items-end justify-end">
          <CommissionCell deal={deal} />
        </div>
      </div>

      {canEdit && (
        <div className="mt-3 pt-3 border-t border-white/5">
          <ActionButtons deal={deal} onEdit={onEdit} onDelete={onDelete} />
        </div>
      )}
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

      {/* Desktop table (lg+) — consolidated columns fit without scrolling */}
      <table className="w-full hidden lg:table table-fixed">
        <colgroup>
          <col /><col className="w-[150px]" /><col className="w-[150px]" />
          <col className="w-[160px]" /><col className="w-[120px]" /><col className="w-[130px]" />
          {canEdit && <col className="w-[80px]" />}
        </colgroup>
        <thead>
          <tr style={{ background: '#00b894' }}>
            {COLS.map(col => (
              <th key={col.key}
                onClick={() => onSort(col.key)}
                className={`px-3 py-3 text-[11px] font-bold text-dark uppercase tracking-wider cursor-pointer select-none hover:bg-black/10 ${
                  col.align === 'right' ? 'text-right' : 'text-left'
                }`}>
                <span className={`flex items-center ${col.align === 'right' ? 'justify-end' : ''}`}>
                  {col.label}
                  <SortIcon col={col.key} sortKey={sortKey} sortDir={sortDir} />
                </span>
              </th>
            ))}
            {canEdit && (
              <th className="px-3 py-3 text-[11px] font-bold text-dark uppercase tracking-wider text-right">
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
                className="hover:bg-white/[0.03] transition-colors align-top">
                <td className="px-3 py-3">
                  <p className="text-[13px] font-semibold text-white truncate">{deal.deal_name}</p>
                  <p className="text-[11px] text-white/40 truncate">{deal.office ?? '—'}</p>
                </td>
                <td className="px-3 py-3">
                  <StatusCell status={deal.status} canEdit={canEdit} onUpdate={onUpdate} dealId={deal.id} />
                </td>
                <td className="px-3 py-3"><PeopleCell deal={deal} /></td>
                <td className="px-3 py-3">
                  <div className="flex flex-col gap-0.5">
                    <DateField label="Sale" value={deal.sale_date}    field="sale_date"    dealId={deal.id} canEdit={canEdit} onUpdate={onUpdate} />
                    <DateField label="Inst" value={deal.install_date} field="install_date" dealId={deal.id} canEdit={canEdit} onUpdate={onUpdate} />
                    <DateField label="Pay"  value={deal.pay_date}     field="pay_date"     dealId={deal.id} canEdit={canEdit} onUpdate={onUpdate} />
                  </div>
                </td>
                <td className="px-3 py-3"><RevenueCell baseline={baseline} jobPrice={jobPrice} /></td>
                <td className="px-3 py-3"><CommissionCell deal={deal} /></td>
                {canEdit && (
                  <td className="px-3 py-3"><ActionButtons deal={deal} onEdit={onEdit} onDelete={onDelete} /></td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Mobile / tablet cards (below lg) */}
      <div className="lg:hidden divide-y divide-white/5">
        {deals.map(deal => (
          <DealCard key={deal.id} deal={deal} canEdit={canEdit}
            onEdit={onEdit} onDelete={onDelete} onUpdate={onUpdate} />
        ))}
      </div>
    </div>
  )
}
