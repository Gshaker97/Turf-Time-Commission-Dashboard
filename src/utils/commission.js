/**
 * Calculate all commission amounts for a deal.
 *
 * Behavior: if a stored dollar amount exists on the deal (synced from the
 * Google Sheet, includes any manual bonuses or deductions), use it as-is.
 * Otherwise, fall back to calculating from the percentage fields.
 *
 * Stored override_pct values are decimals (0.04 = 4%).
 */
export function calcDealCommissions(deal) {
  const baseline = parseFloat(deal.baseline_revenue) || 0
  const jobPrice = parseFloat(deal.job_price) || 0
  const gross    = jobPrice - baseline

  // Solo deal: no closer assigned, OR setter and closer are the same person.
  // In both cases, the setter gets 100% of the commission.
  const sameRep   = !deal.closer_id || deal.setter_id === deal.closer_id
  const setterPct = sameRep ? 1 : (parseFloat(deal.setter_split_pct) || 0.5)

  // ── Manager / Director / VP amounts ──
  // Prefer the stored $ from the sheet; otherwise compute from %.
  const managerAmt  = deal.manager_amount  != null
    ? parseFloat(deal.manager_amount)
    : baseline * (parseFloat(deal.manager_override_pct)  || 0)

  // For director/VP: if the stored amount is null but someone is assigned,
  // fall back to baseline × pct, defaulting pct to 0.05 (5%). Covers the
  // sheet-formula gap where director % is skipped when director = closer.
  const directorAmt = deal.director_amount != null
    ? parseFloat(deal.director_amount)
    : deal.director_id != null
      ? baseline * (parseFloat(deal.director_override_pct) || 0.05)
      : 0

  const vpAmt       = deal.vp_amount       != null
    ? parseFloat(deal.vp_amount)
    : deal.vp_id       != null
      ? baseline * (parseFloat(deal.vp_override_pct)       || 0.05)
      : 0

  // ── Setter / Closer amounts ──
  // If both stored values are present, use them directly.
  const hasStoredRepAmounts =
    deal.setter_amount != null && (sameRep || deal.closer_amount != null)

  let setterAmt, closerAmt
  if (hasStoredRepAmounts) {
    setterAmt = parseFloat(deal.setter_amount) || 0
    closerAmt = sameRep ? 0 : (parseFloat(deal.closer_amount) || 0)
  } else {
    // Fallback: compute from gross + leader-to-rep allocations
    const mgrToRep = baseline * (parseFloat(deal.manager_to_rep_pct)  || 0)
    const dirToRep = baseline * (parseFloat(deal.director_to_rep_pct) || 0)
    const vpToRep  = baseline * (parseFloat(deal.vp_to_rep_pct)       || 0)
    const repPool  = gross + mgrToRep + dirToRep + vpToRep
    setterAmt = repPool * setterPct
    closerAmt = sameRep ? 0 : repPool * (1 - setterPct)
  }

  const repBonus = (setterAmt + closerAmt) - gross
  const commPct  = baseline > 0 ? ((setterAmt + closerAmt) / baseline) * 100 : 0

  return {
    gross,
    commPct,
    setterAmt,
    closerAmt,
    setterPct,
    managerAmt,
    directorAmt,
    vpAmt,
    repBonus,
  }
}

/**
 * Return the commission $ owed to userId on a single deal
 * (combines setter, closer, and any override roles).
 */
export function getUserCommission(deal, userId) {
  if (!userId) return 0
  const { setterAmt, closerAmt, managerAmt, directorAmt, vpAmt } =
    calcDealCommissions(deal)
  let total = 0
  if (deal.setter_id === userId) total += setterAmt
  if (deal.closer_id && deal.closer_id === userId && deal.closer_id !== deal.setter_id)
    total += closerAmt
  if (deal.manager_id  === userId) total += managerAmt
  if (deal.director_id === userId) total += directorAmt
  if (deal.vp_id       === userId) total += vpAmt
  return total
}

/** Sum of payments.amount for a specific user on a specific deal. */
export function getPaidForUser(payments = [], dealId, userId) {
  return payments
    .filter(p => p.deal_id === dealId && p.user_id === userId)
    .reduce((s, p) => s + parseFloat(p.amount), 0)
}

export const fmt = (n) =>
  '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtPct = (n) =>
  n.toFixed(1) + '%'
