// "Where your money stands" — display grouping for the Commissions page.
//
// These are LABELS over the statuses and amounts the page already computes;
// nothing here is commission math. The page passes in the exact deal lists it
// already shows (its owed pipeline and its Paid list) and the same `take`
// function it already sums with, so by construction:
//   projected.total + finalized.total + onHold.total === the page's owed total
//   paid.total                                        === the page's paid total
//
//   Finalized = status "Pay Finalized" (money is locked for a pay run)
//   Projected = every other unpaid deal the page counts as owed
//   Paid      = status "Paid"
//   On hold   = Sales Issue money. The page excludes Sales Issue from every
//               total today, so this row is always empty here; it exists so
//               the sum rule above stays honest if that ever changes.
export const PAID = 'Paid'
export const ISSUE = 'Sales Issue'
export const FINALIZED = 'Pay Finalized'

const sum = (deals, take) => deals.reduce((s, d) => s + (Number(take(d)) || 0), 0)

export function standingRows(pipelineDeals, paidDeals, take, onHoldDeals = []) {
  const finalized = pipelineDeals.filter(d => d.status === FINALIZED)
  const projected = pipelineDeals.filter(d => d.status !== FINALIZED)
  return {
    projected: { key: 'projected', label: 'Projected', deals: projected,   total: sum(projected, take) },
    finalized: { key: 'finalized', label: 'Finalized', deals: finalized,   total: sum(finalized, take) },
    paid:      { key: 'paid',      label: 'Paid',      deals: paidDeals,   total: sum(paidDeals, take) },
    onHold:    { key: 'onhold',    label: 'On hold',   deals: onHoldDeals, total: sum(onHoldDeals, take) },
  }
}
