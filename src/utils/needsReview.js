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
