import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, CalendarClock, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import { fetchDeals, fetchUsers, fetchPayrollAdjustments } from '../lib/db'
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { dealAmounts, getUserCommission, fmt, activeDeals } from '../utils/commission'
import { getPresetRange, matchPreset, rangeMatches, presetLabel, PRESETS, PRESETS_BY_KEY } from '../utils/dateRanges'

const todayISO = () => new Date().toISOString().slice(0, 10)
const inRange = (date, from, to) => !!date && (!from || date >= from) && (!to || date <= to)
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
  if (deal.manager_id  === id) parts.push({ role: 'Manager',  amount: a.manager,  gross: a.manager,  ded: 0, partner: null, detail: `${pct(deal.manager_override_pct)} override of baseline` })
  if (deal.director_id === id) parts.push({ role: 'Director', amount: a.director, gross: a.director, ded: 0, partner: null, detail: `${pct(deal.director_override_pct)} override of baseline` })
  if (deal.vp_id       === id) parts.push({ role: 'VP',       amount: a.vp,       gross: a.vp,       ded: 0, partner: null, detail: `${pct(deal.vp_override_pct)} override of baseline` })
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
                    <span>− Deduction{deal.deduction_note ? ` (${deal.deduction_note})` : ''}</span>
                    <span>−{fmt(p.ded)}</span>
                  </div>
                )}
              </div>
            ))}
            {a.deduction > 0 && !parts.some(p => p.ded > 0) && (
              <div className="flex items-start gap-1.5 pt-2 mt-1 border-t border-white/5 text-[11px] text-red-400/90">
                <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                <span>This deal has a {fmt(a.deduction)} deduction{deal.deduction_note ? ` — ${deal.deduction_note}` : ''} (already reflected in your take).</span>
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
  const { statusColor, statusLabels } = useSettings()
  const [viewId, setViewId] = useState(null)
  const id = viewId || profile?.id
  const [from,   setFrom]   = useState(getPresetRange('mtd').from)
  const [to,     setTo]     = useState(getPresetRange('mtd').to)
  const [preset, setPreset] = useState('mtd')
  const [basis,  setBasis]  = useState('sale')      // 'sale' | 'pay' | 'pipeline'
  const [paydayIdx, setPaydayIdx] = useState(0)
  const [payOpen, setPayOpen] = useState(false)

  const stepWeek = (dir) => {
    const anchor = new Date((from || todayISO()) + 'T12:00:00')
    anchor.setDate(anchor.getDate() + dir * 7)
    const r = isoWeek(anchor.toISOString().slice(0, 10))
    setFrom(r.from); setTo(r.to); setPreset('custom')
  }
  const goThisWeek = () => { const r = isoWeek(todayISO()); setFrom(r.from); setTo(r.to); setPreset('custom') }
  const [allDeals, setAllDeals] = useState([])
  const [users, setUsers] = useState([])
  const [adjustments, setAdjustments] = useState([])
  const [loading, setLoading] = useState(true)

  const periodLabel = presetLabel(rangeMatches(preset, from, to) ? preset : matchPreset(from, to))
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

  const periodMine = useMemo(
    () => allMine.filter(d => inRange(basis === 'pay' ? d.pay_date : d.sale_date, from, to)),
    [allMine, from, to, basis]
  )

  const take = (d) => getUserCommission(d, id)

  // ── Total Pipeline: ALL unpaid deals across all time ─────────
  const pipelineDeals = useMemo(() => {
    return allMine
      .filter(d => d.status !== PAID && d.status !== ISSUE)
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
  }, [allMine])

  const pipelineTotal = useMemo(
    () => pipelineDeals.reduce((s, d) => s + take(d), 0),
    [pipelineDeals]
  )

  const pipelineOverdue = useMemo(() => {
    const today = todayISO()
    return pipelineDeals.filter(d => d.pay_date && d.pay_date < today).reduce((s, d) => s + take(d), 0)
  }, [pipelineDeals])

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

  // ── Forward-looking paydays ───────────────────────────────────
  const { paydays, overdue } = useMemo(() => {
    const today = todayISO()
    const unpaid = allMine.filter(d => d.status !== PAID && d.status !== ISSUE && d.pay_date)
    const byDate = {}
    for (const d of unpaid) (byDate[d.pay_date] ||= []).push(d)
    const adjByDate = {}
    for (const adj of adjustments) if (adj.payee_id === id && adj.pay_date) (adjByDate[adj.pay_date] ||= []).push(adj)
    const dealSum = (arr) => (arr || []).reduce((s, d) => s + take(d), 0)
    const adjSum  = (arr) => (arr || []).reduce((s, a) => s + num(a.amount), 0)
    const dates = [...new Set([...Object.keys(byDate), ...Object.keys(adjByDate)])].sort()
    const overdue = dates.filter(dt => dt < today).reduce((s, dt) => s + dealSum(byDate[dt]) + adjSum(adjByDate[dt]), 0)
    const paydays = dates.filter(dt => dt >= today).slice(0, 6).map(dt => ({
      date: dt,
      deals: byDate[dt] || [],
      adjustments: adjByDate[dt] || [],
      count: (byDate[dt] || []).length,
      total: dealSum(byDate[dt]) + adjSum(adjByDate[dt]),
    }))
    return { paydays, overdue }
  }, [allMine, id, adjustments])

  const payIdx = Math.min(paydayIdx, Math.max(paydays.length - 1, 0))
  const selPayday = paydays[payIdx] || null
  useEffect(() => { setPaydayIdx(0) }, [id])

  // ── Period totals ─────────────────────────────────────────────
  const totals = useMemo(() => {
    let earned = 0, paid = 0, commissions = 0, overrides = 0
    for (const d of periodMine) {
      let t = 0
      for (const p of myParts(d, id)) {
        t += p.amount
        if (p.role === 'Setter' || p.role === 'Closer') commissions += p.amount
        else overrides += p.amount
      }
      earned += t
      if (d.status === PAID) paid += t
    }
    return { earned, paid, upcoming: Math.max(earned - paid, 0), commissions, overrides }
  }, [periodMine, id])

  const byStatus = useMemo(() => {
    const m = {}
    for (const d of periodMine) {
      const k = d.status || '—'
      if (!m[k]) m[k] = { status: k, count: 0, amount: 0 }
      m[k].count += 1; m[k].amount += take(d)
    }
    const order = statusLabels || []
    return Object.values(m).sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))
  }, [periodMine, id, statusLabels])

  const groups = useMemo(() => {
    const m = {}
    for (const d of periodMine) {
      const k = d.pay_date || 'unscheduled'
      if (!m[k]) m[k] = { key: k, date: d.pay_date || null, deals: [], total: 0 }
      m[k].deals.push(d); m[k].total += take(d)
    }
    return Object.values(m).sort((a, b) => {
      if (!a.date) return 1
      if (!b.date) return -1
      return b.date.localeCompare(a.date)
    })
  }, [periodMine, id])

  const isPipeline = basis === 'pipeline'

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
        <div className="flex items-center gap-2 flex-wrap">
          {/* Week stepper — hidden in pipeline mode since it doesn't use a date range */}
          {!isPipeline && (
            <>
              <div className="flex items-center rounded-lg overflow-hidden" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
                <button onClick={() => stepWeek(-1)} className="px-2 py-1.5 text-white/50 hover:text-white" title="Previous week"><ChevronLeft size={15} /></button>
                <button onClick={goThisWeek} className="px-3 py-1.5 text-[12px] font-semibold text-white/80 hover:text-white border-x border-white/10" title="Jump to this week">
                  {from && to ? `${format(new Date(from + 'T12:00:00'), 'MMM d')} – ${format(new Date(to + 'T12:00:00'), 'MMM d')}` : 'This week'}
                </button>
                <button onClick={() => stepWeek(1)} className="px-2 py-1.5 text-white/50 hover:text-white" title="Next week"><ChevronRight size={15} /></button>
              </div>
              <select
                value={rangeMatches(preset, from, to) ? preset : matchPreset(from, to)}
                onChange={e => { const p = PRESETS_BY_KEY[e.target.value]; if (!p) return; const r = p.range(); setFrom(r.from); setTo(r.to); setPreset(p.key) }}
                className="text-[12px] px-2.5 py-1.5 rounded-lg text-white/80 focus:outline-none"
                style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}
                title="Jump to a period">
                <option value="custom" disabled style={{ background: '#2a2a2a' }}>Custom range</option>
                {PRESETS.map(p => <option key={p.key} value={p.key} style={{ background: '#2a2a2a' }}>{p.label}</option>)}
              </select>
            </>
          )}
          {/* Basis tabs */}
          <div className="flex rounded-lg overflow-hidden text-[11px] font-semibold" style={{ border: '1px solid #2a2a2a' }}>
            {[['sale', 'By sale date'], ['pay', 'By pay date'], ['pipeline', 'Total pipeline pay']].map(([k, label]) => (
              <button key={k} onClick={() => setBasis(k)}
                className="px-3 py-1.5 transition-colors"
                style={basis === k ? { background: '#00b894', color: '#0b0b0b' } : { background: '#1e1e1e', color: 'rgba(255,255,255,0.5)' }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── PIPELINE VIEW ─────────────────────────────────────────── */}
      {isPipeline ? (
        <div>
          {/* Total owed hero */}
          <div className="rounded-2xl p-4 md:p-5 mb-4"
            style={{ background: 'linear-gradient(135deg,#143d34,#1e1e1e)', border: '1px solid #1f5a4d' }}>
            <p className="text-[10px] uppercase tracking-widest text-white/40 font-semibold mb-1">Total commission owed</p>
            <p className="text-3xl md:text-4xl font-bold text-teal">{fmt(pipelineTotal)}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              <span className="text-[12px] text-white/50">
                {pipelineDeals.length} deal{pipelineDeals.length === 1 ? '' : 's'} unpaid
              </span>
              {pipelineOverdue > 0 && (
                <span className="text-[12px] text-amber-400/90">
                  {fmt(pipelineOverdue)} overdue from past pay dates
                </span>
              )}
            </div>
          </div>

          {/* Deal list grouped by week */}
          <div style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12, overflow: 'hidden' }}>
            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-white/30 font-semibold">All unpaid deals</span>
              <span className="text-[11px] text-white/30">grouped by pay week</span>
            </div>

            {loading ? (
              <div className="px-4 py-8 text-white/30 text-sm text-center">Loading…</div>
            ) : loadError ? (
              <div className="px-4 py-8 text-red-300 text-sm text-center">Couldn't load deals: {loadError}</div>
            ) : pipelineWeeks.length === 0 ? (
              <div className="px-4 py-8 text-white/30 text-sm text-center">No unpaid deals — you're all caught up!</div>
            ) : (
              pipelineWeeks.map(week => (
                <PipelineWeekGroup key={week.key} week={week} id={id} users={users} statusColor={statusColor} />
              ))
            )}
          </div>
        </div>
      ) : (
        <>
          {/* ── STANDARD VIEW (sale / pay date) ───────────────────── */}

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

          {/* Earned card */}
          <div style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12 }} className="p-3 md:p-4 mb-2">
            <div className="text-[9px] md:text-[11px] uppercase tracking-wider text-white/30 font-semibold mb-1.5">Earned · {periodLabel}</div>
            <div className="text-[18px] md:text-2xl font-bold text-teal">{fmt(totals.earned)}</div>
            <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-white/5">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-white/30 font-semibold mb-0.5">Commissions</div>
                <div className="text-[15px] md:text-[17px] font-bold text-white">{fmt(totals.commissions)}</div>
                <div className="text-[10px] text-white/30">setter / closer</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-white/30 font-semibold mb-0.5">Overrides</div>
                <div className="text-[15px] md:text-[17px] font-bold text-white">{fmt(totals.overrides)}</div>
                <div className="text-[10px] text-white/30">manager / director / VP</div>
              </div>
            </div>
          </div>

          {/* Paid / Upcoming */}
          <div className="grid grid-cols-2 gap-2 md:gap-3 mb-3">
            <Card label="Paid"     value={fmt(totals.paid)}     color="#74b9ff" sub="status = Paid" />
            <Card label="Upcoming" value={fmt(totals.upcoming)} color="#fdcb6e" sub="not yet paid · incl. unfinalized deals" />
          </div>

          {/* Per-status strip */}
          {byStatus.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {byStatus.map(s => {
                const c = statusColor(s.status)
                return (
                  <div key={s.status} className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
                    style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />
                    <span className="text-[11px] text-white/60">{s.status}</span>
                    <span className="text-[11px] font-semibold text-white">{fmt(s.amount)}</span>
                    <span className="text-[10px] text-white/30">×{s.count}</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Deals grouped by payday */}
          <div style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12, overflow: 'hidden' }}>
            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-white/30 font-semibold">Deals · {periodLabel}</span>
              <span className="text-[11px] text-white/30">tap a deal for the breakdown</span>
            </div>

            {loading ? (
              <div className="px-4 py-8 text-white/30 text-sm text-center">Loading…</div>
            ) : loadError ? (
              <div className="px-4 py-8 text-red-300 text-sm text-center">Couldn't load deals: {loadError}</div>
            ) : groups.length === 0 ? (
              <div className="px-4 py-8 text-white/30 text-sm text-center">No deals in this period.</div>
            ) : (
              groups.map(g => (
                <div key={g.key}>
                  <div className="flex items-center justify-between px-4 py-2 bg-white/[0.02] border-b border-white/5">
                    <span className="text-[11px] font-semibold text-white/50">
                      {g.date ? `Pays ${fmtDay(g.date)}` : 'Pay date TBD'}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-white/30">{g.deals.length} deal{g.deals.length === 1 ? '' : 's'}</span>
                      <span className="text-[12px] font-bold text-teal">{fmt(g.total)}</span>
                    </div>
                  </div>
                  {g.deals.map(d => <DealRow key={d.id} deal={d} id={id} statusColor={statusColor} />)}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}