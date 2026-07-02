import { useState, useRef, useEffect, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { ChevronUp, ChevronDown, ChevronsUpDown, Pencil, Trash2, Check, X, MessageSquare, BadgeCheck } from 'lucide-react'
import { calcDealCommissions, fmt, fmtPct, isCanceled, officeOverrideRate } from '../utils/commission'
import { payDateFromInstall } from '../utils/dateRanges'
import { useSettings } from '../contexts/SettingsContext'
import { fetchDealNotes, fetchDealNoteCounts, addDealNote, updateDealNote, deleteDealNote } from '../lib/db'
import DateRangeFilter from './DateRangeFilter'

// Date columns the Dates header can filter on.
export const DATE_FIELDS = [
  { value: 'sale_date',    label: 'Closing date' },
  { value: 'install_date', label: 'Install date' },
  { value: 'pay_date',     label: 'Pay date' },
]

// A deal sits in the "Needs review" staging area until its commission gets the
// gold check (commission_verified) — so UNchecking a deal (manually, or via a
// change order) always sends it back to review, even if it was already Paid.
// Canceled deals are never in review. Legacy deals (sale_date before the
// data-start cutoff) predate our atomized data and are intentionally left out
// of staging — they're "it is what it is" until they reach payout.
export const dealNeedsReview = (deal, dataStartDate) =>
  !isCanceled(deal) && deal.commission_verified !== true &&
  !(dataStartDate && deal.sale_date && deal.sale_date < dataStartDate)

// Changing a deal's office anywhere re-applies the office-driven Director/VP
// rate (Tucson 3.75%, else 5%) and clears stored sheet amounts so the engine
// recomputes from current numbers — same behavior as the edit modal. Without
// this, an old imported deal kept its uploaded amounts no matter what changed.
export const officeChangePatch = (deal, office) => {
  // Era-aware: the rate comes from the admin schedule for THIS deal's sale
  // date, so re-officing an old deal applies the rate in force back then.
  const rate = officeOverrideRate({ office, sale_date: deal.sale_date })
  return {
    ...(deal.director_id ? { director_override_pct: rate } : null),
    ...(deal.vp_id       ? { vp_override_pct: rate }       : null),
    setter_amount: null, closer_amount: null,
    manager_amount: null, director_amount: null, vp_amount: null,
  }
}

// Red ✕ next to the name of a canceled deal (pairs with the dimmed row).
function CanceledMark() {
  return (
    <span className="w-[22px] h-[22px] rounded-full flex items-center justify-center flex-shrink-0"
      style={{ background: '#ef444418', border: '1px solid #ef444455' }} title="Canceled">
      <X size={13} strokeWidth={3} className="text-red-400" />
    </span>
  )
}



// Consolidated columns — related fields are stacked inside one cell so the
// whole table fits on screen without horizontal scrolling.
const COLS = [
  { key: 'deal_name',      label: 'Deal' },
  { key: 'office',         label: 'Office',     filter: 'office' },
  { key: 'payment_method', label: 'Payment',    filter: 'payment' },
  { key: 'status',         label: 'Status',     filter: 'status' },
  { key: 'setter',         label: 'People',     filter: 'rep',  sortAccessor: d => d.setter?.name ?? '' },
  { key: 'sale_date',      label: 'Dates',      filter: 'date', menuWidth: 300 },
  { key: 'job_price',      label: 'Revenue',    align: 'right' },
  { key: 'commission',     label: 'Commission', align: 'right', sortAccessor: d => calcDealCommissions(d).repCommission },
]

function SortIcon({ col, sortKey, sortDir }) {
  if (sortKey !== col) return <ChevronsUpDown size={12} className="text-dark/40 ml-1 flex-shrink-0" />
  return sortDir === 'asc'
    ? <ChevronUp size={12} className="text-dark ml-1 flex-shrink-0" />
    : <ChevronDown size={12} className="text-dark ml-1 flex-shrink-0" />
}

// ── Column-header menu ────────────────────────────────────────
// A clickable header that opens a dark popover with Sort (asc/desc) and, when
// the column declares one, an inline filter (status / office / payment / rep /
// date). Replaces the separate top filter bar on the desktop table — click a
// header to decide how to slice that column.
function HeaderMenu({ col, sortKey, sortDir, onSort, active, renderFilter }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos]   = useState({ top: 0, left: 0 })
  const btnRef = useRef(null)
  const popRef = useRef(null)
  const width  = col.menuWidth || 224

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return
      setOpen(false)
    }
    // Close on page scroll/resize (the popover is fixed-positioned), but ignore
    // scrolling inside the popover itself — e.g. a long, scrollable rep list.
    const onScroll = (e) => { if (!popRef.current?.contains(e.target)) setOpen(false) }
    const onResize = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  function openMenu() {
    if (!open) {
      const r = btnRef.current.getBoundingClientRect()
      let left = col.align === 'right' ? r.right - width : r.left
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8)
      if (left < 8) left = 8
      setPos({ top: r.bottom + 4, left })
    }
    setOpen(o => !o)
  }

  const sortBtn = (dir, label) => {
    const on = sortKey === col.key && sortDir === dir
    return (
      <button type="button" onClick={() => onSort(col.key, dir)}
        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-white/[0.04] transition-colors">
        <span className="flex items-center gap-1.5 text-[12px]" style={{ color: on ? '#2dd4bf' : 'rgba(255,255,255,0.8)' }}>
          {dir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {label}
        </span>
        {on && <Check size={12} className="text-teal" />}
      </button>
    )
  }

  return (
    <>
      <button ref={btnRef} type="button" onClick={openMenu}
        className={`flex items-center hover:opacity-80 transition-opacity ${col.align === 'right' ? 'justify-end w-full' : ''}`}>
        {col.label}
        <SortIcon col={col.key} sortKey={sortKey} sortDir={sortDir} />
        {active && <span className="w-1.5 h-1.5 rounded-full bg-dark ml-1 flex-shrink-0" />}
      </button>
      {open && createPortal(
        <div ref={popRef} className="fixed z-[60] rounded-xl shadow-2xl p-1.5"
          style={{ top: pos.top, left: pos.left, width, background: '#242424', border: '1px solid #3a3a3a' }}>
          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white/40">Sort</div>
          {sortBtn('asc',  'Ascending')}
          {sortBtn('desc', 'Descending')}
          {renderFilter && (
            <>
              <div className="border-t border-white/5 my-1" />
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white/40">Filter</div>
              {renderFilter()}
            </>
          )}
        </div>,
        document.body
      )}
    </>
  )
}

