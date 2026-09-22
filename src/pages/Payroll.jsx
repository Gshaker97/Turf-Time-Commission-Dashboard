import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, Download, Pencil, AlertTriangle, CheckCircle2, Wallet, BadgeCheck, Copy, Check, Plus, X, Trash2, Lock, Ban, MinusCircle } from 'lucide-react'
import { format } from 'date-fns'
import { fetchDeals, fetchUsers, updateDeal, fetchPayrollAdjustments, addPayrollAdjustment, deletePayrollAdjustment, updatePayrollAdjustment,
  writeOffDeduction, reopenDeduction, fetchPayrollLocks, lockPayrollRun, unlockPayrollRun } from '../lib/db'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { dealAmounts, fmt, activeDeals, deductionLabel } from '../utils/commission'
import { onClickUnlessSelecting } from '../utils/selection'
import DealModal from '../components/DealModal'
import RepMultiSelect from '../components/RepMultiSelect'
import { toast } from '../lib/toast'
import DeductionModal from '../components/DeductionModal'
import { buildLedger, openDebts, ledgerTotals, suggestedTake, wouldGoNegative, recoveryLine, STATUS_LABEL } from '../utils/deductions'

// LOCAL date, never UTC — .toISOString() rolls to tomorrow at 5pm Arizona.
const todayISO = () => format(new Date(), 'yyyy-MM-dd')
const fmtDay   = (iso) => iso ? format(new Date(iso + 'T12:00:00'), 'EEE, MMM d, yyyy') : null
// Compact form for the run list's Install column — the full date is in the
// expanded card, and a column 56px wide can't hold a weekday and a year.
const fmtShort = (iso) => iso ? format(new Date(iso + 'T12:00:00'), 'MMM d') : null
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
// What the run's list shows per COLUMN. Read straight off the deal + its
// amounts rather than from dealPayouts, because that helper drops zero-dollar
// shares — a setter earning $0 must still show as the setter.
function rowFacts(d, a, userById = {}) {
  const nameOf = (joined, id) => (id ? (userById[id]?.name || joined?.name || '(unknown)') : null)
  const solo = !d.closer_id || d.closer_id === d.setter_id
  const overrideIds = [d.manager_id, d.director_id, d.vp_id].filter(Boolean)
  return {
    setter: nameOf(d.setter, d.setter_id),
    // A share with money behind it and nobody to pay — the same amber the
    // "Before you pay" card counts.
    setterUnassigned: !d.setter_id && a.setter !== 0,
    closer: solo ? null : nameOf(d.closer, d.closer_id),
    closerSolo: solo,
    closerUnassigned: !solo && !d.closer_id && a.closer !== 0,
    overrideCount: overrideIds.length,
    overrideTotal: a.manager + a.director + a.vp,
  }
}

function dealPayouts(d, userById = null) {
  const a = dealAmounts(d)
  const out = []
  // People resolve by ID from the roster first (the embedded join objects are
  // missing on some rows even when the id is set — real bug: whole payees
  // vanished from the run), joined object as fallback.
  const resolve = (joined, id) => {
    if (id && userById?.[id]) return userById[id]
    if (joined && joined.id) return joined
    return id ? { id, name: '(unknown)' } : null
  }
  // NEGATIVE takes flow through too (a below-baseline deal docks the rep) —
  // dropping them would overstate the payee's total vs the run's Total payout.
  // A share with truly NO person assigned still shows — as an amber
  // "Unassigned" line — instead of silently vanishing while the money stays
  // in the deal's Total commission (those deals also sit in Needs review).
  const push = (person, role, amount, extra) => {
    if (amount === 0) return
    if (person && person.id) out.push({ id: person.id, name: person.name, role, amount, ...extra })
    else out.push({ id: null, name: 'Unassigned', role, amount, unassigned: true, ...extra })
  }
  // A solo deal (setter closed their own) is flagged self-gen — exports label
  // it "Self-Gen" instead of "Setter" (the role string itself stays 'Setter'
  // because roleDeduction and the engine key off it).
  const solo = !d.closer_id || d.setter_id === d.closer_id
  push(resolve(d.setter, d.setter_id), 'Setter', a.setter, solo ? { selfGen: true } : undefined)
  if (d.closer_id !== d.setter_id) push(resolve(d.closer, d.closer_id), 'Closer', a.closer)
  push(resolve(d.manager, d.manager_id), 'Manager', a.manager)
  push(resolve(d.director, d.director_id), 'Director', a.director)
  push(resolve(d.vp, d.vp_id), 'VP', a.vp)
  return out
}

