// Dashboard breakdown: Set and Close ratio (Garrison, Nov 14 2026).
// Setter = deals owned ÷ appointments set. Closer = deals closed ÷ appointments
// assigned (closer on the appointment, else the setter). `assigned` counts
// every calendar appointment with a day and time, any outcome.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPerformance } from '../src/utils/perfSummary.js'
import { headIdSet, buildChangesByProfile } from '../src/utils/team.js'

const users = [
  { id: 'M', name: 'Manager', role: 'manager', manager_id: null, active: true },
  { id: 'S', name: 'Setter',  role: 'rep', manager_id: 'M', active: true, sales_role: 'setter' },
  { id: 'C', name: 'Closer',  role: 'rep', manager_id: 'M', active: true, sales_role: 'closer' },
  { id: 'B', name: 'Both',    role: 'rep', manager_id: 'M', active: true, sales_role: 'both' },
]
const teamCtx = { usersById: Object.fromEntries(users.map(u => [u.id, u])), heads: headIdSet(users), changesByProfile: buildChangesByProfile([]) }
const at = (d, h) => `2026-11-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00-07:00`
const lead = (id, setter, closer, status, day) => ({ id, setter_id: setter, closer_id: closer, status, appointment_at: at(day, 10), set_at: at(day - 1, 9), ignored: false })
const leads = [
  lead('L1', 'S', 'C', 'sold', 3),        // S set, C sat and sold
  lead('L2', 'S', 'C', 'no_show', 4),     // S set, C assigned, no-show
  lead('L3', 'S', null, 'scheduled', 12), // S set, nobody else: assigned to S
  lead('L4', 'B', null, 'completed', 5),  // B set and sat their own
  lead('L5', null, 'C', 'completed', 6),  // setter unknown, C sat it
]
const deal = (id, setter, closer, day) => ({ id, setter_id: setter, closer_id: closer, sale_date: `2026-11-${String(day).padStart(2, '0')}`, baseline_revenue: 1000, job_price: 1500, status: 'Deal Review', office: 'Tucson' })
const deals = [deal('D1', 'S', 'C', 3), deal('D2', 'B', 'B', 5)]

const perf = buildPerformance({ deals, leads, users, teamCtx, range: { from: '2026-11-01', to: '2026-11-30' } })
const rep = (id) => perf.teams.find(t => t.key === 'M').rows.find(r => r.id === id)

test('set counts every calendar appointment the person booked, any outcome', () => {
  assert.equal(rep('S').set, 3)
  assert.equal(rep('B').set, 1)
  assert.equal(rep('C').set, 0)
})
test('assigned counts every appointment handed to the person, any outcome', () => {
  assert.equal(rep('C').assigned, 3, 'L1 sold, L2 no-show, L5 unknown setter')
  assert.equal(rep('S').assigned, 1, 'L3 has no closer, so the setter would sit it')
  assert.equal(rep('B').assigned, 1)
  assert.equal(perf.org.assigned, 5)
})
test('closes go to the closer, or the owner when there is no distinct closer', () => {
  assert.equal(rep('C').closes, 1)
  assert.equal(rep('S').closes, 0)
  assert.equal(rep('B').closes, 1)
  assert.equal(perf.org.closes, 2)
})
test('the two close ratios', () => {
  assert.equal(Math.round(rep('S').setCloseRate), 33, 'setter: 1 owned deal of 3 sets')
  assert.equal(Math.round(rep('C').closerCloseRate), 33, 'closer: 1 close of 3 assigned')
  assert.equal(rep('B').closerCloseRate, 100)
  assert.equal(rep('B').setCloseRate, 100)
  assert.equal(Math.round(perf.org.setCloseRate), 50, 'company: 2 deals of 4 sets')
})
test('deal counts are untouched by the new columns', () => {
  assert.equal(perf.org.deals, 2)
  assert.equal(rep('S').deals, 1)
  assert.equal(rep('C').leadCloses, 1)
})