// One selectable row inside a filter popover.
function FilterRow({ label, active, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-white/[0.04] transition-colors">
      <span className="text-[12px] truncate" style={{ color: active ? '#2dd4bf' : 'rgba(255,255,255,0.85)' }}>{label}</span>
      {active && <Check size={12} className="text-teal flex-shrink-0" />}
    </button>
  )
}

// Single-select option list. `options` is an array of strings or {value,label}.
function OptionFilter({ value, options, onChange, allLabel = 'All' }) {
  const norm = options.map(o => (typeof o === 'string' ? { value: o, label: o } : o))
  return (
    <div className="max-h-60 overflow-auto">
      <FilterRow label={allLabel} active={!value} onClick={() => onChange('')} />
      {norm.map(o => (
        <FilterRow key={o.value} label={o.label} active={value === o.value}
          onClick={() => onChange(value === o.value ? '' : o.value)} />
      ))}
    </div>
  )
}

// Dates filter: pick which date column the range applies to, then a range.
function DateFilterPanel({ dateField, setDateField, dateFrom, dateTo, datePreset, setDateRange }) {
  return (
    <div className="px-1 pb-1 space-y-2">
      <div className="relative">
        <select value={dateField} onChange={e => setDateField(e.target.value)}
          style={{ background: '#1e1e1e', border: '1px solid #333' }}
          className="h-8 w-full rounded-lg text-[12px] text-white px-2 pr-7 focus:outline-none focus:border-teal/50">
          {DATE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
      </div>
      <DateRangeFilter from={dateFrom} to={dateTo} preset={datePreset}
        onChange={({ from, to, preset }) => setDateRange(from, to, preset)} />
    </div>
  )
}

function DateField({ label, value, field, dealId, canEdit, onUpdate, deriveExtra, flagMissing }) {
  // flagMissing → an empty date for a field we expect (install / pay) is shown
  // amber so it's obvious it still needs filling in.
  const missing = flagMissing && !value
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-[10px] uppercase tracking-wide w-8 flex-shrink-0 ${missing ? 'text-amber-400' : 'text-white/30'}`}>{label}</span>
      {canEdit ? (
        <span className="flex items-center gap-0.5">
          <input
            key={value ?? 'empty'}
            type="date"
            defaultValue={value ?? ''}
            onChange={e => {
              const v = e.target.value || null
              onUpdate(dealId, { [field]: v, ...(deriveExtra ? deriveExtra(v) : null) })
            }}
            className={`text-[12px] border-0 outline-none cursor-pointer hover:text-white focus:text-white transition-colors w-[104px] rounded ${missing ? 'text-amber-400' : 'bg-transparent text-white/55'}`}
            style={missing ? { colorScheme: 'dark', background: '#f59e0b18' } : { colorScheme: 'dark' }}
          />
          {value && (
            <button type="button" title={`Clear ${label.toLowerCase()} date`}
              onClick={() => onUpdate(dealId, { [field]: null, ...(deriveExtra ? deriveExtra(null) : null) })}
              className="text-white/25 hover:text-red-400 transition-colors leading-none px-0.5">×</button>
          )}
        </span>
      ) : (
        <span className={`text-[12px] ${missing ? 'text-amber-400' : 'text-white/55'}`}>{value ?? '— missing'}</span>
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

// Leadership sign-off seal next to the commission. Distinct from the name's
// progress ring: a BadgeCheck that lights up green once the commission is
// confirmed. Toggleable by VP/admin; read-only (shown only if verified) to others.
function VerifySeal({ verified, canVerify, onToggle }) {
  if (!verified && !canVerify) return null
  if (!canVerify) return <BadgeCheck size={15} className="flex-shrink-0" style={{ color: '#fbbf24' }} title="Commission checked" />
  return (
    <button type="button" onClick={onToggle} className="flex-shrink-0 hover:opacity-80 transition-opacity"
      title={verified ? 'Commission checked — click to unmark' : 'Mark commission as checked'}>
      <BadgeCheck size={16} className={verified ? '' : 'text-white/20 hover:text-white/50'} style={verified ? { color: '#fbbf24' } : undefined} />
    </button>
  )
}

function CommissionCell({ deal, canVerify, onUpdate }) {
  const { repCommission, setterAmt, closerAmt, deduction, baseline } = calcDealCommissions(deal)
  const split = deal.setter_id && deal.closer_id && deal.setter_id !== deal.closer_id
  // Rep commission only (setter + closer, net of deductions) — overrides go to
  // leadership and are tracked on the Payroll page, not in this column. The % is
  // the rep commission as a share of the deal's BASELINE.
  const repPct = baseline > 0 ? repCommission / baseline : 0

  return (
    <div className="flex items-center justify-end gap-2">
      <VerifySeal verified={deal.commission_verified === true} canVerify={canVerify}
        onToggle={() => onUpdate?.(deal.id, { commission_verified: !deal.commission_verified })} />
      <div className="flex flex-col items-end gap-1 leading-tight">
      {!split ? (
        <div className="flex flex-col items-end">
          <span className={`text-[13px] font-bold ${repCommission < 0 ? 'text-red-400' : 'text-teal'}`}>{fmt(repCommission)}</span>
          <span className="text-[11px] text-white/30">{fmtPct(repPct)}</span>
        </div>
      ) : (
        <div className="flex flex-col items-end gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-white/30 w-[11px] h-[11px] rounded-full bg-white/10 flex items-center justify-center leading-none"
              style={{ fontSize: 8 }}>{deal.setter?.name?.[0]?.toUpperCase() ?? 'S'}</span>
            <span className={`text-[12px] font-semibold ${setterAmt < 0 ? 'text-red-400' : 'text-teal/80'}`}>{fmt(setterAmt)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-white/30 w-[11px] h-[11px] rounded-full bg-white/10 flex items-center justify-center leading-none"
              style={{ fontSize: 8 }}>{deal.closer?.name?.[0]?.toUpperCase() ?? 'C'}</span>
            <span className={`text-[12px] font-semibold ${closerAmt < 0 ? 'text-red-400' : 'text-teal'}`}>{fmt(closerAmt)}</span>
          </div>
          <span className="text-[10px] text-white/20">{fmtPct(repPct)}</span>
        </div>
      )}
      {deduction > 0 && <DeductionTag amount={deduction} note={deal.deduction_note} />}
      </div>
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
function InlineSelectCell({ value, options, field, canEdit, dealId, onUpdate, colorFor, deriveExtra, missingLabel }) {
  // An empty value is flagged amber so a missing office/payment is obvious.
  const display = colorFor
    ? (value
        ? <StatusBadge status={value} color={colorFor(value)} />
        : <span className="text-[12px] text-white/30">—</span>)
    : value
      ? <span className={`text-[12px] whitespace-nowrap transition-colors text-white/70 ${canEdit ? 'hover:text-white cursor-pointer' : ''}`}>{value}</span>
      : <span className="text-[12px] whitespace-nowrap font-semibold px-1.5 py-0.5 rounded"
          style={{ color: '#f59e0b', background: '#f59e0b18', border: '1px dashed #f59e0b66' }}>
          + {missingLabel || 'set'}
        </span>

  if (!canEdit) return display

  return (
    <div className="relative inline-block cursor-pointer">
      {display}
      <select
        key={value ?? ''}
        defaultValue={value ?? ''}
        onChange={e => { const v = e.target.value || null; onUpdate(dealId, { [field]: v, ...(deriveExtra ? deriveExtra(v) : null) }) }}
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

// Threaded per-deal notes: anyone on the deal can read and reply; every post
// notifies the deal's CLOSER + admins (minus the author) via the bell —
// setters/managers can read but aren't pinged. The old single deals.notes
// text shows as a legacy first entry so nothing is lost.
function NotesThread({ deal, profile, users, onCountChange }) {
  const [notes, setNotes]   = useState(null)   // null = loading
  const [draft, setDraft]   = useState('')
  const [posting, setPosting] = useState(false)
  const [editId, setEditId]   = useState(null) // note being edited
  const [editText, setEditText] = useState('')
  const [showLog, setShowLog] = useState(null) // note whose edit history is open
  const isAdmin = profile?.role === 'admin' || profile?.is_admin === true

  const reload = async () => {
    const { data } = await fetchDealNotes(deal.id)
    setNotes(data || [])
    onCountChange?.(deal.id, (data || []).length)
  }
  useEffect(() => {
    let on = true
    fetchDealNotes(deal.id).then(({ data }) => { if (on) setNotes(data || []) })
    return () => { on = false }
  }, [deal.id])

  async function saveEdit(id) {
    const body = editText.trim()
    if (!body) return
    const { error } = await updateDealNote(id, body)
    if (error) { alert('Could not save edit: ' + (error.message || '')); return }
    setEditId(null); setEditText(''); reload()
  }
  async function removeNote(id) {
    if (!confirm('Delete this comment? This cannot be undone.')) return
    const { error } = await deleteDealNote(id)
    if (error) { alert('Could not delete: ' + (error.message || '')); return }
    reload()
  }

  const fmtWhen = (iso) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' +
           d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  async function post() {
    const body = draft.trim()
    if (!body || !profile?.id) return
    setPosting(true)
    // Notify the CLOSER + admins only (minus the author). Setters/managers can
    // read the thread but don't get pinged — per Keaton's call.
    const admins = (users || []).filter(u => u.role === 'admin' || u.is_admin === true).map(u => u.id)
    const recipientIds = [deal.closer_id, ...admins]
    const { error } = await addDealNote({
      dealId: deal.id, dealName: deal.deal_name, body,
      author: { id: profile.id, name: profile.name },
      recipientIds,
    })
    setPosting(false)
    if (error) { alert('Could not post: ' + (error.message || '')); return }
    setDraft('')
    reload()
  }

  return (
    <div className="space-y-2">
      {/* Legacy single-note text, if this deal has one */}
      {deal.notes && (
        <div className="rounded-lg px-3 py-2" style={{ background: '#171717', border: '1px dashed #2e2e2e' }}>
          <p className="text-[10px] uppercase tracking-wide text-white/25 mb-0.5">Original note</p>
          <p className="text-[12px] text-white/60 whitespace-pre-wrap">{deal.notes}</p>
        </div>
      )}

      {notes === null ? (
        <p className="text-[12px] text-white/30 py-1">Loading…</p>
      ) : notes.length === 0 && !deal.notes ? (
        <p className="text-[12px] text-white/30 italic py-1">No notes yet — start the thread below.</p>
      ) : (
        notes.map(n => {
          const mine = n.author_id === profile?.id
          const editCount = (n.edits || []).length
          return (
            <div key={n.id} className="rounded-lg px-3 py-2"
              style={{ background: mine ? '#0e3b3555' : '#171717', border: `1px solid ${mine ? '#1c5a50' : '#2a2a2a'}` }}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-[11px] mb-0.5">
                  <span className="font-semibold" style={{ color: mine ? '#2dd4bf' : 'rgba(255,255,255,0.75)' }}>
                    {n.author?.name || users?.find(u => u.id === n.author_id)?.name || '—'}
                  </span>
                  <span className="text-white/25"> · {fmtWhen(n.created_at)}</span>
                  {editCount > 0 && (
                    <button onClick={() => setShowLog(showLog === n.id ? null : n.id)}
                      className="text-white/30 hover:text-white/60 italic ml-1">
                      · edited{editCount > 1 ? ` ×${editCount}` : ''}
                    </button>
                  )}
                </p>
                {editId !== n.id && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {mine && (
                      <button onClick={() => { setEditId(n.id); setEditText(n.body) }} title="Edit"
                        className="p-1 rounded text-white/25 hover:text-teal hover:bg-teal/10 transition-colors"><Pencil size={12} /></button>
                    )}
                    {isAdmin && (
                      <button onClick={() => removeNote(n.id)} title="Delete (admin)"
                        className="p-1 rounded text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 size={12} /></button>
                    )}
                  </div>
                )}
              </div>

              {editId === n.id ? (
                <div className="space-y-1.5 mt-1">
                  <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={2}
                    className="w-full px-2.5 py-1.5 rounded-lg text-[12px] text-white focus:outline-none resize-y"
                    style={{ background: '#0f0f0f', border: '1px solid #2a2a2a' }} />
                  <div className="flex items-center gap-2">
                    <button onClick={() => saveEdit(n.id)} disabled={!editText.trim() || editText.trim() === n.body}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-dark bg-teal disabled:opacity-40 transition-colors">Save</button>
                    <button onClick={() => { setEditId(null); setEditText('') }}
                      className="text-[11px] text-white/40 hover:text-white">Cancel</button>
                  </div>
                </div>
              ) : (
                <p className="text-[12px] text-white/80 whitespace-pre-wrap">{n.body}</p>
              )}

              {showLog === n.id && editCount > 0 && (
                <div className="mt-2 pt-2 border-t border-white/5 space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-white/25">Edit history</p>
                  {(n.edits || []).slice().reverse().map((e, i) => (
                    <p key={i} className="text-[11px] text-white/40">
                      <span className="text-white/25">{fmtWhen(e.at)} — previously:</span> <span className="line-through">{e.body}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          )
        })
      )}

      <div className="flex items-end gap-2 pt-1">
        <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2}
          placeholder="Write a reply… (everyone on this deal gets notified)"
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post() }}
          className="flex-1 px-3 py-2 rounded-lg text-[12px] text-white placeholder-white/20 focus:outline-none resize-y"
          style={{ background: '#171717', border: '1px solid #2a2a2a' }} />
        <button onClick={post} disabled={posting || !draft.trim()}
          className="px-3 py-2 rounded-lg text-[11px] font-bold text-dark bg-teal disabled:opacity-40 transition-colors flex-shrink-0">
          {posting ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  )
}

const subline = (deal) => [deal.office, deal.payment_method].filter(Boolean).join(' · ') || '—'

// ── Mobile card (below lg) ────────────────────────────────────
function DealCard({ deal, canEdit, canVerify, onEdit, onDelete, onUpdate, statusColor, statusLabels, profile, users, noteCount, onCountChange }) {
  const baseline = parseFloat(deal.baseline_revenue) || 0
  const jobPrice = parseFloat(deal.job_price)        || 0
  const [showNotes, setShowNotes] = useState(false)
  return (
    <div className={`p-4 ${isCanceled(deal) ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <button onClick={() => setShowNotes(s => !s)} className="text-[14px] font-semibold text-white truncate text-left">{deal.deal_name}</button>
            {(deal.notes || noteCount > 0) && (
              <span className="flex items-center gap-0.5 text-teal/70 flex-shrink-0">
                <MessageSquare size={12} />
                {noteCount > 0 && <span className="text-[10px] font-semibold">{noteCount}</span>}
              </span>
            )}
            {isCanceled(deal) && <CanceledMark />}
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
          <DateField label="Inst" value={deal.install_date} field="install_date" dealId={deal.id} canEdit={canEdit} onUpdate={onUpdate} flagMissing
            deriveExtra={v => ({ pay_date: v ? payDateFromInstall(v) : null })} />
          <DateField key={`pay-${deal.pay_date ?? ''}`} label="Pay" value={deal.pay_date} field="pay_date" dealId={deal.id} canEdit={canEdit} onUpdate={onUpdate} flagMissing />
        </div>
        <div className="flex items-end justify-end">
          <CommissionCell deal={deal} canVerify={canVerify} onUpdate={onUpdate} />
        </div>
      </div>

      {showNotes && (
        <div className="mt-3 rounded-lg p-3" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
          <p className="text-[10px] font-bold uppercase tracking-wider text-white/30 mb-2">Notes</p>
          <NotesThread deal={deal} profile={profile} users={users} onCountChange={onCountChange} />
        </div>
      )}

      {canEdit && (
        <div className="mt-3 pt-3 border-t border-white/5">
          <ActionButtons deal={deal} onEdit={onEdit} onDelete={onDelete} />
        </div>
      )}
    </div>
  )
}

export default function DealTable({
  deals, profile, users = [],
  sortKey, sortDir, onSort,
  repFilter, setRepFilter,
  statusFilter, setStatusFilter,
  officeFilter, setOfficeFilter,
  paymentFilter, setPaymentFilter,
  dateField, setDateField,
  dateFrom, dateTo, datePreset, setDateRange,
  onEdit, onDelete, onUpdate, loading, openNotesId,
}) {
  const { statusColor, statusLabels, offices, paymentMethods } = useSettings()
  // Editing deal data anywhere is an admin-only action. Everyone else gets a
  // read-only view (they can still filter, sort, and read/post notes). Admin =
  // the 'admin' title OR the is_admin flag (same rule as useAuth().isAdmin).
  const canEdit = profile?.role === 'admin' || profile?.is_admin === true
  // Commission sign-off (gold check) is likewise admin-only.
  const canVerify = canEdit
  const [notesOpen, setNotesOpen] = useState(() => new Set(openNotesId ? [openNotesId] : []))
  const toggleNotes = (id) => setNotesOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  useEffect(() => { if (openNotesId) setNotesOpen(s => new Set([...s, openNotesId])) }, [openNotesId])

  // 💬 badges: how many thread notes each deal has (single bulk query).
  const [noteCounts, setNoteCounts] = useState({})
  useEffect(() => { fetchDealNoteCounts().then(({ data }) => setNoteCounts(data || {})) }, [])
  const setNoteCount = (dealId, count) => setNoteCounts(m => ({ ...m, [dealId]: count }))
  const colCount = COLS.length + (canEdit ? 1 : 0)

  const reps = users.filter(u => ['rep', 'manager', 'director', 'vp'].includes(u.role))

  // Whether a given column currently has a filter applied (drives the header dot).
  const colActive = (col) => ({
    status:  !!statusFilter,
    office:  !!officeFilter,
    payment: !!paymentFilter,
    rep:     !!repFilter,
    date:    !!(dateFrom || dateTo),
  }[col.filter] || false)

  // The filter UI rendered inside a column's header popover, if any.
  const colFilter = (col) => {
    switch (col.filter) {
      case 'status':  return () => <OptionFilter value={statusFilter}  options={statusLabels}  onChange={setStatusFilter}  allLabel="All statuses" />
      case 'office':  return () => <OptionFilter value={officeFilter}  options={offices}        onChange={setOfficeFilter}  allLabel="All offices" />
      case 'payment': return () => <OptionFilter value={paymentFilter} options={paymentMethods} onChange={setPaymentFilter} allLabel="All payments" />
      case 'rep':     return () => <OptionFilter value={repFilter}     options={reps.map(r => ({ value: r.id, label: r.name }))} onChange={setRepFilter} allLabel="All reps" />
      case 'date':    return () => <DateFilterPanel dateField={dateField} setDateField={setDateField}
                                     dateFrom={dateFrom} dateTo={dateTo} datePreset={datePreset} setDateRange={setDateRange} />
      default:        return null
    }
  }

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
                className={`px-3 py-3 text-[11px] font-bold text-dark uppercase tracking-wider select-none whitespace-nowrap ${
                  col.align === 'right' ? 'text-right' : 'text-left'
                }`}>
                <HeaderMenu col={col} sortKey={sortKey} sortDir={sortDir} onSort={onSort}
                  active={colActive(col)} renderFilter={colFilter(col)} />
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
            const canceled = isCanceled(deal)
            return (
              <Fragment key={deal.id}>
              <tr
                style={{ background: isEven ? '#242424' : '#262626' }}
                className={`hover:bg-white/[0.03] transition-colors align-top ${canceled ? 'opacity-50' : ''}`}>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => toggleNotes(deal.id)} title="Notes"
                      className="text-[13px] font-semibold text-white truncate max-w-[210px] text-left hover:text-teal transition-colors">
                      {deal.deal_name}
                    </button>
                    {(deal.notes || noteCounts[deal.id] > 0) && (
                      <span className="flex items-center gap-0.5 text-teal/70 flex-shrink-0">
                        <MessageSquare size={12} />
                        {noteCounts[deal.id] > 0 && <span className="text-[10px] font-semibold">{noteCounts[deal.id]}</span>}
                      </span>
                    )}
                    {canceled && <CanceledMark />}
                  </div>
                  {deal.project_id && <p className="text-[11px] text-white/40 truncate max-w-[260px]">{deal.project_id}</p>}
                </td>
                <td className="px-3 py-3">
                  <InlineSelectCell value={deal.office} options={offices} colorFor={officeColor}
                    field="office" canEdit={canEdit} dealId={deal.id} onUpdate={onUpdate} missingLabel="office"
                    deriveExtra={v => officeChangePatch(deal, v)} />
                </td>
                <td className="px-3 py-3">
                  <InlineSelectCell value={deal.payment_method} options={paymentMethods}
                    field="payment_method" canEdit={canEdit} dealId={deal.id} onUpdate={onUpdate} missingLabel="payment" />
                </td>
                <td className="px-3 py-3">
                  <StatusCell status={deal.status} color={statusColor(deal.status)} options={statusLabels}
                    canEdit={canEdit} onUpdate={onUpdate} dealId={deal.id} />
                </td>
                <td className="px-3 py-3"><PeopleCell deal={deal} /></td>
                <td className="px-3 py-3">
                  <div className="flex flex-col gap-0.5">
                    <DateField label="Sale" value={deal.sale_date}    field="sale_date"    dealId={deal.id} canEdit={canEdit} onUpdate={onUpdate} />
                    <DateField label="Inst" value={deal.install_date} field="install_date" dealId={deal.id} canEdit={canEdit} onUpdate={onUpdate} flagMissing
                      deriveExtra={v => ({ pay_date: v ? payDateFromInstall(v) : null })} />
                    <DateField key={`pay-${deal.pay_date ?? ''}`} label="Pay" value={deal.pay_date} field="pay_date" dealId={deal.id} canEdit={canEdit} onUpdate={onUpdate} flagMissing />
                  </div>
                </td>
                <td className="px-3 py-3"><RevenueCell baseline={baseline} jobPrice={jobPrice} /></td>
                <td className="px-3 py-3"><CommissionCell deal={deal} canVerify={canVerify} onUpdate={onUpdate} /></td>
                {canEdit && (
                  <td className="px-3 py-3"><ActionButtons deal={deal} onEdit={onEdit} onDelete={onDelete} /></td>
                )}
              </tr>
              {notesOpen.has(deal.id) && (
                <tr style={{ background: isEven ? '#242424' : '#262626' }}>
                  <td colSpan={colCount} className="px-3 pb-3 pt-0">
                    <div className="rounded-lg p-3" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-white/30 mb-2">Notes — {deal.deal_name}</p>
                      <NotesThread deal={deal} profile={profile} users={users} onCountChange={setNoteCount} />
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            )
          })}
        </tbody>
      </table>

      {/* Mobile / tablet cards (below lg) */}
      <div className="lg:hidden divide-y divide-white/5">
        {deals.map(deal => (
          <DealCard key={deal.id} deal={deal} canEdit={canEdit} canVerify={canVerify}
            onEdit={onEdit} onDelete={onDelete} onUpdate={onUpdate}
            statusColor={statusColor} statusLabels={statusLabels}/>
        ))}
      </div>
    </div>
  )
}
