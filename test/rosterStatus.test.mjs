// Roster status (migration 062) — ON the team vs IN the headcount.
//
// The claim that matters: a flex or away rep leaves the HEADCOUNT and keeps
// their MONEY. Keaton chose 24 ÷ 4 = 6.0 over 20 ÷ 4 = 5.0 knowing it gives a
// team with flex reps an edge, so the numerator and the divisor are asserted
// separately — a test that only checked the score would pass with both of
// them wrong in the same direction.
import test from 'node:test'
import assert from 'node:assert/strict'
import { countsInHeadcount, rosterStatus, isFlex, isAway, headIdSet } from '../src/utils/team.js'
import { competitionStandings, teamAvgRoster } from '../src/utils/competition.js'
import { buildPerformance, repFlags } from '../src/utils/perfSummary.js'

// ── the one rule ──────────────────────────────────────────────────────────
test('countsInHeadcount: the default, the two states, and access', () => {
  // THE UNKNOWN COLUMN READS AS COUNTED. This is what let the frontend ship
  // before the migration ran: every profile counted, exactly as before.
  assert.equal(rosterStatus({ id: 'x' }), 'counted')
  assert.equal(countsInHeadcount({ id: 'x', active: true }), true)
  assert.equal(countsInHeadcount({ roster_status: 'counted', active: true }), true)

  assert.equal(countsInHeadcount({ roster_status: 'flex', active: true }), false)
  assert.equal(countsInHeadcount({ roster_status: 'away', active: true }), false)
  // active is a SEPARATE axis — a deactivated counted rep is still out.
  assert.equal(countsInHeadcount({ roster_status: 'counted', active: false }), false)
  // ...and the two compose: flex today, deactivated later.
  assert.equal(countsInHeadcount({ roster_status: 'flex', active: false }), false)

  assert.equal(isFlex({ roster_status: 'flex' }), true)
  assert.equal(isAway({ roster_status: 'away' }), true)
  assert.equal(isAway({ roster_status: 'flex' }), false)
  // A junk value must not silently remove someone from the count.
  assert.equal(rosterStatus({ roster_status: 'part-time' }), 'counted')
  assert.equal(countsInHeadcount({ roster_status: 'part-time', active: true }), true)
})

// ── the team_avg divisor: Keaton's own example ────────────────────────────
const U = (id, extra = {}) => ({ id, name: id, role: 'rep', manager_id: 'm1', active: true, ...extra })
const USERS = [
  U('m1', { role: 'manager', manager_id: null, name: 'Jordan' }),
  U('r1'), U('r2'), U('r3'),                       // counted with m1 = 4
  U('f1', { roster_status: 'flex' }),              // Kyltan
  U('a1', { roster_status: 'away', away_until: '2026-12-15' }),
]
const CTX = {
  usersById: Object.fromEntries(USERS.map(u => [u.id, u])),
  heads: headIdSet(USERS),
  changesByProfile: {},
}
const deal = (id, owner) => ({
  id, setter_id: owner, closer_id: owner, sale_date: '2026-11-10',
  status: 'Paid', baseline_revenue: 1000, job_price: 1100,
})
// 24 deals: 20 from the counted four, 4 from the flex rep.
const DEALS = [
  ...Array.from({ length: 5 },  (_, i) => deal(`m${i}`, 'm1')),
  ...Array.from({ length: 5 },  (_, i) => deal(`a${i}`, 'r1')),
  ...Array.from({ length: 5 },  (_, i) => deal(`b${i}`, 'r2')),
  ...Array.from({ length: 5 },  (_, i) => deal(`c${i}`, 'r3')),
  ...Array.from({ length: 4 },  (_, i) => deal(`f${i}`, 'f1')),
]
const COMP = {
  type: 'team_avg', metric: 'deals', participant_ids: ['m1'],
  start_date: '2026-11-01', end_date: '2026-11-30',
}

