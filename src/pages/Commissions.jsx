import { useState, useEffect, useMemo } from 'react'
import { subDays, isFriday, nextFriday, format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addDays } from 'date-fns'
import { fetchDeals, fetchUsers } from '../lib/db'
import { useAuth } from '../contexts/AuthContext'
import { calcDealCommissions, getUserCommission, fmt } from '../utils/commission'
import KpiCard from '../components/KpiCard'
import { StatusBadge } from '../components/DealTable'

// ─── helpers ─────────────────────────────────────────────────────────────────

function getPayFriday() {
  const today = new Date()
  return isFriday(today) ? today : nextFriday(today)
}

function installWeekForFriday(friday) {
  return {
    start: format(subDays(friday, 11), 'yyyy-MM-dd'),
    end:   format(subDays(friday, 5),  'yyyy-MM-dd'),
  }
}

// ─── sub-components ──────────────────────────────────────────────────────────

function SectionHeader({ title, sub, total }) {
  return (
    <div className="flex items-end justify-between mb-3">
      <div>
        <h2 className="text-[15px] font-bold text-white">{title}</h2>
        {sub && <p className="text-[11px] text-white/30 mt-0.5">{sub}</p>}
      </div>
      {total != null && (
        <div className="text-right">
          <p className="text-[11px] text-white/30 uppercase tracking-wider">Total</p>
          <p className="text-[18px] font-bold text-teal">{fmt(total)}</p>
        </div>
      )}
    </div>
  )
}

function EarnedCell({ myPay, repPay, overridePay }) {
  const hasBoth = repPay > 0 && overridePay > 0
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="text-[14px] font-bold text-teal">{fmt(myPay)}</span>
      {hasBoth && (
        <>
          <span className="text-[11px] text-white/40">Rep {fmt(repPay)}</span>
          <span className="text-[11px] text-white/40">Ovr {fmt(overridePay)}</span>
        </>
      )}
    </div>
  )
}

