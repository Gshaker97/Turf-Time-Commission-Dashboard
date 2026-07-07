import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, CalendarClock, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import { fetchDeals, fetchUsers, fetchPayrollAdjustments, logClientError } from '../lib/db'
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { dealAmounts, getUserCommission, fmt, activeDeals, deductionLabel } from '../utils/commission'

const todayISO = () => new Date().toISOString().slice(0, 10)
// Sunday–Saturday week containing the given date (ISO strings).
const isoWeek = (dateStr) => {
  const d = dateStr ? new Date(dateStr + 'T12:00:00') : new Date()
  const dow = d.getDay()                                  // 0 = Sunday
  const sun = new Date(d); sun.setDate(d.getDate() - dow)
  const sat = new Date(sun); sat.setDate(sun.getDate() + 6)
  const iso = (x) => x.toISOString().slice(0, 10)
  return { from: iso(sun), to: iso(sat) }
}
const PAID = 'Paid'                 // status that means the commission has been paid out
const ISSUE = 'Sales Issue'         // status that means the deal is in trouble
const fmtDay = (iso) => iso ? format(new Date(iso + 'T12:00:00'), 'EEE, MMM d') : null
const num = (v) => Number(v) || 0
const pct = (n) => { const v = (Number(n) || 0) * 100; return (Number.isInteger(v) ? v : v.toFixed(2)) + '%' }

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

function Card({ label, value, color, sub }) {
  return (
    <div style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12 }} className="p-3 md:p-4">
      <div className="text-[9px] md:text-[11px] uppercase tracking-wider text-white/30 font-semibold mb-1.5">{label}</div>
      <div className="text-[16px] md:text-2xl font-bold truncate" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] text-white/30 mt-0.5">{sub}</div>}
    </div>
  )
}

