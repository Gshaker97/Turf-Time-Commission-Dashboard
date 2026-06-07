import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, CalendarClock, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import { fetchDeals } from '../lib/db'
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { dealAmounts, getUserCommission, fmt } from '../utils/commission'
import DateRangeFilter from '../components/DateRangeFilter'
import { getPresetRange, matchPreset, rangeMatches, presetLabel } from '../utils/dateRanges'

const todayISO = () => new Date().toISOString().slice(0, 10)
const inRange = (date, from, to) => !!date && (!from || date >= from) && (!to || date <= to)
const PAID = 'Paid'                 // status that means the commission has been paid out
const ISSUE = 'Sales Issue'         // status that means the deal is in trouble
const fmtDay = (iso) => iso ? format(new Date(iso + 'T12:00:00'), 'EEE, MMM d') : null
const num = (v) => Number(v) || 0
const pct = (n) => { const v = (Number(n) || 0) * 100; return (Number.isInteger(v) ? v : v.toFixed(2)) + '%' }

// The roles the current user holds on a deal, with each role's dollar amount.
// Only the user's OWN roles are ever returned, so a rep never sees overrides
// and a manager only ever sees their own override (never the director/VP chain).
// For setter/closer we also surface the split partner's name and, when the
// deduction is computed (not pre-stored), the gross + deduction so the take adds up.
function myParts(deal, id) {
  const a = dealAmounts(deal)
  const repPool = Math.max(num(deal.job_price) - num(deal.baseline_revenue), 0)
  const solo = !deal.closer_id || deal.setter_id === deal.closer_id
  const split = deal.setter_split_pct == null ? 0.5 : num(deal.setter_split_pct)
  const deduction = a.deduction   // manual deduction + dealer fee
  const paidBy = deal.deduction_paid_by || 'closer'
  const dsp = deal.deduction_split_pct == null ? 0.5 : num(deal.deduction_split_pct)  // setter's share when split
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
  const repPool = Math.max(a.job - a.baseline, 0)
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
          <p className="text-[14px] font-bold" style={{ color: isPaid ? '#74b9ff' : '#fff' }}>{fmt(take)}</p>
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
              <span className="text-[13px] font-bold text-teal">Your take {fmt(take)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Commissions() {
  const { profile } = useAuth()
  const { statusColor, statusLabels } = useSettings()
  const id = profile?.id
  const [from,   setFrom]   = useState(getPresetRange('mtd').from)
  const [to,     setTo]     = useState(getPresetRange('mtd').to)
  const [preset, setPreset] = useState('mtd')
  const [allDeals, setAllDeals] = useState([])
  const [loading, setLoading] = useState(true)

  const periodLabel = presetLabel(rangeMatches(preset, from, to) ? preset : matchPreset(from, to))

  useEffect(() => {
    setLoading(true)
    fetchDeals().then(({ data }) => { setAllDeals(data || []); setLoading(false) })
  }, [])
  useRefreshOnFocus(() => fetchDeals().then(({ data }) => setAllDeals(data || [])))

  // Every deal this user has any stake in (unfiltered — for the forward-looking
  // "next payday", which shouldn't disappear when you filter a past period).
  const allMine = useMemo(
    () => allDeals.filter(d => [d.setter_id, d.closer_id, d.manager_id, d.director_id, d.vp_id].includes(id)),
    [allDeals, id]
  )

  // The period's deals (filtered by sale date) for the cards + grouped list.
  const periodMine = useMemo(
    () => allMine.filter(d => inRange(d.sale_date, from, to)),
    [allMine, from, to]
  )

  const take = (d) => getUserCommission(d, id)

  // ── Forward-looking next payday (global) ──────────────────────
  const payday = useMemo(() => {
    const today = todayISO()
    const unpaid = allMine.filter(d => d.status !== PAID && d.status !== ISSUE && d.pay_date)
    const byDate = {}
    for (const d of unpaid) (byDate[d.pay_date] ||= []).push(d)
    const dates = Object.keys(byDate).sort()
    const nextDate = dates.find(dt => dt >= today) || null
    const sum = (arr) => arr.reduce((s, d) => s + take(d), 0)
    const overdue = dates.filter(dt => dt < today).reduce((s, dt) => s + sum(byDate[dt]), 0)
    return {
      nextDate,
      nextTotal: nextDate ? sum(byDate[nextDate]) : 0,
      nextCount: nextDate ? byDate[nextDate].length : 0,
      overdue,
    }
  }, [allMine, id])

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

  // Per-status breakdown for the period (respects configurable statuses).
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

  // Period deals grouped by pay date (newest first; unscheduled last).
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

  return (
    <div style={{ background: '#1a1a1a', color: '#fff', minHeight: '100%' }}>
      {/* Header */}
      <div className="mb-4 space-y-3">
        <div>
          <h1 className="text-lg md:text-xl font-bold text-white">My Commissions</h1>
          <p className="text-[12px] text-white/40 mt-0.5">{profile?.name}</p>
        </div>
        <DateRangeFilter from={from} to={to} preset={preset}
          onChange={({ from, to, preset }) => { setFrom(from); setTo(to); setPreset(preset) }} />
      </div>

      {/* Next payday hero */}
      <div className="rounded-2xl p-4 md:p-5 mb-4 flex items-center gap-4"
        style={{ background: 'linear-gradient(135deg,#143d34,#1e1e1e)', border: '1px solid #1f5a4d' }}>
        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: '#00b89422', border: '1px solid #00b89440' }}>
          <CalendarClock size={20} className="text-teal" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-widest text-white/40 font-semibold">Next payday</p>
          {payday.nextDate ? (
            <p className="text-[13px] text-white/70">
              <span className="text-white font-semibold">{fmtDay(payday.nextDate)}</span>
              {' · '}{payday.nextCount} deal{payday.nextCount === 1 ? '' : 's'}
            </p>
          ) : (
            <p className="text-[13px] text-white/50">No scheduled paydays coming up.</p>
          )}
          {payday.overdue > 0 && (
            <p className="text-[11px] text-amber-400/90 mt-0.5">{fmt(payday.overdue)} pending from past pay dates</p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-2xl md:text-3xl font-bold text-teal">{fmt(payday.nextTotal)}</p>
        </div>
      </div>

      {/* Earned — total with commissions vs overrides breakdown */}
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
        <Card label="Upcoming" value={fmt(totals.upcoming)} color="#fdcb6e" sub="not yet paid" />
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
    </div>
  )
}