function PayTable({ rows }) {
  if (!rows.length) return (
    <div className="rounded-xl py-10 text-center text-white/20 text-[13px]"
      style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
      No deals in this period
    </div>
  )
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#242424', border: '1px solid #2e2e2e' }}>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr style={{ background: '#00b894' }}>
              {['Deal', 'Office', 'Status', 'Sale Date', 'Install Date', 'Pay Date', 'Setter', 'Closer', 'Baseline Rev', 'Job Price', 'Earned'].map(h => (
                <th key={h}
                  className="px-4 py-3 text-[11px] font-bold text-dark uppercase tracking-wider whitespace-nowrap text-left last:text-right"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}
                style={{ background: i % 2 === 0 ? '#242424' : '#262626' }}
                className="hover:bg-white/[0.03] transition-colors"
              >
                <td className="px-4 py-3 text-[13px] font-semibold text-white whitespace-nowrap">{r.deal_name}</td>
                <td className="px-4 py-3 text-[13px] text-white/50 whitespace-nowrap">{r.office ?? '—'}</td>
                <td className="px-4 py-3 whitespace-nowrap"><StatusBadge status={r.status} /></td>
                <td className="px-4 py-3 text-[13px] text-white/50 whitespace-nowrap">{r.sale_date ?? '—'}</td>
                <td className="px-4 py-3 text-[13px] text-white/50 whitespace-nowrap">{r.install_date ?? '—'}</td>
                <td className="px-4 py-3 text-[13px] text-white/50 whitespace-nowrap">{r.pay_date ?? '—'}</td>
                <td className="px-4 py-3 text-[13px] text-white/60 whitespace-nowrap">{r.setter}</td>
                <td className="px-4 py-3 text-[13px] text-white/60 whitespace-nowrap">{r.closer}</td>
                <td className="px-4 py-3 text-[13px] text-white/50 whitespace-nowrap">{fmt(r.baseline)}</td>
                <td className="px-4 py-3 text-[13px] text-white whitespace-nowrap">{fmt(r.jobPrice)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <EarnedCell myPay={r.myPay} repPay={r.repPay} overridePay={r.overridePay} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: '#1e1e1e', borderTop: '1px solid #2e2e2e' }}>
              <td colSpan={10} className="px-4 py-3 text-[11px] font-bold text-white/30 uppercase tracking-wider">
                {rows.length} deal{rows.length !== 1 ? 's' : ''}
              </td>
              <td className="px-4 py-3 text-[14px] font-bold text-teal text-right whitespace-nowrap">
                {fmt(rows.reduce((s, r) => s + r.repPay + r.overridePay, 0))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function Commissions() {
  const { profile } = useAuth()
  const [deals,         setDeals]         = useState([])
  const [users,         setUsers]         = useState([])
  const [loading,       setLoading]       = useState(true)
  const [weekOffset,    setWeekOffset]    = useState(0)
  const [selectedRepId, setSelectedRepId] = useState('')

  useEffect(() => {
    Promise.all([fetchDeals(), fetchUsers()])
      .then(([{ data: d }, { data: u }]) => {
        setDeals(d ?? [])
        setUsers(u ?? [])
        setLoading(false)
      })
  }, [])

  const isElevated   = ['director', 'vp', 'admin'].includes(profile?.role)
  const viewedUserId = selectedRepId || profile?.id
  const viewedUser   = users.find(u => u.id === viewedUserId)

  const basePayFriday = useMemo(() => getPayFriday(), [])
  const payFriday     = useMemo(() => addDays(basePayFriday, weekOffset * 7), [basePayFriday, weekOffset])
  const installWeek   = useMemo(() => installWeekForFriday(payFriday), [payFriday])

  const role   = viewedUser?.role ?? profile?.role
  const userId = viewedUserId

  // All commission stats — split rep vs override, with weekly/monthly by sale date
  const stats = useMemo(() => {
    const today      = new Date()
    const weekStart  = format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd')
    const weekEnd    = format(endOfWeek(today,   { weekStartsOn: 1 }), 'yyyy-MM-dd')
    const monthStart = format(startOfMonth(today), 'yyyy-MM-dd')
    const monthEnd   = format(endOfMonth(today),   'yyyy-MM-dd')

    let lifetimeComm = 0, paidComm = 0, lifetimeOverride = 0, paidOverride = 0
    let weeklyComm = 0, monthlyComm = 0

    for (const deal of deals) {
      if (!userId) continue
      const { setterAmt, closerAmt, managerAmt, directorAmt, vpAmt } = calcDealCommissions(deal)

      let rep = 0
      if (deal.setter_id === userId) rep += setterAmt
      if (deal.closer_id === userId && deal.closer_id !== deal.setter_id) rep += closerAmt

      let ov = 0
      if (deal.manager_id  === userId) ov += managerAmt
      if (deal.director_id === userId) ov += directorAmt
      if (deal.vp_id       === userId) ov += vpAmt

      lifetimeComm     += rep
      lifetimeOverride += ov

      if (deal.status === 'Paid') {
        paidComm     += rep
        paidOverride += ov
      }

      const sd = deal.sale_date ?? ''
      const total = rep + ov
      if (sd >= weekStart  && sd <= weekEnd)  weeklyComm  += total
      if (sd >= monthStart && sd <= monthEnd) monthlyComm += total
    }

    return {
      lifetimeComm, paidComm, pendingComm: lifetimeComm - paidComm,
      lifetimeOverride, paidOverride, pendingOverride: lifetimeOverride - paidOverride,
      weeklyComm, monthlyComm,
    }
  }, [deals, userId])

  // Build enriched row — separates rep vs override amounts
  function buildRow(deal) {
    if (!userId) return null
    const myPay = getUserCommission(deal, userId)
    if (!myPay) return null

    const { setterAmt, closerAmt, managerAmt, directorAmt, vpAmt } = calcDealCommissions(deal)

    let repPay = 0
    if (deal.setter_id === userId) repPay += setterAmt
    if (deal.closer_id === userId && deal.closer_id !== deal.setter_id) repPay += closerAmt

    let overridePay = 0
    if (deal.manager_id  === userId) overridePay += managerAmt
    if (deal.director_id === userId) overridePay += directorAmt
    if (deal.vp_id       === userId) overridePay += vpAmt

    return {
      id:           deal.id,
      deal_name:    deal.deal_name,
      office:       deal.office,
      install_date: deal.install_date,
      pay_date:     deal.pay_date ?? null,
      sale_date:    deal.sale_date,
      status:       deal.status,
      baseline:     parseFloat(deal.baseline_revenue) || 0,
      jobPrice:     parseFloat(deal.job_price) || 0,
      repPay,
      overridePay,
      myPay,
      setter:       deal.setter?.name ?? '—',
      closer:       deal.closer?.name ?? '—',
    }
  }

  const myDeals = useMemo(() =>
    deals.map(buildRow).filter(Boolean),
  [deals, userId])

  const fridayRows = useMemo(() =>
    myDeals.filter(r =>
      r.install_date >= installWeek.start &&
      r.install_date <= installWeek.end
    ).sort((a, b) => (a.install_date ?? '').localeCompare(b.install_date ?? '')),
  [myDeals, installWeek])

  const paidRows = useMemo(() =>
    myDeals
      .filter(r => r.status === 'Paid')
      .sort((a, b) => (b.install_date ?? '').localeCompare(a.install_date ?? '')),
  [myDeals])

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-white/30 text-[13px]">
      Loading…
    </div>
  )

  const fridayLabel   = format(payFriday, 'MMMM d, yyyy')
  const weekLabel     = `Installs ${installWeek.start} – ${installWeek.end}`
  const showOverrides = ['manager', 'director', 'vp'].includes(role)

  function hasDealsForOffset(offset) {
    const friday = addDays(basePayFriday, offset * 7)
    const wk     = installWeekForFriday(friday)
    return myDeals.some(r => r.install_date >= wk.start && r.install_date <= wk.end)
  }
  const canGoPrev = weekOffset > -4 && hasDealsForOffset(weekOffset - 1)
  const canGoNext = weekOffset <  4 && hasDealsForOffset(weekOffset + 1)

  const sortedUsers = [...users].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))

  return (
    <div className="space-y-8 pb-8">

      {/* Rep selector — elevated roles only */}
      {isElevated && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-white/40 uppercase tracking-widest">Viewing:</span>
            <select
              value={selectedRepId}
              onChange={e => setSelectedRepId(e.target.value)}
              style={{ background: '#242424', border: '1px solid #333' }}
              className="h-8 px-2.5 rounded-lg text-[12px] text-white focus:outline-none"
            >
              <option value="">My commissions</option>
              {sortedUsers.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          {selectedRepId && viewedUser && (
            <span
              className="text-[11px] font-semibold text-teal px-2.5 py-1 rounded-md"
              style={{ background: 'rgba(0,184,148,0.1)', border: '1px solid rgba(0,184,148,0.25)' }}
            >
              Viewing {viewedUser.name}'s commissions
            </span>
          )}
        </div>
      )}

      {/* Stats header */}
      <div className="space-y-3">
        {/* Lifetime commission */}
        <div className="flex gap-3">
          <KpiCard label="Lifetime Earned"    value={fmt(stats.lifetimeComm)} />
          <KpiCard label="Commissions Paid"   value={fmt(stats.paidComm)} />
          <KpiCard label="Pending"            value={fmt(stats.pendingComm)} accent={false} />
        </div>

        {/* Override stats — managers / directors / VPs only */}
        {showOverrides && (
          <div className="flex gap-3">
            <KpiCard label="Lifetime Override"  value={fmt(stats.lifetimeOverride)} />
            <KpiCard label="Overrides Paid"     value={fmt(stats.paidOverride)} />
            <KpiCard label="Override Pending"   value={fmt(stats.pendingOverride)} accent={false} />
          </div>
        )}
      </div>

      {/* Pay Friday — with week toggle */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={() => setWeekOffset(w => w - 1)}
            disabled={!canGoPrev}
            className="px-2.5 py-1 rounded-md text-[12px] text-white/60 hover:text-white hover:bg-white/5 disabled:text-white/15 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
          >
            ← Previous Friday
          </button>
          <span className="text-[12px] font-semibold text-white/70 min-w-[140px] text-center">
            {fridayLabel}
          </span>
          <button
            onClick={() => setWeekOffset(w => w + 1)}
            disabled={!canGoNext}
            className="px-2.5 py-1 rounded-md text-[12px] text-white/60 hover:text-white hover:bg-white/5 disabled:text-white/15 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
          >
            Next Friday →
          </button>
        </div>
        <SectionHeader
          title={`Pay · ${fridayLabel}`}
          sub={weekLabel}
          total={fridayRows.reduce((s, r) => s + r.myPay, 0)}
        />
        <PayTable rows={fridayRows} />
      </div>

      {/* Completed Jobs */}
      <div>
        <SectionHeader
          title="Completed Jobs"
          sub="Jobs marked as Paid"
          total={paidRows.reduce((s, r) => s + r.myPay, 0)}
        />
        <PayTable rows={paidRows} />
      </div>
    </div>
  )
}