function DealRow({ deal, id, statusColor }) {
  const [open, setOpen] = useState(false)
  const a = dealAmounts(deal)
  const parts = myParts(deal, id)
  const take = parts.reduce((s, p) => s + p.amount, 0)
  const repPool = a.job - a.baseline
  const color = statusColor(deal.status)
  const isPaid = deal.status === PAID

  return (
    <div className="border-b border-white/5 last:border-0">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-white/90 truncate">{deal.deal_name}</p>
          <p className="text-[11px] text-white/40 mt-0.5">{parts.map(p => p.role).join(' · ') || '—'}</p>
        </div>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0"
          style={{ color, border: `1px solid ${color}40` }}>{deal.status}</span>
        <div className="text-right flex-shrink-0 w-[88px]">
          <p className="text-[14px] font-bold" style={{ color: take < 0 ? '#f87171' : isPaid ? '#74b9ff' : '#fff' }}>{fmt(take)}</p>
        </div>
        <ChevronDown size={14} className={`text-white/30 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-3 -mt-1">
          <div className="rounded-lg p-3 text-[12px]" style={{ background: '#171717', border: '1px solid #262626' }}>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-white/40 mb-2">
              <span>Job price <span className="text-white/70">{fmt(a.job)}</span></span>
              <span>Baseline <span className="text-white/70">{fmt(a.baseline)}</span></span>
              <span>Rep pool <span className="text-white/70">{fmt(repPool)}</span></span>
              {a.exclusionsTotal > 0 && (
                <span>Override base <span className="text-white/70">{fmt(a.overrideBase)}</span><span className="text-white/25"> (−{fmt(a.exclusionsTotal)} excluded)</span></span>
              )}
            </div>
            {parts.map(p => (
              <div key={p.role} className="py-1 border-t border-white/5">
                <div className="flex items-center justify-between">
                  <span className="text-white/55">
                    {p.detail}{p.partner ? <span className="text-white/40"> · with {p.partner}</span> : null}
                  </span>
                  <span className="font-semibold text-white">{fmt(p.ded > 0 ? p.gross : p.amount)}</span>
                </div>
                {p.ded > 0 && (
                  <div className="flex items-center justify-between text-[11px] text-red-400/90 mt-0.5">
                    <span>− Deduction ({deductionLabel(deal, a)})</span>
                    <span>−{fmt(p.ded)}</span>
                  </div>
                )}
              </div>
            ))}
            {a.deduction > 0 && !parts.some(p => p.ded > 0) && (
              <div className="flex items-start gap-1.5 pt-2 mt-1 border-t border-white/5 text-[11px] text-red-400/90">
                <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                <span>This deal has a {fmt(a.deduction)} deduction — {deductionLabel(deal, a)} (already reflected in your take).</span>
              </div>
            )}
            <div className="flex items-center justify-between pt-2 mt-1 border-t border-white/10">
              <span className="text-white/40">{isPaid ? 'Paid' : 'Expected'} {fmtDay(deal.pay_date) ? `· ${fmtDay(deal.pay_date)}` : '· pay date TBD'}</span>
              <span className={`text-[13px] font-bold ${take < 0 ? 'text-red-400' : 'text-teal'}`}>Your take {fmt(take)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Pipeline Week Group — collapsible week header for pipeline tab ────────────
function PipelineWeekGroup({ week, id, users, statusColor }) {
  const [open, setOpen] = useState(false)
  const weekLabel = week.weekStart
    ? `${format(new Date(week.weekStart + 'T12:00:00'), 'MMM d')} – ${format(new Date(week.weekEnd + 'T12:00:00'), 'MMM d')}`
    : 'Pay date TBD'

  return (
    <div className="border-b border-white/5 last:border-0">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-2">
          {week.isOverdue && <span className="text-amber-400 text-[11px]">⚠</span>}
          <span className="text-[13px] font-semibold" style={{ color: week.isOverdue ? '#fbbf24' : 'rgba(255,255,255,0.8)' }}>
            {weekLabel}
          </span>
          <span className="text-[11px] text-white/30">{week.deals.length} deal{week.deals.length === 1 ? '' : 's'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-bold text-teal">{fmt(week.total)}</span>
          <ChevronDown size={14} className={`text-white/30 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {open && week.deals.map(d => (
        <PipelineRow key={d.id} deal={d} id={id} users={users} statusColor={statusColor} />
      ))}
    </div>
  )
}

// ── Pipeline Row — flat row used in the Total Pipeline tab ────────────────────
function PipelineRow({ deal, id, users, statusColor }) {
  const a = dealAmounts(deal)
  const parts = myParts(deal, id)
  const myTake = parts.reduce((s, p) => s + p.amount, 0)
  const color = statusColor(deal.status)
  const isPaid = deal.status === PAID
  const isOverdue = deal.pay_date && deal.pay_date < todayISO() && !isPaid

  const closerUser = users.find(u => u.id === deal.closer_id)
  const setterUser = users.find(u => u.id === deal.setter_id)

  return (
    <div className="border-b border-white/5 last:border-0 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-white/90 truncate">{deal.deal_name}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
            {closerUser && (
              <span className="text-[11px] text-white/40">
                Closer: <span className="text-white/65">{closerUser.name}</span>
              </span>
            )}
            {setterUser && setterUser.id !== closerUser?.id && (
              <span className="text-[11px] text-white/40">
                Setter: <span className="text-white/65">{setterUser.name}</span>
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
            {deal.install_date && (
              <span className="text-[11px] text-white/40">
                Install: <span className="text-white/55">{fmtDay(deal.install_date)}</span>
              </span>
            )}
            {deal.pay_date ? (
              <span className="text-[11px]" style={{ color: isOverdue ? '#fbbf24' : 'rgba(255,255,255,0.4)' }}>
                Pay: <span style={{ color: isOverdue ? '#fbbf24' : 'rgba(255,255,255,0.55)' }}>
                  {fmtDay(deal.pay_date)}{isOverdue ? ' ⚠ overdue' : ''}
                </span>
              </span>
            ) : (
              <span className="text-[11px] text-white/30">Pay date TBD</span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
            style={{ color, border: `1px solid ${color}40` }}>{deal.status}</span>
          <span className="text-[14px] font-bold" style={{ color: myTake < 0 ? '#f87171' : isPaid ? '#74b9ff' : '#e2e8f0' }}>
            {fmt(myTake)}
          </span>
        </div>
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
  const [tab, setTab] = useState('owed')            // 'owed' | 'paid'

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

  const payIdx = Math.min(paydayIdx, Math.max(paydays.length - 1, 0))
  const selPayday = paydays[payIdx] || null
  useEffect(() => { setPaydayIdx(0) }, [id])

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

  // Permission tripwire: a plain rep must never see override $ (overrides are
  // siloed to the role-holder in myParts). If one ever does, it's a gating
  // regression — log it to client_errors so the Watchdog surfaces it.
  useEffect(() => {
    if (viewUser?.role !== 'rep') return
    const overrides = allMine.reduce((s, d) =>
      s + myParts(d, id).filter(p => p.role !== 'Setter' && p.role !== 'Closer').reduce((t, p) => t + p.amount, 0), 0)
    if (overrides > 0.005) {
      logClientError({ message: `Permission leak: rep "${viewUser.name}" shows ${overrides.toFixed(2)} in override commission`, stack: '' })
    }
  }, [viewUser, allMine, id])

  return (
    <div style={{ background: '#1a1a1a', color: '#fff', minHeight: '100%' }}>
      {/* Header */}
      <div className="mb-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-lg md:text-xl font-bold text-white">
              {viewId && viewId !== profile?.id ? `${viewUser?.name}'s Commissions` : 'My Commissions'}
            </h1>
            <p className="text-[12px] text-white/40 mt-0.5">{viewUser?.name}</p>
          </div>
          {isAdmin && (
            <select value={viewId || ''} onChange={e => setViewId(e.target.value || null)}
              className="text-[12px] px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white max-w-[180px] flex-shrink-0"
              title="View another person's commissions">
              <option value="" style={{ background: '#2a2a2a' }}>My commissions</option>
              {users.filter(u => ['rep','manager','director','vp'].includes(u.role)).slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(u => <option key={u.id} value={u.id} style={{ background: '#2a2a2a' }}>{u.name}{u.ghost ? ' (ghost)' : ''}</option>)}
            </select>
          )}
        </div>
      </div>

      <>
          {/* Next payday hero */}
          <div onClick={() => selPayday && setPayOpen(o => !o)}
            className={`rounded-2xl p-4 md:p-5 ${payOpen ? '' : 'mb-4'} flex items-center gap-4 ${selPayday ? 'cursor-pointer hover:brightness-110 transition-all' : ''}`}
            style={{ background: 'linear-gradient(135deg,#143d34,#1e1e1e)', border: '1px solid #1f5a4d' }}
            title={selPayday ? 'Click to see the deals on this paycheck' : undefined}>
            <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: '#00b89422', border: '1px solid #00b89440' }}>
              <CalendarClock size={20} className="text-teal" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-[10px] uppercase tracking-widest text-white/40 font-semibold">
                  {payIdx === 0 ? 'Next payday' : 'Upcoming payday'}
                </p>
                {paydays.length > 1 && (
                  <span className="text-[9px] font-semibold text-white/45 px-1.5 py-0.5 rounded-full" style={{ background: '#ffffff14' }}>
                    {payIdx + 1} / {paydays.length}
                  </span>
                )}
              </div>
              {selPayday ? (
                <p className="text-[13px] text-white/70">
                  <span className="text-white font-semibold">{fmtDay(selPayday.date)}</span>
                  {' · '}{selPayday.count} deal{selPayday.count === 1 ? '' : 's'}
                </p>
              ) : (
                <p className="text-[13px] text-white/50">No scheduled paydays coming up.</p>
              )}
              {payIdx === 0 && overdue > 0 && (
                <p className="text-[11px] text-amber-400/90 mt-0.5">{fmt(overdue)} pending from past pay dates</p>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {paydays.length > 1 && (
                <button onClick={(e) => { e.stopPropagation(); setPaydayIdx(i => Math.max(0, Math.min(i, paydays.length - 1) - 1)) }}
                  disabled={payIdx === 0}
                  title="Earlier payday"
                  className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors">
                  <ChevronLeft size={18} />
                </button>
              )}
              <div className="text-right min-w-[92px]">
                <p className="text-2xl md:text-3xl font-bold text-teal">{fmt(selPayday ? selPayday.total : 0)}</p>
              </div>
              {paydays.length > 1 && (
                <button onClick={(e) => { e.stopPropagation(); setPaydayIdx(i => Math.min(paydays.length - 1, Math.min(i, paydays.length - 1) + 1)) }}
                  disabled={payIdx >= paydays.length - 1}
                  title="Later payday"
                  className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors">
                  <ChevronRight size={18} />
                </button>
              )}
              {selPayday && <ChevronDown size={18} className={`text-white/40 transition-transform ${payOpen ? 'rotate-180' : ''}`} />}
            </div>
          </div>

          {/* Expanded paycheck breakdown */}
          {payOpen && selPayday && (
            <div className="rounded-2xl mb-4 overflow-hidden" style={{ background: '#1e1e1e', border: '1px solid #1f5a4d' }}>
              <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider text-white/40 font-semibold">
                  Paycheck · {fmtDay(selPayday.date)}
                </span>
                <span className="text-[11px] text-white/30">{selPayday.count} deal{selPayday.count === 1 ? '' : 's'} · tap a deal for the breakdown</span>
              </div>
              {selPayday.deals.length === 0 && selPayday.adjustments.length === 0 ? (
                <div className="px-4 py-6 text-white/30 text-sm text-center">Nothing on this paycheck.</div>
              ) : (
                <>
                  {selPayday.deals.map(d => <DealRow key={d.id} deal={d} id={id} statusColor={statusColor} />)}
                  {selPayday.adjustments.map(adj => (
                    <div key={adj.id} className="flex items-center justify-between px-4 py-3 border-b border-white/5 last:border-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-white/90">Manual adjustment</p>
                        <p className="text-[11px] text-white/40 mt-0.5">{adj.note || 'Payroll adjustment'}</p>
                      </div>
                      <span className={`text-[14px] font-bold whitespace-nowrap ${num(adj.amount) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                        {num(adj.amount) < 0 ? '−' : '+'}{fmt(Math.abs(num(adj.amount)))}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-4 py-3 bg-white/[0.02]">
                    <span className="text-[12px] font-semibold text-white/50">Total this paycheck</span>
                    <span className="text-[15px] font-bold text-teal">{fmt(selPayday.total)}</span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Owed / Paid — the two numbers that matter */}
          <div className="grid grid-cols-2 gap-2 md:gap-3 mb-3">
            <Card label="Owed to you" value={fmt(pipelineTotal)} color="#fdcb6e"
              sub={`${pipelineDeals.length} unpaid deal${pipelineDeals.length === 1 ? '' : 's'}${overdue > 0 ? ` · ${fmt(overdue)} overdue` : ''}`} />
            <Card label="Paid out" value={fmt(paidTotals.total)} color="#74b9ff"
              sub={`all time · ${fmt(paidTotals.mtd)} this month`} />
          </div>

          {/* Owed / Paid deal lists */}
          <div style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12, overflow: 'hidden' }}>
            <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex gap-1 p-1 rounded-xl" style={{ background: '#171717', border: '1px solid #262626' }}>
                <button onClick={() => setTab('owed')}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${tab === 'owed' ? 'bg-teal text-dark' : 'text-white/50 hover:text-white'}`}>
                  To be paid ({pipelineDeals.length})
                </button>
                <button onClick={() => setTab('paid')}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${tab === 'paid' ? 'bg-teal text-dark' : 'text-white/50 hover:text-white'}`}>
                  Paid ({paidDeals.length})
                </button>
              </div>
              <span className="text-[11px] text-white/30">
                {tab === 'owed' ? 'grouped by pay week · tap a week' : 'grouped by pay date · tap a deal'}
              </span>
            </div>

            {loading ? (
              <div className="px-4 py-8 text-white/30 text-sm text-center">Loading…</div>
            ) : loadError ? (
              <div className="px-4 py-8 text-red-300 text-sm text-center">Couldn't load deals: {loadError}</div>
            ) : tab === 'owed' ? (
              pipelineWeeks.length === 0 ? (
                <div className="px-4 py-8 text-white/30 text-sm text-center">No unpaid deals — you're all caught up!</div>
              ) : (
                pipelineWeeks.map(week => (
                  <PipelineWeekGroup key={week.key} week={week} id={id} users={users} statusColor={statusColor} />
                ))
              )
            ) : (
              paidGroups.length === 0 ? (
                <div className="px-4 py-8 text-white/30 text-sm text-center">Nothing paid out yet.</div>
              ) : (
                paidGroups.map(g => (
                  <div key={g.key}>
                    <div className="flex items-center justify-between px-4 py-2 bg-white/[0.02] border-b border-white/5">
                      <span className="text-[11px] font-semibold text-white/50">
                        {g.date ? `Paid ${fmtDay(g.date)}` : 'No pay date'}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-white/30">{g.deals.length} deal{g.deals.length === 1 ? '' : 's'}</span>
                        <span className="text-[12px] font-bold" style={{ color: '#74b9ff' }}>{fmt(g.total)}</span>
                      </div>
                    </div>
                    {g.deals.map(d => <DealRow key={d.id} deal={d} id={id} statusColor={statusColor} />)}
                  </div>
                ))
              )
            )}
          </div>
        </>
    </div>
  )
}