test('team_avg: flex deals stay in the total, flex headcount leaves the divisor', () => {
  const [row] = competitionStandings(COMP, DEALS, USERS, { teamCtx: CTX })
  assert.equal(row.count, 4, 'divisor counts m1 + r1..r3 only — not f1, not a1')
  assert.equal(row.total, 24, 'numerator still carries the flex rep\'s 4 deals')
  assert.equal(row.score, 6, '24 ÷ 4 = 6.0 — the figure Keaton picked over 20 ÷ 4')
})

test('team_avg: BOTH loops skip them — selling does not buy a flex rep back in', () => {
  // The roster is built from everyone on the team PLUS everyone who earned
  // credit. Filtering only the second loop would put f1 straight back into
  // the divisor the moment he sold, which is the bug this pins.
  const roster = teamAvgRoster('m1', DEALS, USERS, COMP, CTX)
  assert.ok(!roster.includes('f1'), 'a flex rep who sold 4 deals is still out of the divisor')
  assert.ok(!roster.includes('a1'), 'an away rep is out of the divisor')
  assert.deepEqual([...roster].sort(), ['m1', 'r1', 'r2', 'r3'])
})

test('team_avg: with nobody flagged, the divisor is unchanged', () => {
  // The before-state, so the test can never pass by excluding everyone.
  const plain = USERS.map(({ roster_status, away_until, ...u }) => u)
  const [row] = competitionStandings(COMP, DEALS, plain, {
    teamCtx: { ...CTX, usersById: Object.fromEntries(plain.map(u => [u.id, u])) },
  })
  assert.equal(row.count, 6, 'all six count when none is flex or away')
  assert.equal(row.total, 24, 'the same deals')
  assert.equal(row.score, 4, '24 ÷ 6 — and 6.0 above is therefore a real change')
})

// ── nothing is red while someone is out ───────────────────────────────────
test('repFlags: away is never flagged, counted still is', () => {
  const floors = { set: 10 }
  assert.deepEqual(repFlags({ set: 0, rosterStatus: 'away' }, floors), {})
  assert.deepEqual(repFlags({ set: 0, rosterStatus: 'flex' }, floors), { set: true },
    'flex reps are present and still held to the floor')
  assert.deepEqual(repFlags({ set: 0, rosterStatus: 'counted' }, floors), { set: true })
  assert.deepEqual(repFlags({ set: 50, rosterStatus: 'counted' }, floors), {})
})

// ── the Dashboard team row ────────────────────────────────────────────────
const perf = (users, deals = DEALS) => buildPerformance({
  deals, users,
  teamCtx: { usersById: Object.fromEntries(users.map(u => [u.id, u])), heads: headIdSet(users), changesByProfile: {} },
  range: { from: '2026-11-01', to: '2026-11-30' },
})

test('team row: "N reps" drops flex and away; a flex rep still gets a row', () => {
  const team = perf(USERS).teams.find(t => t.key === 'm1')
  assert.equal(team.members, 4, 'the count is the counted four')

  const ids = team.rows.map(r => r.id)
  assert.ok(ids.includes('f1'), 'the flex rep is still listed — present, just not counted')
  assert.equal(team.rows.find(r => r.id === 'f1').counted, false)
  assert.equal(team.rows.find(r => r.id === 'f1').deals, 4, 'and their deals still show')

  // AWAY with nothing in the window loses its zero row (Keaton's exemption).
  assert.ok(!ids.includes('a1'), 'an away rep with no deals is not listed as a zero')
})

test('team row: an away rep who DID sell still appears, with their numbers', () => {
  // Hiding them outright would delete real revenue from the breakdown; the
  // zero-row exemption is about silence, not about erasing what they did.
  const sold = [...DEALS, deal('z1', 'a1')]
  const team = perf(USERS, sold).teams.find(t => t.key === 'm1')
  const row = team.rows.find(r => r.id === 'a1')
  assert.ok(row, 'an away rep with a deal in range is listed')
  assert.equal(row.deals, 1)
  assert.equal(row.counted, false, 'listed, but still out of the headcount')
  assert.equal(team.members, 4, 'and the count has not moved')
})

test('team row: with nobody flagged the count is six — the rules really bite', () => {
  const plain = USERS.map(({ roster_status, away_until, ...u }) => u)
  assert.equal(perf(plain).teams.find(t => t.key === 'm1').members, 6)
})
