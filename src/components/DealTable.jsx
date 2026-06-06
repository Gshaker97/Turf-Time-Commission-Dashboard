import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronUp, ChevronDown, ChevronsUpDown, Pencil, Trash2, Check } from 'lucide-react'
import { calcDealCommissions, fmt, fmtPct } from '../utils/commission'
import { payDateFromInstall } from '../utils/dateRanges'
import { useSettings } from '../contexts/SettingsContext'

// New-deal "is it clean?" checklist. Checked items are stored as an array of
// these keys in deals.checklist (jsonb).
const CHECKLIST_ITEMS = [
  { key: 'contract_signed',  label: 'Contract Signed' },
  { key: 'detailed_drawing', label: 'Detailed Drawing' },
  { key: 'payment_method',   label: 'Payment Method' },
  { key: 'scheduled',        label: 'Scheduled' },
  { key: 'no_issues',        label: 'No Issues' },
]

// Compact indicator (progress ring → green check) that opens an inline popover
// of checkboxes. Saves each toggle straight to the deal — no full edit needed.
function DealChecklist({ deal, canEdit, onUpdate }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos]   = useState({ top: 0, left: 0 })
  const btnRef = useRef(null)
  const popRef = useRef(null)

  const checked    = Array.isArray(deal.checklist) ? deal.checklist : []
  const checkedSet = new Set(checked)
  const total = CHECKLIST_ITEMS.length
  const done  = CHECKLIST_ITEMS.filter(i => checkedSet.has(i.key)).length
  const complete = done === total
  const pct = total ? done / total : 0
  const R = 9, C = 2 * Math.PI * R

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onScroll = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  const indicator = complete ? (
    <span className="w-[22px] h-[22px] rounded-full flex items-center justify-center flex-shrink-0" style={{ background: '#00b894' }}>
      <Check size={13} strokeWidth={3} className="text-dark" />
    </span>
  ) : (
    <span className="relative w-[22px] h-[22px] inline-flex items-center justify-center flex-shrink-0">
      <svg width="22" height="22" viewBox="0 0 22 22">
        <circle cx="11" cy="11" r={R} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2.5" />
        {done > 0 && (
          <circle cx="11" cy="11" r={R} fill="none" stroke="#2dd4bf" strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={(1 - pct) * C} transform="rotate(-90 11 11)" />
        )}
      </svg>
      {done > 0 && <span className="absolute text-[8px] font-bold text-white leading-none">{done}</span>}
    </span>
  )

  if (!canEdit) return <span title={`Checklist ${done}/${total}`} className="inline-flex">{indicator}</span>

  function openMenu() {
    if (!open) {
      const r = btnRef.current.getBoundingClientRect()
      const width = 236
      let left = r.left
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8)
      setPos({ top: r.bottom + 6, left })
    }
    setOpen(o => !o)
  }
  const toggle = (key) => onUpdate(deal.id, { checklist: checkedSet.has(key) ? checked.filter(k => k !== key) : [...checked, key] })
  const setAll = (all) => onUpdate(deal.id, { checklist: all ? CHECKLIST_ITEMS.map(i => i.key) : [] })

  return (
    <>
      <button ref={btnRef} type="button" onClick={openMenu}
        title={`New-deal checklist · ${done}/${total}`}
        className="flex-shrink-0 hover:opacity-80 transition-opacity">
        {indicator}
      </button>
      {open && createPortal(
        <div ref={popRef} className="fixed z-[60] w-[236px] rounded-xl shadow-2xl p-1.5"
          style={{ top: pos.top, left: pos.left, background: '#242424', border: '1px solid #3a3a3a' }}>
          <div className="px-2 py-1.5 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">New-deal checklist</span>
            <span className="text-[11px] font-semibold" style={{ color: complete ? '#00b894' : '#fff' }}>{done}/{total}</span>
          </div>
          <div className="h-1 rounded-full mx-2 mb-1.5 overflow-hidden" style={{ background: '#ffffff15' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${pct * 100}%`, background: complete ? '#00b894' : '#2dd4bf' }} />
          </div>
          {CHECKLIST_ITEMS.map(item => {
            const on = checkedSet.has(item.key)
            return (
              <button key={item.key} type="button" onClick={() => toggle(item.key)}
                className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left hover:bg-white/[0.04] transition-colors">
                <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                  style={on ? { background: '#00b894' } : { border: '1.5px solid rgba(255,255,255,0.3)' }}>
                  {on && <Check size={11} strokeWidth={3} className="text-dark" />}
                </span>
                <span className={`text-[12px] ${on ? 'text-white/45 line-through' : 'text-white/85'}`}>{item.label}</span>
              </button>
            )
          })}
          <div className="flex gap-1 px-1 pt-1 mt-1 border-t border-white/5">
            <button type="button" onClick={() => setAll(true)} className="flex-1 text-[11px] py-1.5 rounded-lg text-teal hover:bg-teal/10 transition-colors">Mark all</button>
            <button type="button" onClick={() => setAll(false)} className="flex-1 text-[11px] py-1.5 rounded-lg text-white/40 hover:bg-white/5 transition-colors">Clear</button>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

// Consolidated columns — related fields are stacked inside one cell so the
// whole table fits on screen without horizontal scrolling.
const COLS = [
  { key: 'deal_name',      label: 'Deal' },
  { key: 'office',         label: 'Office' },
  { key: 'payment_method', label: 'Payment' },
  { key: 'status',         label: 'Status' },
  { key: 'setter',         label: 'People',     sortAccessor: d => d.setter?.name ?? '' },
  { key: 'sale_date',      label: 'Dates' },
  { key: 'job_price',      label: 'Revenue',    align: 'right' },
  { key: 'commission',     label: 'Commission', align: 'right', sortAccessor: d => calcDealCommissions(d).repCommission },
]

function SortIcon({ col, sortKey, sortDir }) {
  if (sortKey !== col) return <ChevronsUpDown size={12} className="text-dark/40 ml-1 flex-shrink-0" />
  return sortDir === 'asc'
    ? <ChevronUp size={12} className="text-dark ml-1 flex-shrink-0" />
    : <ChevronDown size={12} className="text-dark ml-1 flex-shrink-0" />
}

function DateField({ label, value, field, dealId, canEdit, onUpdate, deriveExtra }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-white/30 text-[10px] uppercase tracking-wide w-8 flex-shrink-0">{label}</span>
      {canEdit ? (
        <input
          type="date"
          defaultValue={value ?? ''}
          onChange={e => {
            const v = e.target.value || null
            onUpdate(dealId, { [field]: v, ...(deriveExtra ? deriveExtra(v) : null) })
          }}
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
      <span className="text-white/80 whitespace-nowrap"><span className="text-white/30 text-[10px] uppercase mr-1.5">Set</span>{deal.setter?.name ?? '—'}</span>
      <span className="text-white/60 whitespace-nowrap"><span className="text-white/30 text-[10px] uppercase mr-1.5">Cls</span>{deal.closer?.name ?? '—'}</span>
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

// Red deduction amount that reveals its description on click.
function DeductionTag({ amount, note }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-[11px] font-bold text-red-400 hover:text-red-300 hover:underline"
        title="View deduction reason"
      >
        −{fmt(amount)}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-52 rounded-lg p-2.5 text-left shadow-xl"
            style={{ background: '#2a2a2a', border: '1px solid #3a3a3a' }}>
            <p className="text-[9px] font-bold uppercase tracking-wider text-red-400/80 mb-1">Deduction · {fmt(amount)}</p>
            <p className="text-[12px] text-white/80 leading-snug">{note || 'No description provided.'}</p>
          </div>
        </>
      )}
    </div>
  )
}

function CommissionCell({ deal }) {
  const { repCommission, commPct, setterAmt, closerAmt, deduction, job } = calcDealCommissions(deal)
  const split = deal.setter_id && deal.closer_id && deal.setter_id !== deal.closer_id
  // Rep commission only (setter + closer, net of deductions) — overrides go to
  // leadership and are tracked on the Payroll page, not in this column.
  const repPct = job > 0 ? repCommission / job : 0

  return (
    <div className="flex flex-col items-end gap-1 leading-tight">
      {!split ? (
        <div className="flex flex-col items-end">
          <span className="text-[13px] font-bold text-teal">{fmt(repCommission)}</span>
          <span className="text-[11px] text-white/30">{fmtPct(repPct)}</span>
        </div>
      ) : (
        <div className="flex flex-col items-end gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-white/30 w-[11px] h-[11px] rounded-full bg-white/10 flex items-center justify-center leading-none"
              style={{ fontSize: 8 }}>{deal.setter?.name?.[0]?.toUpperCase() ?? 'S'}</span>
            <span className="text-[12px] font-semibold text-teal/80">{fmt(setterAmt)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-white/30 w-[11px] h-[11px] rounded-full bg-white/10 flex items-center justify-center leading-none"
              style={{ fontSize: 8 }}>{deal.closer?.name?.[0]?.toUpperCase() ?? 'C'}</span>
            <span className="text-[12px] font-semibold text-teal">{fmt(closerAmt)}</span>
          </div>
          <span className="text-[10px] text-white/20">{fmtPct(repPct)}</span>
        </div>
      )}
      {deduction > 0 && <DeductionTag amount={deduction} note={deal.deduction_note} />}
    </div>
  )
}

export function StatusBadge({ status, color = '#94a3b8' }) {
  if (!status) return <span className="text-white/20 text-[11px]">—</span>
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap"
      style={{ color, border: `1px solid ${color}40`, background: 'transparent' }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
      {status}
    </span>
  )
}

// Office badge colors — drawn from the app's existing accent palette so they
// fit the rest of the UI. Phoenix = warm orange, Tucson = violet. Any other
// office falls back to the neutral slate used elsewhere for unset badges.
const OFFICE_COLORS = {
  Phoenix: '#fb923c',
  Tucson:  '#a78bfa',
}
const officeColor = (name) => OFFICE_COLORS[name] || '#94a3b8'

// Inline-editable cell backed by a settings list (office, payment method).
// An invisible <select> overlay handles the edit. Uncontrolled (defaultValue +
// key) so the native control keeps the picked value and the write fires
// reliably on change — mirroring the DateField pattern. The visible value is
// driven by the `value` prop, which refreshes after the row reloads. Pass
// `colorFor` to render the value as a colored badge instead of plain text.
function InlineSelectCell({ value, options, field, canEdit, dealId, onUpdate, colorFor }) {
  const display = colorFor
    ? (value
        ? <StatusBadge status={value} color={colorFor(value)} />
        : <span className="text-[12px] text-white/30">—</span>)
    : <span className={`text-[12px] whitespace-nowrap transition-colors ${
        value ? 'text-white/70' : 'text-white/30'
      } ${canEdit ? 'hover:text-white cursor-pointer' : ''}`}>
        {value || '—'}
      </span>

  if (!canEdit) return display

  return (
    <div className="relative inline-block cursor-pointer">
      {display}
      <select
        key={value ?? ''}
        defaultValue={value ?? ''}
        onChange={e => onUpdate(dealId, { [field]: e.target.value || null })}
        className="absolute inset-0 opacity-0 cursor-pointer w-full"
        title="Click to edit"
      >
        <option value="">—</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

function StatusCell({ status, color, options, canEdit, dealId, onUpdate }) {
  if (!canEdit) return <StatusBadge status={status} color={color} />
  return (
    <div className="relative inline-block">
      <StatusBadge status={status} color={color} />
      <select
        value={status ?? ''}
        onChange={e => onUpdate(dealId, { status: e.target.value })}
        className="absolute inset-0 opacity-0 cursor-pointer w-full"
        title="Change status"
      >
        {options.map(st => <option key={st} value={st}>{st}</option>)}
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

const subline = (deal) => [deal.office, deal.payment_method].filter(Boolean).join(' · ') || '—'

// ── Mobile card (below lg) ────────────────────────────────────
function DealCard({ deal, canEdit, onEdit, onDelete, onUpdate, statusColor, statusLabels }) {
  const baseline = parseFloat(deal.baseline_revenue) || 0
  const jobPrice = parseFloat(deal.job_price)        || 0
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[14px] font-semibold text-white truncate">{deal.deal_name}</p>
            <DealChecklist deal={deal} canEdit={canEdit} onUpdate={onUpdate} />
          </div>
          <p className="text-[11px] text-white/40 truncate">{subline(deal)}</p>
        </div>
        <StatusCell status={deal.status} color={statusColor(deal.status)} options={statusLabels}
          canEdit={canEdit} onUpdate={onUpdate} dealId={deal.id} />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3">
        <PeopleCell deal={deal} />
        <div className="flex flex-col items-end justify-center">
          <RevenueCell baseline={baseline} jobPrice={jobPrice} />
        </div>
        <div className="flex flex-col gap-0.5">
          <DateField label="Sale" value={deal.sale_date}    field="sale_date"    dealId={deal.id} canEdit={canEdit} onUpdate={onUpdate} />
          <DateField label="Inst" value={deal.install_date} field="install_date" dealId={deal.id} canEdit={canEdit} onUpdate={onUpdate}
            deriveExtra={v => v ? { pay_date: payDateFromInstall(v) } : null} />
          <DateField key={`pay-${deal.pay_date ?? ''}`} label="Pay" value={deal.pay_date} field="pay_date" dealId={deal.id} canEdit={canEdit} onUpdate={onUpdate} />
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
  const { statusColor, statusLabels, offices, paymentMethods } = useSettings()
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

      {/* Desktop table (lg+) — auto layout: each column sizes to its content,
          a trailing spacer column soaks up any leftover width on the right. */}
      <table className="w-full hidden lg:table">
        <thead>
          <tr style={{ background: '#00b894' }}>
            {COLS.map(col => (
              <th key={col.key}
                onClick={() => onSort(col.key)}
                className={`px-3 py-3 text-[11px] font-bold text-dark uppercase tracking-wider cursor-pointer select-none whitespace-nowrap hover:bg-black/10 ${
                  col.align === 'right' ? 'text-right' : 'text-left'
                }`}>
                <span className={`flex items-center ${col.align === 'right' ? 'justify-end' : ''}`}>
                  {col.label}
                  <SortIcon col={col.key} sortKey={sortKey} sortDir={sortDir} />
                </span>
              </th>
            ))}
            {canEdit && (
              <th className="px-3 py-3 text-[11px] font-bold text-dark uppercase tracking-wider text-right whitespace-nowrap">
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
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-semibold text-white truncate max-w-[230px]">{deal.deal_name}</p>
                    <DealChecklist deal={deal} canEdit={canEdit} onUpdate={onUpdate} />
                  </div>
                  {deal.project_id && <p className="text-[11px] text-white/40 truncate max-w-[260px]">{deal.project_id}</p>}
                </td>
                <td className="px-3 py-3">
                  <InlineSelectCell value={deal.office} options={offices} colorFor={officeColor}
                    field="office" canEdit={canEdit} dealId={deal.id} onUpdate={onUpdate} />
                </td>
                <td className="px-3 py-3">
                  <InlineSelectCell value={deal.payment_method} options={paymentMethods}
                    field="payment_method" canEdit={canEdit} dealId={deal.id} onUpdate={onUpdate} />
                </td>
                <td className="px-3 py-3">
                  <StatusCell status={deal.status} color={statusColor(deal.status)} options={statusLabels}
                    canEdit={canEdit} onUpdate={onUpdate} dealId={deal.id} />
                </td>
                <td className="px-3 py-3"><PeopleCell deal={deal} /></td>
                <td className="px-3 py-3">
                  <div className="flex flex-col gap-0.5">
                    <DateField label="Sale" value={deal.sale_date}    field="sale_date"    dealId={deal.id} canEdit={canEdit} onUpdate={onUpdate} />
                    <DateField label="Inst" value={deal.install_date} field="install_date" dealId={deal.id} canEdit={canEdit} onUpdate={onUpdate}
                      deriveExtra={v => v ? { pay_date: payDateFromInstall(v) } : null} />
                    <DateField key={`pay-${deal.pay_date ?? ''}`} label="Pay" value={deal.pay_date} field="pay_date" dealId={deal.id} canEdit={canEdit} onUpdate={onUpdate} />
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
            onEdit={onEdit} onDelete={onDelete} onUpdate={onUpdate}
            statusColor={statusColor} statusLabels={statusLabels} />
        ))}
      </div>
    </div>
  )
}
