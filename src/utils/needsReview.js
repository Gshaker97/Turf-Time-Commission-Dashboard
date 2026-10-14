// ============================================================
// needsReview.js — the ONE rule for "is this deal in the Needs-review queue".
//
// Shared by the Deals page (src/components/DealTable.jsx re-exports these) and
// server.js (the audit queue), so the browser's queue and the server's audit
// can never select different deals. Pure — no React/DOM — so server.js can
// import it directly. Keep it that way.
// ============================================================
import { countsInTotals } from './commission.js'

// The fields a finalized deal must have. Order is the display order.
export const dealMissingInfo = (deal) => {
  const missing = []
  if (!deal.office)          missing.push('office')
  if (!deal.payment_method)  missing.push('payment')
  if (!deal.setter_id)       missing.push('setter')
  if (!deal.closer_id)       missing.push('closer')
  if (!deal.install_date)    missing.push('install date')
  if (!deal.pay_date)        missing.push('pay date')
  if (!(parseFloat(deal.baseline_revenue) > 0)) missing.push('baseline')
  if (!(parseFloat(deal.job_price) > 0))        missing.push('sale price')
  return missing
}

// A deal is in the queue when it still needs something — not gold-checked, or
// carrying a change alert, or missing a field — AND it actually counts
// (canceled/hidden are out, via countsInTotals) AND it is not legacy (closed
// before the data-start date). Keep in exact lockstep with the server audit.
export const dealNeedsReview = (deal, dataStartDate) =>
  countsInTotals(deal) &&
  (deal.commission_verified !== true || deal.change_alert != null || dealMissingInfo(deal).length > 0) &&
  !(dataStartDate && deal.sale_date && deal.sale_date < dataStartDate)

// ── Same job imported twice under two Project IDs ─────────────
// ArcSite sometimes re-issues a job under a FRESH Project ID (a re-sign).
// The sync cannot tell that from a genuine second job for the same customer,
// and guessing is how both of its matcher bugs happened: adopting the old
// deal loses a real second sale, creating blindly leaves a silent duplicate.
// So the sync always creates, and this flags the pairs for a human.
//
// The signature is deliberately TIGHT — same customer, same baseline, same
// closing date — because repeat customers are common here and a flag on
// every one of them would be noise. A genuine second job differs in at
// least one of the three.
//
// Returns a Map of deal id -> how many OTHER deals share its signature, so a
// row can say "same as 1 other deal" without counting every pair on the page.
// Canceled/hidden deals are left out: hiding one of a pair is how you
// resolve it, so a resolved pair must stop flagging.
export function duplicateDealIds(deals = []) {
  const bySig = new Map()
  for (const d of deals) {
    if (!countsInTotals(d)) continue
    const name = String(d.deal_name ?? '').trim().toLowerCase()
    if (!name) continue
    // A POSITIVE baseline, not merely a finite one: Number(null) is 0, so
    // every deal still waiting on its figures shared one signature and the
    // whole un-priced backlog flagged itself as duplicates of each other.
    const base = Number(d.baseline_revenue)
    if (!(base > 0)) continue
    const sig = `${name}|${base.toFixed(2)}|${d.sale_date ?? ''}`
    if (!bySig.has(sig)) bySig.set(sig, [])
    bySig.get(sig).push(d)
  }
  const out = new Map()
  for (const group of bySig.values()) {
    if (group.length < 2) continue
    for (const d of group) out.set(d.id, group.length - 1)
  }
  return out
}
