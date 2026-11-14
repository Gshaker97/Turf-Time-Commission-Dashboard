import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, Loader2, Lock, XCircle } from 'lucide-react'
import { onClickUnlessSelecting } from '../../utils/selection'

// ============================================================
// Private Bank building blocks (redesign/private-bank).
// Presentation ONLY: these take text, numbers and children and draw them with
// the tokens in src/index.css. No data, no fetching, no commission logic.
// var()-backed colours can't take Tailwind opacity modifiers, so the few
// translucent surfaces are spelled out once here.
// ============================================================

export const SURFACE = {
  card:  { background: 'var(--card)',  border: '1px solid var(--line)', boxShadow: 'var(--card-shadow)' },
  raise: { background: 'var(--raise)', border: '1px solid var(--line)' },
  well:  { background: 'var(--bg)',    border: '1px solid var(--line)' },
}
export const GOLD_WASH   = { background: 'rgba(191,164,108,0.10)', border: '1px solid rgba(191,164,108,0.35)' }
export const WARN_BORDER = 'rgba(210,160,116,0.45)'

// Amount colour: negatives read as deductions, paid money as "in the bank",
// everything else plain ivory. Gold is reserved for the one key number.
export const amountColor = (n, isPaid) => n < 0 ? 'var(--neg)' : isPaid ? 'var(--pos)' : 'var(--tx)'
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

// ── Card ────────────────────────────────────────────────────────────────────
export function Card({ as: Tag = 'div', className = '', style, padded = true, children, ...rest }) {
  return (
    <Tag className={`rounded-2xl ${padded ? 'p-4 md:p-5' : 'overflow-hidden'} ${className}`}
      style={{ ...SURFACE.card, ...style }} {...rest}>
      {children}
    </Tag>
  )
}

