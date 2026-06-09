import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, Download, Pencil, AlertTriangle, CheckCircle2, Wallet, BadgeCheck, Copy, Check } from 'lucide-react'
import { format } from 'date-fns'
import { fetchDeals, fetchUsers, updateDeal } from '../lib/db'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { dealAmounts, fmt, activeDeals } from '../utils/commission'
import DealModal from '../components/DealModal'

const todayISO = () => new Date().toISOString().slice(0, 10)
const fmtDay   = (iso) => iso ? format(new Date(iso + 'T12:00:00'), 'EEE, MMM d, yyyy') : null
const APPROVED = 'Pay Finalized'
const PAID     = 'Paid'
const ISSUE    = 'Sales Issue'
// A deal counts toward the payout total only once it's finalized (Pay Finalized
// or Paid). Pending Install / Deal Review / Change Order deals can carry a pay
// date but aren't being paid out yet, so they're shown separately, never in the
// headline total — this is what keeps the run in step with the commission sheet.
const isFinalized = (d) => d.status === APPROVED || d.status === PAID

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

// Per-deal payout breakdown — who earns what on a single deal.
function dealPayouts(d) {
  const a = dealAmounts(d)
  const out = []
  const push = (person, role, amount) => { if (person && person.id && amount > 0) out.push({ id: person.id, name: person.name, role, amount }) }
  push(d.setter, 'Setter', a.setter)
  if (d.closer_id !== d.setter_id) push(d.closer, 'Closer', a.closer)
  push(d.manager, 'Manager', a.manager)
  push(d.director, 'Director', a.director)
  push(d.vp, 'VP', a.vp)
  return out
}

