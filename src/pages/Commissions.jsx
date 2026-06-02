import { useEffect, useMemo, useState } from 'react'
import { fetchDeals, fetchPayments } from '../lib/db'
import { useAuth } from '../contexts/AuthContext'
import { calcDealCommissions, fmt } from '../utils/commission'
import DateRangeFilter from '../components/DateRangeFilter'
import { getPresetRange, matchPreset, rangeMatches, presetLabel } from '../utils/dateRanges'

const inRange = (date, from, to) =>
  !!date && (!from || date >= from) && (!to || date <= to)

export default function Commissions() {
  const { profile } = useAuth()
  const [from,   setFrom]   = useState(getPresetRange('mtd').from)
  const [to,     setTo]     = useState(getPresetRange('mtd').to)
  const [preset, setPreset] = useState('mtd')
  const [allDeals, setAllDeals] = useState([])
  const [allPayments, setAllPayments] = useState([])
  const [loading, setLoading] = useState(true)

  const periodLabel = presetLabel(rangeMatches(preset, from, to) ? preset : matchPreset(from, to))

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchDeals(), fetchPayments()]).then(([{ data: d }, { data: p }]) => {
      setAllDeals(d || [])
      setAllPayments(p || [])
      setLoading(false)
    })
  }, [])

  const deals = useMemo(
    () => allDeals.filter(d => inRange(d.sale_date, from, to)),
    [allDeals, from, to]
  )

  const payments = useMemo(
    () => allPayments.filter(p => p.user_id === profile?.id && inRange(p.pay_date, from, to)),
    [allPayments, profile?.id, from, to]
  )

  const myDeals = useMemo(() =>
    (deals || []).filter(d =>
      d.setter_id === profile?.id || d.closer_id === profile?.id ||
      d.manager_id === profile?.id || d.director_id === profile?.id ||
      d.vp_id === profile?.id
    ), [deals, profile?.id])

  const totalEarned = useMemo(() =>
    myDeals.reduce((sum, d) => {
      const a = calcDealCommissions(d)
      if (d.setter_id   === profile?.id) sum += a.setter
      if (d.closer_id   === profile?.id && d.closer_id !== d.setter_id) sum += a.closer
      if (d.manager_id  === profile?.id) sum += a.manager
      if (d.director_id === profile?.id) sum += a.director
      if (d.vp_id       === profile?.id) sum += a.vp
      return sum
    }, 0), [myDeals, profile?.id])

  const totalPaid    = useMemo(() => (payments || []).reduce((s, p) => s + Number(p.amount || 0), 0), [payments])
  const totalPending = Math.max(totalEarned - totalPaid, 0)

  return (
    <div style={{ background: '#1a1a1a', color: '#fff', minHeight: '100%' }}>

      {/* Header */}
      <div className="mb-4 space-y-3">
        <div>
          <h1 className="text-lg md:text-xl font-bold text-white">Commissions</h1>
          <p className="text-[12px] text-white/40 mt-0.5">{profile?.name}</p>
        </div>
        <DateRangeFilter from={from} to={to} preset={preset}
          onChange={({ from, to, preset }) => { setFrom(from); setTo(to); setPreset(preset) }} />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2 md:gap-3 mb-4">
        {[
          { label: 'Earned',  value: fmt(totalEarned),  color: '#00b894' },
          { label: 'Paid',    value: fmt(totalPaid),    color: '#74b9ff' },
          { label: 'Pending', value: fmt(totalPending), color: '#fdcb6e' },
        ].map(c => (
          <div key={c.label} style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12, padding: '12px 10px' }}>
            <div className="text-[9px] md:text-[11px] uppercase tracking-wider text-white/30 font-semibold mb-1.5">{c.label}</div>
            <div className="text-[15px] md:text-2xl font-bold truncate" style={{ color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Deals list */}
      <div style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12, overflow: 'hidden' }}>
        <div className="px-4 py-3 border-b border-white/5">
          <span className="text-[11px] uppercase tracking-wider text-white/30 font-semibold">{periodLabel}</span>
        </div>

        {loading ? (
          <div className="px-4 py-6 text-white/30 text-sm">Loading…</div>
        ) : myDeals.length === 0 ? (
          <div className="px-4 py-6 text-white/30 text-sm">No deals in this period.</div>
        ) : (
          <>
            {/* Desktop table */}
            <table className="w-full text-[13px] hidden md:table">
              <thead>
                <tr className="border-b border-white/5">
                  {['Deal', 'Role', 'Status', 'Amount'].map((h, i) => (
                    <th key={h} className={`px-4 py-2.5 text-white/30 font-semibold text-[11px] uppercase tracking-wider ${i === 3 ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {myDeals.map(d => {
                  const a = calcDealCommissions(d)
                  const roles = []
                  let myAmt = 0
                  if (d.setter_id   === profile?.id) { roles.push('Setter');   myAmt += a.setter }
                  if (d.closer_id   === profile?.id && d.closer_id !== d.setter_id) { roles.push('Closer'); myAmt += a.closer }
                  if (d.manager_id  === profile?.id) { roles.push('Manager');  myAmt += a.manager }
                  if (d.director_id === profile?.id) { roles.push('Director'); myAmt += a.director }
                  if (d.vp_id       === profile?.id) { roles.push('VP');       myAmt += a.vp }
                  return (
                    <tr key={d.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 text-white/80">{d.deal_name}</td>
                      <td className="px-4 py-3 text-white/40">{roles.join(', ')}</td>
                      <td className="px-4 py-3">
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{
                          background: d.status === 'Paid' ? '#00b89422' : '#fdcb6e22',
                          color:      d.status === 'Paid' ? '#00b894'   : '#fdcb6e',
                        }}>{d.status}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-white">{fmt(myAmt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-white/5">
              {myDeals.map(d => {
                const a = calcDealCommissions(d)
                const roles = []
                let myAmt = 0
                if (d.setter_id   === profile?.id) { roles.push('Setter');   myAmt += a.setter }
                if (d.closer_id   === profile?.id && d.closer_id !== d.setter_id) { roles.push('Closer'); myAmt += a.closer }
                if (d.manager_id  === profile?.id) { roles.push('Manager');  myAmt += a.manager }
                if (d.director_id === profile?.id) { roles.push('Director'); myAmt += a.director }
                if (d.vp_id       === profile?.id) { roles.push('VP');       myAmt += a.vp }
                return (
                  <div key={d.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-white/90 truncate">{d.deal_name}</p>
                      <p className="text-[11px] text-white/40 mt-0.5">{roles.join(', ')}</p>
                      <span className="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded" style={{
                        background: d.status === 'Paid' ? '#00b89422' : '#fdcb6e22',
                        color:      d.status === 'Paid' ? '#00b894'   : '#fdcb6e',
                      }}>{d.status}</span>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[15px] font-bold text-white">{fmt(myAmt)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
