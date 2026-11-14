// Redesign step 3 proof: the "Where your money stands" rows on the Commissions
// page are a re-labelling of the page's EXISTING owed and paid totals.
// For every demo user: Projected + Finalized + On hold == owed total, and
// Paid == paid total, to the cent. The owed/paid sets below are built with the
// page's own rules (src/pages/Commissions.jsx: pipelineDeals / paidDeals).
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEMO_USERS, DEMO_DEALS_JOINED } from '../src/lib/demoData.js'
import { activeDeals, getUserCommission } from '../src/utils/commission.js'
import { standingRows, PAID, ISSUE, FINALIZED } from '../src/pages/commissionsStanding.js'

const cents = n => Math.round((Number(n) || 0) * 100) / 100
const dataStartDate = null   // demo settings carry no cutoff; the page's legacy rule is kept verbatim anyway

test('standing rows reconcile to the page owed and paid totals for every demo user', () => {
  const all = activeDeals(DEMO_DEALS_JOINED)
  let usersWithMoney = 0, finalizedSeen = 0
  for (const u of DEMO_USERS) {
    const id = u.id
    const take = (d) => getUserCommission(d, id)
    const mine = all.filter(d => [d.setter_id, d.closer_id, d.manager_id, d.director_id, d.vp_id].includes(id))
    // Page rule: owed = unpaid, not Sales Issue, not pre-cutoff legacy.
    const pipeline = mine.filter(d => d.status !== PAID && d.status !== ISSUE &&
      !(dataStartDate && d.sale_date && d.sale_date < dataStartDate))
    const paid = mine.filter(d => d.status === PAID)
    const owedTotal = cents(pipeline.reduce((s, d) => s + take(d), 0))
    const paidTotal = cents(paid.reduce((s, d) => s + take(d), 0))

    const rows = standingRows(pipeline, paid, take)
    assert.equal(cents(rows.projected.total + rows.finalized.total + rows.onHold.total), owedTotal, `${u.name}: owed`)
    assert.equal(cents(rows.paid.total), paidTotal, `${u.name}: paid`)
    // The three unpaid buckets partition the owed set: no deal lost or counted twice.
    assert.equal(rows.projected.deals.length + rows.finalized.deals.length + rows.onHold.deals.length, pipeline.length, `${u.name}: owed deal count`)
    assert.ok(rows.finalized.deals.every(d => d.status === FINALIZED))
    assert.ok(rows.projected.deals.every(d => d.status !== FINALIZED && d.status !== PAID && d.status !== ISSUE))
    assert.ok(rows.paid.deals.every(d => d.status === PAID))
    assert.equal(rows.onHold.total, 0, 'Sales Issue money is not shown today, so On hold is empty')
    if (owedTotal !== 0 || paidTotal !== 0) usersWithMoney++
    finalizedSeen += rows.finalized.deals.length
  }
  assert.ok(usersWithMoney >= 5, `expected real money for several demo users, got ${usersWithMoney}`)
  assert.ok(finalizedSeen > 0, 'demo data should exercise the Finalized bucket')
})
