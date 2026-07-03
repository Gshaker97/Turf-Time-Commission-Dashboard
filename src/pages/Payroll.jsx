import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, Download, Pencil, AlertTriangle, CheckCircle2, Wallet, BadgeCheck, Copy, Check, Plus, X, Trash2, Lock } from 'lucide-react'
import { format } from 'date-fns'
import { fetchDeals, fetchUsers, updateDeal, fetchPayrollAdjustments, addPayrollAdjustment, deletePayrollAdjustment, fetchPayrollLocks, lockPayrollRun, unlockPayrollRun } from '../lib/db'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { dealAmounts, fmt, activeDeals, officeOverrideRate } from '../utils/commission'
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
  // NEGATIVE takes flow through too (a below-baseline deal docks the rep) —
  // dropping them would overstate the payee's total vs the run's Total payout.
  const push = (person, role, amount) => { if (person && person.id && amount !== 0) out.push({ id: person.id, name: person.name, role, amount }) }
  push(d.setter, 'Setter', a.setter)
  if (d.closer_id !== d.setter_id) push(d.closer, 'Closer', a.closer)
  push(d.manager, 'Manager', a.manager)
  push(d.director, 'Director', a.director)
  push(d.vp, 'VP', a.vp)
  return out
}

// Ratio (e.g. 0.2 or 0.0375) → "20%" / "3.75%".
const asPct = (ratio) => { const v = (Number(ratio) || 0) * 100; return (Number.isInteger(v) ? v : +v.toFixed(2)) + '%' }
// The override % a role is paid (director/VP fall back to the office rate).
const overridePctFor = (d, role) =>
  role === 'Manager'  ? Number(d.manager_override_pct) || 0
  : role === 'Director' ? (d.director_override_pct != null ? Number(d.director_override_pct) : officeOverrideRate(d))
  : role === 'VP'       ? (d.vp_override_pct       != null ? Number(d.vp_override_pct)       : officeOverrideRate(d))
  : 0
// How much of a deal's deduction a setter/closer absorbed (mirrors the engine).
function roleDeduction(d, role, a) {
  if (role !== 'Setter' && role !== 'Closer') return 0
  const deduction = a.deduction
  if (deduction <= 0) return 0
  const solo = !d.closer_id || d.setter_id === d.closer_id
  const paidBy = d.deduction_paid_by || 'closer'
  const dsp = d.deduction_split_pct == null ? 0.5 : Number(d.deduction_split_pct)
  if (role === 'Setter') {
    if (d.setter_amount != null) return 0
    return solo ? deduction : paidBy === 'setter' ? deduction : paidBy === 'split' ? deduction * dsp : 0
  }
  if (d.closer_amount != null) return 0
  return solo ? 0 : paidBy === 'closer' ? deduction : paidBy === 'split' ? deduction * (1 - dsp) : 0
}

