// ============================================================
// Commission engine — the SINGLE source of truth for deal math.
// Every page derives revenue & commission from here so the numbers
// always agree.
//
// Definitions used across the whole app:
//   • "Revenue" / "production"  = baseline_revenue  (what monthly goals track)
//   • Rep pool                  = max(job_price - baseline_revenue, 0)
//   • Stored *_amount fields     = source of truth when present (from the
//                                  Google Sheet sync; already NET of deductions)
//   • Overrides                  = baseline * override_pct  (manager/dir/vp)
// ============================================================

const num = (v) => (v == null ? 0 : Number(v) || 0)

// Director & VP override rate defaults BY OFFICE. Used only as a FALLBACK when a
// deal carries no explicit per-deal override % (e.g. a manual deal the sync
// hasn't stamped yet). Tucson books at 3.75%, every other office at 5%. A stored
// *_amount or an explicit per-deal pct always wins over this default, so this
// never overrides a manually-corrected rate.
export const TUCSON_OVERRIDE_RATE  = 0.0375
export const DEFAULT_OVERRIDE_RATE = 0.05
export const isTucson = (deal) => String(deal?.office || '').trim().toLowerCase() === 'tucson'

// ── Admin-configurable rate schedule (app_settings.override_rates) ──────────
// An array of "eras": { effective: 'YYYY-MM-DD', manager: 3, default: 5,
// byOffice: { tucson: 3.75 } } — percentages in HUMAN form (3.75 = 3.75%).
// A deal's era is picked by its SALE DATE (last era whose effective date is on
// or before it), so changing rates going forward never re-prices older deals:
// they keep the era in force when they closed. When no schedule is configured,
// the legacy constants above apply. SettingsContext feeds this on load/save.
let RATE_SCHEDULE = null
export function setOverrideRateSchedule(rows) {
  RATE_SCHEDULE = Array.isArray(rows) && rows.length
    ? [...rows].sort((a, b) => String(a.effective || '').localeCompare(String(b.effective || '')))
    : null
}
export function rateEraFor(saleDate) {
  if (!RATE_SCHEDULE) return null
  const d = saleDate || new Date().toISOString().slice(0, 10)
  let era = RATE_SCHEDULE[0]
  for (const r of RATE_SCHEDULE) { if (String(r.effective || '') <= d) era = r; else break }
  return era
}
// Director/VP rate for a deal (fraction, e.g. 0.05) — era-aware, office-aware.
export function officeOverrideRate(deal) {
  const era = rateEraFor(deal?.sale_date)
  if (era) {
    const office = String(deal?.office || '').trim().toLowerCase()
    const v = era.byOffice && era.byOffice[office] != null ? era.byOffice[office] : era.default
    return (Number(v) || 0) / 100 || DEFAULT_OVERRIDE_RATE
  }
  return isTucson(deal) ? TUCSON_OVERRIDE_RATE : DEFAULT_OVERRIDE_RATE
}
// Manager default rate for a deal closed on saleDate (fraction, e.g. 0.03).
export function managerDefaultRate(saleDate) {
  const era = rateEraFor(saleDate)
  return era && era.manager != null ? (Number(era.manager) || 0) / 100 : 0.03
}

