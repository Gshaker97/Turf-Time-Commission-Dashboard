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

export function dealAmounts(deal) {
  const baseline = num(deal.baseline_revenue)
  const job      = num(deal.job_price)
  const repPool  = Math.max(job - baseline, 0)
  const solo     = !deal.closer_id || deal.setter_id === deal.closer_id
  const split    = deal.setter_split_pct == null ? 0.5 : num(deal.setter_split_pct)
  const deduction = num(deal.deduction_amount)

  // Stored amounts win when present (sheet sync / manual entry — already NET of
  // deductions). Otherwise compute the split and net the deduction off whoever
  // absorbs it: the setter on a solo deal, the closer on a split deal (mirrors
  // the New Deal entry form). Overrides are never reduced by a deduction.
  const rawSetter = repPool * (solo ? 1 : split)
  const rawCloser = solo ? 0 : repPool * (1 - split)
  const setter   = deal.setter_amount   != null ? num(deal.setter_amount)   : Math.max(rawSetter - (solo ? deduction : 0), 0)
  const closer   = deal.closer_amount   != null ? num(deal.closer_amount)   : Math.max(rawCloser - (solo ? 0 : deduction), 0)
  const manager  = deal.manager_amount  != null ? num(deal.manager_amount)  : baseline * num(deal.manager_override_pct)
  const director = deal.director_amount != null ? num(deal.director_amount) : baseline * num(deal.director_override_pct)
  const vp       = deal.vp_amount       != null ? num(deal.vp_amount)       : baseline * num(deal.vp_override_pct)

  const repCommission = setter + closer
  const overrides     = manager + director + vp
  const totalCommission = repCommission + overrides

  return {
    baseline, job, revenue: baseline, deduction,
    setter, closer, manager, director, vp,
    repCommission, overrides, totalCommission,
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