// Ratio (e.g. 0.2 or 0.0375) → "20%" / "3.75%".
const asPct = (ratio) => { const v = (Number(ratio) || 0) * 100; return (Number.isInteger(v) ? v : +v.toFixed(2)) + '%' }
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
  // Deals render as one list; a row expands IN PLACE to its full payout card.
  const [expanded, setExpanded] = useState(() => new Set())
  const toggleExpanded = (id) => setExpanded(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  // Same idea on the payee summary: click a person to see the deals behind
  // their lump sum.
  const [openPayees, setOpenPayees] = useState(() => new Set())
  const togglePayee = (id) => setOpenPayees(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const [repFilters, setRepFilters] = useState([])   // profile ids; empty = everyone
  const [adjFor, setAdjFor] = useState('')            // payee id whose adjustment editor is open
  const [adjAmt, setAdjAmt] = useState('')
  const [adjNote, setAdjNote] = useState('')
  const [locks, setLocks] = useState([])              // locked pay runs (migration 028)
  // Deduction ledger (migration 050): a debt is an adjustment with NO pay
  // date. Nothing is ever taken automatically — Keaton clicks, and he types
  // how much comes out of each cheque.
  const [dedModal, setDedModal] = useState(null)      // {} = new, {edit: debt} = editing
  const [applyFor, setApplyFor] = useState('')        // debt id whose amount box is open
  const [applyAmt, setApplyAmt] = useState('')
  const [dedFilter, setDedFilter] = useState('open')  // open | all
  // "Before you pay" — which checklist rows are expanded.
  const [openChecks, setOpenChecks] = useState(() => new Set())
  const toggleCheck = (k) => setOpenChecks(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
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
    if (res?.error) { toast.error('Could not save adjustment: ' + (res.error.message || 'unknown error')); return }
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
    // INSTALL order — the same order the Google Calendar shows the week — so a
    // run can be walked top-to-bottom against the calendar for checks and
    // balances (per Keaton). Same-day ties (the sheet carries no install TIME,
    // only the date) fall back to sale date, then name; deals with no install
    // date yet sink to the bottom.
    const key = (d) => `${d.install_date || '9999-99-99'}|${d.sale_date || '9999-99-99'}|${(d.deal_name || '').toLowerCase()}`
    return [...list].sort((a, b) => key(a).localeCompare(key(b)))
  }, [deals, view, overdueDeals])

  // Deals on this run with no office set — their director/VP override rate
  // defaulted instead of using the office rate (Tucson 3.75% vs 5%), so the
  // commission is likely wrong. Flag them so they get fixed before payout.
  const noOfficeDeals = useMemo(
    () => runDeals.filter(d => !d.office || !String(d.office).trim()),
    [runDeals]
  )

  const userById = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users])
  const dealById = useMemo(() => Object.fromEntries(deals.map(d => [d.id, d])), [deals])

  // Deals on this run with commission owed to NOBODY (missing setter/closer) —
  // that money would fall out of every payee's statement. Flag before payout.
  const unassignedDeals = useMemo(
    () => runDeals.filter(d => dealPayouts(d, userById).some(p => p.unassigned)),
    [runDeals, userById]
  )

  const payees = useMemo(() => {
    const m = {}
    const ensure = (id, name) => (m[id] ||= { id, name, total: 0, lines: [], dealIds: new Set(), adjustments: [] })
    const add = (person, role, amount, deal, a, selfGen) => {
      // amount !== 0 (not > 0): a NEGATIVE take from a below-baseline deal must
      // dock the payee's total, or the payee rows overstate vs Total payout.
      if (!person || !person.id || !amount) return
      const p = ensure(person.id, person.name)
      p.total += amount
      const ded = roleDeduction(deal, role, a)
      // Deduction note: when the deduction is SPLIT between setter and closer,
      // a short share breakdown — "Dealer fee: 6% (split with Jordan, your 3%)"
      // — so a rep never reads the full fee as theirs. Single-payer keeps the
      // standard label (they do pay it all).
      let note = ''
      if (ded > 0) {
        note = deductionLabel(deal, a)
        if ((deal.deduction_paid_by || 'closer') === 'split' && a.deduction > ded + 0.005) {
          const shareFrac = ded / a.deduction
          const pctStr = (v) => { const n = +v.toFixed(2); return (Number.isInteger(n) ? n : n) + '%' }
          if (a.dealerFee > 0 && !a.manualDeduction) {
            const feePct = (Number(deal.dealer_fee_pct) || 0) * 100
            note = `Dealer fee: ${pctStr(feePct)} (split), ${pctStr(feePct * shareFrac)}`
          } else {
            note = `${note} (split), ${Math.round(shareFrac * 100)}%`
          }
        }
      }
      p.lines.push({
        deal: deal.deal_name, role, amount, baseline: a.baseline, selfGen: !!selfGen,
        // setter/closer: % of baseline they net; mgmt: their override %
        // amount ÷ baseline for every role — for mgmt this is the EFFECTIVE
        // override rate (reflects override exclusions, e.g. 2.7% not 3%).
        pct: a.baseline > 0 ? amount / a.baseline : 0,
        ded, note,
      })
      p.dealIds.add(deal.id)
    }
    for (const d of runDeals) {
      if (!isFinalized(d)) continue   // only finalized deals are being paid out
      const a = dealAmounts(d)
      // Same id-based person resolution as the deal cards (joins can be
      // missing even when the ids are set); unassigned shares carry no payee.
      for (const p of dealPayouts(d, userById)) {
        if (!p.unassigned) add(p, p.role, p.amount, d, a, p.selfGen)
      }
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

  // What each person is currently owed on THIS run — the number the tray
  // prefills a recovery with, so a take never quietly exceeds the cheque.
  const payeeTotals = useMemo(
    () => Object.fromEntries(payees.map(p => [p.id, p.total])),
    [payees])

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

  // ── Deduction ledger (migration 050) ─────────────────────────────────
  // Every debt with the recoveries taken against it. All the math lives in
  // utils/deductions.js; this page only renders and writes.
  const ledger    = useMemo(() => buildLedger(adjustments), [adjustments])
  const ledgerById = useMemo(() => Object.fromEntries(ledger.map(d => [d.id, d])), [ledger])
  const openLedger = useMemo(() => openDebts(ledger), [ledger])
  const owedTotals = useMemo(() => ledgerTotals(ledger), [ledger])

  async function saveDeduction(input) {
    const res = input.id
      ? await updatePayrollAdjustment(input.id, {
          payee_id: input.payeeId, deal_id: input.dealId, amount: input.amount, note: input.note, pay_date: input.payDate,
        })
      : await addPayrollAdjustment(input, profile?.id)
    if (res?.error) { toast.error('Could not save the deduction: ' + (res.error.message || 'unknown error') + '\n(Has migration 050 been run?)'); return false }
    toast.success(input.payDate ? 'Deduction added to that run' : 'Deduction logged — it will show on every run until it is recovered')
    reloadAdjustments()
    return true
  }

  // Take some (or all) of a debt on the CURRENT run. Never automatic: this
  // only ever runs from a click, with an amount Keaton can type over.
  async function applyDeduction(debt, rawAmount) {
    if (!view || view === 'overdue') return
    const take = Math.round(Math.abs(parseFloat(rawAmount) || 0) * 100) / 100
    if (!take) { setApplyFor(''); return }
    if (take > debt.remaining && !confirm(`Take ${fmt(take)} against a balance of only ${fmt(debt.remaining)}? The extra isn't owed.`)) return
    const res = await addPayrollAdjustment({
      payeeId: debt.payee_id, payDate: view, amount: -take,
      note: debt.note, dealId: debt.deal_id, parentId: debt.id,
    }, profile?.id)
    if (res?.error) { toast.error('Could not apply it: ' + (res.error.message || 'unknown error')); return }
    const left = Math.max(0, Math.round((debt.remaining - take) * 100) / 100)
    toast.success(left > 0 ? `${fmt(take)} taken · ${fmt(left)} still owed, carried to the next run` : `${fmt(take)} taken · settled`)
    setApplyFor(''); setApplyAmt('')
    reloadAdjustments()
  }

  async function writeOff(debt) {
    const why = prompt(`Write off ${fmt(debt.remaining)} still owed by ${userById[debt.payee_id]?.name || 'this rep'}?\n\nIt stops appearing on every run but stays on the record. Reason (optional):`)
    if (why === null) return
    const res = await writeOffDeduction(debt.id, why.trim() || null, profile?.id)
    if (res?.error) { toast.error('Could not write it off: ' + (res.error.message || 'unknown error')); return }
    reloadAdjustments()
  }
  async function reopen(debt) {
    const res = await reopenDeduction(debt.id)
    if (res?.error) { toast.error('Could not reopen it: ' + (res.error.message || 'unknown error')); return }
    reloadAdjustments()
  }
  async function deleteDebt(debt) {
    if (debt.recoveries.length) {
      toast.error('Money has already come out against this one. Write it off instead — deleting it would erase what was paid.')
      return
    }
    if (!confirm('Delete this deduction? Nothing has been collected against it.')) return
    const res = await deletePayrollAdjustment(debt.id)
    if (res?.error) { toast.error('Could not delete it: ' + (res.error.message || 'unknown error')); return }
    reloadAdjustments()
  }

  // Is the current run locked? A locked run is frozen — no status changes,
  // deal edits, or adjustments (enforced in the DB by migration 028's trigger;
  // this mirrors it in the UI).
  const runLock = view && view !== 'overdue' ? locks.find(l => l.pay_date === view) : null
  // Per-deal lock check — matters in the Overdue view, which mixes deals from
  // several pay dates (runLock above only covers a single-date view).
  const isRunLocked = (payDate) => !!payDate && locks.some(l => l.pay_date === payDate)

  // Viewing payroll is leadership (route guard: vp/admin), but CHANGING data
  // (advancing status, editing a deal) is admin-only — non-admins get a
  // read-only run. A locked run is read-only for everyone.
  const canApprove = isAdmin && !runLock && statusLabels?.includes(APPROVED)
  // Marking a FINALIZED deal Paid is allowed even on a locked run (matches
  // migration 035's trigger — it acknowledges the payout without changing it).
  const canPay     = isAdmin && statusLabels?.includes(PAID)
  const openEdit   = (deal) => {
    if (!isAdmin) return
    // Only the locked run's PAYOUT is frozen (finalized/paid deals — matches
    // migration 034's trigger). A pending / Sales Issue deal parked on a
    // locked date stays editable so e.g. its install date can be corrected.
    if (isRunLocked(deal.pay_date) && isFinalized(deal)) { toast.info('This deal is part of a locked pay run — unlock the run first.'); return }
    setEditDeal(deal); setModal(true)
  }
  const viewLabel  = view === 'overdue' ? 'Overdue (unpaid)' : (fmtDay(view) || '—')

  // Optional filter: scope the run to a single payee/rep. Auto-clears if that
  // person isn't in the current run.
  // Pruned to people actually on this run, so a selection made on one run
  // can't silently empty the next one.
  const effFilters = useMemo(
    () => repFilters.filter(id => payees.some(p => p.id === id)),
    [repFilters, payees])
  const effSet = useMemo(() => new Set(effFilters), [effFilters])
  const filtered = effFilters.length > 0
  const shownDeals  = filtered ? runDeals.filter(d => dealPayouts(d, userById).some(p => effSet.has(p.id))) : runDeals
  const shownPayees = filtered ? payees.filter(p => effSet.has(p.id)) : payees
  // ── Where this run is in its life (per Keaton's review) ──────────────
  // Review → approve → pay → lock. The bar tracks the PAYOUT (paid of
  // finalized), because that is the thing that finishes; verification and
  // approval read as counts beside it.
  const runStage = useMemo(() => {
    const total     = shownDeals.length
    const verified  = shownDeals.filter(d => d.commission_verified === true).length
    const finalized = shownDeals.filter(isFinalized).length
    const paid      = shownDeals.filter(d => d.status === PAID).length
    // THREE SEGMENTS, one per stage, each filling against the count printed
    // beneath it. A single bar tied to paid/finalized read 0% on a run that
    // was fully verified and fully approved, which is where most of the work
    // actually is — it only moved at the very last step.
    const frac = (n, d) => (d > 0 ? Math.min(1, n / d) : 0)
    const segments = [
      { key: 'verified',  fill: runLock ? 1 : frac(verified, total) },
      { key: 'approved',  fill: runLock ? 1 : frac(finalized, total) },
      { key: 'paid',      fill: runLock ? 1 : frac(paid, finalized) },
    ]
    const label =
      runLock                          ? 'Locked'
      : total === 0                    ? 'Nothing on this run'
      : finalized > 0 && paid >= finalized ? 'Paid — ready to lock'
      : finalized >= total             ? 'Approved — ready to pay'
      : paid > 0                       ? 'Paying'
                                       : 'In review'
    const color = runLock ? '#00b894' : (finalized > 0 && paid >= finalized) ? '#00b894'
                : finalized >= total && total > 0 ? '#fbbf24' : '#fdcb6e'
    return { total, verified, finalized, paid, segments, label, color }
  }, [shownDeals, runLock])

  // The three deal-level problems, as one list. They used to be three amber
  // banners of identical construction stacked on top of each other.
  const checks = useMemo(() => ([
    {
      key: 'unverified', deals: runUnverified,
      label: 'aren\u2019t gold-checked yet',
      hint: 'Verify commissions in Deals \u2192 Needs review, or click one to review it here.',
    },
    {
      key: 'office', deals: noOfficeDeals,
      label: 'have no office \u2014 override rates may be wrong',
      hint: 'Set the office to apply the correct director/VP rate. Click a deal to fix it.',
    },
    {
      key: 'unassigned', deals: unassignedDeals,
      label: 'have commission with nobody assigned to pay it to',
      hint: 'The share exists but there is nobody to pay it to \u2014 it will not appear on any pay statement.',
    },
  ].filter(c => c.deals.length > 0)), [runUnverified, noOfficeDeals, unassignedDeals])

  const onThisRun  = useMemo(() => openLedger.filter(d => (payeeTotals[d.payee_id] ?? 0) > 0).length, [openLedger, payeeTotals])
  const checkCount = checks.length + (openLedger.length > 0 ? 1 : 0)

  const summary = (() => {
    let total = 0, paid = 0, paidCount = 0, pending = 0, pendingCount = 0, finalizedCount = 0
    for (const d of shownDeals) {
      const amt = filtered
        ? dealPayouts(d, userById).filter(p => effSet.has(p.id)).reduce((s, p) => s + p.amount, 0)
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

  // Declared before its first use: `summary` is built from shownDeals/shownPayees below, so these
  // two handlers sit after it rather than hoisting it past its own inputs.
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
    if (res?.error) { toast.error('Could not lock the run: ' + (res.error.message || 'unknown error') + '\n(Has migration 028 been run?)'); return }
    const { data } = await fetchPayrollLocks(); setLocks(data || [])
  }
  async function unlockRun() {
    if (!runLock) return
    if (!confirm(`Unlock the ${viewLabel} run? Its deals become editable again.`)) return
    const res = await unlockPayrollRun(runLock.pay_date)
    if (res?.error) { toast.error('Could not unlock: ' + (res.error.message || 'unknown error')); return }
    const { data } = await fetchPayrollLocks(); setLocks(data || [])
  }


  // Advancing a deal collapses it — you've dealt with it, so the run reads
  // top-to-bottom as you work. Re-click the row to open it again.
  function approveAndCollapse(id, status = APPROVED) {
    setExpanded(s => { const n = new Set(s); n.delete(id); return n })
    setStatus(id, status)
  }

  async function setStatus(id, status) {
    const deal = deals.find(d => d.id === id)
    // Advancing status makes the deal part of the run's payout (or edits an
    // already-locked payout) — frozen while the run is locked, EXCEPT the
    // payout acknowledgment: Pay Finalized → Paid is always allowed (035).
    if (deal && isRunLocked(deal.pay_date) && !(status === PAID && deal.status === APPROVED)) {
      toast.info(`The ${fmtDay(deal.pay_date)} pay run is locked — unlock it first to change this deal.`)
      return
    }
    setDeals(ds => ds.map(d => d.id === id ? { ...d, status } : d))   // optimistic
    for (let attempt = 0; ; attempt++) {
      const res = await updateDeal(id, { status })
      if (!res?.error) return
      if (attempt < 2) { await new Promise(r => setTimeout(r, 500 * (attempt + 1))); continue }
      toast.error('Could not save the status change, so it was reverted:\n' + (res.error.message || 'network error'))
      load()
      return
    }
  }
  async function markAll(status) {
    const ids = shownDeals.filter(d => d.status !== status && (!isRunLocked(d.pay_date) || (status === PAID && d.status === APPROVED))).map(d => d.id)
    if (!ids.length) return
    // Name the outstanding problems in the confirm (per Keaton's review).
    // The warnings sit in the "Before you pay" card above, which is one
    // scroll away and easy to have skimmed — and this is money going out.
    const set = new Set(ids)
    const among = (list) => list.filter(d => set.has(d.id)).length
    const flags = [
      [among(runUnverified),   'not gold-checked'],
      [among(noOfficeDeals),   'missing an office'],
      [among(unassignedDeals), 'have commission with nobody assigned'],
    ].filter(([n]) => n > 0).map(([n, what]) => `${n} ${what}`)
    const owed = status === PAID
      ? openLedger.filter(d => (payeeTotals[d.payee_id] ?? 0) > 0).reduce((s2, d) => s2 + d.remaining, 0)
      : 0
    const warn = [
      flags.length ? `Of those, ${flags.join(', ')}.` : '',
      owed > 0 ? `${fmt(owed)} in logged deductions has not been taken off this run yet.` : '',
    ].filter(Boolean).join('\n')
    if (!confirm(`Mark ${ids.length} deal${ids.length === 1 ? '' : 's'} as "${status}"?` + (warn ? `\n\n${warn}` : ''))) return
    setDeals(ds => ds.map(d => ids.includes(d.id) ? { ...d, status } : d))
    const results = await Promise.all(ids.map(id => updateDeal(id, { status })))
    const failed = results.filter(r => r?.error)
    if (failed.length) {
      toast.error(`${failed.length} of ${ids.length} deal${ids.length === 1 ? '' : 's'} could not be updated and were reverted:\n` +
            (failed[0].error.message || 'unknown error'))
      load()
    }
  }

  async function handleSave(data) {
    if (editDeal) {
      setDeals(ds => ds.map(d => d.id === editDeal.id ? { ...d, ...withJoins(data) } : d))
      setModal(false); setEditDeal(null)
      const res = await updateDeal(editDeal.id, data)
      if (res?.error) {
        toast.error('Could not save this deal, so it was reverted:\n' + (res.error.message || 'unknown error'))
        load()
      }
    } else {
      setModal(false); setEditDeal(null)
    }
  }

  // Full run export — organized by deal, listing everyone paid on it with their
  // % (override % for mgmt, % of baseline for setter/closer) and $, then any
  // deduction, then the deal total. Manual adjustments and the grand total last.
  function exportCsv() {
    const rows = [['Deal', 'Baseline', 'Paid to', 'Role', '%', 'Commission $', 'Note']]
    const scoped = filtered
    for (const d of shownDeals) {
      if (!isFinalized(d)) continue
      const a = dealAmounts(d)
      let payouts = dealPayouts(d, userById)
      if (scoped) payouts = payouts.filter(p => effSet.has(p.id))   // rep-scoped export
      if (!payouts.length) continue
      rows.push([d.deal_name || '—', a.baseline.toFixed(2), '', '', '', '', d.office || ''])
      for (const p of payouts) {
        const isRep = p.role === 'Setter' || p.role === 'Closer'
        const roleCell = p.selfGen ? 'Self-Gen' : isRep ? p.role : 'Override'
        const pctRatio = a.baseline > 0 ? p.amount / a.baseline : 0   // effective rate (reflects exclusions)
        rows.push(['', '', p.name, roleCell, asPct(pctRatio), p.amount.toFixed(2), ''])
      }
      if (!scoped && a.deduction > 0)
        rows.push(['', '', '', 'Deduction (already in takes)', '', (-a.deduction).toFixed(2), deductionLabel(d, a)])
      const dealTotal = scoped ? payouts.reduce((s, p) => s + p.amount, 0) : a.totalCommission
      rows.push(['', '', '', 'Deal total', '', dealTotal.toFixed(2), ''])
    }
    // Manual payroll adjustments for this run.
    const adjList = scoped ? runAdjustments.filter(x => effSet.has(x.payee_id)) : runAdjustments
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
    const who = effFilters.length === 1 ? (users.find(u => u.id === effFilters[0])?.name || 'rep')
              : effFilters.length > 1 ? `${effFilters.length}-reps` : ''
    downloadCsv(`payroll-${view === 'overdue' ? 'overdue' : view}${who ? '-' + who : ''}.csv`, rows)
  }

  // Copy one rep's pay statement to the clipboard — a styled table (text/html,
  // pastes into email/Sheets/Docs) plus a plain-text version. Admin only.
  async function copyPayee(p) {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Self-gen deals (rep set AND closed it) read "Self-Gen", not "Setter".
    const roleLabel = (l) => l.selfGen ? 'Self-Gen' : (l.role === 'Setter' || l.role === 'Closer') ? l.role : 'Override'
    const ORDER = { 'Self-Gen': 0, Setter: 1, Closer: 2, Override: 3 }
    const sorted = [...p.lines].sort((a, b) =>
      (ORDER[roleLabel(a)] ?? 9) - (ORDER[roleLabel(b)] ?? 9) || b.amount - a.amount)
    // Flat rows: each pay line (with its % + $), a deduction sub-line where one
    // applied, then any manual adjustments. Net total is authoritative (p.total).
    const items = []
    for (const l of sorted) {
      items.push({ grp: 'deal', deal: l.deal, baseline: fmt(l.baseline || 0), role: roleLabel(l), pct: asPct(l.pct), amount: l.amount })
      if (l.ded > 0) items.push({ grp: 'deal', deal: '', baseline: '', role: l.note || 'Deduction', pct: '', amount: -l.ded, dim: true })
    }
    for (const adj of p.adjustments) {
      // A recovery against a logged deduction (migration 050) names its job,
      // and a PARTIAL take spells out the whole balance and what is left —
      // per Keaton, the statement shows both so nobody has to ask.
      const debt = adj.parent_id ? ledgerById[adj.parent_id] : null
      const line = debt ? recoveryLine(adj, debt) : null
      const job  = adj.deal_id ? dealById[adj.deal_id]?.deal_name : ''
      items.push({
        grp: 'adj',
        deal: debt ? (job || 'Deduction') : 'Adjustment',
        baseline: '',
        role: adj.note || (debt ? 'Deduction' : '—'),
        pct: '', amount: Number(adj.amount),
      })
      if (line?.detail) items.push({ grp: 'adj', deal: '', baseline: '', role: line.detail, pct: '', amount: 0, dim: true, noAmount: true })
    }
    const text = `Pay statement — ${p.name} — ${viewLabel}\n\n`
      + items.map(l => l.noAmount
          ? `    ${l.role}`
          : `• ${l.deal ? l.deal + (l.baseline ? ` (baseline ${l.baseline})` : '') + ' — ' : ''}${l.role}${l.pct ? ` (${l.pct})` : ''}: ${fmt(l.amount)}`).join('\n')
      + `\n\nNet total: ${fmt(p.total)}`

    // Styled statement (inline CSS only — it's pasted into email clients).
    const F = 'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Arial,sans-serif'
    const money = (v) => `<span style="color:${v < 0 ? '#dc2626' : '#111827'};font-weight:600;white-space:nowrap">${fmt(v)}</span>`
    // Each item is tagged at push time — never inferred from its deal name,
    // which would misfile a recovery whose job the rep is also being paid for
    // on this same run.
    const dealRows = items.filter(l => l.grp === 'deal')
    const adjRows  = items.filter(l => l.grp === 'adj')
    const th = (label, align = 'left') =>
      `<td style="padding:8px 12px;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;font-weight:700;text-align:${align};border-bottom:2px solid #e5e7eb">${label}</td>`
    const row = (l, last) => l.noAmount
      ? `<tr><td colspan="5" style="padding:0 12px 8px 24px;font-size:12px;color:#b45309;font-style:italic;${last ? '' : 'border-bottom:1px solid #f3f4f6'}">${esc(l.role)}</td></tr>`
      : l.dim
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
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Always here, not only inside the outstanding tray — that only
                renders once something is owed, so logging the FIRST deduction
                used to mean switching tabs (per Keaton). */}
            {isAdmin && (
              <button onClick={() => setDedModal({})} title="Log a deduction against any job, even one that already paid out"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-white/70 hover:text-white transition-colors"
                style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
                <MinusCircle size={14} className="text-red-400/80" /> Log a deduction
              </button>
            )}
            <button onClick={exportCsv} disabled={!shownDeals.length}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-white/70 hover:text-white disabled:opacity-40 transition-colors"
              style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
              <Download size={14} /> Export CSV
            </button>
          </div>
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

          {/* ── Run status (per Keaton's review) ────────────────────────
              A pay run is a process — review, approve, pay, lock — and the
              page used to show four flat tiles that never said which stage
              you were at. "Deals 2/19" was a progress bar pretending to be a
              statistic; this is the progress bar. */}
          <div className="mb-3 rounded-xl p-4" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
            <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
              <div className="min-w-[190px]">
                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/35">
                  {filtered ? 'Rep payout' : 'Total payout'}
                </p>
                <p className="text-[26px] font-extrabold text-teal mt-1 leading-none tabular-nums">{fmt(summary.total)}</p>
                <p className="text-[11px] text-white/40 mt-1.5">
                  {summary.adjTotal ? (
                    <span className={summary.adjTotal < 0 ? 'text-red-400/90' : 'text-emerald-400/90'}>
                      incl. {summary.adjTotal < 0 ? '−' : '+'}{fmt(Math.abs(summary.adjTotal))} adjustments ·{' '}
                    </span>
                  ) : null}
                  {summary.payees} payee{summary.payees === 1 ? '' : 's'}
                </p>
              </div>

              <div className="flex-1 min-w-[280px]">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/35">Run progress</p>
                  <span className="text-[11.5px] font-bold" style={{ color: runStage.color }}>{runStage.label}</span>
                </div>
                {/* One segment per stage, aligned with the three counts
                    below it, so a fully-verified fully-approved run doesn't
                    read as zero progress. */}
                <div className="flex gap-1">
                  {runStage.segments.map(seg => (
                    <div key={seg.key} className="flex-1 h-[7px] rounded-full overflow-hidden" style={{ background: '#262626' }}>
                      <div style={{
                        width: `${Math.round(seg.fill * 100)}%`, height: '100%',
                        background: seg.fill >= 1 ? '#00b894' : runStage.color,
                        transition: 'width .3s',
                      }} />
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-3 flex-wrap mt-2 text-[11px]">
                  <span className={runStage.verified >= runStage.total && runStage.total > 0 ? 'text-emerald-400/90' : 'text-white/40'}>
                    {runStage.verified}/{runStage.total} verified
                  </span>
                  <span className={runStage.finalized >= runStage.total && runStage.total > 0 ? 'text-emerald-400/90' : 'text-white/40'}>
                    {runStage.finalized}/{runStage.total} approved
                  </span>
                  <span className={runStage.paid >= runStage.finalized && runStage.finalized > 0 ? 'text-emerald-400/90' : 'text-amber-300'}>
                    {runStage.paid}/{runStage.finalized} paid
                  </span>
                  <span className="text-white/40">
                    {summary.remaining > 0 ? `${fmt(summary.remaining)} remaining` : runLock ? 'locked' : 'nothing outstanding'}
                  </span>
                </div>
              </div>
            </div>

            {/* Deals carrying this pay date that aren't finalized aren't being
                paid, so they stay out of the total above. */}
            {summary.pending > 0 && (
              <p className="text-[11px] text-white/35 mt-3 pt-3 border-t border-white/5">
                + {fmt(summary.pending)} across {summary.pendingCount} deal{summary.pendingCount === 1 ? '' : 's'} not yet finalized — excluded from the total until they reach “{APPROVED}”.
              </p>
            )}
          </div>

          {/* ── Before you pay (per Keaton's review) ─────────────────────
              This replaced THREE separate amber banners (unassigned
              commission, missing office, not gold-checked) that had identical
              construction and stacked into one wall of yellow, plus the
              standalone deductions tray. One card, one line per problem,
              each expanding to the same chips as before. A clean run says so
              in a single green line rather than rendering nothing, which
              reads as reassurance instead of absence. */}
          {(checks.length > 0 || openLedger.length > 0) ? (
            <div className="mb-3 rounded-xl overflow-hidden" style={{ background: '#1e1e1e', border: '1px solid rgba(245,158,11,0.38)' }}>
              <div className="flex items-center gap-3 flex-wrap px-4 py-2.5"
                style={{ background: 'rgba(245,158,11,0.07)', borderBottom: '1px solid rgba(245,158,11,0.22)' }}>
                <AlertTriangle size={14} className="text-amber-300 flex-shrink-0" />
                <span className="text-[12.5px] font-bold text-amber-300">
                  Before you pay — {checkCount} thing{checkCount === 1 ? '' : 's'} to look at
                </span>
                <span className="flex-1" />
                <span className="text-[11px] text-white/35">none of these block payment</span>
              </div>

              {/* Deal-level problems */}
              {checks.map(c => (
                <div key={c.key} className="border-t border-white/5">
                  <div className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-[76px] flex-shrink-0 text-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide"
                      style={{ color: '#fcd34d', background: 'rgba(245,158,11,0.13)', border: '1px solid rgba(245,158,11,0.35)' }}>
                      {c.deals.length} deal{c.deals.length === 1 ? '' : 's'}
                    </span>
                    <span className="flex-1 min-w-0 text-[12.5px] text-white/75">{c.label}</span>
                    <button onClick={() => toggleCheck(c.key)}
                      className="px-3 h-8 rounded-lg text-[11.5px] font-bold text-white/55 hover:text-white transition-colors flex-shrink-0"
                      style={{ border: '1px solid #333' }}>
                      {openChecks.has(c.key) ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {openChecks.has(c.key) && (
                    <div className="px-4 pb-3 -mt-0.5">
                      <p className="text-[11px] text-white/35 mb-2">{c.hint}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {c.deals.map(d => (
                          <button key={d.id} onClick={() => openEdit(d)}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white/80 hover:text-white transition-colors"
                            style={{ background: '#171717', border: '1px solid #f59e0b40' }}>
                            {d.deal_name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Deductions owed (migration 050) — now a row of this card
                  rather than its own block above the money. */}
              {openLedger.length > 0 && (
                <div className="border-t border-white/5">
                  <div className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-[76px] flex-shrink-0 text-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide tabular-nums"
                      style={{ color: '#fcd34d', background: 'rgba(245,158,11,0.13)', border: '1px solid rgba(245,158,11,0.35)' }}>
                      {fmt(owedTotals.owed)}
                    </span>
                    <span className="flex-1 min-w-0 text-[12.5px] text-white/75">
                      in deductions owed — {onThisRun} of {owedTotals.count} {onThisRun === 1 ? 'is a rep' : 'are reps'} getting paid on this run
                    </span>
                    <button onClick={() => toggleCheck('deductions')}
                      className={`px-3 h-8 rounded-lg text-[11.5px] font-bold transition-colors flex-shrink-0 ${openChecks.has('deductions') ? 'text-teal' : 'text-white/55 hover:text-white'}`}
                      style={{ border: `1px solid ${openChecks.has('deductions') ? 'rgba(0,184,148,0.4)' : '#333'}` }}>
                      {openChecks.has('deductions') ? 'Hide' : 'Show'}
                    </button>
                  </div>

                  {openChecks.has('deductions') && openLedger.map(d => {
                    const pay  = payeeTotals[d.payee_id] ?? 0
                    const has  = pay > 0
                    const open = applyFor === d.id
                    const typed = open ? (parseFloat(applyAmt) || 0) : 0
                    const negative = open && wouldGoNegative(typed, pay)
                    return (
                      <div key={d.id} className="px-4 py-2.5 border-t border-white/5" style={has ? undefined : { opacity: 0.68 }}>
                        <div className="flex items-center gap-3 flex-wrap">
                          <div className="w-[150px] flex-shrink-0 min-w-0">
                            <p className="text-[12.5px] font-semibold text-white truncate">{userById[d.payee_id]?.name || 'Unknown rep'}</p>
                            <p className="text-[10.5px] text-white/40">{has ? `on this run · ${fmt(pay)}` : 'no pay on this run'}</p>
                          </div>
                          <div className="w-[82px] flex-shrink-0 text-right">
                            <span className="text-[14.5px] font-extrabold text-red-400 tabular-nums">−{fmt(d.remaining)}</span>
                            {d.recovered > 0 && <p className="text-[10px] text-white/35 tabular-nums">of {fmt(d.owed)}</p>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] text-white/70 truncate">
                              {dealById[d.deal_id]?.deal_name || 'No job'}
                              {d.note ? <span className="text-white/45"> · {d.note}</span> : null}
                            </p>
                            <p className="text-[10.5px] text-white/35">
                              logged {d.created_at ? format(new Date(d.created_at), 'MMM d') : '—'}
                              {d.recovered > 0 ? ` · ${fmt(d.recovered)} already recovered` : ''}
                            </p>
                          </div>
                          {isAdmin && !runLock && !open && (
                            <span className="flex items-center gap-1.5 flex-shrink-0">
                              <button onClick={() => { setApplyFor(d.id); setApplyAmt(String(suggestedTake(d.remaining, pay) || d.remaining)) }}
                                className="px-3 h-8 rounded-lg text-[11.5px] font-bold transition-colors"
                                style={{ background: 'rgba(0,184,148,0.12)', border: '1px solid rgba(0,184,148,0.4)', color: '#00b894' }}>
                                Take from this run
                              </button>
                              <button onClick={() => setDedModal({ edit: d })} title="Edit"
                                className="p-1.5 rounded-lg text-white/30 hover:text-teal hover:bg-teal/10"><Pencil size={13} /></button>
                              <button onClick={() => writeOff(d)} title="Write it off — stops it appearing, keeps the record"
                                className="p-1.5 rounded-lg text-white/30 hover:text-amber-400 hover:bg-amber-500/10"><Ban size={13} /></button>
                              {!d.recoveries.length && (
                                <button onClick={() => deleteDebt(d)} title="Delete"
                                  className="p-1.5 rounded-lg text-white/25 hover:text-red-400 hover:bg-red-500/10"><Trash2 size={13} /></button>
                              )}
                            </span>
                          )}
                        </div>

                        {/* How much comes out — Keaton types the number. */}
                        {open && (
                          <div className="mt-2 ml-[150px] flex items-center gap-2 flex-wrap">
                            <label htmlFor={`take-${d.id}`} className="text-[11px] text-white/45">Take</label>
                            <input id={`take-${d.id}`} autoFocus type="number" step="0.01" min="0" value={applyAmt}
                              onChange={e => setApplyAmt(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') applyDeduction(d, applyAmt); if (e.key === 'Escape') setApplyFor('') }}
                              className="w-24 h-8 px-2 rounded-lg text-[12.5px] text-white tabular-nums focus:outline-none"
                              style={{ background: '#1a1a1a', border: '1px solid rgba(0,184,148,0.45)' }} />
                            <span className="text-[11px] text-white/35">of {fmt(d.remaining)} owed</span>
                            <button onClick={() => applyDeduction(d, applyAmt)}
                              className="px-3 h-8 rounded-lg text-[11.5px] font-bold bg-teal text-dark">Take it</button>
                            <button onClick={() => setApplyFor('')} className="px-2 h-8 rounded-lg text-[11.5px] text-white/45 hover:text-white">Cancel</button>
                            {typed > 0 && typed < d.remaining && (
                              <span className="text-[11px] text-amber-300">leaves {fmt(d.remaining - typed)} owed — carries to the next run</span>
                            )}
                            {negative && (
                              <span className="text-[11px] text-red-400">more than the {fmt(pay)} they earn this run — their cheque would go negative</span>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ) : shownDeals.length > 0 && (
            <div className="mb-3 rounded-xl px-4 py-2.5 flex items-center gap-2.5"
              style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.28)' }}>
              <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
              <span className="text-[12.5px] text-emerald-300/90">
                Everything checks out — all deals verified, offices set, every share assigned, nothing owed.
              </span>
            </div>
          )}

          {/* Who gets paid — the run's workspace (per Keaton's review).
              Everything you actually DO lives in here (copy a statement, add
              an adjustment, take a deduction), so the rep filter and the bulk
              actions moved into its header instead of sitting in two more
              strips above it. */}
          {shownPayees.length > 0 && (
            <div className="mb-4 rounded-xl overflow-hidden" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
              <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 border-b border-white/5">
                <button onClick={() => setShowPayees(s => !s)}
                  className="flex items-center gap-2 text-left hover:opacity-80 transition-opacity">
                  <ChevronDown size={14} className={`text-white/30 transition-transform ${showPayees ? 'rotate-180' : ''}`} />
                  <span className="text-[11px] uppercase tracking-wider text-white/40 font-semibold">
                    Who gets paid · {shownPayees.length} {shownPayees.length === 1 ? 'person' : 'people'}
                  </span>
                  <span className="text-[13px] font-bold text-teal">{fmt(summary.total)}</span>
                </button>
                <span className="flex-1" />
                {payees.length > 1 && (
                  <RepMultiSelect users={payees} value={effFilters} onChange={setRepFilters} minW="130px" />
                )}
                {view !== 'overdue' && shownDeals.length > 0 && (
                  <>
                    {canApprove && (
                      <button onClick={() => markAll(APPROVED)}
                        className="px-3 py-1.5 rounded-lg text-[11.5px] font-semibold text-white/70 hover:text-white transition-colors"
                        style={{ background: '#1a1a1a', border: '1px solid #2e2e2e' }}>
                        Approve all
                      </button>
                    )}
                    {canPay && (
                      <button onClick={() => markAll(PAID)}
                        className="px-3 py-1.5 rounded-lg text-[11.5px] font-bold text-dark transition-colors"
                        style={{ background: '#00b894' }}>
                        Mark all paid
                      </button>
                    )}
                    {isAdmin && !runLock && (
                      <button onClick={lockRun} title="Freeze this run — its deals and adjustments become read-only until unlocked"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-semibold text-white/60 hover:text-white transition-colors"
                        style={{ background: '#1a1a1a', border: '1px solid #2e2e2e' }}>
                        <Lock size={12} /> Lock run
                      </button>
                    )}
                  </>
                )}
              </div>
              {showPayees && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 px-4 pb-3 pt-1 items-start">
                  {shownPayees.map(p => (
                    <div key={p.id} className="py-1 border-t border-white/5">
                      <div className="flex items-center justify-between gap-2">
                        <button onClick={onClickUnlessSelecting(() => togglePayee(p.id))}
                          className="flex items-center gap-1 text-[13px] text-white/80 truncate mr-1 text-left min-w-0 hover:text-white transition-colors"
                          title="Show the deals in this payout">
                          <ChevronDown size={12}
                            className={`text-white/25 flex-shrink-0 transition-transform ${openPayees.has(p.id) ? 'rotate-180' : ''}`} />
                          <span className="truncate">
                            {p.name}
                            <span className="text-white/30 text-[11px]"> · {p.dealIds.size} deal{p.dealIds.size === 1 ? '' : 's'}</span>
                          </span>
                        </button>
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
                      {/* Expanded — every deal feeding this person's payout,
                          with the role they earned it in and any deduction. */}
                      {openPayees.has(p.id) && (
                        p.lines.length === 0 ? (
                          <p className="text-[11px] text-white/30 pl-4 mt-0.5">Adjustments only — no deals on this run.</p>
                        ) : (
                          <div className="pl-4 mt-1 mb-1 rounded-lg overflow-hidden" style={{ background: '#171717', border: '1px solid #262626' }}>
                            {p.lines.map((l, i) => (
                              <div key={i} className="px-2.5 py-1.5 border-b border-white/5 last:border-0">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[11.5px] text-white/70 truncate">
                                    {l.deal}
                                    <span className="text-white/30"> · {l.selfGen ? 'Self-Gen' : l.role}</span>
                                  </span>
                                  <span className="text-[11.5px] font-semibold text-white whitespace-nowrap">{fmt(l.amount)}</span>
                                </div>
                                {l.ded > 0 && (
                                  <p className="text-[10px] text-red-400/80 truncate">− {l.note || 'deduction'} · {fmt(l.ded)}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        )
                      )}
                      {p.adjustments.map(a => {
                        // A RECOVERY (migration 050) names its job and, when
                        // it's a partial take, says how much is still owed —
                        // per Keaton, the cheque has to show both numbers.
                        const debt = a.parent_id ? ledgerById[a.parent_id] : null
                        const line = debt ? recoveryLine(a, debt) : null
                        return (
                        <div key={a.id} className="pl-3 mt-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-white/40 truncate">
                            {debt
                              ? <>↳ deduction{dealById[a.deal_id] ? ` · ${dealById[a.deal_id].deal_name}` : ''}{a.note ? ` · ${a.note}` : ''}</>
                              : <>↳ adjustment{a.note ? ` · ${a.note}` : ''}</>}
                          </span>
                          <span className="flex items-center gap-1.5 flex-shrink-0">
                            <span className={`text-[11px] font-semibold whitespace-nowrap ${Number(a.amount) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                              {Number(a.amount) < 0 ? '−' : '+'}{fmt(Math.abs(Number(a.amount)))}
                            </span>
                            {isAdmin && !runLock && (
                              <button onClick={() => removeAdjustment(a.id)} title={debt ? 'Undo this recovery — the balance goes back to outstanding' : 'Remove adjustment'}
                                className="p-0.5 rounded text-white/25 hover:text-red-400"><Trash2 size={11} /></button>
                            )}
                          </span>
                        </div>
                        {line?.detail && (
                          <p className="text-[10px] text-amber-300/80 pl-3">{line.detail}</p>
                        )}
                        </div>
                      )})}
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

          {/* Deals in this run — ONE list. A row expands in place to the full
              payout card; the deal NAME still opens the editor. Approving a
              deal collapses it again so the run works top-to-bottom. */}
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] uppercase tracking-wider text-white/30 font-semibold">Deals in this run</p>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-white/30">{shownDeals.length} deal{shownDeals.length === 1 ? '' : 's'}</span>
              {shownDeals.length > 0 && (
                <button
                  onClick={() => setExpanded(expanded.size ? new Set() : new Set(shownDeals.map(d => d.id)))}
                  className="text-[11px] font-semibold text-white/40 hover:text-teal transition-colors">
                  {expanded.size ? 'Collapse all' : 'Expand all'}
                </button>
              )}
            </div>
          </div>

          <div className="rounded-xl overflow-hidden" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
            {/* Column headings — the row used to be a name and ~600px of
                nothing, and the INSTALL DATE, which is what the list is sorted
                by so it reads against the calendar, was hidden in the
                expander (per Keaton). Columns drop as the window narrows:
                below xl the office/overrides/baseline go, below lg the
                people, below md everything but name/commission/actions. */}
            {shownDeals.length > 0 && (
              <div className="hidden md:flex items-center gap-2.5 px-3 md:px-4 py-1.5 border-b border-white/10"
                style={{ background: '#1a1a1a' }}>
                <span className="w-[13px] flex-shrink-0" />
                <span className="w-2 flex-shrink-0" />
                <span className="flex-1 min-w-0 text-[8.5px] font-bold uppercase tracking-[0.1em] text-white/30">Deal</span>
                <span className="w-[56px] flex-shrink-0 text-[8.5px] font-bold uppercase tracking-[0.1em] text-white/30">Install</span>
                <span className="hidden xl:block w-[62px] flex-shrink-0 text-[8.5px] font-bold uppercase tracking-[0.1em] text-white/30">Office</span>
                <span className="hidden lg:block w-[104px] flex-shrink-0 text-[8.5px] font-bold uppercase tracking-[0.1em] text-white/30">Setter</span>
                <span className="hidden lg:block w-[104px] flex-shrink-0 text-[8.5px] font-bold uppercase tracking-[0.1em] text-white/30">Closer</span>
                <span className="hidden xl:block w-[86px] flex-shrink-0 text-[8.5px] font-bold uppercase tracking-[0.1em] text-white/30">Overrides</span>
                <span className="hidden xl:block w-[76px] flex-shrink-0 text-right text-[8.5px] font-bold uppercase tracking-[0.1em] text-white/30">Baseline</span>
                <span className="w-[86px] flex-shrink-0 text-right text-[8.5px] font-bold uppercase tracking-[0.1em] text-white/30">Commission</span>
                <span className="hidden sm:block w-[84px] flex-shrink-0 text-[8.5px] font-bold uppercase tracking-[0.1em] text-white/30">Status</span>
                <span className="w-[52px] flex-shrink-0" />
              </div>
            )}
            {shownDeals.map(d => {
              const a = dealAmounts(d)
              const color = statusColor(d.status)
              const isPaid = d.status === PAID
              const dealLocked = isRunLocked(d.pay_date)
              const isOpen = expanded.has(d.id)
              const payouts = isOpen ? dealPayouts(d, userById) : []
              const f = rowFacts(d, a, userById)
              return (
                <div key={d.id} className="border-b border-white/5 last:border-0">
                  {/* Row — click anywhere (except the name/actions) to expand */}
                  <div onClick={onClickUnlessSelecting(() => toggleExpanded(d.id))}
                    className="flex items-center gap-2.5 px-3 md:px-4 py-2 hover:bg-white/[0.02] transition-colors cursor-pointer"
                    style={isOpen ? { background: 'rgba(255,255,255,0.02)' } : undefined}>
                    <ChevronDown size={13}
                      className={`text-white/25 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} title={d.status} />
                    {/* The wrapper takes the free space (clicking it expands the
                        row); the button hugs the text so only the NAME edits. */}
                    <div className="min-w-0 flex-1">
                      <button onClick={e => { e.stopPropagation(); openEdit(d) }}
                        className="block w-fit max-w-full text-[13px] font-semibold text-white truncate text-left hover:text-teal transition-colors"
                        title={`${d.deal_name} — click the name to edit this deal`}>
                        {d.deal_name}
                      </button>
                      {/* Phones get the two facts the columns can't show. */}
                      <p className="md:hidden text-[10.5px] text-white/35 truncate">
                        {[fmtShort(d.install_date) || 'No install date', f.setter].filter(Boolean).join(' · ')}
                      </p>
                    </div>

                    <span className={`hidden md:block w-[56px] flex-shrink-0 text-[11.5px] truncate ${d.install_date ? 'text-white/60' : 'text-amber-400/80'}`}>
                      {fmtShort(d.install_date) || 'TBD'}
                    </span>
                    <span className={`hidden xl:block w-[62px] flex-shrink-0 text-[11.5px] truncate ${d.office ? 'text-white/60' : 'text-amber-400/80'}`}
                      title={d.office || 'No office set — the override rate may be wrong'}>
                      {d.office || '—'}
                    </span>
                    <span className={`hidden lg:block w-[104px] flex-shrink-0 text-[11.5px] truncate ${f.setterUnassigned ? 'text-amber-400' : 'text-white/60'}`}
                      title={f.setter || ''}>
                      {f.setter || (f.setterUnassigned ? 'Unassigned' : '—')}
                    </span>
                    <span className={`hidden lg:block w-[104px] flex-shrink-0 text-[11.5px] truncate ${f.closerUnassigned ? 'text-amber-400' : f.closerSolo ? 'text-white/30' : 'text-white/60'}`}
                      title={f.closer || (f.closerSolo ? 'The setter closed it themselves' : '')}>
                      {f.closer || (f.closerUnassigned ? 'Unassigned' : 'self-gen')}
                    </span>
                    <span className="hidden xl:block w-[86px] flex-shrink-0 text-[11.5px] text-white/50 truncate"
                      title={f.overrideCount ? `Manager / director / VP overrides — ${fmt(f.overrideTotal)}. Open the row for the breakdown.` : 'No overrides on this deal'}>
                      {f.overrideCount ? `${f.overrideCount} · ${fmt(f.overrideTotal)}` : '—'}
                    </span>
                    <span className="hidden xl:block w-[76px] flex-shrink-0 text-right text-[11.5px] text-white/60 tabular-nums">{fmt(a.baseline)}</span>

                    <span className="text-[13px] font-bold text-teal flex-shrink-0 w-[86px] text-right tabular-nums">
                      {fmt(a.totalCommission)}
                      {a.deduction > 0 && (
                        <span className="block text-[9.5px] font-semibold text-red-400/90">−{fmt(a.deduction)}</span>
                      )}
                    </span>
                    <span className="hidden sm:flex items-center gap-1 w-[84px] flex-shrink-0">
                      {d.commission_verified === true && <BadgeCheck size={12} className="flex-shrink-0" style={{ color: '#fbbf24' }} title="Commission verified" />}
                      <span className="text-[11px] truncate" style={{ color }}>{d.status}</span>
                    </span>
                    <div className="flex items-center justify-end gap-1 flex-shrink-0 w-[52px]" onClick={e => e.stopPropagation()}>
                      {dealLocked && <Lock size={13} className="text-white/30" title={`The ${fmtDay(d.pay_date)} pay run is locked`} />}
                      {canApprove && !dealLocked && !isPaid && d.status !== APPROVED && (
                        <button onClick={() => approveAndCollapse(d.id)} title={`Move to ${APPROVED}`}
                          className="px-2 py-1 rounded-lg text-[10px] font-semibold text-white/60 hover:text-white transition-colors"
                          style={{ border: '1px solid #3a3a3a' }}>
                          Approve
                        </button>
                      )}
                      {canPay && (isPaid ? (
                        <span className="flex items-center text-teal px-1" title="Paid"><CheckCircle2 size={14} /></span>
                      ) : (!dealLocked || d.status === APPROVED) && (
                        <button onClick={() => approveAndCollapse(d.id, PAID)} title="Mark paid"
                          className="px-2 py-1 rounded-lg text-[10px] font-bold text-dark transition-colors" style={{ background: '#00b894' }}>
                          Paid
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Expanded — the full payout card, inline */}
                  {isOpen && (
                    <div className="px-3 md:px-4 pb-3 pt-1">
                      <p className="text-[11px] text-white/40 mb-2">
                        {[d.office, d.payment_method].filter(Boolean).join(' · ') || 'No office / payment set'}
                      </p>

                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-2 text-[12px]">
                        <div><p className="text-white/30 text-[10px] uppercase">Sold</p><p className="text-white/80">{fmtDay(d.sale_date) || '—'}</p></div>
                        <div><p className="text-white/30 text-[10px] uppercase">Baseline</p><p className="text-white/80">{fmt(a.baseline)}</p></div>
                        <div><p className="text-white/30 text-[10px] uppercase">Job price</p><p className="text-white/80">{fmt(a.job)}</p></div>
                        <div><p className="text-white/30 text-[10px] uppercase">Rep pool</p><p className={a.job - a.baseline < 0 ? 'text-red-400' : 'text-white/80'}>{fmt(a.job - a.baseline)}</p></div>
                        <div><p className="text-white/30 text-[10px] uppercase">Install</p><p className="text-white/80">{fmtDay(d.install_date) || 'TBD'}</p></div>
                        <div><p className="text-white/30 text-[10px] uppercase">Pay date</p><p className="text-white/80">{fmtDay(d.pay_date) || 'TBD'}</p></div>
                      </div>

                      {/* Who gets paid on this deal */}
                      <div className="mt-3 rounded-lg overflow-hidden" style={{ background: '#171717', border: '1px solid #262626' }}>
                        {payouts.length === 0 ? (
                          <div className="px-3 py-2 text-[12px] text-white/30">No payouts on this deal.</div>
                        ) : payouts.map((p, i) => (
                          <div key={i} className="flex items-center justify-between px-3 py-1.5 text-[12px] border-b border-white/5 last:border-0">
                            {p.unassigned ? (
                              <span className="text-amber-400 truncate mr-2 flex items-center gap-1.5">
                                <AlertTriangle size={11} /> Unassigned <span className="text-amber-400/60">· {p.role} — set the {p.role.toLowerCase()} on the deal</span>
                              </span>
                            ) : (
                              <span className="text-white/70 truncate mr-2">
                                {p.name}
                                <span className="text-white/30"> · {p.selfGen ? 'Self-Gen' : p.role}</span>
                                {/* The EFFECTIVE rate — amount ÷ baseline, so
                                    override exclusions show as e.g. 2.7% not
                                    3%. This is what the row's "3 · $389"
                                    overrides column summarizes. */}
                                {a.baseline > 0 && ['Manager', 'Director', 'VP'].includes(p.role) && (
                                  <span className="text-white/25"> · {asPct(p.amount / a.baseline)}</span>
                                )}
                              </span>
                            )}
                            <span className={`font-semibold whitespace-nowrap ${p.unassigned ? 'text-amber-400' : 'text-white'}`}>{fmt(p.amount)}</span>
                          </div>
                        ))}
                      </div>

                      {a.deduction > 0 && (
                        <p className="text-[11px] text-red-400/90 mt-2 flex items-center gap-1.5">
                          <AlertTriangle size={12} /> {fmt(a.deduction)} deduction — {deductionLabel(d, a)}
                        </p>
                      )}

                      <div className="flex items-center justify-end gap-1.5 mt-3">
                        <button onClick={() => openEdit(d)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white/50 hover:text-teal hover:bg-teal/10 transition-colors">
                          <Pencil size={13} /> Edit deal
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            {shownDeals.length === 0 && (
              <div className="px-4 py-6 text-white/30 text-sm text-center">
                {filtered ? 'No deals for the selected rep(s) in this run.' : 'No deals in this run.'}
              </div>
            )}
          </div>
        </>
      )}
      </>)}

      {tab === 'deductions' && (
        <>
          {/* ── Logged deductions (the ledger, migration 050) ───────────────
              What people OWE, separate from the deductions priced into a deal.
              A debt here never altered its job's commission — it rides on a
              future cheque instead. */}
          <div className="mb-4 rounded-xl overflow-hidden" style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}>
            <div className="flex items-center gap-3 flex-wrap px-4 py-3 border-b border-white/5">
              <span className="text-[11px] uppercase tracking-wider text-white/30 font-semibold">Logged after payout</span>
              {owedTotals.count > 0 && (
                <span className="text-[11px] font-bold text-amber-300">{fmt(owedTotals.owed)} owed across {owedTotals.people} {owedTotals.people === 1 ? 'person' : 'people'}</span>
              )}
              <span className="flex-1" />
              <span className="flex gap-1">
                {[['open', 'Outstanding'], ['all', 'All']].map(([k, label]) => (
                  <button key={k} onClick={() => setDedFilter(k)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${dedFilter === k ? 'bg-teal/15 text-teal border border-teal/30' : 'text-white/45 hover:text-white border border-transparent'}`}>
                    {label}
                  </button>
                ))}
              </span>
              {isAdmin && (
                <button onClick={() => setDedModal({})}
                  className="px-3 py-1.5 rounded-lg text-[11.5px] font-bold bg-teal text-dark">+ Log a deduction</button>
              )}
            </div>
            {(() => {
              const rows = dedFilter === 'open' ? openLedger : ledger
              if (!rows.length) {
                return <p className="px-4 py-8 text-center text-white/30 text-sm">
                  {dedFilter === 'open' ? 'Nothing owed — every logged deduction has been recovered or written off.' : 'No deductions logged yet.'}
                </p>
              }
              return rows.map(d => (
                <div key={d.id} className="px-4 py-3 border-b border-white/5 last:border-0"
                  style={d.status === 'open' || d.status === 'partial' ? undefined : { opacity: 0.66 }}>
                  <div className="flex items-start gap-3 flex-wrap">
                    <div className="w-[150px] flex-shrink-0 min-w-0">
                      <p className="text-[13px] font-semibold text-white truncate">{userById[d.payee_id]?.name || 'Unknown rep'}</p>
                      <p className="text-[10.5px] text-white/35">logged {d.created_at ? format(new Date(d.created_at), 'MMM d, yyyy') : '—'}</p>
                    </div>
                    <div className="w-[96px] flex-shrink-0 text-right">
                      <p className="text-[13.5px] font-extrabold text-red-400 tabular-nums">{fmt(d.remaining)}</p>
                      <p className="text-[10px] text-white/35 tabular-nums">of {fmt(d.owed)}</p>
                    </div>
                    <div className="flex-1 min-w-[180px]">
                      <p className="text-[12.5px] text-white/75 truncate">
                        {dealById[d.deal_id]?.deal_name || 'No job'}
                        {d.note ? <span className="text-white/45"> · {d.note}</span> : null}
                      </p>
                      {d.recoveries.length > 0 && (
                        <div className="mt-1.5 pl-3 border-l-2 border-white/10 space-y-0.5">
                          {d.recoveries.map(r => (
                            <p key={r.id} className="text-[11px] text-white/45 tabular-nums">
                              {fmt(Math.abs(Number(r.amount)))} came out {fmtDay(r.pay_date)}
                            </p>
                          ))}
                          {d.remaining > 0 && <p className="text-[11px] text-amber-300 tabular-nums">{fmt(d.remaining)} rolls to their next run</p>}
                        </div>
                      )}
                      {d.writtenOff && d.written_off_note && (
                        <p className="text-[11px] text-white/35 mt-1">written off — {d.written_off_note}</p>
                      )}
                    </div>
                    <span className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide"
                        style={d.status === 'settled'
                          ? { color: '#6ee7b7', background: 'rgba(16,185,129,0.13)', border: '1px solid rgba(16,185,129,0.35)' }
                          : d.status === 'written_off'
                          ? { color: 'rgba(255,255,255,0.55)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.18)' }
                          : { color: '#fcd34d', background: 'rgba(245,158,11,0.13)', border: '1px solid rgba(245,158,11,0.35)' }}>
                        {STATUS_LABEL[d.status]}
                      </span>
                      {isAdmin && d.status !== 'settled' && (
                        d.writtenOff
                          ? <button onClick={() => reopen(d)} title="Reopen — it starts showing on runs again"
                              className="p-1.5 rounded-lg text-white/30 hover:text-teal hover:bg-teal/10"><CheckCircle2 size={13} /></button>
                          : <>
                              <button onClick={() => setDedModal({ edit: d })} title="Edit"
                                className="p-1.5 rounded-lg text-white/30 hover:text-teal hover:bg-teal/10"><Pencil size={13} /></button>
                              <button onClick={() => writeOff(d)} title="Write it off"
                                className="p-1.5 rounded-lg text-white/30 hover:text-amber-400 hover:bg-amber-500/10"><Ban size={13} /></button>
                              {!d.recoveries.length && (
                                <button onClick={() => deleteDebt(d)} title="Delete"
                                  className="p-1.5 rounded-lg text-white/25 hover:text-red-400 hover:bg-red-500/10"><Trash2 size={13} /></button>
                              )}
                            </>
                      )}
                    </span>
                  </div>
                </div>
              ))
            })()}
          </div>

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

      {dedModal && (
        <DeductionModal
          deals={deals} users={users} payDates={payDates}
          currentRun={view} edit={dedModal.edit}
          onClose={() => setDedModal(null)} onSave={saveDeduction} />
      )}

      {modal && (
        <DealModal deal={editDeal} users={users} onSave={handleSave}
          onClose={() => { setModal(false); setEditDeal(null) }} />
      )}
    </div>
  )
}
