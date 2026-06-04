import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, Download, Pencil, AlertTriangle, CheckCircle2, Wallet } from 'lucide-react'
import { format } from 'date-fns'
import { fetchDeals, fetchUsers, updateDeal } from '../lib/db'
import { useSettings } from '../contexts/SettingsContext'
import { dealAmounts, fmt } from '../utils/commission'
import DealModal from '../components/DealModal'

const todayISO = () => new Date().toISOString().slice(0, 10)
const fmtDay   = (iso) => iso ? format(new Date(iso + 'T12:00:00'), 'EEE, MMM d, yyyy') : null
const APPROVED = 'Pay Finalized'
const PAID     = 'Paid'
const ISSUE    = 'Sales Issue'

const distinctPayDates = (deals) =>
  [...new Set(deals.filter(d => d.pay_date).map(d => d.pay_date))].sort()

function downloadCsv(name, rows) {
  const csv = rows.map(r => r.map(c => {
    const s = String(c ?? '')
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}

function Card({ label, value, color = '#fff', sub }) {
  return (
    <div style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12 }} className="p-3 md:p-4">
      <div className="text-[9px] md:text-[11px] uppercase tracking-wider text-white/30 font-semibold mb-1.5">{label}</div>
      <div className="text-[16px] md:text-2xl font-bold truncate" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] text-white/30 mt-0.5">{sub}</div>}
    </div>
  )
}

