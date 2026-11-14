import { useState, useRef, useEffect, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { RepPickList } from './RepMultiSelect'
import { ChevronUp, ChevronDown, ChevronsUpDown, Pencil, Trash2, Check, X, MessageSquare, BadgeCheck, AlertCircle, EyeOff, RefreshCw } from 'lucide-react'
import { SURFACE, POPOVER, GOLD_WASH, IconButton, PrimaryButton, SecondaryButton, EmptyBlock, LoadingBlock } from './ui'
import { calcDealCommissions, fmt, fmtPct, isCanceled, isHidden, countsInTotals, officeOverrideRate, deductionBreakdown } from '../utils/commission'
import { payDateFromInstall } from '../utils/dateRanges'
import { useSettings } from '../contexts/SettingsContext'
import { fetchDealNotes, fetchDealNoteCounts, addDealNote, updateDealNote, deleteDealNote } from '../lib/db'
import DateRangeFilter from './DateRangeFilter'
import AuditStrip, { AuditBadge } from './AuditStrip'
import { toast } from '../lib/toast'
import { confirmDialog } from '../lib/dialog'

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
// A change alert (❗ — the sheet shows a re-signed agreement, migration 031)
// also puts the deal in review, even if it's still gold-checked, until the
// alert is dismissed.
// Missing key fields hold a deal in review too (even gold-checked): a deal
// without an office pays the wrong override rate, without a pay date it never
// reaches payroll, etc. — "needs review" = "needs SOMETHING".
// The Needs-review rule lives in one shared module so the server audit queue
// selects the exact same deals. Re-exported here for existing importers.
export { dealMissingInfo, dealNeedsReview } from '../utils/needsReview'

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
const MARK = 'w-[22px] h-[22px] rounded-full flex items-center justify-center flex-shrink-0'
function HiddenMark() {
  return (
    <span className={MARK} style={SURFACE.raise}
      title="Hidden — counts toward nothing (revenue, payroll, leaderboards, competitions)">
      <EyeOff size={12} strokeWidth={2.5} className="text-bank-mu" />
    </span>
  )
}

// Amber "2x": this deal shares its customer, baseline AND closing date with
// another — almost always one job that ArcSite re-issued under a second
// Project ID. The sync cannot tell that from a real second sale, so it
// imports both and flags the pair here (see duplicateDealIds).
function DupeMark({ other }) {
  return (
    <span className={`${MARK} text-[11px] font-extrabold`}
      style={{ background: 'rgba(210,160,116,0.14)', border: '1px solid rgba(210,160,116,0.45)', color: 'var(--warn)' }}
      title={`Possible duplicate — same customer, baseline and closing date as ${other} other deal${other === 1 ? '' : 's'}. If the job was re-signed under a new Project ID, hide the one you don't want.`}>
      2x
    </span>
  )
}

function CanceledMark() {
  return (
    <span className={MARK} style={{ background: 'rgba(217,140,128,0.14)', border: '1px solid rgba(217,140,128,0.45)' }} title="Canceled">
      <X size={13} strokeWidth={3} style={{ color: 'var(--neg)' }} />
    </span>
  )
}

// Columns, grouped so the row scans left to right: the deal (name, ID, office,
// payment), its status, the people, the dates, the money, then the audit and
// notes flags. Office and payment live under the deal name; their filters and
// sorts stay reachable from the Deal header menu.
const COLS = [
  { key: 'deal_name', label: 'Deal', filter: 'deal', menuWidth: 260,
    extraSorts: [{ key: 'office', label: 'Office' }, { key: 'payment_method', label: 'Payment' }] },
  { key: 'status',    label: 'Status',     filter: 'status' },
  { key: 'setter',    label: 'People',     filter: 'rep',  sortAccessor: d => d.setter?.name ?? '' },
  { key: 'sale_date', label: 'Dates',      filter: 'date', menuWidth: 300 },
  { key: 'job_price', label: 'Revenue',    align: 'right' },
  { key: 'commission',label: 'Commission', align: 'right', sortAccessor: d => calcDealCommissions(d).repCommission },
  { key: 'audit',     label: 'Audit',      noSort: true, onlyWithAudit: true },
  { key: 'notes',     label: 'Notes',      noSort: true, align: 'right' },
]

// Every sort the desktop header menus offer, for the phone picker.
const PHONE_SORTS = [
  ['deal_name', 'Deal'], ['office', 'Office'], ['payment_method', 'Payment'], ['status', 'Status'],
  ['setter', 'Setter'], ['sale_date', 'Sale date'], ['job_price', 'Revenue'], ['commission', 'Commission'],
]

function SortIcon({ col, sortKey, sortDir }) {
  if (sortKey !== col) return <ChevronsUpDown size={12} className="text-bank-fa ml-1 flex-shrink-0 opacity-70" />
  return sortDir === 'asc'
    ? <ChevronUp size={12} className="text-bank-tx ml-1 flex-shrink-0" />
    : <ChevronDown size={12} className="text-bank-tx ml-1 flex-shrink-0" />
}

// ── Column-header menu ────────────────────────────────────────
// A clickable header that opens a popover with Sort (asc/desc) and, when the
// column declares one, an inline filter (status / office / payment / rep /
// date). Click a header to decide how to slice that column.
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

  const sortBtn = (key, dir, label) => {
    const on = sortKey === key && sortDir === dir
    return (
      <button key={`${key}-${dir}`} type="button" onClick={() => onSort(key, dir)}
        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-bank-raise transition-colors">
        <span className={`flex items-center gap-1.5 text-[13px] ${on ? 'text-bank-gold-tx font-semibold' : 'text-bank-tx'}`}>
          {dir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {label}
        </span>
        {on && <Check size={12} className="text-bank-gold-tx" />}
      </button>
    )
  }
  const menuLabel = (t) => <div className="px-2 py-1 text-[13px] font-bold uppercase tracking-wide text-bank-fa">{t}</div>

  if (col.noSort) return <span className={`flex items-center ${col.align === 'right' ? 'justify-end w-full' : ''}`}>{col.label}</span>

  return (
    <>
      <button ref={btnRef} type="button" onClick={openMenu} aria-expanded={open}
        className={`flex items-center hover:text-bank-tx transition-colors ${col.align === 'right' ? 'justify-end w-full' : ''}`}>
        {col.label}
        <SortIcon col={col.key} sortKey={sortKey} sortDir={sortDir} />
        {active && <span className="w-1.5 h-1.5 rounded-full ml-1 flex-shrink-0" style={{ background: 'var(--gold)' }} />}
      </button>
      {open && createPortal(
        <div ref={popRef} className="fixed z-[60] p-1.5"
          style={{ ...POPOVER, top: pos.top, left: pos.left, width }}>
          {menuLabel('Sort')}
          {sortBtn(col.key, 'asc',  'Ascending')}
          {sortBtn(col.key, 'desc', 'Descending')}
          {col.extraSorts?.map(x => (
            <div key={x.key} className="border-t border-bank-line mt-1 pt-1">
              {menuLabel(`Sort by ${x.label.toLowerCase()}`)}
              {sortBtn(x.key, 'asc', 'Ascending')}
              {sortBtn(x.key, 'desc', 'Descending')}
            </div>
          ))}
          {renderFilter && (
            <>
              <div className="border-t border-bank-line my-1" />
              {menuLabel('Filter')}
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
    <button type="button" onClick={onClick} aria-pressed={active}
      className="w-full flex items-center justify-between gap-2 px-2 py-1.5 min-h-[44px] lg:min-h-0 rounded-lg text-left hover:bg-bank-raise transition-colors">
      <span className={`text-[13px] truncate ${active ? 'text-bank-gold-tx font-semibold' : 'text-bank-tx'}`}>{label}</span>
      {active && <Check size={12} className="text-bank-gold-tx flex-shrink-0" />}
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
        <select value={dateField} onChange={e => setDateField(e.target.value)} aria-label="Which date the range applies to"
          style={SURFACE.raise}
          className="h-9 w-full rounded-lg text-[13px] text-bank-tx px-2 pr-7 focus:outline-none appearance-none">
          {DATE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-bank-fa pointer-events-none" />
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
  const tone = missing ? 'var(--warn)' : undefined
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-[12px] uppercase tracking-wide w-9 flex-shrink-0 ${missing ? '' : 'text-bank-fa'}`} style={{ color: tone }}>{label}</span>
      {canEdit ? (
        <span className="flex items-center gap-0.5">
          <input
            key={value ?? 'empty'}
            type="date"
            aria-label={`${label} date`}
            defaultValue={value ?? ''}
            onChange={e => {
              const v = e.target.value || null
              onUpdate(dealId, { [field]: v, ...(deriveExtra ? deriveExtra(v) : null) })
            }}
            className={`text-[13px] border-0 outline-none cursor-pointer hover:text-bank-tx focus:text-bank-tx transition-colors w-[112px] min-h-[44px] lg:min-h-0 rounded px-1 ${missing ? '' : 'bg-transparent text-bank-mu'}`}
            style={missing ? { colorScheme: 'dark', color: 'var(--warn)', background: 'rgba(210,160,116,0.12)' } : { colorScheme: 'dark' }}
          />
          {value && (
            <button type="button" title={`Clear ${label.toLowerCase()} date`} aria-label={`Clear ${label.toLowerCase()} date`}
              onClick={() => onUpdate(dealId, { [field]: null, ...(deriveExtra ? deriveExtra(null) : null) })}
              className="text-bank-fa hover:text-bank-neg transition-colors leading-none px-1 min-w-[28px] min-h-[44px] lg:min-h-0 lg:min-w-0">×</button>
          )}
        </span>
      ) : (
        <span className={`text-[13px] ${missing ? '' : 'text-bank-mu'}`} style={{ color: tone }}>{value ?? '— missing'}</span>
      )}
    </div>
  )
}

function PeopleCell({ deal }) {
  return (
    <div className="flex flex-col gap-0.5 text-[13px]">
      <span className="text-bank-tx whitespace-nowrap"><span className="text-bank-fa text-[12px] uppercase mr-1.5">Set</span>{deal.setter?.name ?? '—'}</span>
      <span className="text-bank-mu whitespace-nowrap"><span className="text-bank-fa text-[12px] uppercase mr-1.5">Cls</span>{deal.closer?.name ?? '—'}</span>
    </div>
  )
}

function RevenueCell({ baseline, jobPrice }) {
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="text-[13px] font-semibold text-bank-tx tabular-nums">{fmt(jobPrice)}</span>
      <span className="text-[13px] text-bank-mu tabular-nums">base {fmt(baseline)}</span>
    </div>
  )
}

// Red deduction amount that reveals its description on click.
function DeductionTag({ amount, deal }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef(null)
  // Itemized: names the dealer fee (rate/financed/lender) and the manual
  // deduction's note, so it never reads as a bare unexplained "Deduction".
  const parts = deductionBreakdown(deal)
  const WIDTH = 240, EST_H = 120
  // Portal + fixed positioning so the table's scroll container can't clip it
  // (same fix as ChangeAlertTag); flips above when there's no room below.
  const openPopover = () => {
    if (!open) {
      const r = btnRef.current.getBoundingClientRect()
      let left = Math.min(Math.max(8, r.right - WIDTH), window.innerWidth - WIDTH - 8)
      let top = r.bottom + 4
      if (top + EST_H > window.innerHeight - 8) top = Math.max(8, r.top - EST_H - 4)
      setPos({ top, left })
    }
    setOpen(o => !o)
  }
  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={openPopover}
        className="text-[13px] font-bold hover:underline tabular-nums min-h-[44px] lg:min-h-0"
        style={{ color: 'var(--neg)' }}
        title="View deduction reason"
      >
        −{fmt(amount)}
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[59]" onClick={() => setOpen(false)} />
          <div className="fixed z-[60] p-2.5 text-left"
            style={{ ...POPOVER, top: pos.top, left: pos.left, width: WIDTH }}>
            <p className="text-[13px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--neg)' }}>Deduction · {fmt(amount)}</p>
            {parts.length === 0 ? (
              <p className="text-[13px] text-bank-tx leading-snug">No description provided.</p>
            ) : parts.map((x, i) => (
              <div key={i} className="flex items-start justify-between gap-2 py-0.5">
                <span className="text-[13px] text-bank-tx leading-snug">{x.label}</span>
                <span className="text-[13px] font-semibold whitespace-nowrap tabular-nums" style={{ color: 'var(--neg)' }}>−{fmt(x.amount)}</span>
              </div>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

// Amber ❗ on a deal whose sheet row shows a NEW signed agreement (the sync
// flags it via deals.change_alert instead of rewriting anything — migration
// 031). Click reveals the old → new figures; an admin dismisses it once the
// deal has been reviewed (and hand-edited, if the re-sign is real).
function ChangeAlertTag({ deal, canEdit, onUpdate, onSplit }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef(null)
  const ca = deal.change_alert
  if (!ca) return null
  const money = (v) => (v == null || v === '' ? '—' : fmt(parseFloat(v) || 0))
  // EST_H must cover the TALLEST panel — with the split button there are three
  // actions, and an under-measured height stopped the last one flipping above
  // the icon on a bottom row, which is how Dismiss became unreachable before.
  const WIDTH = 272, EST_H = canEdit && onSplit ? 360 : 280
  // The popover renders in a portal with fixed positioning — inside the row it
  // gets clipped by the table's scroll container (the Dismiss button became
  // unreachable on bottom rows). Flip above the icon when there's no room below.
  const openPopover = () => {
    if (!open) {
      const r = btnRef.current.getBoundingClientRect()
      let left = Math.min(Math.max(8, r.left), window.innerWidth - WIDTH - 8)
      let top = r.bottom + 4
      if (top + EST_H > window.innerHeight - 8) top = Math.max(8, r.top - EST_H - 4)
      setPos({ top, left })
    }
    setOpen(o => !o)
  }
  return (
    <div className="relative flex-shrink-0">
      <button ref={btnRef} onClick={openPopover} title="New agreement on the sheet — click for details" aria-label="New agreement on the sheet — click for details"
        className="flex items-center hover:opacity-80 transition-opacity min-w-[28px] min-h-[28px] justify-center">
        <AlertCircle size={15} style={{ color: 'var(--warn)' }} />
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[59]" onClick={() => setOpen(false)} />
          <div className="fixed z-[60] p-3 text-left"
            style={{ ...POPOVER, top: pos.top, left: pos.left, width: WIDTH }}>
            <p className="text-[13px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--warn)' }}>
              New agreement on the sheet{ca.at ? ` · ${new Date(ca.at).toLocaleDateString()}` : ''}
            </p>
            <div className="text-[13px] text-bank-tx leading-snug space-y-0.5">
              <p>Baseline {money(ca.prev_baseline)} → <b className="text-bank-tx">{money(ca.baseline)}</b></p>
              <p>Sale price {money(ca.prev_job_price)} → <b className="text-bank-tx">{money(ca.job_price)}</b></p>
            </div>
            <p className="text-[13px] text-bank-mu mt-1.5 leading-snug">
              Nothing on the deal was changed yet.
            </p>
            {canEdit && (
              <div className="mt-2 space-y-1.5">
                {/* APPLY — adopt the sheet's new figures onto the deal. Stored
                    *_amount values are cleared so the engine recomputes every
                    commission from the new baseline/price (same rule as the
                    DealModal's MONEY_KEYS), and the gold check comes off: it
                    was a sign-off on the OLD numbers. The payroll guard (034/
                    039) refuses to re-price a deal on a LOCKED run — that
                    surfaces as a toast + revert via persistInline, which is
                    the right answer: a frozen payout can't be silently changed. */}
                <button onClick={async () => {
                    const finalized = deal.status === 'Paid' || deal.status === 'Pay Finalized'
                    const ok = await confirmDialog({
                      tone: 'warn',
                      title: "Apply the sheet's new figures to this deal?",
                      message: `Baseline ${money(ca.prev_baseline)} → ${money(ca.baseline)}\nSale price ${money(ca.prev_job_price)} → ${money(ca.job_price)}`,
                      bullets: [
                        'Every commission and override recomputes from the new numbers.',
                        'The gold check comes off — it signed off the OLD figures — so the deal goes back to Needs review.',
                        finalized ? `This deal is ${deal.status}. If its pay run is locked you will be asked to confirm a logged override.` : '',
                      ],
                      confirmLabel: 'Apply new numbers',
                    })
                    if (!ok) return
                    onUpdate?.(deal.id, {
                      baseline_revenue: ca.baseline, job_price: ca.job_price,
                      setter_amount: null, closer_amount: null, manager_amount: null, director_amount: null, vp_amount: null,
                      commission_verified: false,
                      change_alert: null,
                    })
                    setOpen(false)
                  }}
                  className="w-full py-2 min-h-[44px] rounded-lg text-[13px] font-bold transition-opacity hover:opacity-90"
                  style={{ background: 'var(--warn)', color: 'var(--gold-ink)' }}>
                  Apply new numbers to the deal
                </button>
                <button onClick={async () => {
                    if (!await confirmDialog({
                      title: 'Dismiss this change alert?',
                      message: 'The deal is left exactly as it is.',
                      bullets: [
                        'Use this when the deal is already right, or you updated it by hand.',
                        'It clears the ❗ for good — it only comes back if the sheet changes again.',
                      ],
                      confirmLabel: 'Dismiss alert',
                    })) return
                    onUpdate?.(deal.id, { change_alert: null }); setOpen(false)
                  }}
                  className="w-full py-2 min-h-[44px] rounded-lg text-[13px] font-semibold transition-colors hover:bg-bank-raise"
                  style={{ color: 'var(--warn)', border: '1px solid rgba(210,160,116,0.5)' }}>
                  Dismiss — deal is already right
                </button>
                {/* CREATE AS A NEW DEAL (per Keaton) — the third answer, for
                    when the sheet changed because a SECOND job was sold under
                    the same ArcSite project id. Apply would overwrite the first
                    job's money with the second job's; Dismiss would throw the
                    second sale away. The page owns the two writes (insert, then
                    clear the alert) — see utils/splitDeal.js. */}
                {onSplit && (
                  <>
                    <div className="h-px my-0.5" style={{ background: 'var(--line)' }} />
                    <SecondaryButton onClick={async () => { if (await onSplit(deal)) setOpen(false) }} className="w-full min-h-[44px]">
                      Create as a separate deal
                    </SecondaryButton>
                    <p className="text-[13px] text-bank-mu leading-snug">
                      For a second job sold under the same project ID — this deal is left untouched.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

// Leadership sign-off seal next to the commission — the "gold check". A
// BadgeCheck that lights up gold once the commission is confirmed. Toggleable
// by VP/admin; read-only (shown only if verified) to others.
function VerifySeal({ verified, canVerify, onToggle }) {
  if (!verified && !canVerify) return null
  if (!canVerify) return <BadgeCheck size={15} className="flex-shrink-0" style={{ color: 'var(--gold-tx)' }} title="Commission checked" />
  return (
    <button type="button" onClick={onToggle} className="flex-shrink-0 hover:opacity-80 transition-opacity min-w-[28px] min-h-[28px] flex items-center justify-center"
      aria-pressed={verified}
      title={verified ? 'Commission checked — click to unmark' : 'Mark commission as checked'}>
      <BadgeCheck size={16} className={verified ? '' : 'text-bank-fa hover:text-bank-mu'} style={verified ? { color: 'var(--gold-tx)' } : undefined} />
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
  const amt = (n) => ({ color: n < 0 ? 'var(--neg)' : 'var(--tx)' })
  const initial = (name, fallback) => (
    <span className="text-[10px] font-bold text-bank-fa w-[14px] h-[14px] rounded-full flex items-center justify-center leading-none" style={SURFACE.raise}>
      {name?.[0]?.toUpperCase() ?? fallback}
    </span>
  )

  return (
    <div className="flex items-center justify-end gap-2">
      <VerifySeal verified={deal.commission_verified === true} canVerify={canVerify}
        onToggle={() => onUpdate?.(deal.id, { commission_verified: !deal.commission_verified })} />
      <div className="flex flex-col items-end gap-1 leading-tight">
      {!split ? (
        <div className="flex flex-col items-end">
          <span className="text-[13px] font-bold tabular-nums" style={amt(repCommission)}>{fmt(repCommission)}</span>
          <span className="text-[13px] text-bank-fa">{fmtPct(repPct)}</span>
        </div>
      ) : (
        <div className="flex flex-col items-end gap-0.5">
          <div className="flex items-center gap-1.5">
            {initial(deal.setter?.name, 'S')}
            <span className="text-[13px] font-semibold tabular-nums" style={amt(setterAmt)}>{fmt(setterAmt)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {initial(deal.closer?.name, 'C')}
            <span className="text-[13px] font-semibold tabular-nums" style={amt(closerAmt)}>{fmt(closerAmt)}</span>
          </div>
          <span className="text-[13px] text-bank-fa">{fmtPct(repPct)}</span>
        </div>
      )}
      {deduction > 0 && <DeductionTag amount={deduction} deal={deal} />}
      </div>
    </div>
  )
}

export function StatusBadge({ status, color = '#94a3b8' }) {
  if (!status) return <span className="text-bank-fa text-[13px]">—</span>
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[13px] font-medium whitespace-nowrap"
      style={{ color, border: `1px solid ${color}55`, background: 'transparent' }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
      {status}
    </span>
  )
}

// Office badge tones on the palette: Phoenix = warm amber, Tucson = sage. Any
// other office falls back to the neutral used elsewhere for unset badges.
const OFFICE_COLORS = {
  Phoenix: '#d2a074',
  Tucson:  '#a9c4b2',
}
const officeColor = (name) => OFFICE_COLORS[name] || '#a19e97'

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
        : <span className="text-[13px] text-bank-fa">—</span>)
    : value
      ? <span className={`text-[13px] whitespace-nowrap transition-colors text-bank-mu ${canEdit ? 'hover:text-bank-tx cursor-pointer' : ''}`}>{value}</span>
      : <span className="text-[13px] whitespace-nowrap font-semibold px-1.5 py-0.5 rounded"
          style={{ color: 'var(--warn)', background: 'rgba(210,160,116,0.12)', border: '1px dashed rgba(210,160,116,0.6)' }}>
          + {missingLabel || 'set'}
        </span>

  if (!canEdit) return display

  return (
    <div className="relative inline-block cursor-pointer min-h-[44px] lg:min-h-0 flex items-center">
      {display}
      <select
        key={value ?? ''}
        defaultValue={value ?? ''}
        aria-label={`Edit ${missingLabel || field}`}
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
        aria-label="Change status"
        onChange={e => onUpdate(dealId, { status: e.target.value })}
        className="absolute inset-0 opacity-0 cursor-pointer w-full"
        title="Change status"
      >
        {options.map(st => <option key={st} value={st}>{st}</option>)}
      </select>
    </div>
  )
}

function ActionButtons({ deal, onEdit, onDelete, onToggleHidden }) {
  const hidden = isHidden(deal)
  return (
    <div className="flex gap-1 justify-end">
      <IconButton onClick={() => onEdit(deal)} title="Edit deal" aria-label="Edit deal">
        <Pencil size={14} />
      </IconButton>
      {/* Hide, NOT delete — the row has to survive or the sheet sync
          re-creates it within the minute (see migration 052). */}
      {onToggleHidden && (
        <IconButton onClick={() => onToggleHidden(deal)}
          title={hidden
            ? 'Un-hide — this job counts again everywhere'
            : 'Hide — keep the record but count it toward nothing'}
          aria-label={hidden ? 'Un-hide deal' : 'Hide deal'}
          tone={hidden ? 'var(--warn)' : undefined}>
          <EyeOff size={14} />
        </IconButton>
      )}
      <IconButton onClick={() => onDelete(deal.id)} title="Delete deal" aria-label="Delete deal" className="hover:!text-bank-neg">
        <Trash2 size={14} />
      </IconButton>
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
  const { noteNotify } = useSettings()
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
    if (error) { toast.error('Could not save edit: ' + (error.message || '')); return }
    setEditId(null); setEditText(''); reload()
  }
  async function removeNote(id) {
    if (!await confirmDialog({ tone: 'danger', title: 'Delete this comment?', message: 'This cannot be undone.', confirmLabel: 'Delete' })) return
    const { error } = await deleteDealNote(id)
    if (error) { toast.error('Could not delete: ' + (error.message || '')); return }
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
    // Who gets pinged is admin-configurable (Admin → Settings → Deal Note
    // Notifications); default is closer + admins, minus the author.
    const recipientIds = []
    if (noteNotify.closer !== false) recipientIds.push(deal.closer_id)
    if (noteNotify.setter)  recipientIds.push(deal.setter_id)
    if (noteNotify.manager) recipientIds.push(deal.manager_id)
    if (noteNotify.admins !== false) {
      recipientIds.push(...(users || []).filter(u => u.role === 'admin' || u.is_admin === true).map(u => u.id))
    }
    const { error } = await addDealNote({
      dealId: deal.id, dealName: deal.deal_name, body,
      author: { id: profile.id, name: profile.name },
      recipientIds,
    })
    setPosting(false)
    if (error) { toast.error('Could not post: ' + (error.message || '')); return }
    setDraft('')
    reload()
  }

  const textarea = 'w-full px-3 py-2 rounded-lg text-[13px] text-bank-tx placeholder-bank-fa focus:outline-none resize-y'

  return (
    <div className="space-y-2">
      {/* Legacy single-note text, if this deal has one */}
      {deal.notes && (
        <div className="rounded-lg px-3 py-2" style={{ background: 'var(--bg)', border: '1px dashed var(--line)' }}>
          <p className="text-[12px] uppercase tracking-wide text-bank-fa mb-0.5">Original note</p>
          <p className="text-[13px] text-bank-mu whitespace-pre-wrap">{deal.notes}</p>
        </div>
      )}

      {notes === null ? (
        <p className="text-[13px] text-bank-mu py-1">Loading…</p>
      ) : notes.length === 0 && !deal.notes ? (
        <p className="text-[13px] text-bank-mu italic py-1">No notes yet — start the thread below.</p>
      ) : (
        notes.map(n => {
          const mine = n.author_id === profile?.id
          const editCount = (n.edits || []).length
          return (
            <div key={n.id} className="rounded-lg px-3 py-2"
              style={mine ? GOLD_WASH : SURFACE.well}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] mb-0.5">
                  <span className={`font-semibold ${mine ? 'text-bank-gold-tx' : 'text-bank-tx'}`}>
                    {n.author?.name || users?.find(u => u.id === n.author_id)?.name || '—'}
                  </span>
                  <span className="text-bank-fa"> · {fmtWhen(n.created_at)}</span>
                  {editCount > 0 && (
                    <button onClick={() => setShowLog(showLog === n.id ? null : n.id)}
                      className="text-bank-fa hover:text-bank-mu italic ml-1">
                      · edited{editCount > 1 ? ` ×${editCount}` : ''}
                    </button>
                  )}
                </p>
                {editId !== n.id && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {mine && (
                      <IconButton onClick={() => { setEditId(n.id); setEditText(n.body) }} title="Edit" aria-label="Edit note"><Pencil size={12} /></IconButton>
                    )}
                    {isAdmin && (
                      <IconButton onClick={() => removeNote(n.id)} title="Delete (admin)" aria-label="Delete note" className="hover:!text-bank-neg"><Trash2 size={12} /></IconButton>
                    )}
                  </div>
                )}
              </div>

              {editId === n.id ? (
                <div className="space-y-1.5 mt-1">
                  <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={2} aria-label="Edit note"
                    className={textarea} style={SURFACE.raise} />
                  <div className="flex items-center gap-2">
                    <PrimaryButton onClick={() => saveEdit(n.id)} disabled={!editText.trim() || editText.trim() === n.body} className="px-3 py-1.5">Save</PrimaryButton>
                    <button onClick={() => { setEditId(null); setEditText('') }}
                      className="text-[13px] text-bank-mu hover:text-bank-tx min-h-[44px] lg:min-h-0 px-1">Cancel</button>
                  </div>
                </div>
              ) : (
                <p className="text-[13px] text-bank-tx whitespace-pre-wrap">{n.body}</p>
              )}

              {showLog === n.id && editCount > 0 && (
                <div className="mt-2 pt-2 border-t border-bank-line space-y-1">
                  <p className="text-[12px] uppercase tracking-wide text-bank-fa">Edit history</p>
                  {(n.edits || []).slice().reverse().map((e, i) => (
                    <p key={i} className="text-[13px] text-bank-mu">
                      <span className="text-bank-fa">{fmtWhen(e.at)} — previously:</span> <span className="line-through">{e.body}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          )
        })
      )}

      <div className="flex items-end gap-2 pt-1">
        <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2} aria-label="Write a reply"
          placeholder="Write a reply… (everyone on this deal gets notified)"
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post() }}
          className={`${textarea} flex-1`} style={SURFACE.well} />
        <PrimaryButton onClick={post} disabled={posting || !draft.trim()} className="flex-shrink-0 px-3">
          {posting ? 'Posting…' : 'Post'}
        </PrimaryButton>
      </div>
    </div>
  )
}

const subline = (deal) => [deal.office, deal.payment_method].filter(Boolean).join(' · ') || '—'

// The flags that ride next to a deal's name everywhere it appears.
// `staticAlert` draws the ❗ as a plain icon (no popover button) — used inside
// the phone row's header, which is itself a button; the live alert with its
// actions renders once the row is open.
function NameFlags({ deal, canEdit, onUpdate, onSplit, dupeIds, staticAlert = false }) {
  return (
    <>
      {staticAlert
        ? (deal.change_alert ? <span className="flex-shrink-0 flex items-center" title="New agreement on the sheet"><AlertCircle size={15} style={{ color: 'var(--warn)' }} /></span> : null)
        : <ChangeAlertTag deal={deal} canEdit={canEdit} onUpdate={onUpdate} onSplit={onSplit} />}
      {isCanceled(deal) && <CanceledMark />}
      {isHidden(deal) && <HiddenMark />}
      {dupeIds?.has(deal.id) && <DupeMark other={dupeIds.get(deal.id)} />}
    </>
  )
}

// Notes button: the bubble + count; opens the thread.
function NotesButton({ count, hasLegacy, open, onClick, compact = false }) {
  const any = hasLegacy || count > 0
  return (
    <button onClick={onClick} title="Notes" aria-label="Notes" aria-expanded={open}
      className={`inline-flex items-center gap-1 rounded-lg transition-colors ${compact ? 'min-w-[44px] min-h-[44px] justify-center' : 'px-2 py-1 min-h-[44px] lg:min-h-0'} ${any ? 'text-bank-tx' : 'text-bank-fa'} hover:text-bank-gold-tx hover:bg-bank-raise`}>
      <MessageSquare size={14} />
      {count > 0 && <span className="text-[13px] font-semibold tabular-nums">{count}</span>}
    </button>
  )
}

function NotesPanel({ deal, profile, users, onCountChange }) {
  return (
    <div className="rounded-xl p-3" style={SURFACE.raise}>
      <p className="text-[13px] font-bold uppercase tracking-wide text-bank-fa mb-2">Notes — {deal.deal_name}</p>
      <NotesThread deal={deal} profile={profile} users={users} onCountChange={onCountChange} />
    </div>
  )
}

// ── Phone card (below lg): a compact row that expands to the full record ──
function DealCard({ deal, canEdit, canVerify, onEdit, onDelete, onToggleHidden, onUpdate, onSplit, dupeIds, statusColor, statusLabels, offices, paymentMethods, profile, users, noteCount, onCountChange, audit = null, canAudit = false, defaultOpen = false }) {
  const baseline = parseFloat(deal.baseline_revenue) || 0
  const jobPrice = parseFloat(deal.job_price)        || 0
  const [open, setOpen] = useState(defaultOpen)
  const [showNotes, setShowNotes] = useState(defaultOpen)
  useEffect(() => { if (defaultOpen) { setOpen(true); setShowNotes(true) } }, [defaultOpen])
  const a = audit?.byId[deal.id]
  const dimmed = !countsInTotals(deal)
  return (
    <div className={dimmed ? 'opacity-60' : ''}>
      {/* Compact row: name + ID, status, revenue */}
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 min-h-[56px] text-left hover:bg-bank-raise transition-colors">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`text-[14px] font-semibold truncate ${isCanceled(deal) ? 'line-through text-bank-mu' : 'text-bank-tx'}`}>{deal.deal_name}</span>
            <NameFlags deal={deal} canEdit={false} dupeIds={dupeIds} staticAlert />
          </div>
          <p className="text-[13px] text-bank-mu truncate">{deal.project_id ? `${deal.project_id} · ` : ''}{subline(deal)}</p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <StatusBadge status={deal.status} color={statusColor(deal.status)} />
          <span className="text-[13px] font-semibold text-bank-tx tabular-nums">{fmt(jobPrice)}</span>
        </div>
        <ChevronDown size={16} className={`text-bank-fa flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3" style={{ background: 'var(--bg)' }}>
          {/* Flags that need a tap (alert) + inline office / payment / status editors */}
          <div className="flex items-center gap-2 flex-wrap pt-3">
            <NameFlags deal={deal} canEdit={canEdit} onUpdate={onUpdate} onSplit={onSplit} dupeIds={null} />
            {a && <AuditBadge done={a.done} total={a.total} reviewed={a.reviewed} />}
            <NotesButton count={noteCount} hasLegacy={!!deal.notes} open={showNotes} onClick={() => setShowNotes(s => !s)} />
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <p className="text-[13px] text-bank-fa mb-1">Status</p>
              <StatusCell status={deal.status} color={statusColor(deal.status)} options={statusLabels}
                canEdit={canEdit} onUpdate={onUpdate} dealId={deal.id} />
            </div>
            <div>
              <p className="text-[13px] text-bank-fa mb-1">Office</p>
              <InlineSelectCell value={deal.office} options={offices} colorFor={officeColor}
                field="office" canEdit={canEdit} dealId={deal.id} onUpdate={onUpdate} missingLabel="office"
                deriveExtra={v => officeChangePatch(deal, v)} />
            </div>
            <div>
              <p className="text-[13px] text-bank-fa mb-1">Payment</p>
              <InlineSelectCell value={deal.payment_method} options={paymentMethods}
                field="payment_method" canEdit={canEdit} dealId={deal.id} onUpdate={onUpdate} missingLabel="payment" />
            </div>
            <div>
              <p className="text-[13px] text-bank-fa mb-1">People</p>
              <PeopleCell deal={deal} />
            </div>
            <div>
              <p className="text-[13px] text-bank-fa mb-1">Dates</p>
              <div className="flex flex-col gap-0.5">
                <DateField label="Sale" value={deal.sale_date}    field="sale_date"    dealId={deal.id} canEdit={canEdit} onUpdate={onUpdate} />
                <DateField label="Inst" value={deal.install_date} field="install_date" dealId={deal.id} canEdit={canEdit} onUpdate={onUpdate} flagMissing
                  deriveExtra={v => ({ pay_date: v ? payDateFromInstall(v) : null })} />
                <DateField key={`pay-${deal.pay_date ?? ''}`} label="Pay" value={deal.pay_date} field="pay_date" dealId={deal.id} canEdit={canEdit} onUpdate={onUpdate} flagMissing />
              </div>
            </div>
            <div className="flex flex-col items-end gap-3">
              <div><p className="text-[13px] text-bank-fa mb-1 text-right">Revenue</p><RevenueCell baseline={baseline} jobPrice={jobPrice} /></div>
              <div><p className="text-[13px] text-bank-fa mb-1 text-right">Commission</p><CommissionCell deal={deal} canVerify={canVerify} onUpdate={onUpdate} /></div>
            </div>
          </div>

          {a && (
            <div>
              {canAudit && (
                <div className="flex justify-end mb-1.5">
                  <SecondaryButton onClick={() => audit.rerun(deal.id)} disabled={audit.busy[deal.id]}>
                    <RefreshCw size={12} className={audit.busy[deal.id] ? 'animate-spin' : ''} /> Re-run
                  </SecondaryButton>
                </div>
              )}
              <AuditStrip deal={deal} audit={audit} canAudit={canAudit} />
            </div>
          )}

          {showNotes && <NotesPanel deal={deal} profile={profile} users={users} onCountChange={onCountChange} />}

          {canEdit && (
            <div className="pt-3 border-t border-bank-line">
              <ActionButtons deal={deal} onEdit={onEdit} onDelete={onDelete} onToggleHidden={onToggleHidden} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function DealTable({
  deals, profile, users = [],
  sortKey, sortDir, onSort,
  repFilters = [], setRepFilters,
  statusFilter, setStatusFilter,
  officeFilter, setOfficeFilter,
  paymentFilter, setPaymentFilter,
  dateField, setDateField,
  dateFrom, dateTo, datePreset, setDateRange,
  onEdit, onDelete, onToggleHidden, onUpdate, onSplit, dupeIds, loading, openNotesId,
  audit = null, canAudit = false,
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
  const cols = COLS.filter(c => !c.onlyWithAudit || !!audit)
  const colCount = cols.length + (canEdit ? 1 : 0)

  const reps = users.filter(u => ['rep', 'manager', 'director', 'vp'].includes(u.role))

  // Whether a given column currently has a filter applied (drives the header dot).
  const colActive = (col) => ({
    deal:    !!officeFilter || !!paymentFilter,
    status:  !!statusFilter,
    rep:     repFilters.length > 0,
    date:    !!(dateFrom || dateTo),
  }[col.filter] || false)

  // The filter UI rendered inside a column's header popover, if any.
  const colFilter = (col) => {
    switch (col.filter) {
      case 'deal':    return () => (
        <div className="space-y-1">
          <div className="px-2 pt-0.5 text-[13px] text-bank-mu">Office</div>
          <OptionFilter value={officeFilter}  options={offices}        onChange={setOfficeFilter}  allLabel="All offices" />
          <div className="px-2 pt-1 text-[13px] text-bank-mu border-t border-bank-line">Payment</div>
          <OptionFilter value={paymentFilter} options={paymentMethods} onChange={setPaymentFilter} allLabel="All payments" />
        </div>)
      case 'status':  return () => <OptionFilter value={statusFilter}  options={statusLabels}  onChange={setStatusFilter}  allLabel="All statuses" />
      case 'rep':     return () => <RepPickList users={reps} value={repFilters} onChange={setRepFilters} />
      case 'date':    return () => <DateFilterPanel dateField={dateField} setDateField={setDateField}
                                     dateFrom={dateFrom} dateTo={dateTo} datePreset={datePreset} setDateRange={setDateRange} />
      default:        return null
    }
  }

  if (loading) return <LoadingBlock text="Loading deals…" className="py-16" />

  if (!deals.length) return (
    <div className="rounded-2xl" style={SURFACE.card}>
      <EmptyBlock className="py-16">No deals match your filters.</EmptyBlock>
    </div>
  )

  const TH = 'px-3 py-3 text-[13px] font-semibold text-bank-fa uppercase tracking-wide select-none whitespace-nowrap'
  const rowBg = (i) => (i % 2 === 0 ? 'var(--card)' : 'var(--bg)')

  return (
    <div className="rounded-2xl overflow-hidden" style={{ ...SURFACE.card, color: 'var(--tx)' }}>

      {/* Desktop table (lg+) — auto layout: each column sizes to its content. */}
      <table className="w-full hidden lg:table">
        <thead>
          <tr style={{ background: 'var(--raise)', borderBottom: '1px solid var(--line)' }}>
            {cols.map(col => (
              <th key={col.key} className={`${TH} ${col.align === 'right' ? 'text-right' : 'text-left'}`}>
                <HeaderMenu col={col} sortKey={sortKey} sortDir={sortDir} onSort={onSort}
                  active={colActive(col)} renderFilter={colFilter(col)} />
              </th>
            ))}
            {canEdit && <th className={`${TH} text-right`}>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {deals.map((deal, i) => {
            const baseline = parseFloat(deal.baseline_revenue) || 0
            const jobPrice = parseFloat(deal.job_price)        || 0
            const dimmed = !countsInTotals(deal)
            const a = audit?.byId[deal.id]
            const open = notesOpen.has(deal.id)
            return (
              <Fragment key={deal.id}>
              <tr
                style={{ background: rowBg(i) }}
                className={`hover:bg-bank-raise transition-colors align-top border-t border-bank-line ${dimmed ? 'opacity-60' : ''}`}>
                {/* Deal: name, ID, office, payment */}
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => toggleNotes(deal.id)} title="Notes"
                      className={`text-[13px] font-semibold truncate max-w-[220px] text-left hover:text-bank-gold-tx transition-colors ${isCanceled(deal) ? 'line-through text-bank-mu' : 'text-bank-tx'}`}>
                      {deal.deal_name}
                    </button>
                    <NameFlags deal={deal} canEdit={canEdit} onUpdate={onUpdate} onSplit={onSplit} dupeIds={dupeIds} />
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mt-1">
                    {deal.project_id && <span className="text-[13px] text-bank-fa truncate max-w-[160px] tabular-nums">{deal.project_id}</span>}
                    <InlineSelectCell value={deal.office} options={offices} colorFor={officeColor}
                      field="office" canEdit={canEdit} dealId={deal.id} onUpdate={onUpdate} missingLabel="office"
                      deriveExtra={v => officeChangePatch(deal, v)} />
                    <InlineSelectCell value={deal.payment_method} options={paymentMethods}
                      field="payment_method" canEdit={canEdit} dealId={deal.id} onUpdate={onUpdate} missingLabel="payment" />
                  </div>
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
                {audit && (
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      {a ? <AuditBadge done={a.done} total={a.total} reviewed={a.reviewed} /> : <span className="text-[13px] text-bank-fa">—</span>}
                      {a && canAudit && (
                        <IconButton onClick={() => audit.rerun(deal.id)} disabled={audit.busy[deal.id]} title="Re-run audit" aria-label="Re-run audit">
                          <RefreshCw size={12} className={audit.busy[deal.id] ? 'animate-spin' : ''} />
                        </IconButton>
                      )}
                    </div>
                  </td>
                )}
                <td className="px-3 py-2 text-right">
                  <NotesButton count={noteCounts[deal.id] || 0} hasLegacy={!!deal.notes} open={open} onClick={() => toggleNotes(deal.id)} />
                </td>
                {canEdit && (
                  <td className="px-3 py-2">
                    <ActionButtons deal={deal} onEdit={onEdit} onDelete={onDelete} onToggleHidden={onToggleHidden} />
                  </td>
                )}
              </tr>
              {audit && a && (
                <tr style={{ background: rowBg(i) }}>
                  <td colSpan={colCount} className="px-3 pb-3 pt-0">
                    <AuditStrip deal={deal} audit={audit} canAudit={canAudit} />
                  </td>
                </tr>
              )}
              {/* A dark band ends each customer's block so the next one reads as a
                  separate card (Needs-review / audit view only). */}
              {audit && a && (
                <tr aria-hidden="true"><td colSpan={colCount} style={{ background: 'var(--bg)', height: 10, padding: 0 }} /></tr>
              )}
              {open && (
                <tr style={{ background: rowBg(i) }}>
                  <td colSpan={colCount} className="px-3 pb-3 pt-0">
                    <NotesPanel deal={deal} profile={profile} users={users} onCountChange={setNoteCount} />
                  </td>
                </tr>
              )}
              </Fragment>
            )
          })}
        </tbody>
      </table>

      {/* Phone / tablet (below lg): the header menus live in the desktop table,
          so the same sorts are offered here as a picker; filters (office,
          payment, status, reps, dates) are the filter bar above the list. */}
      <div className="lg:hidden flex items-center gap-2 px-4 py-2 border-b border-bank-line" style={{ background: 'var(--raise)' }}>
        <label htmlFor="deal-sort" className="text-[13px] text-bank-fa whitespace-nowrap">Sort by</label>
        <select id="deal-sort" value={sortKey} onChange={e => onSort(e.target.value, sortDir)}
          className="text-[13px] px-2 py-2 min-h-[44px] rounded-lg text-bank-tx focus:outline-none flex-1 min-w-0" style={SURFACE.well}>
          {PHONE_SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button type="button" onClick={() => onSort(sortKey, sortDir === 'asc' ? 'desc' : 'asc')}
          aria-label={sortDir === 'asc' ? 'Sorted ascending — switch to descending' : 'Sorted descending — switch to ascending'}
          className="inline-flex items-center gap-1 px-3 min-h-[44px] rounded-lg text-[13px] font-semibold text-bank-mu hover:text-bank-tx" style={SURFACE.well}>
          {sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}{sortDir === 'asc' ? 'Asc' : 'Desc'}
        </button>
      </div>
      <div className="lg:hidden divide-y divide-bank-line">
        {deals.map(deal => (
          <DealCard key={deal.id} deal={deal} canEdit={canEdit} canVerify={canVerify}
            onEdit={onEdit} onDelete={onDelete} onToggleHidden={onToggleHidden} onUpdate={onUpdate} onSplit={onSplit} dupeIds={dupeIds}
            statusColor={statusColor} statusLabels={statusLabels} offices={offices} paymentMethods={paymentMethods}
            profile={profile} users={users} noteCount={noteCounts[deal.id] || 0} onCountChange={setNoteCount}
            audit={audit} canAudit={canAudit} defaultOpen={openNotesId === deal.id} />
        ))}
      </div>
    </div>
  )
}
