// ============================================================
// The deduction LEDGER (migration 050) — the one shared rule for a deduction
// that is owed but not yet taken. Pure: pages feed rows in and render.
//
// Shape, all of it inside `payroll_adjustments`:
//   • a DEBT      = pay_date NULL. What a rep owes, with no run attached.
//   • a RECOVERY  = pay_date set + parent_id -> the debt. What actually came
//                   out on that run. An ordinary dated adjustment, which is
//                   exactly what Payroll already sums, so a recovery needs no
//                   special handling anywhere in the payout math.
//   • anything else with a pay_date and no parent = a plain adjustment, the
//     +/− that existed before this feature. Untouched.
//
// Money is stored signed (negative deducts, matching the old +/− editor), but
// a debt is only ever a deduction, so the ledger works in POSITIVE dollars
// owed and converts at the edges. `owed`, `recovered` and `remaining` are all
// positive numbers here; the rows they came from stay negative.
//
// Per Keaton: nothing is ever taken automatically, and HE picks how much comes
// out of each cheque — `suggestedTake` is only the number the input starts on.
// ============================================================

const money = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
// Dollars-and-cents, so a debt can't be left owing $0.000001 and never settle.
const round2 = (n) => Math.round(n * 100) / 100

export const isDebt     = (a) => !!a && !a.pay_date
export const isRecovery = (a) => !!a && !!a.pay_date && !!a.parent_id
export const isWrittenOff = (a) => !!a && !!a.written_off_at

// open → nothing taken yet · partial → some taken, some left
// settled → fully recovered · written_off → closed without collecting
export function debtStatus(d) {
  if (d.writtenOff) return 'written_off'
  if (d.remaining <= 0) return 'settled'
  return d.recovered > 0 ? 'partial' : 'open'
}

export const STATUS_LABEL = {
  open: 'Outstanding',
  partial: 'Partly recovered',
  settled: 'Recovered',
  written_off: 'Written off',
}

// Every debt, each carrying the recoveries taken against it.
// `adjustments` is the whole payroll_adjustments table as db.js returns it.
export function buildLedger(adjustments = []) {
  const recoveriesByParent = new Map()
  for (const a of adjustments) {
    if (!isRecovery(a)) continue
    if (!recoveriesByParent.has(a.parent_id)) recoveriesByParent.set(a.parent_id, [])
    recoveriesByParent.get(a.parent_id).push(a)
  }

  const debts = adjustments.filter(isDebt).map(row => {
    const recoveries = (recoveriesByParent.get(row.id) || [])
      .slice()
      .sort((a, b) => String(a.pay_date).localeCompare(String(b.pay_date)))
    const owed      = round2(Math.abs(money(row.amount)))
    const recovered = round2(recoveries.reduce((s, r) => s + Math.abs(money(r.amount)), 0))
    // Never negative: an over-collection (someone typed too much) reads as
    // settled rather than as the rep being owed money back, which would be a
    // different thing entirely and needs a human, not arithmetic.
    const remaining = round2(Math.max(0, owed - recovered))
    const d = { ...row, owed, recovered, remaining, recoveries, writtenOff: isWrittenOff(row) }
    d.status = debtStatus(d)
    return d
  })

  // Newest first, but anything still owed outranks anything closed — the list
  // is a worklist before it is a history.
  const rank = { open: 0, partial: 0, settled: 1, written_off: 2 }
  debts.sort((a, b) =>
    (rank[a.status] - rank[b.status]) ||
    String(b.created_at || '').localeCompare(String(a.created_at || '')))

  return debts
}

export const openDebts = (debts = []) => debts.filter(d => d.remaining > 0 && !d.writtenOff)

// What to prefill the "how much comes out" box with: the whole balance, or
// everything they earned this run when that is less. Keaton can type over it —
// the cap is a starting point, not a rule (he asked to dictate the amount).
export function suggestedTake(remaining, payAvailable) {
  const rem = round2(Math.max(0, money(remaining)))
  const pay = round2(Math.max(0, money(payAvailable)))
  return round2(Math.min(rem, pay))
}

// Would this take push the cheque below zero? The tray warns, then allows it.
export const wouldGoNegative = (take, payAvailable) => round2(money(take)) > round2(money(payAvailable))

// Totals for the tray header and the "still owed after this run" tile.
export function ledgerTotals(debts = []) {
  const open = openDebts(debts)
  return {
    count: open.length,
    owed: round2(open.reduce((s, d) => s + d.remaining, 0)),
    people: new Set(open.map(d => d.payee_id)).size,
  }
}

// One line for a pay statement / the payee row. Keaton asked that a partial
// take says so on the cheque: what came out AND what is still owed.
// `debt` may be absent when an adjustment has no parent (a plain +/−).
export function recoveryLine(recovery, debt) {
  const took = round2(Math.abs(money(recovery.amount)))
  const base = recovery.note || 'Deduction'
  if (!debt) return { label: base, took, partial: false, detail: null }
  const takenBefore = debt.recoveries
    .filter(r => String(r.pay_date) < String(recovery.pay_date))
    .reduce((s, r) => s + Math.abs(money(r.amount)), 0)
  const leftAfter = round2(Math.max(0, debt.owed - round2(takenBefore) - took))
  return {
    label: base,
    took,
    partial: took < debt.owed,
    owed: debt.owed,
    left: leftAfter,
    detail: took < debt.owed
      ? `partial — $${took.toFixed(2)} of $${debt.owed.toFixed(2)}${leftAfter > 0 ? `, $${leftAfter.toFixed(2)} still owed` : ', now settled'}`
      : null,
  }
}