function PayeeRow({ payee }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-white/5 last:border-0">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-white/90 truncate">{payee.name}</p>
          <p className="text-[11px] text-white/40">{payee.lines.length} line{payee.lines.length === 1 ? '' : 's'}</p>
        </div>
        <span className="text-[15px] font-bold text-teal">{fmt(payee.total)}</span>
        <ChevronDown size={14} className={`text-white/30 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-1">
          {payee.lines.map((l, i) => (
            <div key={i} className="flex items-center justify-between text-[12px] rounded-lg px-3 py-1.5"
              style={{ background: '#171717', border: '1px solid #262626' }}>
              <span className="text-white/60 truncate mr-2">{l.deal} <span className="text-white/30">· {l.role}</span></span>
              <span className="font-semibold text-white whitespace-nowrap">{fmt(l.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Payroll() {
  const { statusColor, statusLabels } = useSettings()
  const [deals, setDeals]     = useState([])
  const [users, setUsers]     = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView]       = useState(null)        // a pay_date string, or 'overdue'
  const [editDeal, setEditDeal] = useState(null)
  const [modal, setModal]     = useState(false)
  const today = todayISO()

  useEffect(() => { load() }, [])
  async function load() {
    const [{ data: d }, { data: u }] = await Promise.all([fetchDeals(), fetchUsers()])
    const dd = d || []
    setDeals(dd); setUsers(u || [])
    setView(v => {
      if (v) return v
      const pds = distinctPayDates(dd)
      return pds.find(p => p >= today) || pds[pds.length - 1] || null
    })
    setLoading(false)
  }

  const withJoins = (data) => ({
    ...data,
    setter:   users.find(u => u.id === data.setter_id)   ?? null,
    closer:   users.find(u => u.id === data.closer_id)   ?? null,
    manager:  users.find(u => u.id === data.manager_id)  ?? null,
    director: users.find(u => u.id === data.director_id) ?? null,
    vp:       users.find(u => u.id === data.vp_id)       ?? null,
  })

  const payDates = useMemo(() => distinctPayDates(deals), [deals])
  const idx = payDates.indexOf(view)

  const overdueDeals = useMemo(
    () => deals.filter(d => d.pay_date && d.pay_date < today && d.status !== PAID && d.status !== ISSUE),
    [deals, today]
  )
  const overdueTotal = useMemo(
    () => overdueDeals.reduce((s, d) => s + dealAmounts(d).totalCommission, 0),
    [overdueDeals]
  )

  const runDeals = useMemo(() => {
    if (view === 'overdue') return overdueDeals
    return deals.filter(d => d.pay_date === view)
  }, [deals, view, overdueDeals])

  const totals = useMemo(() => {
    let total = 0, paid = 0
    for (const d of runDeals) {
      const c = dealAmounts(d).totalCommission
      total += c
      if (d.status === PAID) paid += c
    }
    return { total, paid, remaining: total - paid, count: runDeals.length, paidCount: runDeals.filter(d => d.status === PAID).length }
  }, [runDeals])

  const payees = useMemo(() => {
    const m = {}
    const add = (person, role, amount, deal) => {
      if (!person || !person.id || !(amount > 0)) return
      if (!m[person.id]) m[person.id] = { id: person.id, name: person.name, total: 0, lines: [] }
      m[person.id].total += amount
      m[person.id].lines.push({ deal: deal.deal_name, role, amount })
    }
    for (const d of runDeals) {
      const a = dealAmounts(d)
      add(d.setter, 'Setter', a.setter, d)
      if (d.closer_id !== d.setter_id) add(d.closer, 'Closer', a.closer, d)
      add(d.manager, 'Manager', a.manager, d)
      add(d.director, 'Director', a.director, d)
      add(d.vp, 'VP', a.vp, d)
    }
    return Object.values(m).sort((a, b) => b.total - a.total)
  }, [runDeals])

  const canApprove = statusLabels?.includes(APPROVED)
  const canPay     = statusLabels?.includes(PAID)
  const viewLabel  = view === 'overdue' ? 'Overdue (unpaid)' : (fmtDay(view) || '—')

  async function setStatus(id, status) {
    setDeals(ds => ds.map(d => d.id === id ? { ...d, status } : d))
    const res = await updateDeal(id, { status })
    if (res?.error) load()
  }
  async function markAll(status) {
    const ids = runDeals.filter(d => d.status !== status).map(d => d.id)
    if (!ids.length) return
    if (!confirm(`Mark ${ids.length} deal${ids.length === 1 ? '' : 's'} as "${status}"?`)) return
    setDeals(ds => ds.map(d => ids.includes(d.id) ? { ...d, status } : d))
    const results = await Promise.all(ids.map(id => updateDeal(id, { status })))
    if (results.some(r => r?.error)) load()
  }

  async function handleSave(data) {
    if (editDeal) {
      setDeals(ds => ds.map(d => d.id === editDeal.id ? { ...d, ...withJoins(data) } : d))
      setModal(false); setEditDeal(null)
      const res = await updateDeal(editDeal.id, data)
      if (res?.error) load()
    } else {
      setModal(false); setEditDeal(null)
    }
  }

  function exportCsv() {
    const rows = [['Pay Date', 'Payee', 'Deal', 'Role', 'Amount']]
    for (const p of payees) for (const l of p.lines) rows.push([viewLabel, p.name, l.deal, l.role, l.amount.toFixed(2)])
    rows.push([])
    rows.push(['', 'TOTAL', '', '', totals.total.toFixed(2)])
    downloadCsv(`payroll-${view === 'overdue' ? 'overdue' : view}.csv`, rows)
  }

  return (
    <div style={{ background: '#1a1a1a', color: '#fff', minHeight: '100%' }}>
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
            <Wallet size={18} className="text-teal" /> Payroll Run
          </h1>
          <p className="text-[12px] text-white/40 mt-0.5">Review deals due for pay and approve them.</p>
        </div>
        <button onClick={exportCsv} disabled={!runDeals.length}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-white/70 hover:text-white disabled:opacity-40 transition-colors"
          style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* Pay-date navigator */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button onClick={() => idx > 0 && setView(payDates[idx - 1])} disabled={view === 'overdue' || idx <= 0}
          className="p-2 rounded-lg text-white/50 hover:text-white disabled:opacity-30" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
          <ChevronLeft size={16} />
        </button>
        <select value={view === 'overdue' ? '' : (view || '')} onChange={e => setView(e.target.value)}
          className="px-3 py-2 rounded-lg text-[13px] font-semibold text-white flex-1 min-w-[180px] focus:outline-none"
          style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
          {view === 'overdue' && <option value="">Overdue (unpaid)</option>}
          {payDates.map(d => <option key={d} value={d}>{fmtDay(d)}</option>)}
          {!payDates.length && <option value="">No pay dates yet</option>}
        </select>
        <button onClick={() => idx < payDates.length - 1 && setView(payDates[idx + 1])} disabled={view === 'overdue' || idx < 0 || idx >= payDates.length - 1}
          className="p-2 rounded-lg text-white/50 hover:text-white disabled:opacity-30" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
          <ChevronRight size={16} />
        </button>
        {overdueDeals.length > 0 && (
          <button onClick={() => setView('overdue')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold transition-colors"
            style={{ background: view === 'overdue' ? '#f59e0b22' : '#1e1e1e', border: `1px solid ${view === 'overdue' ? '#f59e0b60' : '#2a2a2a'}`, color: '#f59e0b' }}>
            <AlertTriangle size={13} /> {overdueDeals.length} overdue
          </button>
        )}
      </div>

      {loading ? (
        <div className="py-16 text-center text-white/30 text-sm">Loading…</div>
      ) : !payDates.length ? (
        <div className="rounded-xl p-10 text-center text-white/40 text-[13px]" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
          No deals have a pay date yet. Set install dates (which auto-fill pay dates) or run the pay-date backfill.
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-3">
            <Card label="Total payout" value={fmt(totals.total)} color="#00b894" sub={viewLabel} />
            <Card label="Remaining" value={fmt(totals.remaining)} color="#fdcb6e" sub="not yet paid" />
            <Card label="Deals" value={`${totals.paidCount}/${totals.count}`} sub="paid / total" />
            <Card label="Payees" value={payees.length} sub="people to pay" />
          </div>

          {/* Bulk actions */}
          {view !== 'overdue' && runDeals.length > 0 && (
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              {canApprove && (
                <button onClick={() => markAll(APPROVED)}
                  className="px-3 py-2 rounded-lg text-[12px] font-semibold text-white/80 hover:text-white transition-colors"
                  style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
                  Approve all → {APPROVED}
                </button>
              )}
              {canPay && (
                <button onClick={() => markAll(PAID)}
                  className="px-3 py-2 rounded-lg text-[12px] font-bold text-dark transition-colors"
                  style={{ background: '#00b894' }}>
                  Mark all paid
                </button>
              )}
            </div>
          )}

          {/* Payroll sheet — by person */}
          <p className="text-[11px] uppercase tracking-wider text-white/30 font-semibold mb-2">Payroll sheet · by person</p>
          <div className="mb-5" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12, overflow: 'hidden' }}>
            {payees.length === 0
              ? <div className="px-4 py-6 text-white/30 text-sm text-center">No payouts for this run.</div>
              : payees.map(p => <PayeeRow key={p.id} payee={p} />)}
          </div>

          {/* Deal review — by deal */}
          <p className="text-[11px] uppercase tracking-wider text-white/30 font-semibold mb-2">Deal review</p>
          <div className="space-y-2">
            {runDeals.map(d => {
              const a = dealAmounts(d)
              const color = statusColor(d.status)
              const isPaid = d.status === PAID
              return (
                <div key={d.id} className="rounded-xl p-3 md:p-4" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold text-white truncate">{d.deal_name}</p>
                      <p className="text-[11px] text-white/40">{[d.office, d.payment_method].filter(Boolean).join(' · ') || '—'}</p>
                    </div>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0"
                      style={{ color, border: `1px solid ${color}40` }}>{d.status}</span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-3 text-[12px]">
                    <div><p className="text-white/30 text-[10px] uppercase">Setter</p><p className="text-white/80 truncate">{d.setter?.name ?? '—'}</p></div>
                    <div><p className="text-white/30 text-[10px] uppercase">Closer</p><p className="text-white/80 truncate">{d.closer?.name ?? '—'}</p></div>
                    <div><p className="text-white/30 text-[10px] uppercase">Baseline</p><p className="text-white/80">{fmt(a.baseline)}</p></div>
                    <div><p className="text-white/30 text-[10px] uppercase">Job price</p><p className="text-white/80">{fmt(a.job)}</p></div>
                  </div>

                  {a.deduction > 0 && (
                    <p className="text-[11px] text-red-400/90 mt-2 flex items-center gap-1.5">
                      <AlertTriangle size={12} /> {fmt(a.deduction)} deduction{d.deduction_note ? ` — ${d.deduction_note}` : ''}
                    </p>
                  )}

                  <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-white/5">
                    <div>
                      <span className="text-[10px] uppercase text-white/30">Total commission</span>
                      <span className="ml-2 text-[15px] font-bold text-teal">{fmt(a.totalCommission)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => { setEditDeal(d); setModal(true) }}
                        className="p-2 rounded-lg text-white/40 hover:text-teal hover:bg-teal/10 transition-colors" title="Edit deal">
                        <Pencil size={14} />
                      </button>
                      {canApprove && !isPaid && d.status !== APPROVED && (
                        <button onClick={() => setStatus(d.id, APPROVED)}
                          className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white/70 hover:text-white transition-colors"
                          style={{ border: '1px solid #3a3a3a' }}>
                          Approve
                        </button>
                      )}
                      {canPay && (
                        isPaid ? (
                          <span className="flex items-center gap-1 text-[12px] font-semibold text-teal px-2"><CheckCircle2 size={14} /> Paid</span>
                        ) : (
                          <button onClick={() => setStatus(d.id, PAID)}
                            className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-dark transition-colors" style={{ background: '#00b894' }}>
                            Mark paid
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            {runDeals.length === 0 && (
              <div className="rounded-xl px-4 py-6 text-white/30 text-sm text-center" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
                No deals in this run.
              </div>
            )}
          </div>
        </>
      )}

      {modal && (
        <DealModal deal={editDeal} users={users} onSave={handleSave}
          onClose={() => { setModal(false); setEditDeal(null) }} />
      )}
    </div>
  )
}