// ── Section header (title + one line of context, optional right slot) ───────
export function SectionHeader({ title, sub, right, id, className = '', divider = false }) {
  return (
    <div className={`flex items-start justify-between gap-3 flex-wrap ${divider ? 'px-4 py-3 border-b border-bank-line' : 'mb-3'} ${className}`}>
      <div className="min-w-0">
        <h2 id={id} className="text-[15px] font-bold text-bank-tx">{title}</h2>
        {sub && <p className="text-[13px] text-bank-mu mt-0.5">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

// Small uppercase label used above a group of tiles.
export function Eyebrow({ children, className = '' }) {
  return <p className={`text-[13px] uppercase tracking-wider text-bank-fa font-semibold ${className}`}>{children}</p>
}

// ── Status chips ────────────────────────────────────────────────────────────
// Money-state chips: label + icon + colour, so each state reads without colour.
const STATUS = {
  projected: { label: 'Projected', Icon: CircleDashed,  cls: 'text-bank-mu', style: { border: '1px dashed var(--mu)' } },
  finalized: { label: 'Finalized', Icon: Lock,          cls: 'text-bank-tx', style: { border: '1px solid var(--tx)' } },
  paid:      { label: 'Paid',      Icon: CheckCircle2,  cls: '',             style: { color: 'var(--pos)', border: '1px solid transparent' }, fill: true },
  onhold:    { label: 'On hold',   Icon: AlertTriangle, cls: '',             style: { color: 'var(--warn)', border: '1px solid var(--warn)' } },
  canceled:  { label: 'Canceled',  Icon: XCircle,       cls: '',             style: { color: 'var(--neg)', border: '1px solid var(--neg)' } },
}
export function StatusChip({ kind, label }) {
  const s = STATUS[kind] || STATUS.projected
  const Icon = s.Icon
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${s.cls}`} style={s.style}>
      <Icon size={s.fill ? 15 : 13} aria-hidden="true" style={s.fill ? { fill: 'var(--pos)', color: 'var(--card)' } : undefined} />
      {label || s.label}
    </span>
  )
}

// A raw deal-status pill. Colour comes from Settings (statusColor), exactly as
// before; the text label is always present so colour is never the only cue.
export function DealStatusChip({ status, statusColor }) {
  const color = statusColor ? statusColor(status) : 'var(--mu)'
  return (
    <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0"
      style={{ color, border: `1px solid ${color}55` }}>{status}</span>
  )
}

// ── Expandable row ──────────────────────────────────────────────────────────
// A clearly labelled row that opens to show its detail, so nothing has to be
// an always-open table. `right` renders before the chevron (amount, chip…).
export function Expandable({ title, meta, right, children, defaultOpen = false, tone, className = '', minH = 'min-h-[44px]', bodyStyle }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`border-b border-bank-line last:border-0 ${className}`}>
      <button onClick={onClickUnlessSelecting(() => setOpen(o => !o))} aria-expanded={open}
        className={`w-full flex items-center gap-3 px-4 py-3 ${minH} text-left hover:bg-bank-raise transition-colors`}>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold truncate" style={{ color: tone || 'var(--tx)' }}>{title}</div>
          {meta && <div className="text-[13px] text-bank-mu mt-0.5 truncate">{meta}</div>}
        </div>
        {right}
        <ChevronDown size={16} className={`text-bank-fa flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div style={bodyStyle}>{children}</div>}
    </div>
  )
}

// ── KPI figure ──────────────────────────────────────────────────────────────
// One labelled number (optionally a second one beside it), a trend slot and a
// caption. `color` is for the one key number per screen (var(--gold-tx)).
export function KpiFigure({ label, value, color, sub, trend, value2, valueLabel, value2Label, className = '', size = 'md' }) {
  const big = size === 'lg' ? 'text-[26px] md:text-[30px]' : 'text-[22px] md:text-2xl'
  return (
    <div style={{ ...SURFACE.card, borderRadius: 14 }} className={`p-4 min-w-0 ${className}`}>
      <div className="text-[13px] uppercase tracking-wider text-bank-fa font-semibold mb-1.5 leading-tight">{label}</div>
      {value2 != null ? (
        <div className="flex flex-wrap items-start gap-x-5 gap-y-1 min-w-0">
          <div className="min-w-0">
            <div className={`${big} font-bold leading-none truncate tabular-nums`} style={{ color: color || 'var(--tx)' }}>{value}</div>
            {valueLabel && <div className="text-[13px] text-bank-fa mt-1 truncate">{valueLabel}</div>}
          </div>
          <div className="min-w-0">
            <div className={`${big} font-bold leading-none truncate tabular-nums text-bank-mu`}>{value2}</div>
            {value2Label && <div className="text-[13px] text-bank-fa mt-1 truncate">{value2Label}</div>}
          </div>
        </div>
      ) : (
        <div className={`${big} font-bold leading-none truncate tabular-nums`} style={{ color: color || 'var(--tx)' }}>{value}</div>
      )}
      {trend && <div className="mt-1.5">{trend}</div>}
      {sub && <div className="text-[13px] text-bank-mu mt-1">{sub}</div>}
    </div>
  )
}

// ── Buttons ─────────────────────────────────────────────────────────────────
// Primary = the one gold action on a screen. Secondary = everything else.
export function PrimaryButton({ className = '', children, ...rest }) {
  return (
    <button className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl text-[13px] font-bold transition-colors hover:brightness-105 disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
      style={{ background: 'var(--gold)', color: 'var(--gold-ink)' }} {...rest}>
      {children}
    </button>
  )
}
export function SecondaryButton({ className = '', active = false, children, style, ...rest }) {
  return (
    <button className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] md:min-h-0 md:py-1.5 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      active ? 'text-bank-gold-tx' : 'text-bank-mu hover:text-bank-tx'} ${className}`}
      style={{ ...(active ? GOLD_WASH : SURFACE.raise), ...style }} {...rest}>
      {children}
    </button>
  )
}
// A pill in a segmented group (tabs, presets). Active = gold text on a raised pill.
export function Pill({ active, className = '', children, ...rest }) {
  return (
    <button aria-pressed={active}
      className={`px-3 py-2 min-h-[44px] md:min-h-0 md:py-1.5 rounded-lg text-[13px] font-semibold transition-colors border ${
        active ? 'text-bank-gold-tx' : 'text-bank-mu hover:text-bank-tx hover:bg-bank-raise border-transparent'} ${className}`}
      style={active ? SURFACE.raise : undefined} {...rest}>
      {children}
    </button>
  )
}
export function PillGroup({ className = '', children, ...rest }) {
  return (
    <div className={`inline-flex flex-wrap gap-1 p-1 rounded-xl max-w-full ${className}`} style={SURFACE.well} {...rest}>{children}</div>
  )
}

// ── Loading / empty / error ─────────────────────────────────────────────────
export function LoadingBlock({ text = 'Loading…', className = '' }) {
  return (
    <div style={{ ...SURFACE.card, borderRadius: 14 }} className={`p-6 flex items-center justify-center gap-3 text-bank-mu text-[13px] ${className}`} role="status" aria-live="polite">
      <Loader2 size={16} className="animate-spin text-bank-fa" aria-hidden="true" /> {text}
    </div>
  )
}
export function EmptyBlock({ children, className = '' }) {
  return <div className={`px-4 py-8 text-bank-mu text-[13px] text-center ${className}`}>{children}</div>
}
export function ErrorBlock({ title = "Something went wrong", message, className = '' }) {
  return (
    <div style={{ ...SURFACE.card, borderRadius: 14, borderColor: 'var(--neg)' }} className={`p-5 flex items-start gap-3 ${className}`} role="alert">
      <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--neg)' }} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-bank-tx">{title}</p>
        {message && <p className="text-[13px] text-bank-mu mt-0.5 break-words">{message}</p>}
      </div>
    </div>
  )
}