export default function Payroll() {
  const { isAdmin } = useAuth()
  const { statusColor, statusLabels } = useSettings()
  const [copiedId, setCopiedId] = useState('')
  const [deals, setDeals]     = useState([])
  const [users, setUsers]     = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView]       = useState(null)        // a pay_date string, or 'overdue'
  const [editDeal, setEditDeal] = useState(null)
  const [modal, setModal]     = useState(false)
  const [showPayees, setShowPayees] = useState(true)
  const [tab, setTab] = useState('run')   // 'run' | 'deductions'
  const [repFilter, setRepFilter] = useState('')
  const today = todayISO()

  useEffect(() => { load() }, [])
  async function load() {
    const [{ data: d }, { data: u }] = await Promise.all([fetchDeals(), fetchUsers()])
    const dd = activeDeals(d || [])   // canceled jobs are never paid / counted
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
    // Sales-Issue deals are pulled from the run (they're flagged, not payable).
    const list = view === 'overdue' ? overdueDeals : deals.filter(d => d.pay_date === view && d.status !== ISSUE)
    // Pay oldest-sold first: sort by sale date ascending (blanks last).
    return [...list].sort((a, b) => (a.sale_date || '9999').localeCompare(b.sale_date || '9999'))
  }, [deals, view, overdueDeals])

  // Deals on this run with no office set — their director/VP override rate
  // defaulted instead of using the office rate (Tucson 3.75% vs 5%), so the
  // commission is likely wrong. Flag them so they get fixed before payout.
  const noOfficeDeals = useMemo(
    () => runDeals.filter(d => !d.office || !String(d.office).trim()),
    [runDeals]
  )

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
      if (!m[person.id]) m[person.id] = { id: person.id, name: person.name, total: 0, lines: [], dealIds: new Set() }
      m[person.id].total += amount
      m[person.id].lines.push({ deal: deal.deal_name, role, amount })
      m[person.id].dealIds.add(deal.id)
    }
    for (const d of runDeals) {
      if (!isFinalized(d)) continue   // only finalized deals are being paid out
      const a = dealAmounts(d)
      add(d.setter, 'Setter', a.setter, d)
      if (d.closer_id !== d.setter_id) add(d.closer, 'Closer', a.closer, d)
      add(d.manager, 'Manager', a.manager, d)
      add(d.director, 'Director', a.director, d)
      add(d.vp, 'VP', a.vp, d)
    }
    return Object.values(m).sort((a, b) => b.total - a.total)
  }, [runDeals])

  // All deals that carry a deduction — across all time, for the Deductions tab.
  // A deduction is "applied" once its deal is Paid; otherwise it's still pending.
  const deductions = useMemo(() => {
    return deals
      .map(d => ({ d, a: dealAmounts(d) }))
      .filter(({ a }) => a.deduction > 0)
      .map(({ d, a }) => {
        const solo = !d.closer_id || d.setter_id === d.closer_id
        const paidBy = d.deduction_paid_by || 'closer'
        const setterNm = d.setter?.name ?? '—', closerNm = d.closer?.name ?? '—'
        const absorbedBy = solo ? setterNm
          : paidBy === 'setter' ? setterNm
          : paidBy === 'split'  ? `${setterNm} & ${closerNm} (split)`
          : closerNm
        return {
          id: d.id,
          deal: d,
          name: d.deal_name,
          office: d.office,
          amount: a.deduction,            // manual + dealer fee
          manual: a.manualDeduction,
          dealerFee: a.dealerFee,
          note: d.deduction_note,
          absorbedBy,
          payDate: d.pay_date,
          status: d.status,
          applied: d.status === PAID,
        }
      })
      .sort((a, b) => (b.payDate || '').localeCompare(a.payDate || ''))
  }, [deals])

  const deductionTotals = useMemo(() => {
    let total = 0, applied = 0, pending = 0
    for (const x of deductions) { total += x.amount; if (x.applied) applied += x.amount; else pending += x.amount }
    return { total, applied, pending, count: deductions.length, pendingCount: deductions.filter(x => !x.applied).length }
  }, [deductions])

  // Deals still awaiting a commission sign-off (soonest pay date first).
  const unverified = useMemo(() =>
    deals
      .filter(d => d.commission_verified !== true && dealAmounts(d).totalCommission > 0)
      .sort((a, b) => (a.pay_date || '9999').localeCompare(b.pay_date || '9999')),
    [deals]
  )
  const unverifiedTotal = useMemo(() => unverified.reduce((s, d) => s + dealAmounts(d).totalCommission, 0), [unverified])
  const verifiedCount   = useMemo(() => deals.filter(d => d.commission_verified === true).length, [deals])

  async function verifyDeal(id, value = true) {
    setDeals(ds => ds.map(d => d.id === id ? { ...d, commission_verified: value } : d))
    const res = await updateDeal(id, { commission_verified: value })
    if (res?.error) load()
  }

  const canApprove = statusLabels?.includes(APPROVED)
  const canPay     = statusLabels?.includes(PAID)
  const viewLabel  = view === 'overdue' ? 'Overdue (unpaid)' : (fmtDay(view) || '—')

  // Optional filter: scope the run to a single payee/rep. Auto-clears if that
  // person isn't in the current run.
  const effFilter = repFilter && payees.some(p => p.id === repFilter) ? repFilter : ''
  const shownDeals  = effFilter ? runDeals.filter(d => dealPayouts(d).some(p => p.id === effFilter)) : runDeals
  const shownPayees = effFilter ? payees.filter(p => p.id === effFilter) : payees
  const summary = (() => {
    let total = 0, paid = 0, paidCount = 0, pending = 0, pendingCount = 0, finalizedCount = 0
    for (const d of shownDeals) {
      const amt = effFilter
        ? dealPayouts(d).filter(p => p.id === effFilter).reduce((s, p) => s + p.amount, 0)
        : dealAmounts(d).totalCommission
      if (isFinalized(d)) {
        total += amt; finalizedCount++
        if (d.status === PAID) { paid += amt; paidCount++ }
      } else {
        pending += amt; pendingCount++
      }
    }
    return { total, paid, remaining: total - paid, pending, pendingCount, finalizedCount,
             count: shownDeals.length, paidCount, payees: shownPayees.length }
  })()

  async function setStatus(id, status) {
    setDeals(ds => ds.map(d => d.id === id ? { ...d, status } : d))
    const res = await updateDeal(id, { status })
    if (res?.error) load()
  }
  async function markAll(status) {
    const ids = shownDeals.filter(d => d.status !== status).map(d => d.id)
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
    for (const p of shownPayees) for (const l of p.lines) rows.push([viewLabel, p.name, l.deal, l.role, l.amount.toFixed(2)])
    rows.push([])
    rows.push(['', 'TOTAL', '', '', summary.total.toFixed(2)])
    downloadCsv(`payroll-${view === 'overdue' ? 'overdue' : view}.csv`, rows)
  }

  // Copy one rep's pay statement to the clipboard — a styled table (text/html,
  // pastes into email/Sheets/Docs) plus a plain-text version. Admin only.
  async function copyPayee(p) {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Export-friendly labels: Setter → Self-gen, overrides → Override. Ordered
    // self-gens, then closes, then overrides.
    const EXPORT_LABEL = { Setter: 'Self-gen', Closer: 'Closer', Manager: 'Override', Director: 'Override', VP: 'Override' }
    const ORDER = { 'Self-gen': 0, 'Closer': 1, 'Override': 2 }
    const lines = p.lines
      .map(l => ({ ...l, label: EXPORT_LABEL[l.role] || l.role }))
      .sort((a, b) => (ORDER[a.label] ?? 9) - (ORDER[b.label] ?? 9) || b.amount - a.amount)
    const text = `Pay statement — ${p.name} — ${viewLabel}\n\n`
      + lines.map(l => `• ${l.deal} — ${l.label}: ${fmt(l.amount)}`).join('\n')
      + `\n\nTotal: ${fmt(p.total)}`
    const cell = 'padding:6px 12px;border:1px solid #d1d5db'
    const html =
      `<p style="font-family:Arial,sans-serif;font-size:13px"><strong>${esc(p.name)}</strong> — pay for ${esc(viewLabel)}</p>` +
      `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">` +
      `<thead><tr style="background:#00b894;color:#0b0b0b">` +
      `<th style="${cell};text-align:left">Deal</th><th style="${cell};text-align:left">Role</th><th style="${cell};text-align:right">Amount</th></tr></thead><tbody>` +
      lines.map((l, i) => `<tr style="background:${i % 2 ? '#f3f4f6' : '#ffffff'};color:#111">` +
        `<td style="${cell}">${esc(l.deal)}</td><td style="${cell}">${esc(l.label)}</td><td style="${cell};text-align:right">${fmt(l.amount)}</td></tr>`).join('') +
      `<tr style="font-weight:bold;color:#111"><td style="${cell}" colspan="2">Total</td><td style="${cell};text-align:right">${fmt(p.total)}</td></tr>` +
      `</tbody></table>`
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new window.ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        })])
      } else { await navigator.clipboard.writeText(text) }
      setCopiedId(p.id); setTimeout(() => setCopiedId(''), 1800)
    } catch { try { await navigator.clipboard.writeText(text); setCopiedId(p.id); setTimeout(() => setCopiedId(''), 1800) } catch {} }
  }

  return (
    <div style={{ background: '#1a1a1a', color: '#fff', minHeight: '100%' }}>
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
            <Wallet size={18} className="text-teal" /> Payroll
          </h1>
          <p className="text-[12px] text-white/40 mt-0.5">Review deals due for pay, approve them, and track deductions.</p>
        </div>
        {tab === 'run' && (
          <button onClick={exportCsv} disabled={!shownDeals.length}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-white/70 hover:text-white disabled:opacity-40 transition-colors"
            style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
            <Download size={14} /> Export CSV
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 p-1 rounded-xl w-fit" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
        {[['run', 'Pay run'], ['verify', `To verify${unverified.length ? ` (${unverified.length})` : ''}`], ['deductions', `Deductions${deductionTotals.count ? ` (${deductionTotals.count})` : ''}`]].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${tab === k ? 'bg-teal text-dark' : 'text-white/50 hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'run' && (<>
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
            <Card label={effFilter ? "Rep payout" : "Total payout"} value={fmt(summary.total)} color="#00b894" sub={`${viewLabel} · finalized`} />
            <Card label="Remaining" value={fmt(summary.remaining)} color="#fdcb6e" sub="finalized, not yet paid" />
            <Card label="Deals" value={`${summary.paidCount}/${summary.finalizedCount}`} sub="paid / finalized" />
            <Card label="Payees" value={summary.payees} sub="people to pay" />
          </div>

          {/* Not-yet-finalized deals carry this pay date but aren't being paid
              out yet, so they're excluded from the total above. */}
          {summary.pending > 0 && (
            <p className="text-[11px] text-white/40 mb-3 -mt-1">
              + {fmt(summary.pending)} across {summary.pendingCount} deal{summary.pendingCount === 1 ? '' : 's'} not yet finalized — excluded from the total until they reach “{APPROVED}”.
            </p>
          )}

          {/* Missing-office warning — these deals likely have the wrong override
              rate until an office is set. Click one to fix it inline. */}
          {noOfficeDeals.length > 0 && (
            <div className="mb-3 rounded-xl p-3" style={{ background: '#f59e0b14', border: '1px solid #f59e0b55' }}>
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle size={14} style={{ color: '#f59e0b' }} />
                <span className="text-[12px] font-semibold" style={{ color: '#f59e0b' }}>
                  {noOfficeDeals.length} deal{noOfficeDeals.length === 1 ? '' : 's'} on this run {noOfficeDeals.length === 1 ? 'has' : 'have'} no office — override rates may be wrong
                </span>
              </div>
              <p className="text-[11px] text-white/40 mb-2">
                Set the office to apply the correct director/VP rate (Tucson 3.75%, otherwise 5%). Click a deal to fix it.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {noOfficeDeals.map(d => (
                  <button key={d.id} onClick={() => { setEditDeal(d); setModal(true) }}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white/80 hover:text-white transition-colors"
                    style={{ background: '#1e1e1e', border: '1px solid #f59e0b40' }}>
                    {d.deal_name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Filter by rep */}
          {payees.length > 0 && (
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-[11px] text-white/30">Filter by rep:</span>
              <select value={effFilter} onChange={e => setRepFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white focus:outline-none"
                style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
                <option value="">All reps</option>
                {payees.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {effFilter && (
                <button onClick={() => setRepFilter('')} className="text-[11px] text-white/40 hover:text-white transition-colors">Clear</button>
              )}
            </div>
          )}

          {/* Bulk actions */}
          {view !== 'overdue' && shownDeals.length > 0 && (
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

          {/* Payee totals — compact summary of each person's lump sum for the run */}
          {shownPayees.length > 0 && (
            <div className="mb-4 rounded-xl overflow-hidden" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
              <button onClick={() => setShowPayees(s => !s)}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.02] transition-colors">
                <span className="text-[11px] uppercase tracking-wider text-white/40 font-semibold">
                  Payee totals · {shownPayees.length} {shownPayees.length === 1 ? 'person' : 'people'}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-[13px] font-bold text-teal">{fmt(summary.total)}</span>
                  <ChevronDown size={14} className={`text-white/30 transition-transform ${showPayees ? 'rotate-180' : ''}`} />
                </span>
              </button>
              {showPayees && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 px-4 pb-3 pt-1">
                  {shownPayees.map(p => (
                    <div key={p.id} className="flex items-center justify-between py-1 border-t border-white/5 gap-2">
                      <span className="text-[13px] text-white/80 truncate mr-1">
                        {p.name}
                        <span className="text-white/30 text-[11px]"> · {p.dealIds.size} deal{p.dealIds.size === 1 ? '' : 's'}</span>
                      </span>
                      <span className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-[13px] font-semibold text-white whitespace-nowrap">{fmt(p.total)}</span>
                        {isAdmin && (
                          <button onClick={() => copyPayee(p)} title="Copy this rep's pay statement to email"
                            className={`p-1 rounded transition-colors ${copiedId === p.id ? 'text-emerald-400' : 'text-white/30 hover:text-teal hover:bg-teal/10'}`}>
                            {copiedId === p.id ? <Check size={13} /> : <Copy size={13} />}
                          </button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Deals in this run — each card shows its own payouts inline */}
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] uppercase tracking-wider text-white/30 font-semibold">Deals in this run</p>
            <span className="text-[11px] text-white/30">{shownDeals.length} deal{shownDeals.length === 1 ? '' : 's'}</span>
          </div>
          <div className="space-y-2">
            {shownDeals.map(d => {
              const a = dealAmounts(d)
              const color = statusColor(d.status)
              const isPaid = d.status === PAID
              const payouts = dealPayouts(d)
              return (
                <div key={d.id} className="rounded-xl p-3 md:p-4" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <button onClick={() => { setEditDeal(d); setModal(true) }}
                        className="text-[14px] font-semibold text-white truncate text-left hover:text-teal transition-colors" title="Click to edit this deal">
                        {d.deal_name}
                      </button>
                      <p className="text-[11px] text-white/40">{[d.office, d.payment_method].filter(Boolean).join(' · ') || '—'}</p>
                    </div>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0"
                      style={{ color, border: `1px solid ${color}40` }}>{d.status}</span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-2 mt-3 text-[12px]">
                    <div><p className="text-white/30 text-[10px] uppercase">Sold</p><p className="text-white/80">{fmtDay(d.sale_date) || '—'}</p></div>
                    <div><p className="text-white/30 text-[10px] uppercase">Baseline</p><p className="text-white/80">{fmt(a.baseline)}</p></div>
                    <div><p className="text-white/30 text-[10px] uppercase">Job price</p><p className="text-white/80">{fmt(a.job)}</p></div>
                    <div><p className="text-white/30 text-[10px] uppercase">Rep pool</p><p className="text-white/80">{fmt(Math.max(a.job - a.baseline, 0))}</p></div>
                    <div><p className="text-white/30 text-[10px] uppercase">Pay date</p><p className="text-white/80">{fmtDay(d.pay_date) || 'TBD'}</p></div>
                  </div>

                  {/* Payouts on this deal — the rep/override breakdown, merged in */}
                  <div className="mt-3 rounded-lg overflow-hidden" style={{ background: '#171717', border: '1px solid #262626' }}>
                    {payouts.length === 0 ? (
                      <div className="px-3 py-2 text-[12px] text-white/30">No payouts on this deal.</div>
                    ) : payouts.map((p, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-1.5 text-[12px] border-b border-white/5 last:border-0">
                        <span className="text-white/70 truncate mr-2">{p.name} <span className="text-white/30">· {p.role}</span></span>
                        <span className="font-semibold text-white whitespace-nowrap">{fmt(p.amount)}</span>
                      </div>
                    ))}
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
            {shownDeals.length === 0 && (
              <div className="rounded-xl px-4 py-6 text-white/30 text-sm text-center" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
                {effFilter ? 'No deals for this rep in this run.' : 'No deals in this run.'}
              </div>
            )}
          </div>
        </>
      )}
      </>)}

      {tab === 'verify' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3 mb-4">
            <Card label="Deals to verify" value={unverified.length} color="#fbbf24" />
            <Card label="Commission pending review" value={fmt(unverifiedTotal)} color="#fbbf24" />
            <Card label="Verified" value={verifiedCount} sub="all-time" />
          </div>

          <div style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12, overflow: 'hidden' }}>
            <div className="px-4 py-3 border-b border-white/5">
              <span className="text-[11px] uppercase tracking-wider text-white/30 font-semibold">Awaiting commission sign-off</span>
            </div>
            {loading ? (
              <div className="px-4 py-8 text-center text-white/30 text-sm">Loading…</div>
            ) : unverified.length === 0 ? (
              <div className="px-4 py-8 text-center text-white/40 text-sm">🎉 Every deal's commission has been verified.</div>
            ) : unverified.map(d => {
              const a = dealAmounts(d)
              const payouts = dealPayouts(d)
              const color = statusColor(d.status)
              return (
                <div key={d.id} className="px-4 py-3 border-b border-white/5 last:border-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <button onClick={() => { setEditDeal(d); setModal(true) }}
                        className="text-[13px] font-semibold text-white/90 truncate text-left hover:text-teal transition-colors" title="Click to edit this deal">
                        {d.deal_name}
                      </button>
                      <p className="text-[11px] text-white/40 mt-0.5">
                        {[d.office, d.payment_method].filter(Boolean).join(' · ') || '—'}
                        {d.pay_date ? ` · pays ${fmtDay(d.pay_date)}` : ' · pay date TBD'}
                        <span className="ml-1.5" style={{ color }}>· {d.status}</span>
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className="text-[15px] font-bold text-teal">{fmt(a.totalCommission)}</span>
                    </div>
                  </div>

                  {/* Who earns what — eyeball before signing off */}
                  <div className="mt-2 rounded-lg overflow-hidden" style={{ background: '#171717', border: '1px solid #262626' }}>
                    {payouts.map((p, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-1.5 text-[12px] border-b border-white/5 last:border-0">
                        <span className="text-white/70 truncate mr-2">{p.name} <span className="text-white/30">· {p.role}</span></span>
                        <span className="font-semibold text-white whitespace-nowrap">{fmt(p.amount)}</span>
                      </div>
                    ))}
                  </div>

                  {a.deduction > 0 && (
                    <p className="text-[11px] text-red-400/90 mt-2 flex items-center gap-1.5">
                      <AlertTriangle size={12} /> {fmt(a.deduction)} deduction{d.deduction_note ? ` — ${d.deduction_note}` : ''}
                    </p>
                  )}

                  <div className="flex items-center justify-end gap-2 mt-2.5">
                    <button onClick={() => { setEditDeal(d); setModal(true) }}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white/60 hover:text-white transition-colors"
                      style={{ border: '1px solid #3a3a3a' }}>
                      <Pencil size={12} /> Adjust
                    </button>
                    <button onClick={() => verifyDeal(d.id, true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-dark transition-colors"
                      style={{ background: '#fbbf24' }}>
                      <BadgeCheck size={13} /> Looks good
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {tab === 'deductions' && (
        <>
          {/* Deduction summary */}
          <div className="grid grid-cols-3 gap-2 md:gap-3 mb-4">
            <Card label="Total deductions" value={fmt(deductionTotals.total)} color="#f87171" sub={`${deductionTotals.count} total`} />
            <Card label="Pending" value={fmt(deductionTotals.pending)} color="#fdcb6e" sub={`${deductionTotals.pendingCount} not yet paid`} />
            <Card label="Applied" value={fmt(deductionTotals.applied)} color="#74b9ff" sub="on paid deals" />
          </div>

          <div style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12, overflow: 'hidden' }}>
            <div className="px-4 py-3 border-b border-white/5">
              <span className="text-[11px] uppercase tracking-wider text-white/30 font-semibold">All deductions · present & past</span>
            </div>
            {loading ? (
              <div className="px-4 py-8 text-center text-white/30 text-sm">Loading…</div>
            ) : deductions.length === 0 ? (
              <div className="px-4 py-8 text-center text-white/30 text-sm">No deductions on any deal.</div>
            ) : deductions.map(x => (
              <div key={x.id} className="flex items-start justify-between gap-3 px-4 py-3 border-b border-white/5 last:border-0">
                <div className="min-w-0">
                  <button onClick={() => { setEditDeal(x.deal); setModal(true) }}
                    className="text-[13px] font-semibold text-white/90 truncate text-left hover:text-teal transition-colors" title="Click to edit this deal">
                    {x.name}
                  </button>
                  <p className="text-[11px] text-white/40 mt-0.5">
                    From <span className="text-white/60">{x.absorbedBy}</span>
                    {x.office ? ` · ${x.office}` : ''}
                    {x.payDate ? ` · pays ${fmtDay(x.payDate)}` : ' · pay date TBD'}
                  </p>
                  {x.dealerFee > 0 && (
                    <p className="text-[11px] text-white/40 mt-0.5">
                      Dealer fee −{fmt(x.dealerFee)}{x.manual > 0 ? ` · other −${fmt(x.manual)}` : ''}
                    </p>
                  )}
                  {x.note && <p className="text-[11px] text-white/50 mt-1 italic">“{x.note}”</p>}
                </div>
                <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                  <span className="text-[15px] font-bold text-red-400">−{fmt(x.amount)}</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={x.applied
                      ? { color: '#74b9ff', border: '1px solid #74b9ff40' }
                      : { color: '#fdcb6e', border: '1px solid #fdcb6e40' }}>
                    {x.applied ? 'Applied' : 'Pending'}
                  </span>
                  <button onClick={() => { setEditDeal(x.deal); setModal(true) }}
                    className="text-[11px] text-white/40 hover:text-teal transition-colors flex items-center gap-1">
                    <Pencil size={11} /> Edit
                  </button>
                </div>
              </div>
            ))}
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
