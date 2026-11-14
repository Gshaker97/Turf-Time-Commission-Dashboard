import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, CalendarClock, AlertTriangle, CircleDashed, Lock, CheckCircle2, Loader2 } from 'lucide-react'
import { format } from 'date-fns'
import { fetchDeals, fetchUsers, fetchPayrollAdjustments, logClientError } from '../lib/db'
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { dealAmounts, getUserCommission, fmt, activeDeals, deductionLabel } from '../utils/commission'
import { getPresetRange, presetLabel } from '../utils/dateRanges'
import { onClickUnlessSelecting } from '../utils/selection'
import { buildLedger, openDebts, recoveryLine } from '../utils/deductions'
import DateRangeFilter from '../components/DateRangeFilter'
import { standingRows, PAID, ISSUE } from './commissionsStanding'

// LOCAL dates, never UTC — .toISOString() rolls to tomorrow at 5pm Arizona.
const todayISO = () => format(new Date(), 'yyyy-MM-dd')
// Sunday–Saturday week containing the given date (ISO strings).
const isoWeek = (dateStr) => {
  const d = dateStr ? new Date(dateStr + 'T12:00:00') : new Date()
  const dow = d.getDay()                                  // 0 = Sunday
  const sun = new Date(d); sun.setDate(d.getDate() - dow)
  const sat = new Date(sun); sat.setDate(sun.getDate() + 6)
  const iso = (x) => format(x, 'yyyy-MM-dd')
  return { from: iso(sun), to: iso(sat) }
}
// PAID / ISSUE (the status strings this page keys on) live in ./commissionsStanding
const fmtDay = (iso) => iso ? format(new Date(iso + 'T12:00:00'), 'EEE, MMM d') : null
const num = (v) => Number(v) || 0
const pct = (n) => { const v = (Number(n) || 0) * 100; return (Number.isInteger(v) ? v : v.toFixed(2)) + '%' }

// Roles that pay a rep directly vs. roles that pay an override on someone
// else's deal. Used by the Earned tab to split a person's take.
const REP_ROLES = ['Setter', 'Closer']
const OVERRIDE_ROLES = ['Manager', 'Director', 'VP']

// Which date the Earned tab measures a deal on. Sale is the default because
// "what did I earn" is a question about when the work was sold, not when
// payroll happens to run. The DB column is `sale_date` (001_schema.sql) —
// the Deals page surfaces the same field as "Closing date".
const EARNED_BASES = [
  { key: 'sale',    label: 'Sale Date' },
  { key: 'install', label: 'Install Date' },
  { key: 'pay',     label: 'Pay Date' },
]
const basisLabel = (key) => EARNED_BASES.find(b => b.key === key)?.label || 'Sale Date'

function myParts(deal, id) {
  const a = dealAmounts(deal)
  const repPool = num(deal.job_price) - num(deal.baseline_revenue)
  const solo = !deal.closer_id || deal.setter_id === deal.closer_id
  const split = deal.setter_split_pct == null ? 0.5 : num(deal.setter_split_pct)
  const deduction = a.deduction
  const paidBy = deal.deduction_paid_by || 'closer'
  const dsp = deal.deduction_split_pct == null ? 0.5 : num(deal.deduction_split_pct)
  const setterDed = deal.setter_amount != null ? 0 : (solo ? deduction : paidBy === 'setter' ? deduction : paidBy === 'split' ? deduction * dsp : 0)
  const closerDed = deal.closer_amount != null ? 0 : (solo ? 0 : paidBy === 'closer' ? deduction : paidBy === 'split' ? deduction * (1 - dsp) : 0)
  const parts = []
  if (deal.setter_id === id) {
    const gross = repPool * (solo ? 1 : split)
    parts.push({
      role: 'Setter', amount: a.setter, gross,
      ded: setterDed,
      partner: solo ? null : (deal.closer?.name || null),
      detail: solo ? 'Full rep pool (self-generated)' : `Setter split · ${pct(split)} of rep pool`,
    })
  }
  if (deal.closer_id === id && deal.closer_id !== deal.setter_id) {
    const gross = repPool * (1 - split)
    parts.push({
      role: 'Closer', amount: a.closer, gross,
      ded: closerDed,
      partner: deal.setter?.name || null,
      detail: `Closer split · ${pct(1 - split)} of rep pool`,
    })
  }
  // Show the EFFECTIVE rate (amount ÷ baseline) — reflects override exclusions
  // (e.g. reads 2.7% when subcontracted items reduce the override base).
  const exNote = a.exclusionsTotal > 0 ? ' (after exclusions)' : ''
  const effPct = (amt) => (a.baseline > 0 ? pct(amt / a.baseline) : pct(0))
  if (deal.manager_id  === id) parts.push({ role: 'Manager',  amount: a.manager,  gross: a.manager,  ded: 0, partner: null, detail: `${effPct(a.manager)} override of baseline${exNote}` })
  if (deal.director_id === id) parts.push({ role: 'Director', amount: a.director, gross: a.director, ded: 0, partner: null, detail: `${effPct(a.director)} override of baseline${exNote}` })
  if (deal.vp_id       === id) parts.push({ role: 'VP',       amount: a.vp,       gross: a.vp,       ded: 0, partner: null, detail: `${effPct(a.vp)} override of baseline${exNote}` })
  return parts
}

// ── Private Bank tokens, as plain styles (var()-backed colours can't take
//    Tailwind opacity modifiers, so the few surfaces are spelled out once) ──
const CARD  = { background: 'var(--card)',  border: '1px solid var(--line)', boxShadow: 'var(--card-shadow)' }
const RAISE = { background: 'var(--raise)', border: '1px solid var(--line)' }
const WELL  = { background: 'var(--bg)',    border: '1px solid var(--line)' }
const WARN_BORDER = 'rgba(210,160,116,0.45)'   // --warn at 45%
// Amount colour: negatives read as deductions, paid money as "in the bank",
// everything else as plain ivory. Gold is reserved for the paycheck total.
const amountColor = (n, isPaid) => n < 0 ? 'var(--neg)' : isPaid ? 'var(--pos)' : 'var(--tx)'
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

function Card({ label, value, color, sub }) {
  return (
    <div style={{ ...CARD, borderRadius: 14 }} className="p-4">
      <div className="text-[13px] uppercase tracking-wider text-bank-fa font-semibold mb-1.5">{label}</div>
      <div className="text-[22px] md:text-2xl font-bold truncate tabular-nums" style={{ color: color || 'var(--tx)' }}>{value}</div>
      {sub && <div className="text-[13px] text-bank-mu mt-0.5">{sub}</div>}
    </div>
  )
}

// Deal status pill — colour comes from Settings (statusColor) exactly as
// before; the text label is always present so colour is never the only cue.
function StatusChip({ status, statusColor }) {
  const color = statusColor(status)
  return (
    <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0"
      style={{ color, border: `1px solid ${color}55` }}>{status}</span>
  )
}

