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
const isoWeek = (dateStr) => {
  const d = dateStr ? new Date(dateStr + 'T12:00:00') : new Date()
  const dow = d.getDay()
  const sun = new Date(d); sun.setDate(d.getDate() - dow)
  const sat = new Date(sun); sat.setDate(sun.getDate() + 6)
  const iso = (x) => x.toISOString().slice(0, 10)
  return { from: iso(sun), to: iso(sat) }
}
const PAID = 'Paid'
const ISSUE = 'Sales Issue'
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
                <AlertTriangle size={12} className="mt-0.5 
