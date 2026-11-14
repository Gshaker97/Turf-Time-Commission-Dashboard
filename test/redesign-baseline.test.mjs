// Redesign baseline (Nov 2026). Proof that the UI-only redesign on
// redesign/private-bank never changes a number: every demo deal is run through
// src/utils/commission.js for every demo user, rounded to cents, and compared
// with the committed snapshot test/fixtures/redesign-baseline.json.
//
// Regenerate ONLY when the engine itself is intentionally changed on main:
//   REDESIGN_BASELINE_WRITE=1 node --test test/redesign-baseline.test.mjs
// Demo deal ids are random per load, so deals are keyed by index + project_id +
// deal_name; dates are left out (they are relative to "today" in demoData).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { DEMO_USERS, DEMO_DEALS_JOINED } from '../src/lib/demoData.js'
import { dealAmounts, getUserCommission, getSetterCommission, rollup, activeDeals, countsInTotals, isCanceled, isHidden } from '../src/utils/commission.js'

const FIXTURE = new URL('./fixtures/redesign-baseline.json', import.meta.url)
const cents = n => Math.round((Number(n) || 0) * 100) / 100
const AMOUNT_KEYS = ['baseline', 'job', 'revenue', 'deduction', 'manualDeduction', 'dealerFee', 'financed', 'setter', 'closer', 'manager', 'director', 'vp', 'repCommission', 'overrides', 'totalCommission', 'exclusionsTotal', 'overrideBase', 'bonus', 'bonusSetter', 'bonusCloser']

export function buildBaseline() {
  const users = [...DEMO_USERS].map(u => ({ id: u.id, name: u.name, role: u.role })).sort((a, b) => a.id.localeCompare(b.id))
  const deals = DEMO_DEALS_JOINED.map((d, i) => {
    const a = dealAmounts(d)
    const amounts = Object.fromEntries(AMOUNT_KEYS.map(k => [k, cents(a[k])]))
    amounts.bonusFrom = Object.fromEntries(Object.entries(a.bonusFrom || {}).map(([k, v]) => [k, cents(v)]))
    const perUser = {}
    for (const u of users) { const c = cents(getUserCommission(d, u.id)); if (c !== 0) perUser[u.id] = c }
    return {
      key: `${String(i).padStart(2, '0')}:${d.project_id || ''}:${d.deal_name || ''}`,
      status: d.status, office: d.office || null, canceled: isCanceled(d), hidden: isHidden(d), counts: countsInTotals(d),
      setter_id: d.setter_id || null, closer_id: d.closer_id || null, manager_id: d.manager_id || null, director_id: d.director_id || null, vp_id: d.vp_id || null,
      amounts, setter_commission: cents(getSetterCommission(d)), per_user: perUser,
    }
  })
  const active = activeDeals(DEMO_DEALS_JOINED)
  const r = rollup(active), rAll = rollup(DEMO_DEALS_JOINED)
  const totals = {
    deals: DEMO_DEALS_JOINED.length, active_deals: active.length,
    active: { count: r.count, baseline_revenue: cents(r.baselineRevenue), job_revenue: cents(r.jobRevenue), commission: cents(r.commission) },
    all: { count: rAll.count, baseline_revenue: cents(rAll.baselineRevenue), job_revenue: cents(rAll.jobRevenue), commission: cents(rAll.commission) },
    per_user_active: Object.fromEntries(users.map(u => [u.id, cents(getUserCommission(active, u.id))])),
    per_user_all: Object.fromEntries(users.map(u => [u.id, cents(getUserCommission(DEMO_DEALS_JOINED, u.id))])),
  }
  return { generated_for: 'redesign/private-bank baseline — commission engine output over demo data', engine: 'src/utils/commission.js', data: 'src/lib/demoData.js', users, deals, totals }
}

test('redesign baseline: commission engine output over demo data matches the committed snapshot', () => {
  const now = buildBaseline()
  if (process.env.REDESIGN_BASELINE_WRITE === '1' || !existsSync(FIXTURE)) {
    writeFileSync(FIXTURE, JSON.stringify(now, null, 2) + '\n')
    console.log(`wrote ${FIXTURE.pathname}`)
  }
  const snap = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  assert.equal(now.deals.length, snap.deals.length, 'deal count changed')
  assert.equal(now.users.length, snap.users.length, 'user count changed')
  for (let i = 0; i < snap.deals.length; i++) {
    assert.deepEqual(now.deals[i], snap.deals[i], `deal ${snap.deals[i].key} changed`)
  }
  assert.deepEqual(now.totals, snap.totals, 'totals changed')
  assert.deepEqual(now.users, snap.users, 'users changed')
})

test('redesign baseline: the snapshot is non-trivial (guards against an empty or zeroed fixture)', () => {
  const snap = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  assert.ok(snap.deals.length >= 20, 'expected the full demo deal set')
  assert.ok(snap.totals.active.commission > 0, 'active commission must be positive')
  assert.ok(Object.values(snap.totals.per_user_active).some(v => v > 0), 'someone must earn commission')
  assert.ok(snap.deals.some(d => Object.keys(d.per_user).length >= 3), 'a deal should pay setter/closer plus overrides')
})