export default function Payroll() {
  const { isAdmin, profile } = useAuth()
  const { statusColor, statusLabels, dataStartDate } = useSettings()
  const [copiedId, setCopiedId] = useState('')
  const [deals, setDeals]     = useState([])
  const [users, setUsers]     = useState([])
  const [adjustments, setAdjustments] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView]       = useState(null)        // a pay_date string, or 'overdue'
  const [editDeal, setEditDeal] = useState(null)
  const [modal, setModal]     = useState(false)
  const [showPayees, setShowPayees] = useState(true)
  const [tab, setTab] = useState('run')   // 'run' | 'deductions'
  const [runStyle, setRunStyle] = useState('list')   // 'list' (compact) | 'cards' (full payouts)
  const [repFilter, setRepFilter] = useState('')
  const [adjFor, setAdjFor] = useState('')            // payee id whose adjustment editor is open
  const [adjAmt, setAdjAmt] = useState('')
  const [adjNote, setAdjNote] = useState('')
  const [locks, setLocks] = useState([])              // locked pay runs (migration 028)
  const today = todayISO()

  useEffect(() => { load() }, [])
  async function load() {
    const [{ data: d }, { data: u }, { data: adj }, { data: lk }] = await Promise.all([
      fetchDeals(), fetchUsers(), fetchPayrollAdjustments(), fetchPayrollLocks(),
    ])
    const dd = activeDeals(d || [])   // canceled jobs are never paid / counted
    setDeals(dd); setUsers(u || []); setAdjustments(adj || []); setLocks(lk || [])
    setView(v => {
      if (v) return v
      const pds = distinctPayDates(dd)
      return pds.find(p => p >= today) || pds[pds.length - 1] || null
    })
    setLoading(false)
  }
  async function reloadAdjustments() {
    const { data } = await fetchPayrollAdjustments()
    setAdjustments(data || [])
  }

  // Adjustments on the current run (a real pay date, not the synthetic Overdue view).
  const runAdjustments = useMemo(
    () => (view && view !== 'overdue') ? adjustments.filter(a => a.pay_date === view) : [],
    [adjustments, view]
  )

  async function saveAdjustment(payeeId) {
    const amt = parseFloat(adjAmt)
    if (!amt || view === 'overdue' || !view) { setAdjFor(''); return }
    const res = await addPayrollAdjustment({ payeeId, payDate: view, amount: amt, note: adjNote.trim() || null }, profile?.id)
    if (res?.error) { alert('Could not save adjustment: ' + (res.error.message || 'unknown error')); return }
    setAdjFor(''); setAdjAmt(''); setAdjNote('')
    reloadAdjustments()
  }
  async function removeAdjustment(id) {
    setAdjustments(a => a.filter(x => x.id !== id))   // optimistic
    const res = await deletePayrollAdjustment(id)
    if (res?.error) reloadAdjustments()
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

  // Legacy deals (sale_date before the data-start cutoff) predate our atomized
  // data; they're excluded from the overdue nag so old history doesn't pile up
  // as tasks. They still show on their own pay-date run when one rolls around.
  const overdueDeals = useMemo(
    () => deals.filter(d => d.pay_date && d.pay_date < today && d.status !== PAID && d.status !== ISSUE &&
                            !(dataStartDate && d.sale_date && d.sale_date < dataStartDate)),
    [deals, today, dataStartDate]
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

  const payees = useMemo(() => {
    const m = {}
    const ensure = (id, name) => (m[id] ||= { id, name, total: 0, lines: [], dealIds: new Set(), adjustments: [] })
    const add = (person, role, amount, deal, a) => {
      // amount !== 0 (not > 0): a NEGATIVE take from a below-baseline deal must
      // dock the payee's total, or the payee rows overstate vs Total payout.
      if (!person || !person.id || !amount) return
      const p = ensure(person.id, person.name)
      p.total += amount
      const isRep = role === 'Setter' || role === 'Closer'
      const ded = roleDeduction(deal, role, a)
      p.lines.push({
        deal: deal.deal_name, role, amount, baseline: a.baseline,
        // setter/closer: % of baseline they net; mgmt: their override %
        pct: isRep ? (a.baseline > 0 ? amount / a.baseline : 0) : overridePctFor(deal, role),
        ded, note: deal.deduction_note || '',
      })
      p.dealIds.add(deal.id)
    }
    for (const d of runDeals) {
      if (!isFinalized(d)) continue   // only finalized deals are being paid out
      const a = dealAmounts(d)
      add(d.setter, 'Setter', a.setter, d, a)
      if (d.closer_id !== d.setter_id) add(d.closer, 'Closer', a.closer, d, a)
      add(d.manager, 'Manager', a.manager, d, a)
      add(d.director, 'Director', a.director, d, a)
      add(d.vp, 'VP', a.vp, d, a)
    }
    // Manual adjustments for this run — folded into each payee's total (a payee
    // can exist on adjustments alone, e.g. a clawback after their deal was paid).
    for (const adj of runAdjustments) {
      const person = users.find(u => u.id === adj.payee_id)
      const p = ensure(adj.payee_id, person?.name || 'Unknown')
      p.total += Number(adj.amount)
      p.adjustments.push(adj)
    }
    return Object.values(m).sort((a, b) => b.total - a.total)
  }, [runDeals, runAdjustments, users])

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

  // Deals on this run whose commission hasn't been gold-checked yet. The
  // Deals page's "Needs review" tab is the verification inbox; this is just
  // the pre-payout safety net.
  const runUnverified = useMemo(
    () => runDeals.filter(d => d.commission_verified !== true && dealAmounts(d).totalCommission !== 0),
    [runDeals]
  )

  // Is the current run locked? A locked run is frozen — no status changes,
  // deal edits, or adjustments (enforced in the DB by migration 028's trigger;
  // this mirrors it in the UI).
  const runLock = view && view !== 'overdue' ? locks.find(l => l.pay_date === view) : null

  // Viewing payroll is leadership (route guard: vp/admin), but CHANGING data
  // (advancing status, editing a deal) is admin-only — non-admins get a
  // read-only run. A locked run is read-only for everyone.
  const canApprove = isAdmin && !runLock && statusLabels?.includes(APPROVED)
  const canPay     = isAdmin && !runLock && statusLabels?.includes(PAID)
  const openEdit   = (deal) => {
    if (!isAdmin) return
    if (locks.some(l => l.pay_date === deal.pay_date)) { alert('This deal is on a locked pay run — unlock the run first.'); return }
    setEditDeal(deal); setModal(true)
  }
  const viewLabel  = view === 'overdue' ? 'Overdue (unpaid)' : (fmtDay(view) || '—')

  async function lockRun() {
    if (!view || view === 'overdue') return
    const unpaid = runDeals.filter(d => d.status !== PAID).length
    const msg = unpaid
      ? `Lock the ${viewLabel} run? ${unpaid} deal(s) are not marked Paid yet — locking freezes them as-is.`
      : `Lock the ${viewLabel} run? Its deals and adjustments become read-only until unlocked.`
    if (!confirm(msg)) return
    const snapshot = {
      total: summary.total,
      payees: payees.map(p => ({ id: p.id, name: p.name, total: +p.total.toFixed(2) })),
      deals: runDeals.length,
    }
    const res = await lockPayrollRun(view, snapshot, profile?.id)
    if (res?.error) { alert('Could not lock the run: ' + (res.error.message || 'unknown error') + '\n(Has migration 028 been run?)'); return }
    const { data } = await fetchPayrollLocks(); setLocks(data || [])
  }
  async function unlockRun() {
    if (!runLock) return
    if (!confirm(`Unlock the ${viewLabel} run? Its deals become editable again.`)) return
    const res = await unlockPayrollRun(runLock.pay_date)
    if (res?.error) { alert('Could not unlock: ' + (res.error.message || 'unknown error')); return }
    const { data } = await fetchPayrollLocks(); setLocks(data || [])
  }

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
    // Manual adjustments count toward the payout total. They go out WITH the
    // paychecks, so they count toward Remaining only while the run still has
    // unpaid finalized deals — once everything's Paid, the adjustments were
    // disbursed too and Remaining reads $0 (not the stray adjustment total).
    const adjTotal = shownPayees.reduce((s, p) => s + p.adjustments.reduce((t, a) => t + Number(a.amount), 0), 0)
    total += adjTotal
    const allPaid = finalizedCount === 0 || paidCount === finalizedCount
    return { total, paid, remaining: allPaid ? 0 : total - paid, pending, pendingCount, finalizedCount, adjTotal,
             count: shownDeals.length, paidCount, payees: shownPayees.length }
  })()

  async function setStatus(id, status) {
    setDeals(ds => ds.map(d => d.id === id ? { ...d, status } : d))   // optimistic
    for (let attempt = 0; ; attempt++) {
      const res = await updateDeal(id, { status })
      if (!res?.error) return
      if (attempt < 2) { await new Promise(r => setTimeout(r, 500 * (attempt + 1))); continue }
      alert('Could not save the status change, so it was reverted:\n' + (res.error.message || 'network error'))
      load()
      return
    }
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

  // Full run export — organized by deal, listing everyone paid on it with their
  // % (override % for mgmt, % of baseline for setter/closer) and $, then any
  // deduction, then the deal total. Manual adjustments and the grand total last.
  function exportCsv() {
    const rows = [['Deal', 'Baseline', 'Paid to', 'Role', '%', 'Commission $', 'Note']]
    const repFilterId = effFilter || null
    for (const d of shownDeals) {
      if (!isFinalized(d)) continue
      const a = dealAmounts(d)
      let payouts = dealPayouts(d)
      if (repFilterId) payouts = payouts.filter(p => p.id === repFilterId)   // rep-scoped export
      if (!payouts.length) continue
      rows.push([d.deal_name || '—', a.baseline.toFixed(2), '', '', '', '', d.office || ''])
      for (const p of payouts) {
        const isRep = p.role === 'Setter' || p.role === 'Closer'
        const pctRatio = isRep ? (a.baseline > 0 ? p.amount / a.baseline : 0) : overridePctFor(d, p.role)
        rows.push(['', '', p.name, isRep ? p.role : 'Override', asPct(pctRatio), p.amount.toFixed(2), ''])
      }
      if (!repFilterId && a.deduction > 0)
        rows.push(['', '', '', 'Deduction (already in takes)', '', (-a.deduction).toFixed(2), d.deduction_note || ''])
      const dealTotal = repFilterId ? payouts.reduce((s, p) => s + p.amount, 0) : a.totalCommission
      rows.push(['', '', '', 'Deal total', '', dealTotal.toFixed(2), ''])
    }
    // Manual payroll adjustments for this run.
    const adjList = repFilterId ? runAdjustments.filter(x => x.payee_id === repFilterId) : runAdjustments
    if (adjList.length) {
      rows.push([])
      rows.push(['Manual adjustments', '', '', '', '', '', ''])
      for (const adj of adjList) {
        const person = users.find(u => u.id === adj.payee_id)
        rows.push(['', '', person?.name || '—', 'Adjustment', '', Number(adj.amount).toFixed(2), adj.note || ''])
      }
    }
    // Net total each rep is actually being paid this run (deal takes + adjustments).
    rows.push([])
    rows.push(['Net totals per rep', '', '', '', '', '', ''])
    for (const p of shownPayees) rows.push(['', '', p.name, '', '', p.total.toFixed(2), ''])
    rows.push([])
    rows.push(['TOTAL', '', '', '', '', summary.total.toFixed(2), ''])
    downloadCsv(`payroll-${view === 'overdue' ? 'overdue' : view}${effFilter ? '-' + (users.find(u => u.id === effFilter)?.name || 'rep') : ''}.csv`, rows)
  }

  // Copy one rep's pay statement to the clipboard — a styled table (text/html,
  // pastes into email/Sheets/Docs) plus a plain-text version. Admin only.
  async function copyPayee(p) {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const roleLabel = (r) => (r === 'Setter' || r === 'Closer') ? r : 'Override'
    const ORDER = { Setter: 0, Closer: 1, Override: 2 }
    const sorted = [...p.lines].sort((a, b) =>
      (ORDER[roleLabel(a.role)] ?? 9) - (ORDER[roleLabel(b.role)] ?? 9) || b.amount - a.amount)
    // Flat rows: each pay line (with its % + $), a deduction sub-line where one
    // applied, then any manual adjustments. Net total is authoritative (p.total).
    const items = []
    for (const l of sorted) {
      items.push({ deal: l.deal, baseline: fmt(l.baseline || 0), role: roleLabel(l.role), pct: asPct(l.pct), amount: l.amount })
      if (l.ded > 0) items.push({ deal: '', baseline: '', role: `Deduction${l.note ? ` (${l.note})` : ''}`, pct: '', amount: -l.ded, dim: true })
    }
    for (const adj of p.adjustments) items.push({ deal: 'Adjustment', baseline: '', role: adj.note || '—', pct: '', amount: Number(adj.amount) })
    const text = `Pay statement — ${p.name} — ${viewLabel}\n\n`
      + items.map(l => `• ${l.deal ? l.deal + (l.baseline ? ` (baseline ${l.baseline})` : '') + ' — ' : ''}${l.role}${l.pct ? ` (${l.pct})` : ''}: ${fmt(l.amount)}`).join('\n')
      + `\n\nNet total: ${fmt(p.total)}`

    // Styled statement (inline CSS only — it's pasted into email clients).
    const F = 'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Arial,sans-serif'
    const money = (v) => `<span style="color:${v < 0 ? '#dc2626' : '#111827'};font-weight:600;white-space:nowrap">${fmt(v)}</span>`
    const dealRows = items.filter(l => l.deal !== 'Adjustment')
    const adjRows  = items.filter(l => l.deal === 'Adjustment')
    const th = (label, align = 'left') =>
      `<td style="padding:8px 12px;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;font-weight:700;text-align:${align};border-bottom:2px solid #e5e7eb">${label}</td>`
    const row = (l, last) => l.dim
      ? `<tr><td colspan="4" style="padding:2px 12px 8px 24px;font-size:12px;color:#dc2626;font-style:italic;${last ? '' : 'border-bottom:1px solid #f3f4f6'}">− ${esc(l.role)}</td>` +
        `<td style="padding:2px 12px 8px;font-size:12px;text-align:right;color:#dc2626;font-style:italic;${last ? '' : 'border-bottom:1px solid #f3f4f6'}">${fmt(l.amount)}</td></tr>`
      : `<tr>` +
        `<td style="padding:10px 12px;font-size:13px;color:#111827;font-weight:600;${last ? '' : 'border-bottom:1px solid #f3f4f6'}">${esc(l.deal)}</td>` +
        `<td style="padding:10px 12px;font-size:13px;color:#6b7280;text-align:right;${last ? '' : 'border-bottom:1px solid #f3f4f6'}">${esc(l.baseline)}</td>` +
        `<td style="padding:10px 12px;font-size:12px;color:#374151;${last ? '' : 'border-bottom:1px solid #f3f4f6'}">${esc(l.role)}</td>` +
        `<td style="padding:10px 12px;font-size:13px;color:#374151;text-align:right;${last ? '' : 'border-bottom:1px solid #f3f4f6'}">${esc(l.pct)}</td>` +
        `<td style="padding:10px 12px;font-size:13px;text-align:right;${last ? '' : 'border-bottom:1px solid #f3f4f6'}">${money(l.amount)}</td></tr>`
    const html =
      `<div style="${F};max-width:620px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">` +
      // Header band
      `<div style="background:#0f2e28;padding:18px 20px">` +
      `<div style="font-size:11px;letter-spacing:0.18em;color:#2dd4a7;font-weight:800">TURF TIME</div>` +
      `<div style="font-size:19px;color:#ffffff;font-weight:700;margin-top:2px">Pay Statement</div>` +
      `<table style="width:100%;border-collapse:collapse;margin-top:10px"><tr>` +
      `<td style="${F}"><div style="font-size:11px;color:#7fb8aa;text-transform:uppercase;letter-spacing:0.08em">Paid to</div>` +
      `<div style="font-size:15px;color:#ffffff;font-weight:600">${esc(p.name)}</div></td>` +
      `<td style="${F};text-align:right"><div style="font-size:11px;color:#7fb8aa;text-transform:uppercase;letter-spacing:0.08em">Pay date</div>` +
      `<div style="font-size:15px;color:#ffffff;font-weight:600">${esc(viewLabel)}</div></td>` +
      `</tr></table></div>` +
      // Deal lines
      `<table style="width:100%;border-collapse:collapse;background:#ffffff">` +
      `<tr>${th('Deal')}${th('Baseline', 'right')}${th('Role')}${th('%', 'right')}${th('Commission', 'right')}</tr>` +
      dealRows.map((l, i) => row(l, i === dealRows.length - 1 && !adjRows.length)).join('') +
      (adjRows.length
        ? `<tr><td colspan="5" style="padding:12px 12px 4px;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;font-weight:700;border-top:2px solid #e5e7eb">Adjustments</td></tr>` +
          adjRows.map((l, i) => `<tr>` +
            `<td colspan="4" style="padding:8px 12px;font-size:13px;color:#374151;${i === adjRows.length - 1 ? '' : 'border-bottom:1px solid #f3f4f6'}">${esc(l.role)}</td>` +
            `<td style="padding:8px 12px;font-size:13px;text-align:right;${i === adjRows.length - 1 ? '' : 'border-bottom:1px solid #f3f4f6'}">${money(l.amount)}</td></tr>`).join('')
        : '') +
      // Net total band
      `<tr><td colspan="4" style="padding:14px 12px;background:#f0fdf9;border-top:2px solid #00b894;font-size:14px;color:#0f2e28;font-weight:800">Net total</td>` +
      `<td style="padding:14px 12px;background:#f0fdf9;border-top:2px solid #00b894;font-size:17px;text-align:right;color:${p.total < 0 ? '#dc2626' : '#047857'};font-weight:800;white-space:nowrap">${fmt(p.total)}</td></tr>` +
      `</table>` +
      `<div style="background:#f9fafb;padding:10px 20px;font-size:11px;color:#9ca3af;border-top:1px solid #e5e7eb">Deductions are already reflected in each line. Questions? Reply to this email.</div>` +
      `</div>`
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
        {[['run', 'Pay run'], ['deductions', `Deductions${deductionTotals.count ? ` (${deductionTotals.count})` : ''}`]].map(([k, label]) => (
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
          {/* Locked-run banner */}
          {runLock && (
            <div className="mb-3 rounded-xl p-3 flex items-center gap-3 flex-wrap" style={{ background: '#00b89412', border: '1px solid #00b89440' }}>
              <Lock size={14} className="text-teal flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-teal">This pay run is locked</p>
                <p className="text-[11px] text-white/40">
                  {runLock.snapshot?.auto ? 'Auto-locked (pay date passed with every deal Paid)' : 'Locked'}
                  {runLock.locked_at ? ` ${format(new Date(runLock.locked_at), 'MMM d, yyyy · h:mmaaa')}` : ''}
                  {runLock.locked_by ? ` by ${users.find(u => u.id === runLock.locked_by)?.name || 'an admin'}` : ''}
                  {runLock.snapshot?.total != null ? ` · locked total ${fmt(runLock.snapshot.total)}` : ''} — deals and adjustments on this run are frozen.
                </p>
              </div>
              {isAdmin && (
                <button onClick={unlockRun}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-white/60 hover:text-white transition-colors flex-shrink-0"
                  style={{ background: '#1e1e1e', border: '1px solid #2e2e2e' }}>
                  Unlock
                </button>
              )}
            </div>
          )}

          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-3">
            <Card label={effFilter ? "Rep payout" : "Total payout"} value={fmt(summary.total)} color="#00b894"
              sub={summary.adjTotal ? `incl. ${summary.adjTotal < 0 ? '−' : '+'}${fmt(Math.abs(summary.adjTotal))} adjustments` : `${viewLabel} · finalized`} />
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
                  <button key={d.id} onClick={() => openEdit(d)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white/80 hover:text-white transition-colors"
                    style={{ background: '#1e1e1e', border: '1px solid #f59e0b40' }}>
                    {d.deal_name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Pre-payout safety net: every deal should carry the gold check
              before money goes out. Verify from Deals → Needs review, or click
              a deal here to open it. */}
          {runUnverified.length > 0 && (
            <div className="mb-3 rounded-xl p-3" style={{ background: '#fbbf2414', border: '1px solid #fbbf2455' }}>
              <div className="flex items-center gap-2 mb-1">
                <BadgeCheck size={14} style={{ color: '#fbbf24' }} />
                <span className="text-[12px] font-semibold" style={{ color: '#fbbf24' }}>
                  {runUnverified.length} deal{runUnverified.length === 1 ? '' : 's'} on this run {runUnverified.length === 1 ? 'isn\u2019t' : 'aren\u2019t'} gold-checked yet
                </span>
              </div>
              <p className="text-[11px] text-white/40 mb-2">
                Verify commissions in Deals → Needs review, or click a deal to review it here.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {runUnverified.map(d => (
                  <button key={d.id} onClick={() => openEdit(d)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white/80 hover:text-white transition-colors"
                    style={{ background: '#1e1e1e', border: '1px solid #fbbf2440' }}>
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
              {isAdmin && !runLock && (
                <button onClick={lockRun} title="Freeze this run — its deals and adjustments become read-only until unlocked"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-white/70 hover:text-white transition-colors ml-auto"
                  style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
                  <Lock size={13} /> Lock run
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 px-4 pb-3 pt-1 items-start">
                  {shownPayees.map(p => (
                    <div key={p.id} className="py-1 border-t border-white/5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] text-white/80 truncate mr-1">
                          {p.name}
                          <span className="text-white/30 text-[11px]"> · {p.dealIds.size} deal{p.dealIds.size === 1 ? '' : 's'}</span>
                        </span>
                        <span className="flex items-center gap-1.5 flex-shrink-0">
                          <span className="text-[13px] font-semibold text-white whitespace-nowrap">{fmt(p.total)}</span>
                          {isAdmin && view !== 'overdue' && !runLock && (
                            <button onClick={() => { setAdjFor(adjFor === p.id ? '' : p.id); setAdjAmt(''); setAdjNote('') }}
                              title="Add a payroll adjustment (+/−)"
                              className="p-1 rounded text-white/30 hover:text-teal hover:bg-teal/10 transition-colors"><Plus size={13} /></button>
                          )}
                          {isAdmin && (
                            <button onClick={() => copyPayee(p)} title="Copy this rep's pay statement to email"
                              className={`p-1 rounded transition-colors ${copiedId === p.id ? 'text-emerald-400' : 'text-white/30 hover:text-teal hover:bg-teal/10'}`}>
                              {copiedId === p.id ? <Check size={13} /> : <Copy size={13} />}
                            </button>
                          )}
                        </span>
                      </div>
                      {p.adjustments.map(a => (
                        <div key={a.id} className="flex items-center justify-between gap-2 pl-3 mt-0.5">
                          <span className="text-[11px] text-white/40 truncate">↳ adjustment{a.note ? ` · ${a.note}` : ''}</span>
                          <span className="flex items-center gap-1.5 flex-shrink-0">
                            <span className={`text-[11px] font-semibold whitespace-nowrap ${Number(a.amount) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                              {Number(a.amount) < 0 ? '−' : '+'}{fmt(Math.abs(Number(a.amount)))}
                            </span>
                            {isAdmin && !runLock && (
                              <button onClick={() => removeAdjustment(a.id)} title="Remove adjustment"
                                className="p-0.5 rounded text-white/25 hover:text-red-400"><Trash2 size={11} /></button>
                            )}
                          </span>
                        </div>
                      ))}
                      {isAdmin && adjFor === p.id && (
                        <div className="flex items-center gap-1.5 pl-3 mt-1">
                          <input autoFocus type="number" step="0.01" value={adjAmt} onChange={e => setAdjAmt(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveAdjustment(p.id); if (e.key === 'Escape') setAdjFor('') }}
                            placeholder="± $" className="w-20 rounded px-2 py-1 text-[12px] text-white focus:outline-none"
                            style={{ background: '#1a1a1a', border: '1px solid rgba(0,184,148,0.4)' }} />
                          <input value={adjNote} onChange={e => setAdjNote(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveAdjustment(p.id); if (e.key === 'Escape') setAdjFor('') }}
                            placeholder="note (e.g. missed deduction)" className="flex-1 min-w-0 rounded px-2 py-1 text-[12px] text-white focus:outline-none"
                            style={{ background: '#1a1a1a', border: '1px solid #3a3a3a' }} />
                          <button onClick={() => saveAdjustment(p.id)} className="p-1 rounded text-emerald-400 hover:bg-emerald-400/10"><Check size={14} /></button>
                          <button onClick={() => setAdjFor('')} className="p-1 rounded text-white/30 hover:bg-white/5"><X size={14} /></button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Deals in this run — compact list by default; cards show payouts inline */}
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] uppercase tracking-wider text-white/30 font-semibold">Deals in this run</p>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-white/30">{shownDeals.length} deal{shownDeals.length === 1 ? '' : 's'}</span>
              <div className="flex rounded-lg overflow-hidden text-[10px] font-semibold" style={{ border: '1px solid #2a2a2a' }}>
                {[['list', 'List'], ['cards', 'Cards']].map(([k, label]) => (
                  <button key={k} onClick={() => setRunStyle(k)} className="px-2 py-1 transition-colors"
                    style={runStyle === k ? { background: '#00b894', color: '#0b0b0b' } : { background: '#1e1e1e', color: 'rgba(255,255,255,0.5)' }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Compact list — one row per deal, everything actionable inline */}
          {runStyle === 'list' && (
            <div className="rounded-xl overflow-hidden" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
              {shownDeals.map(d => {
                const a = dealAmounts(d)
                const color = statusColor(d.status)
                const isPaid = d.status === PAID
                return (
                  <div key={d.id} className="flex items-center gap-2.5 px-3 md:px-4 py-2 border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} title={d.status} />
                    <button onClick={() => openEdit(d)}
                      className="text-[13px] font-semibold text-white truncate text-left hover:text-teal transition-colors min-w-0 flex-1"
                      title="Click to edit this deal">
                      {d.deal_name}
                    </button>
                    {d.commission_verified === true && <BadgeCheck size={13} className="flex-shrink-0" style={{ color: '#fbbf24' }} title="Commission verified" />}
                    <span className="hidden sm:block text-[11px] flex-shrink-0" style={{ color }}>{d.status}</span>
                    <span className="text-[13px] font-bold text-teal flex-shrink-0 w-[88px] text-right">{fmt(a.totalCommission)}</span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {canApprove && !isPaid && d.status !== APPROVED && (
                        <button onClick={() => setStatus(d.id, APPROVED)} title={`Move to ${APPROVED}`}
                          className="px-2 py-1 rounded-lg text-[10px] font-semibold text-white/60 hover:text-white transition-colors"
                          style={{ border: '1px solid #3a3a3a' }}>
                          Approve
                        </button>
                      )}
                      {canPay && (isPaid ? (
                        <span className="flex items-center text-teal px-1" title="Paid"><CheckCircle2 size={14} /></span>
                      ) : (
                        <button onClick={() => setStatus(d.id, PAID)} title="Mark paid"
                          className="px-2 py-1 rounded-lg text-[10px] font-bold text-dark transition-colors" style={{ background: '#00b894' }}>
                          Paid
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
              {shownDeals.length === 0 && (
                <div className="px-4 py-6 text-white/30 text-sm text-center">
                  {effFilter ? 'No deals for this rep in this run.' : 'No deals in this run.'}
                </div>
              )}
            </div>
          )}

          {runStyle === 'cards' && (
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
                      <button onClick={() => openEdit(d)}
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
                    <div><p className="text-white/30 text-[10px] uppercase">Rep pool</p><p className={a.job - a.baseline < 0 ? 'text-red-400' : 'text-white/80'}>{fmt(a.job - a.baseline)}</p></div>
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
                      <button onClick={() => openEdit(d)}
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
          )}
        </>
      )}
      </>)}

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
                  <button onClick={() => openEdit(x.deal)}
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
                  <button onClick={() => openEdit(x.deal)}
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