export function dealAmounts(deal) {
  const baseline = num(deal.baseline_revenue)
  const job      = num(deal.job_price)
  // Rep pool can go NEGATIVE when a deal is sold BELOW baseline — the rep eats
  // the shortfall, so commission is allowed to be negative (shown red).
  const repPool  = job - baseline
  const solo     = !deal.closer_id || deal.setter_id === deal.closer_id
  const split    = deal.setter_split_pct == null ? 0.5 : num(deal.setter_split_pct)

  // Deduction = the manual amount + a financing dealer fee (financed × fee%).
  const manualDeduction = num(deal.deduction_amount)
  const financed   = num(deal.financed_amount)
  const dealerFee  = financed * num(deal.dealer_fee_pct)
  const deduction  = manualDeduction + dealerFee

  // Stored amounts win when present (sheet sync / manual entry — already NET of
  // deductions). Otherwise compute the split and net the deduction off whoever
  // absorbs it. Solo deals → the setter. Split deals → deduction_paid_by:
  // 'closer' (default), 'setter', or 'split' (50/50). Overrides are never reduced.
  const rawSetter = repPool * (solo ? 1 : split)
  const rawCloser = solo ? 0 : repPool * (1 - split)
  const paidBy = deal.deduction_paid_by || 'closer'
  let setterDed = 0, closerDed = 0
  if (solo)                     setterDed = deduction
  else if (paidBy === 'setter') setterDed = deduction
  else if (paidBy === 'split')  {
    const dsp = deal.deduction_split_pct == null ? 0.5 : num(deal.deduction_split_pct)  // setter's share
    setterDed = deduction * dsp
    closerDed = deduction * (1 - dsp)
  }
  else                          closerDed = deduction          // 'closer' (default)
  // Computed-from-rules amounts — what each role SHOULD earn given the split and
  // the override %s, independent of any stored value. The Requires-Audit panel
  // reconciles these against the stored sheet amounts. Director/VP fall back to
  // the office rate (Tucson 3.75% / else 5%) only when the per-deal pct is
  // missing; manager has no such default (sync stamps 0.03 at deal creation).
  const dirVpRate = officeOverrideRate(deal)
  const computed = {
    setter:   rawSetter - setterDed,
    closer:   rawCloser - closerDed,
    manager:  baseline * num(deal.manager_override_pct),
    director: baseline * (deal.director_override_pct != null ? num(deal.director_override_pct) : dirVpRate),
    vp:       baseline * (deal.vp_override_pct       != null ? num(deal.vp_override_pct)       : dirVpRate),
  }

  // Stored *_amount (sheet sync / manual entry — already NET of deductions) wins
  // when present; otherwise use the computed value. An override only counts when
  // its person is actually assigned — a stranded override % / amount with no
  // manager/director/vp pays nobody, so it must not inflate any total.
  let setter   = deal.setter_amount   != null ? num(deal.setter_amount)   : computed.setter
  let closer   = deal.closer_amount   != null ? num(deal.closer_amount)   : computed.closer
  let manager  = deal.manager_id  ? (deal.manager_amount  != null ? num(deal.manager_amount)  : computed.manager)  : 0
  let director = deal.director_id ? (deal.director_amount != null ? num(deal.director_amount) : computed.director) : 0
  let vp       = deal.vp_id       ? (deal.vp_amount       != null ? num(deal.vp_amount)       : computed.vp)       : 0

  // Optional rep bonus: several management roles and/or the company can each
  // chip in a $ amount (the editor resolves % of baseline → $). Each management
  // contribution is pulled from THAT role's payout, capped at what they have;
  // 'company' is an extra on top, from nobody. The rep (setter by default, or
  // closer) receives the total. Baked into the per-role amounts here so every
  // roll-up (payroll, leaderboards, getUserCommission) reflects it.
  const fromManager  = deal.manager_id  ? Math.min(manager,  Math.max(0, num(deal.bonus_manager)))  : 0
  const fromDirector = deal.director_id ? Math.min(director, Math.max(0, num(deal.bonus_director))) : 0
  const fromVp       = deal.vp_id       ? Math.min(vp,       Math.max(0, num(deal.bonus_vp)))       : 0
  const fromCompany  = Math.max(0, num(deal.bonus_company))
  manager  -= fromManager
  director -= fromDirector
  vp       -= fromVp
  const bonus = fromManager + fromDirector + fromVp + fromCompany
  if (bonus > 0) {
    if ((deal.bonus_recipient || 'setter') === 'closer' && deal.closer_id && deal.closer_id !== deal.setter_id) closer += bonus
    else setter += bonus
  }

  const repCommission = setter + closer
  const overrides     = manager + director + vp
  const totalCommission = repCommission + overrides

  return {
    baseline, job, revenue: baseline, deduction, manualDeduction, dealerFee, financed,
    setter, closer, manager, director, vp,
    repCommission, overrides, totalCommission,
    bonus, bonusFrom: { company: fromCompany, manager: fromManager, director: fromDirector, vp: fromVp },
    computed,
  }
}

export const calcDealCommissions = (deal) => {
  const r = dealAmounts(deal)
  return {
    ...r,
    gross:       r.totalCommission,
    setterAmt:   r.setter,
    closerAmt:   r.closer,
    managerAmt:  r.manager,
    directorAmt: r.director,
    vpAmt:       r.vp,
    // commission as a % of the deal's job price
    commPct:     r.job > 0 ? r.totalCommission / r.job : 0,
  }
}

// The setter's OWN share of a deal — never the closer's portion and never
// any override the same person might also earn on that deal. Use this for the
// rep leaderboard, which credits the setter with full revenue but should show
// only the setter's commission, not the combined rep pool. On a solo deal the
// setter share is the whole rep pool; on a split deal it is the setter's split
// (or the stored setter_amount when the sheet provides it).
export const getSetterCommission = (deal) => dealAmounts(deal).setter