// A clearly labelled row that opens to show its detail. Used for every piece
// of secondary information on the page so nothing is an always-open table.
function Expandable({ title, meta, right, children, defaultOpen = false, tone, className = '' }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`border-b border-bank-line last:border-0 ${className}`}>
      <button onClick={onClickUnlessSelecting(() => setOpen(o => !o))} aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] text-left hover:bg-bank-raise transition-colors">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold truncate" style={{ color: tone || 'var(--tx)' }}>{title}</p>
          {meta && <p className="text-[13px] text-bank-mu mt-0.5 truncate">{meta}</p>}
        </div>
        {right}
        <ChevronDown size={16} className={`text-bank-fa flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && children}
    </div>
  )
}

function DealRow({ deal, id, statusColor }) {
  const [open, setOpen] = useState(false)
  const a = dealAmounts(deal)
  const parts = myParts(deal, id)
  const take = parts.reduce((s, p) => s + p.amount, 0)
  const repPool = a.job - a.baseline
  const isPaid = deal.status === PAID

  return (
    <div className="border-b border-bank-line last:border-0">
      <button onClick={onClickUnlessSelecting(() => setOpen(o => !o))} aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] text-left hover:bg-bank-raise transition-colors">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-bank-tx truncate">{deal.deal_name}</p>
          <p className="text-[13px] text-bank-mu mt-0.5">{parts.map(p => p.role).join(' · ') || '—'}</p>
        </div>
        <StatusChip status={deal.status} statusColor={statusColor} />
        <div className="text-right flex-shrink-0 w-[92px]">
          <p className="text-[14px] font-bold tabular-nums" style={{ color: amountColor(take, isPaid) }}>{fmt(take)}</p>
        </div>
        <ChevronDown size={14} className={`text-bank-fa flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-3 -mt-1">
          <div className="rounded-xl p-3 text-[13px]" style={WELL}>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-bank-mu mb-2">
              <span>Job price <span className="text-bank-tx">{fmt(a.job)}</span></span>
              <span>Baseline <span className="text-bank-tx">{fmt(a.baseline)}</span></span>
              <span>Rep pool <span className="text-bank-tx">{fmt(repPool)}</span></span>
              {a.exclusionsTotal > 0 && (
                <span>Override base <span className="text-bank-tx">{fmt(a.overrideBase)}</span><span className="text-bank-fa"> (−{fmt(a.exclusionsTotal)} excluded)</span></span>
              )}
            </div>
            {parts.map(p => (
              <div key={p.role} className="py-1 border-t border-bank-line">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-bank-mu">
                    {p.detail}{p.partner ? <span className="text-bank-fa"> · with {p.partner}</span> : null}
                  </span>
                  <span className="font-semibold text-bank-tx tabular-nums">{fmt(p.ded > 0 ? p.gross : p.amount)}</span>
                </div>
                {p.ded > 0 && (
                  <div className="flex items-center justify-between text-[13px] mt-0.5" style={{ color: 'var(--neg)' }}>
                    <span>− Deduction ({deductionLabel(deal, a)})</span>
                    <span className="tabular-nums">−{fmt(p.ded)}</span>
                  </div>
                )}
              </div>
            ))}
            {a.deduction > 0 && !parts.some(p => p.ded > 0) && (
              <div className="flex items-start gap-1.5 pt-2 mt-1 border-t border-bank-line text-[13px]" style={{ color: 'var(--neg)' }}>
                <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                <span>This deal has a {fmt(a.deduction)} deduction — {deductionLabel(deal, a)} (already reflected in your take).</span>
              </div>
            )}
            <div className="flex items-center justify-between pt-2 mt-1 border-t border-bank-line">
              <span className="text-bank-mu">{isPaid ? 'Paid' : 'Expected'} {fmtDay(deal.pay_date) ? `· ${fmtDay(deal.pay_date)}` : '· pay date TBD'}</span>
              <span className="text-[13px] font-bold tabular-nums" style={{ color: amountColor(take, isPaid) }}>Your take {fmt(take)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Pipeline Week Group — collapsible week header for the To-be-paid tab ─────
function PipelineWeekGroup({ week, id, users, statusColor }) {
  const [open, setOpen] = useState(false)
  const weekLabel = week.weekStart
    ? `${format(new Date(week.weekStart + 'T12:00:00'), 'MMM d')} – ${format(new Date(week.weekEnd + 'T12:00:00'), 'MMM d')}`
    : 'Pay date TBD'

  return (
    <div className="border-b border-bank-line last:border-0">
      <button onClick={onClickUnlessSelecting(() => setOpen(o => !o))} aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 min-h-[44px] hover:bg-bank-raise transition-colors">
        <div className="flex items-center gap-2 min-w-0">
          {week.isOverdue && <AlertTriangle size={13} style={{ color: 'var(--warn)' }} aria-label="overdue" />}
          <span className="text-[13px] font-semibold truncate" style={{ color: week.isOverdue ? 'var(--warn)' : 'var(--tx)' }}>
            {weekLabel}
          </span>
          <span className="text-[13px] text-bank-fa whitespace-nowrap">{plural(week.deals.length, 'deal')}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-bold text-bank-tx tabular-nums">{fmt(week.total)}</span>
          <ChevronDown size={14} className={`text-bank-fa transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {open && week.deals.map(d => (
        <PipelineRow key={d.id} deal={d} id={id} users={users} statusColor={statusColor} />
      ))}
    </div>
  )
}

// ── Pipeline Row — flat row used inside a pay-week group ─────────────────────
function PipelineRow({ deal, id, users, statusColor }) {
  const parts = myParts(deal, id)
  const myTake = parts.reduce((s, p) => s + p.amount, 0)
  const isPaid = deal.status === PAID
  const isOverdue = deal.pay_date && deal.pay_date < todayISO() && !isPaid

  const closerUser = users.find(u => u.id === deal.closer_id)
  const setterUser = users.find(u => u.id === deal.setter_id)

  return (
    <div className="border-b border-bank-line last:border-0 px-4 py-3" style={{ background: 'var(--bg)' }}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-bank-tx truncate">{deal.deal_name}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
            {closerUser && (
              <span className="text-[13px] text-bank-fa">
                Closer: <span className="text-bank-mu">{closerUser.name}</span>
              </span>
            )}
            {setterUser && setterUser.id !== closerUser?.id && (
              <span className="text-[13px] text-bank-fa">
                Setter: <span className="text-bank-mu">{setterUser.name}</span>
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
            {deal.install_date && (
              <span className="text-[13px] text-bank-fa">
                Install: <span className="text-bank-mu">{fmtDay(deal.install_date)}</span>
              </span>
            )}
            {deal.pay_date ? (
              <span className="text-[13px]" style={{ color: isOverdue ? 'var(--warn)' : 'var(--fa)' }}>
                Pay: <span style={{ color: isOverdue ? 'var(--warn)' : 'var(--mu)' }}>
                  {fmtDay(deal.pay_date)}{isOverdue ? ' ⚠ overdue' : ''}
                </span>
              </span>
            ) : (
              <span className="text-[13px] text-bank-fa">Pay date TBD</span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <StatusChip status={deal.status} statusColor={statusColor} />
          <span className="text-[14px] font-bold tabular-nums" style={{ color: amountColor(myTake, isPaid) }}>
            {fmt(myTake)}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── "Where your money stands" chips: label + icon + colour, so each state is
//    readable without colour. ─────────────────────────────────────────────────
function StandingChip({ kind }) {
  if (kind === 'projected') return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold px-2.5 py-1 rounded-full text-bank-mu"
      style={{ border: '1px dashed var(--mu)' }}><CircleDashed size={13} aria-hidden="true" />Projected</span>
  )
  if (kind === 'finalized') return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold px-2.5 py-1 rounded-full text-bank-tx"
      style={{ border: '1px solid var(--tx)' }}><Lock size={13} aria-hidden="true" />Finalized</span>
  )
  if (kind === 'onhold') return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold px-2.5 py-1 rounded-full"
      style={{ border: '1px solid var(--warn)', color: 'var(--warn)' }}><AlertTriangle size={13} aria-hidden="true" />On hold</span>
  )
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold px-2.5 py-1 rounded-full"
      style={{ color: 'var(--pos)', border: '1px solid transparent' }}>
      <CheckCircle2 size={15} aria-hidden="true" style={{ fill: 'var(--pos)', color: 'var(--card)' }} />Paid</span>
  )
}

function StandingRow({ row, hint, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-bank-line last:border-0">
      <button onClick={onClickUnlessSelecting(() => setOpen(o => !o))} aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 min-h-[56px] text-left hover:bg-bank-raise transition-colors">
        <StandingChip kind={row.key} />
        <span className="text-[13px] text-bank-mu min-w-0 flex-1 truncate">{plural(row.deals.length, 'job')}{hint ? ` · ${hint}` : ''}</span>
        <span className="text-[16px] font-bold tabular-nums" style={{ color: row.key === 'paid' ? 'var(--pos)' : 'var(--tx)' }}>{fmt(row.total)}</span>
        <ChevronDown size={16} className={`text-bank-fa flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div style={{ background: 'var(--bg)', borderTop: '1px solid var(--line)' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// Earned detail as a compact row (phones). The desktop table keeps every column.
function EarnedRow({ r, basis, users, statusColor, showOverride }) {
  const [open, setOpen] = useState(false)
  const d = r.deal
  const isPaid = d.status === PAID
  const setterUser = users.find(u => u.id === d.setter_id)
  const closerUser = users.find(u => u.id === d.closer_id)
  const installShown = fmtDay(basis === 'install' ? (d.install_date || d.sale_date) : d.install_date) || '—'
  return (
    <div className="border-b border-bank-line last:border-0">
      <button onClick={onClickUnlessSelecting(() => setOpen(o => !o))} aria-expanded={open}
        className="w-full flex items-center gap-3 px-3 py-3 min-h-[44px] text-left hover:bg-bank-raise transition-colors">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-bank-tx truncate">{d.deal_name}</p>
          <p className="text-[13px] text-bank-mu mt-0.5 whitespace-nowrap">{fmtDay(r.date)}</p>
        </div>
        <StatusChip status={d.status} statusColor={statusColor} />
        <span className="text-[14px] font-bold tabular-nums w-[92px] text-right" style={{ color: amountColor(r.total, isPaid) }}>{fmt(r.total)}</span>
        <ChevronDown size={14} className={`text-bank-fa flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3 pb-3 -mt-1">
          <dl className="rounded-xl p-3 text-[13px] grid grid-cols-2 gap-x-4 gap-y-1.5" style={WELL}>
            <dt className="text-bank-fa">Sale Date</dt><dd className="text-bank-tx text-right">{fmtDay(d.sale_date) || '—'}</dd>
            <dt className="text-bank-fa">Install Date</dt><dd className="text-bank-tx text-right">{installShown}</dd>
            <dt className="text-bank-fa">Pay Date</dt><dd className="text-bank-tx text-right">{fmtDay(d.pay_date) || '—'}</dd>
            <dt className="text-bank-fa">Setter</dt><dd className="text-bank-tx text-right truncate">{setterUser?.name || '—'}</dd>
            <dt className="text-bank-fa">Closer</dt><dd className="text-bank-tx text-right truncate">{closerUser?.name || '—'}</dd>
            {showOverride && (<>
              <dt className="text-bank-fa">Rep $</dt><dd className="text-bank-tx text-right tabular-nums">{fmt(r.rep)}</dd>
              <dt className="text-bank-fa">Override $</dt><dd className="text-bank-tx text-right tabular-nums">{fmt(r.override)}</dd>
              <dt className="text-bank-fa">Total $</dt><dd className="text-bank-tx text-right tabular-nums font-semibold">{fmt(r.total)}</dd>
            </>)}
            {!showOverride && (<>
              <dt className="text-bank-fa">Commission $</dt><dd className="text-bank-tx text-right tabular-nums font-semibold">{fmt(r.total)}</dd>
            </>)}
          </dl>
        </div>
      )}
    </div>
  )
}

function StateCard({ kind, message }) {
  if (kind === 'loading') return (
    <div style={{ ...CARD, borderRadius: 14 }} className="p-6 flex items-center justify-center gap-3 text-bank-mu text-[13px]" role="status" aria-live="polite">
      <Loader2 size={16} className="animate-spin text-bank-fa" aria-hidden="true" /> Loading your commissions…
    </div>
  )
  return (
    <div style={{ ...CARD, borderRadius: 14, borderColor: 'var(--neg)' }} className="p-5 flex items-start gap-3" role="alert">
      <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--neg)' }} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-bank-tx">Couldn't load deals</p>
        <p className="text-[13px] text-bank-mu mt-0.5 break-words">Couldn't load deals: {message}</p>
      </div>
    </div>
  )
}

export default function Commissions() {
  const { profile, isAdmin } = useAuth()
  const { statusColor, dataStartDate } = useSettings()
  const [viewId, setViewId] = useState(null)
  const id = viewId || profile?.id
  const [paydayIdx, setPaydayIdx] = useState(0)
  const [payOpen, setPayOpen] = useState(false)
  const [tab, setTab] = useState('owed')            // 'owed' | 'paid' | 'earned'

  const [allDeals, setAllDeals] = useState([])
  const [users, setUsers] = useState([])
  const [adjustments, setAdjustments] = useState([])
  const [loading, setLoading] = useState(true)

  const viewUser = useMemo(() => users.find(u => u.id === id) || profile, [users, id, profile])

  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    setLoading(true); setLoadError('')
    Promise.all([fetchDeals(), fetchUsers(), fetchPayrollAdjustments()])
      .then(([dealsRes, usersRes, adjRes]) => {
        if (dealsRes?.error) throw dealsRes.error
        setAllDeals(activeDeals(dealsRes?.data || []))
        setUsers(usersRes?.data || [])
        setAdjustments(adjRes?.data || [])
      })
      .catch(e => { console.error('Commissions load failed:', e); setLoadError(e?.message || 'Could not load deals.') })
      .finally(() => setLoading(false))
  }, [])
  useRefreshOnFocus(() => fetchDeals().then(({ data }) => setAllDeals(activeDeals(data || []))).catch(() => {}))

  const allMine = useMemo(
    () => allDeals.filter(d => [d.setter_id, d.closer_id, d.manager_id, d.director_id, d.vp_id].includes(id)),
    [allDeals, id]
  )

  const take = (d) => getUserCommission(d, id)

  // ── Total Pipeline: unpaid deals (excludes pre-cutoff legacy, which were
  // never tracked through to Paid — same rule as the rest of the app) ──────────
  const pipelineDeals = useMemo(() => {
    return allMine
      .filter(d => d.status !== PAID && d.status !== ISSUE &&
        !(dataStartDate && d.sale_date && d.sale_date < dataStartDate))
      .slice()
      .sort((a, b) => {
        // overdue first, then by pay date ascending, then TBD last
        const today = todayISO()
        const aOver = a.pay_date && a.pay_date < today
        const bOver = b.pay_date && b.pay_date < today
        if (aOver && !bOver) return -1
        if (!aOver && bOver) return 1
        if (!a.pay_date) return 1
        if (!b.pay_date) return -1
        return a.pay_date.localeCompare(b.pay_date)
      })
  }, [allMine, dataStartDate])

  const pipelineTotal = useMemo(
    () => pipelineDeals.reduce((s, d) => s + take(d), 0),
    [pipelineDeals]
  )

  // Group pipeline deals by pay week (Sun–Sat of the pay_date)
  const pipelineWeeks = useMemo(() => {
    const today = todayISO()
    const weekKey = (payDate) => {
      if (!payDate) return 'tbd'
      const { from } = isoWeek(payDate)
      return from
    }
    const map = {}
    for (const d of pipelineDeals) {
      const key = weekKey(d.pay_date)
      if (!map[key]) {
        const isOverdue = d.pay_date && d.pay_date < today
        const weekStart = key !== 'tbd' ? key : null
        const weekEnd = weekStart ? isoWeek(weekStart).to : null
        map[key] = { key, weekStart, weekEnd, isOverdue: false, deals: [], total: 0 }
      }
      if (d.pay_date && d.pay_date < today) map[key].isOverdue = true
      map[key].deals.push(d)
      map[key].total += take(d)
    }
    return Object.values(map).sort((a, b) => {
      if (a.isOverdue && !b.isOverdue) return -1
      if (!a.isOverdue && b.isOverdue) return 1
      if (!a.weekStart) return 1
      if (!b.weekStart) return -1
      return a.weekStart.localeCompare(b.weekStart)
    })
  }, [pipelineDeals])

  // ── Forward-looking paydays ("what's being paid") ─────────────
  const { paydays, overdue } = useMemo(() => {
    const today = todayISO()
    // An upcoming paycheck shows EVERY payable deal on that date — including
    // ones already marked Paid ahead of the run, and legacy (pre-cutoff) deals
    // (pay-time prompts are deliberately kept for those). Sales-Issue deals are
    // flagged, not payable.
    const byDate = {}
    for (const d of allMine) {
      if (!d.pay_date || d.pay_date < today || d.status === ISSUE) continue
      ;(byDate[d.pay_date] ||= []).push(d)
    }
    const adjByDate = {}
    for (const adj of adjustments) if (adj.payee_id === id && adj.pay_date && adj.pay_date >= today) (adjByDate[adj.pay_date] ||= []).push(adj)
    const dealSum = (arr) => (arr || []).reduce((s, d) => s + take(d), 0)
    const adjSum  = (arr) => (arr || []).reduce((s, a) => s + num(a.amount), 0)
    const dates = [...new Set([...Object.keys(byDate), ...Object.keys(adjByDate)])].sort()
    const paydays = dates.slice(0, 6).map(dt => ({
      date: dt,
      deals: byDate[dt] || [],
      adjustments: adjByDate[dt] || [],
      count: (byDate[dt] || []).length,
      total: dealSum(byDate[dt]) + adjSum(adjByDate[dt]),
    }))
    // Overdue = actionable only: unpaid, past-due, non-legacy.
    const overdue = allMine
      .filter(d => d.pay_date && d.pay_date < today && d.status !== PAID && d.status !== ISSUE &&
        !(dataStartDate && d.sale_date && d.sale_date < dataStartDate))
      .reduce((s, d) => s + take(d), 0)
    return { paydays, overdue }
  }, [allMine, id, adjustments, dataStartDate])

  // ── What this person still OWES (the deduction ledger, migration 050) ──
  // Per Keaton, a rep can see their own. The page is already siloed by
  // identity, and knowing a deduction is coming beats being surprised by a
  // short cheque.
  const ledger     = useMemo(() => buildLedger(adjustments), [adjustments])
  const ledgerById = useMemo(() => Object.fromEntries(ledger.map(d => [d.id, d])), [ledger])
  const myDebts    = useMemo(() => openDebts(ledger).filter(d => d.payee_id === id), [ledger, id])
  const myOwed     = useMemo(() => myDebts.reduce((s, d) => s + d.remaining, 0), [myDebts])
  const dealName   = useMemo(() => {
    const m = Object.fromEntries(allDeals.map(d => [d.id, d.deal_name]))
    return (dealId) => (dealId ? m[dealId] : null)
  }, [allDeals])

  const payIdx = Math.min(paydayIdx, Math.max(paydays.length - 1, 0))
  const selPayday = paydays[payIdx] || null
  useEffect(() => { setPaydayIdx(0) }, [id])

  // "See what's in this paycheck" opens the breakdown and brings it into view.
  const breakdownRef = useRef(null)
  const [scrollToBreakdown, setScrollToBreakdown] = useState(false)
  useEffect(() => {
    if (!payOpen || !scrollToBreakdown) return
    setScrollToBreakdown(false)
    breakdownRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [payOpen, scrollToBreakdown])
  const showPaycheck = () => { setPayOpen(o => !o); setScrollToBreakdown(true) }

  // ── Paid history ("what's been paid") ─────────────────────────
  const paidDeals = useMemo(() => allMine.filter(d => d.status === PAID), [allMine])
  const paidTotals = useMemo(() => {
    const curMonth = todayISO().slice(0, 7)
    let total = 0, mtd = 0
    for (const d of paidDeals) {
      const t = take(d)
      total += t
      if ((d.pay_date || d.sale_date || '').startsWith(curMonth)) mtd += t
    }
    return { total, mtd }
  }, [paidDeals, id])
  const paidGroups = useMemo(() => {
    const m = {}
    for (const d of paidDeals) {
      const k = d.pay_date || 'unscheduled'
      if (!m[k]) m[k] = { key: k, date: d.pay_date || null, deals: [], total: 0 }
      m[k].deals.push(d); m[k].total += take(d)
    }
    return Object.values(m).sort((a, b) => {
      if (!a.date) return 1
      if (!b.date) return -1
      return b.date.localeCompare(a.date)
    })
  }, [paidDeals, id])

  // ── "Where your money stands": display labels over the two lists above.
  // Projected + Finalized (+ On hold, always empty today) == pipelineTotal;
  // Paid == paidTotals.total. Proven in test/redesign-commissions-standing.
  const standing = useMemo(() => standingRows(pipelineDeals, paidDeals, take), [pipelineDeals, paidDeals, id])

  // ── Earned ("what did I actually earn in this window") ────────
  // Deliberately status-blind apart from Sales Issue: Scheduled, Pay Finalized
  // and Paid all count, because this tab measures EARNINGS, not payment state.
  // The Paid / Not-yet-paid split below is what surfaces payment state.
  const [earnedBasis, setEarnedBasis] = useState('sale')     // 'sale' | 'install' | 'pay'
  const [earnedFrom, setEarnedFrom]     = useState(getPresetRange('mtd').from)
  const [earnedTo, setEarnedTo]         = useState(getPresetRange('mtd').to)
  const [earnedPreset, setEarnedPreset] = useState('mtd')
  function handleEarnedRangeChange({ from, to, preset }) {
    setEarnedFrom(from); setEarnedTo(to); setEarnedPreset(preset)
  }

  // The date a deal is measured on under the active basis.
  //   sale    → sale_date, no fallback. A deal with no sale date is dropped
  //             rather than silently counted on some other date; the count is
  //             surfaced under the table so the omission is never invisible.
  //   install → install_date, falling back to sale_date so a sold-but-not-yet-
  //             scheduled deal still lands in a period.
  //   pay     → pay_date, no fallback.
  const earnedDateOf = (d) => {
    if (earnedBasis === 'sale')    return d.sale_date || null
    if (earnedBasis === 'install') return d.install_date || d.sale_date || null
    return d.pay_date || null
  }

  const { earnedRows, earnedMissingDates } = useMemo(() => {
    const inRange = (dt) => {
      if (earnedFrom && dt < earnedFrom) return false
      if (earnedTo   && dt > earnedTo)   return false
      return true
    }
    const candidates = allMine.filter(d => d.status !== ISSUE)
    // Range-independent: deals that carry no date at all on this basis, so the
    // note doesn't flicker as the user scrubs the date range.
    const missing = candidates.filter(d => !earnedDateOf(d)).length
    const rows = candidates
      .map(d => ({ deal: d, date: earnedDateOf(d) }))
      .filter(r => r.date && inRange(r.date))
      .map(r => {
        const parts = myParts(r.deal, id)
        const sum = (roles) => parts.filter(p => roles.includes(p.role)).reduce((s, p) => s + p.amount, 0)
        return {
          ...r,
          rep: sum(REP_ROLES),
          override: sum(OVERRIDE_ROLES),
          total: getUserCommission(r.deal, id),
        }
      })
      .sort((a, b) => b.date.localeCompare(a.date))   // active basis, newest first
    return { earnedRows: rows, earnedMissingDates: missing }
  }, [allMine, id, earnedBasis, earnedFrom, earnedTo])

  const earnedTotals = useMemo(() => {
    let rep = 0, override = 0, total = 0, paid = 0, unpaid = 0
    for (const r of earnedRows) {
      rep += r.rep; override += r.override; total += r.total
      if (r.deal.status === PAID) paid += r.total; else unpaid += r.total
    }
    return { rep, override, total, paid, unpaid, count: earnedRows.length }
  }, [earnedRows])

  // Does the person being viewed actually EARN an override in this range?
  // A plain rep never does (myParts only emits roles they personally hold),
  // so the Override column and card were a permanent $0.00 for most of the
  // roster (per Keaton). Tested per ROW, not on the sum: a positive and a
  // negative override could cancel to zero and the column would still be
  // carrying real numbers.
  const showOverride = useMemo(
    () => earnedRows.some(r => Math.abs(r.override) > 0.005),
    [earnedRows])
  // With no override, `total` is `rep` by construction — every override role
  // contributed 0 — so Rep $ / Total $ and the Rep / Total cards are the same
  // figure printed twice. They collapse to one.

  // Permission tripwire: a plain rep must never see override $ (overrides are
  // siloed to the role-holder in myParts). If one ever does, it's a gating
  // regression — log it to client_errors so the Watchdog surfaces it.
  useEffect(() => {
    if (viewUser?.role !== 'rep') return
    // A rep CAN legitimately hold override money: a demoted manager keeps
    // their manager override on deals sold before the move (Colt), because
    // their id is still stamped as deal.manager_id there. That's their OWN
    // pay, not a leak. A real leak = override dollars shown to someone who is
    // NOT the stamped person for that role on the deal.
    const ROLE_KEY = { Manager: 'manager_id', Director: 'director_id', VP: 'vp_id' }
    const leaked = allMine.reduce((s, d) =>
      s + myParts(d, id)
        .filter(p => ROLE_KEY[p.role] && d[ROLE_KEY[p.role]] !== id)
        .reduce((t, p) => t + p.amount, 0), 0)
    if (leaked > 0.005) {
      logClientError({ message: `Permission leak: rep "${viewUser.name}" shows ${leaked.toFixed(2)} in override commission not assigned to them`, stack: '' })
    }
  }, [viewUser, allMine, id])

  const tabBtn = (key, label) => (
    <button key={key} onClick={() => setTab(key)} aria-pressed={tab === key}
      className={`px-3 py-2 min-h-[44px] md:min-h-0 md:py-1.5 rounded-lg text-[13px] font-semibold transition-colors ${
        tab === key ? 'text-bank-gold-tx' : 'text-bank-mu hover:text-bank-tx'}`}
      style={tab === key ? RAISE : undefined}>
      {label}
    </button>
  )

  const paidList = paidGroups.length === 0 ? (
    <div className="px-4 py-8 text-bank-mu text-[13px] text-center">Nothing paid out yet.</div>
  ) : (
    paidGroups.map(g => (
      <div key={g.key}>
        <div className="flex items-center justify-between px-4 py-2 border-b border-bank-line" style={{ background: 'var(--bg)' }}>
          <span className="text-[13px] font-semibold text-bank-mu">
            {g.date ? `Paid ${fmtDay(g.date)}` : 'No pay date'}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-bank-fa">{plural(g.deals.length, 'deal')}</span>
            <span className="text-[13px] font-bold tabular-nums" style={{ color: 'var(--pos)' }}>{fmt(g.total)}</span>
          </div>
        </div>
        {g.deals.map(d => <DealRow key={d.id} deal={d} id={id} statusColor={statusColor} />)}
      </div>
    ))
  )

  return (
    <div style={{ color: 'var(--tx)', minHeight: '100%' }} className="max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="mb-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-lg md:text-xl font-bold text-bank-tx">
              {viewId && viewId !== profile?.id ? `${viewUser?.name}'s Commissions` : 'My Commissions'}
            </h1>
            <p className="text-[13px] text-bank-mu mt-0.5">{viewUser?.name}</p>
          </div>
          {isAdmin && (
            <select value={viewId || ''} onChange={e => setViewId(e.target.value || null)}
              className="text-[13px] px-3 py-2 min-h-[44px] md:min-h-0 rounded-lg text-bank-tx max-w-[200px] flex-shrink-0"
              style={RAISE}
              title="View another person's commissions" aria-label="View another person's commissions">
              <option value="">My commissions</option>
              {users.filter(u => ['rep','manager','director','vp'].includes(u.role)).slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(u => <option key={u.id} value={u.id}>{u.name}{u.ghost ? ' (ghost)' : ''}</option>)}
            </select>
          )}
        </div>
      </div>

      {loading ? <StateCard kind="loading" /> : loadError ? <StateCard kind="error" message={loadError} /> : (
        <div className="space-y-3 md:space-y-4">

          {/* ── 1. Next payday: the date, the count, the amount, one button ── */}
          <section className="rounded-2xl p-4 md:p-6" style={CARD} aria-labelledby="next-payday-h">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={RAISE}>
                  <CalendarClock size={20} className="text-bank-mu" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p id="next-payday-h" className="text-[13px] uppercase tracking-widest text-bank-fa font-semibold">
                      {payIdx === 0 ? 'Next payday' : 'Upcoming payday'}
                    </p>
                    {paydays.length > 1 && (
                      <span className="text-[13px] font-semibold text-bank-mu px-1.5 py-0.5 rounded-full" style={RAISE}>
                        {payIdx + 1} / {paydays.length}
                      </span>
                    )}
                  </div>
                  {selPayday ? (
                    <p className="text-[15px] md:text-[17px] text-bank-mu mt-0.5">
                      <span className="text-bank-tx font-semibold">{fmtDay(selPayday.date)}</span>
                      {' · '}{plural(selPayday.count, 'deal')}
                    </p>
                  ) : (
                    <p className="text-[15px] text-bank-mu mt-0.5">No scheduled paydays coming up.</p>
                  )}
                </div>
              </div>
              {paydays.length > 1 && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => setPaydayIdx(i => Math.max(0, Math.min(i, paydays.length - 1) - 1))}
                    disabled={payIdx === 0} title="Earlier payday" aria-label="Earlier payday"
                    className="w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded-lg text-bank-mu hover:text-bank-tx hover:bg-bank-raise disabled:opacity-25 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors">
                    <ChevronLeft size={18} />
                  </button>
                  <button onClick={() => setPaydayIdx(i => Math.min(paydays.length - 1, Math.min(i, paydays.length - 1) + 1))}
                    disabled={payIdx >= paydays.length - 1} title="Later payday" aria-label="Later payday"
                    className="w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded-lg text-bank-mu hover:text-bank-tx hover:bg-bank-raise disabled:opacity-25 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors">
                    <ChevronRight size={18} />
                  </button>
                </div>
              )}
            </div>

            <p className="mt-3 text-[40px] md:text-[52px] leading-none font-bold tabular-nums tracking-tight" style={{ color: 'var(--gold-tx)' }}>
              {fmt(selPayday ? selPayday.total : 0)}
            </p>
            {payIdx === 0 && overdue > 0 && (
              <p className="text-[13px] mt-2 flex items-center gap-1.5" style={{ color: 'var(--warn)' }}>
                <AlertTriangle size={13} aria-hidden="true" />{fmt(overdue)} pending from past pay dates
              </p>
            )}

            {selPayday && (
              <button onClick={showPaycheck} aria-expanded={payOpen} aria-controls="paycheck-breakdown"
                className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl text-[13px] font-bold transition-colors hover:brightness-105"
                style={{ background: 'var(--gold)', color: 'var(--gold-ink)' }}>
                {payOpen ? 'Hide paycheck details' : 'See what’s in this paycheck'}
                <ChevronDown size={15} className={`transition-transform ${payOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
            )}
          </section>

          {/* Expanded paycheck breakdown (existing) */}
          {payOpen && selPayday && (
            <div id="paycheck-breakdown" ref={breakdownRef} className="rounded-2xl overflow-hidden scroll-mt-4" style={CARD}>
              <div className="px-4 py-2.5 border-b border-bank-line flex items-center justify-between gap-3 flex-wrap">
                <span className="text-[13px] uppercase tracking-wider text-bank-fa font-semibold">
                  Paycheck · {fmtDay(selPayday.date)}
                </span>
                <span className="text-[13px] text-bank-mu">{plural(selPayday.count, 'deal')} · tap a deal for the breakdown</span>
              </div>
              {selPayday.deals.length === 0 && selPayday.adjustments.length === 0 ? (
                <div className="px-4 py-6 text-bank-mu text-[13px] text-center">Nothing on this paycheck.</div>
              ) : (
                <>
                  {selPayday.deals.map(d => <DealRow key={d.id} deal={d} id={id} statusColor={statusColor} />)}
                  {selPayday.adjustments.map(adj => {
                    const debt = adj.parent_id ? ledgerById[adj.parent_id] : null
                    const line = debt ? recoveryLine(adj, debt) : null
                    return (
                    <div key={adj.id} className="flex items-center justify-between gap-3 px-4 py-3 border-b border-bank-line last:border-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-bank-tx">
                          {debt ? (dealName(adj.deal_id) || 'Deduction') : 'Manual adjustment'}
                        </p>
                        <p className="text-[13px] text-bank-mu mt-0.5">{adj.note || (debt ? 'Deduction' : 'Payroll adjustment')}</p>
                        {line?.detail && <p className="text-[13px] mt-0.5" style={{ color: 'var(--warn)' }}>{line.detail}</p>}
                      </div>
                      <span className="text-[14px] font-bold whitespace-nowrap tabular-nums" style={{ color: num(adj.amount) < 0 ? 'var(--neg)' : 'var(--pos)' }}>
                        {num(adj.amount) < 0 ? '−' : '+'}{fmt(Math.abs(num(adj.amount)))}
                      </span>
                    </div>
                  )})}
                  <div className="flex items-center justify-between px-4 py-3" style={{ background: 'var(--bg)' }}>
                    <span className="text-[13px] font-semibold text-bank-mu">Total this paycheck</span>
                    <span className="text-[15px] font-bold tabular-nums" style={{ color: 'var(--gold-tx)' }}>{fmt(selPayday.total)}</span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── 2. Where your money stands ── */}
          <section className="rounded-2xl overflow-hidden" style={CARD} aria-labelledby="standing-h">
            <div className="px-4 py-3 border-b border-bank-line">
              <h2 id="standing-h" className="text-[15px] font-bold text-bank-tx">Where your money stands</h2>
              <p className="text-[13px] text-bank-mu mt-0.5">Tap a line to see the jobs behind it.</p>
            </div>
            <StandingRow row={standing.projected} hint="not yet locked for a pay run">
              {standing.projected.deals.length === 0
                ? <div className="px-4 py-5 text-bank-mu text-[13px] text-center">Nothing projected right now.</div>
                : standing.projected.deals.map(d => <DealRow key={d.id} deal={d} id={id} statusColor={statusColor} />)}
            </StandingRow>
            <StandingRow row={standing.finalized} hint="locked for a pay run">
              {standing.finalized.deals.length === 0
                ? <div className="px-4 py-5 text-bank-mu text-[13px] text-center">Nothing finalized yet.</div>
                : standing.finalized.deals.map(d => <DealRow key={d.id} deal={d} id={id} statusColor={statusColor} />)}
            </StandingRow>
            {standing.onHold.deals.length > 0 && (
              <StandingRow row={standing.onHold} hint="Sales Issue · not counted">
                {standing.onHold.deals.map(d => <DealRow key={d.id} deal={d} id={id} statusColor={statusColor} />)}
              </StandingRow>
            )}
            <StandingRow row={standing.paid} hint={`all time · ${fmt(paidTotals.mtd)} this month`}>
              {paidList}
            </StandingRow>
          </section>

          {/* ── 3. Everything else, nothing removed ── */}

          {/* What you still owe (deduction ledger, migration 050). Shown to the
              rep themselves (per Keaton). A deduction logged against a job
              that already paid out comes off a FUTURE cheque. */}
          {myDebts.length > 0 && (
            <section className="rounded-2xl overflow-hidden" style={{ ...CARD, borderColor: WARN_BORDER }}>
              <Expandable tone="var(--warn)"
                title={<span className="inline-flex items-center gap-2"><AlertTriangle size={13} aria-hidden="true" />{fmt(myOwed)} in deductions still to come out</span>}
                meta={`${plural(myDebts.length, 'item')} · tap for the list`}>
                {myDebts.map(d => (
                  <div key={d.id} className="flex items-start justify-between gap-3 px-4 py-2.5 border-t border-bank-line" style={{ background: 'var(--bg)' }}>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-bank-tx truncate">{dealName(d.deal_id) || 'No job'}</p>
                      {d.note && <p className="text-[13px] text-bank-mu mt-0.5 truncate">{d.note}</p>}
                      {d.recovered > 0 && (
                        <p className="text-[13px] text-bank-fa mt-0.5 tabular-nums">{fmt(d.recovered)} of {fmt(d.owed)} already taken</p>
                      )}
                    </div>
                    <span className="text-[13px] font-bold whitespace-nowrap tabular-nums" style={{ color: 'var(--neg)' }}>{fmt(d.remaining)}</span>
                  </div>
                ))}
                <p className="px-4 py-2 text-[13px] text-bank-mu border-t border-bank-line" style={{ background: 'var(--bg)' }}>
                  It comes off a future paycheck — the run it lands on is set by leadership, not automatically.
                </p>
              </Expandable>
            </section>
          )}

          {/* Owed / Paid — the two numbers that matter */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card label="Owed to you" value={fmt(pipelineTotal)}
              sub={`${plural(pipelineDeals.length, 'unpaid deal')}${overdue > 0 ? ` · ${fmt(overdue)} overdue` : ''}`} />
            <Card label="Paid out" value={fmt(paidTotals.total)} color="var(--pos)"
              sub={`all time · ${fmt(paidTotals.mtd)} this month`} />
          </div>

          {/* Owed / Paid / Earned deal lists */}
          <div className="rounded-2xl overflow-hidden" style={CARD}>
            <div className="px-3 md:px-4 py-2.5 border-b border-bank-line flex items-center justify-between gap-3 flex-wrap">
              <div className="flex flex-wrap gap-1 p-1 rounded-xl" style={WELL} role="tablist">
                {tabBtn('owed', `To be paid (${pipelineDeals.length})`)}
                {tabBtn('paid', `Paid (${paidDeals.length})`)}
                {tabBtn('earned', 'Earned')}
              </div>
              <span className="text-[13px] text-bank-mu">
                {tab === 'owed'
                  ? 'grouped by pay week · tap a week'
                  : tab === 'paid'
                    ? 'grouped by pay date · tap a deal'
                    : `by ${basisLabel(earnedBasis)} · ${presetLabel(earnedPreset)}`}
              </span>
            </div>

            {tab === 'owed' ? (
              pipelineWeeks.length === 0 ? (
                <div className="px-4 py-8 text-bank-mu text-[13px] text-center">No unpaid deals — you're all caught up!</div>
              ) : (
                pipelineWeeks.map(week => (
                  <PipelineWeekGroup key={week.key} week={week} id={id} users={users} statusColor={statusColor} />
                ))
              )
            ) : tab === 'paid' ? (
              paidList
            ) : (
              /* ── Earned ─────────────────────────────────────────── */
              <div className="p-3 md:p-4 space-y-3">
                {/* Date range — same shared filter every other page uses */}
                <DateRangeFilter from={earnedFrom} to={earnedTo} preset={earnedPreset}
                  onChange={handleEarnedRangeChange} />

                {/* Date basis */}
                <div className="flex flex-wrap gap-1 p-1 rounded-xl w-fit" style={WELL} role="group" aria-label="Date basis">
                  {EARNED_BASES.map(b => (
                    <button key={b.key} onClick={() => setEarnedBasis(b.key)} aria-pressed={earnedBasis === b.key}
                      className={`px-3 py-2 min-h-[44px] md:min-h-0 md:py-1 rounded-lg text-[13px] font-semibold transition-colors ${
                        earnedBasis === b.key ? 'text-bank-gold-tx' : 'text-bank-mu hover:text-bank-tx'}`}
                      style={earnedBasis === b.key ? RAISE : undefined}>
                      {b.label}
                    </button>
                  ))}
                </div>

                {/* Summary cards — every one names the active basis, so a
                    number can never be read against the wrong date. */}
                <div className={`grid grid-cols-1 ${showOverride ? 'md:grid-cols-4' : 'md:grid-cols-2'} gap-3`}>
                  {showOverride ? (
                    <>
                      <Card label="Rep Commission" value={fmt(earnedTotals.rep)}
                        sub={`setter + closer · by ${basisLabel(earnedBasis)}`} />
                      <Card label="Override" value={fmt(earnedTotals.override)}
                        sub={`mgr · dir · VP · by ${basisLabel(earnedBasis)}`} />
                      <Card label={`Total Earned — by ${basisLabel(earnedBasis)}`} value={fmt(earnedTotals.total)}
                        sub={presetLabel(earnedPreset)} />
                    </>
                  ) : (
                    <Card label={`Commission Earned — by ${basisLabel(earnedBasis)}`} value={fmt(earnedTotals.total)}
                      sub={`setter + closer · ${presetLabel(earnedPreset)}`} />
                  )}
                  <Card label="Deal Count" value={String(earnedTotals.count)}
                    sub={`by ${basisLabel(earnedBasis)}`} />
                </div>

                {/* Paid vs not-yet-paid split of Total Earned */}
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-3 py-2 rounded-xl" style={WELL}>
                  <span className="text-[13px] text-bank-mu">
                    Already Paid
                    <span className="text-[13px] font-bold ml-1.5 tabular-nums" style={{ color: 'var(--pos)' }}>{fmt(earnedTotals.paid)}</span>
                  </span>
                  <span className="text-[13px] text-bank-mu">
                    Not Yet Paid
                    <span className="text-[13px] font-bold ml-1.5 tabular-nums text-bank-tx">{fmt(earnedTotals.unpaid)}</span>
                  </span>
                  <span className="text-[13px] text-bank-fa">of {fmt(earnedTotals.total)} earned</span>
                </div>

                {/* Detail — header states the basis, and the column the rows
                    are sorted/filtered on is highlighted. */}
                <div className="flex items-baseline justify-between gap-3 flex-wrap pt-1">
                  <span className="text-[13px] uppercase tracking-wider text-bank-fa font-semibold">
                    Detail — by {basisLabel(earnedBasis)}
                  </span>
                  <span className="text-[13px] text-bank-fa">newest first · {presetLabel(earnedPreset)}</span>
                </div>

                {earnedRows.length === 0 ? (
                  <div className="px-4 py-8 text-bank-mu text-[13px] text-center">
                    Nothing earned in this range by {basisLabel(earnedBasis)}.
                  </div>
                ) : (
                  <>
                    {/* Phones: one compact row per job, tap to expand. */}
                    <div className="md:hidden rounded-xl overflow-hidden" style={{ border: '1px solid var(--line)' }}>
                      {earnedRows.map(r => (
                        <EarnedRow key={r.deal.id} r={r} basis={earnedBasis} users={users} statusColor={statusColor} showOverride={showOverride} />
                      ))}
                      <div className="flex items-center justify-between px-3 py-3 border-t border-bank-line" style={{ background: 'var(--bg)' }}>
                        <span className="text-[13px] font-semibold text-bank-mu">{plural(earnedTotals.count, 'deal')} · by {basisLabel(earnedBasis)}</span>
                        <span className="text-[13px] font-bold text-bank-tx tabular-nums">{fmt(earnedTotals.total)}</span>
                      </div>
                    </div>

                    {/* Desktop: the full table. */}
                    <div className="hidden md:block rounded-xl overflow-x-auto" style={{ border: '1px solid var(--line)' }}>
                      <table className="w-full">
                        <thead>
                          <tr style={{ background: 'var(--raise)' }}>
                            <th className="px-3 py-3 text-[13px] font-bold text-bank-fa uppercase tracking-wider text-left whitespace-nowrap">Customer</th>
                            {[['sale', 'Sale Date'], ['install', 'Install Date'], ['pay', 'Pay Date']].map(([k, h]) => (
                              <th key={k} className={`px-3 py-3 text-[13px] font-bold uppercase tracking-wider text-left whitespace-nowrap ${earnedBasis === k ? 'text-bank-gold-tx' : 'text-bank-fa'}`}>
                                {h}{earnedBasis === k ? ' ▾' : ''}
                              </th>
                            ))}
                            {['Setter', 'Closer'].map(h => (
                              <th key={h} className="px-3 py-3 text-[13px] font-bold text-bank-fa uppercase tracking-wider text-left whitespace-nowrap">{h}</th>
                            ))}
                            {(showOverride ? ['Rep $', 'Override $', 'Total $'] : ['Commission $']).map(h => (
                              <th key={h} className="px-3 py-3 text-[13px] font-bold text-bank-fa uppercase tracking-wider text-right whitespace-nowrap">{h}</th>
                            ))}
                            <th className="px-3 py-3 text-[13px] font-bold text-bank-fa uppercase tracking-wider text-left whitespace-nowrap">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {earnedRows.map((r, i) => {
                            const d = r.deal
                            const setterUser = users.find(u => u.id === d.setter_id)
                            const closerUser = users.find(u => u.id === d.closer_id)
                            // The active basis column reads brighter than the others.
                            const dateCls = (k) => `px-3 py-3 text-[13px] whitespace-nowrap ${
                              earnedBasis === k ? 'text-bank-tx font-semibold' : 'text-bank-mu'}`
                            return (
                              <tr key={d.id}
                                style={{ background: i % 2 === 0 ? 'var(--card)' : 'var(--bg)' }}
                                className="hover:bg-bank-raise transition-colors">
                                <td className="px-3 py-3">
                                  <div className="text-[13px] font-semibold text-bank-tx truncate max-w-[220px]">{d.deal_name}</div>
                                </td>
                                <td className={dateCls('sale')}>{fmtDay(d.sale_date) || '—'}</td>
                                <td className={dateCls('install')}>
                                  {fmtDay(earnedBasis === 'install' ? (d.install_date || d.sale_date) : d.install_date) || '—'}
                                </td>
                                <td className={dateCls('pay')}>{fmtDay(d.pay_date) || '—'}</td>
                                <td className="px-3 py-3 text-[13px] text-bank-mu whitespace-nowrap">{setterUser?.name || '—'}</td>
                                <td className="px-3 py-3 text-[13px] text-bank-mu whitespace-nowrap">{closerUser?.name || '—'}</td>
                                {showOverride && (
                                  <>
                                    <td className="px-3 py-3 text-[13px] text-right font-semibold text-bank-tx whitespace-nowrap tabular-nums">{fmt(r.rep)}</td>
                                    <td className="px-3 py-3 text-[13px] text-right font-semibold text-bank-tx whitespace-nowrap tabular-nums">{fmt(r.override)}</td>
                                  </>
                                )}
                                <td className="px-3 py-3 text-[13px] text-right font-bold whitespace-nowrap tabular-nums"
                                  style={{ color: amountColor(r.total, d.status === PAID) }}>
                                  {fmt(r.total)}
                                </td>
                                <td className="px-3 py-3 whitespace-nowrap">
                                  <StatusChip status={d.status} statusColor={statusColor} />
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: 'var(--raise)', borderTop: '1px solid var(--line)' }}>
                            <td className="px-3 py-3 text-[13px] font-semibold text-bank-mu whitespace-nowrap" colSpan={6}>
                              {plural(earnedTotals.count, 'deal')} · by {basisLabel(earnedBasis)}
                            </td>
                            {showOverride && (
                              <>
                                <td className="px-3 py-3 text-[13px] text-right font-bold text-bank-tx whitespace-nowrap tabular-nums">{fmt(earnedTotals.rep)}</td>
                                <td className="px-3 py-3 text-[13px] text-right font-bold text-bank-tx whitespace-nowrap tabular-nums">{fmt(earnedTotals.override)}</td>
                              </>
                            )}
                            <td className="px-3 py-3 text-[13px] text-right font-bold text-bank-tx whitespace-nowrap tabular-nums">{fmt(earnedTotals.total)}</td>
                            <td className="px-3 py-3" />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </>
                )}

                {/* Deals this basis can't place on the timeline at all. */}
                {earnedMissingDates > 0 && (
                  <p className="text-[13px] text-bank-mu">
                    {plural(earnedMissingDates, 'deal')} excluded
                    {' '}(no {basisLabel(earnedBasis).toLowerCase()})
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