// What a single user personally earns on one deal or an array of deals,
// summed across whichever roles they hold (setter/closer/manager/dir/vp).
export const getUserCommission = (dealsOrDeal, userId) => {
  const arr = Array.isArray(dealsOrDeal) ? dealsOrDeal : [dealsOrDeal]
  return arr.reduce((sum, d) => {
    const a = dealAmounts(d)
    if (d.setter_id   === userId) sum += a.setter
    if (d.closer_id   === userId && d.closer_id !== d.setter_id) sum += a.closer
    if (d.manager_id  === userId) sum += a.manager
    if (d.director_id === userId) sum += a.director
    if (d.vp_id       === userId) sum += a.vp
    return sum
  }, 0)
}

// Aggregate roll-up for a set of deals. revenue = baseline (goal basis).
export function rollup(deals) {
  return (deals || []).reduce(
    (acc, d) => {
      const a = dealAmounts(d)
      acc.count += 1
      acc.baselineRevenue += a.baseline
      acc.jobRevenue += a.job
      acc.commission += a.totalCommission
      return acc
    },
    { count: 0, baselineRevenue: 0, jobRevenue: 0, commission: 0 }
  )
}

export const fmt = (n) =>
  '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtPct = (n) => ((Number(n) || 0) * 100).toFixed(1) + '%'

// A canceled deal is excluded from every aggregate — revenue, commissions,
// leaderboards, competitions, payroll. It still shows on the Deals page so it
// can be moved out of "Canceled", at which point it counts again. Tolerates the
// "Cancelled" spelling too.
export const isCanceled = (deal) => {
  const s = (deal?.status || '').trim().toLowerCase()
  return s === 'canceled' || s === 'cancelled'
}
export const activeDeals = (deals = []) => deals.filter(d => !isCanceled(d))

// ── Requires-Audit reconciliation ────────────────────────────
// Compare the dollar amounts STORED on a deal (synced from the Google Sheet)
// against what the commission rules compute. Any field off by more than $1 is
// flagged so leadership can catch errors in EITHER the sheet or the dashboard
// math. Stored amounts that match the rules — and fields with no stored value at
// all (the engine just computes those) — are never flagged. Canceled deals are
// excluded, consistent with every other aggregate.
export const AUDIT_TOLERANCE = 1

// [stored-column, human label, key into the `computed` object]
const AUDIT_FIELDS = [
  ['setter_amount',   'Setter',   'setter'],
  ['closer_amount',   'Closer',   'closer'],
  ['manager_amount',  'Manager',  'manager'],
  ['director_amount', 'Director', 'director'],
  ['vp_amount',       'VP',       'vp'],
]

// Returns null when the deal is clean (or canceled), otherwise
// { deal, mismatches: [{ field, label, stored, calculated, diff, kind }] }.
export function dealAudit(deal) {
  if (!deal || isCanceled(deal)) return null
  const { computed } = dealAmounts(deal)
  const baseline = num(deal.baseline_revenue)
  const mismatches = []

  // 1) Stored amount vs computed amount, per role.
  for (const [field, label, key] of AUDIT_FIELDS) {
    if (deal[field] == null) continue          // nothing stored → nothing to reconcile
    const stored = num(deal[field])
    const calculated = computed[key]
    if (Math.abs(stored - calculated) > AUDIT_TOLERANCE) {
      mismatches.push({ field, label, stored, calculated, diff: stored - calculated, kind: 'amount' })
    }
  }

  // 2) Tucson rate check: a Tucson deal whose stored Director/VP amount reflects
  //    the 5% default instead of the 3.75% Tucson office rate. Catches a wrong
  //    RATE even when the stored amount is internally consistent with a wrong %.
  if (isTucson(deal)) {
    const at5   = baseline * DEFAULT_OVERRIDE_RATE
    const at375 = baseline * TUCSON_OVERRIDE_RATE
    for (const [field, label] of [['director_amount', 'Director'], ['vp_amount', 'VP']]) {
      if (deal[field] == null) continue
      const stored = num(deal[field])
      const looksLike5 =
        Math.abs(stored - at5) <= AUDIT_TOLERANCE && Math.abs(stored - at375) > AUDIT_TOLERANCE
      if (looksLike5 && !mismatches.some(m => m.field === field)) {
        mismatches.push({ field, label, stored, calculated: at375, diff: stored - at375, kind: 'tucson-rate' })
      }
    }
  }

  return mismatches.length ? { deal, mismatches } : null
}

// Map a list of deals to the subset that need review (each as a dealAudit result).
// Legacy deals (closed before dataStartDate) predate our atomized data and are
// left out so old imports don't permanently flag the audit panel.
export const dealsRequiringAudit = (deals = [], dataStartDate = null) =>
  (deals || [])
    .filter(d => !(dataStartDate && d.sale_date && d.sale_date < dataStartDate))
    .map(dealAudit)
    .filter(Boolean)
