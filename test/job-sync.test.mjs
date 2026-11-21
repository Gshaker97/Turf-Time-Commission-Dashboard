import test from 'node:test'
import assert from 'node:assert/strict'
import { pickLiveOpp, projectBelongsToOpp, scheduleState, statusPlan, fieldPlan, carryoverPlan, unsignedClosed } from '../lib/job-sync.mjs'

const OUT = 'pipe-outside', IN = 'pipe-inside'

test('shared Project ID: Inside/Outside pair → Outside live, Inside reported; otherwise the calendar-linked opp; lost never counted', () => {
  // the PM calendar job decides first: Dhan Harnanan / Samer Darraj / Pamela Thompson keep their Inside copy
  const r = pickLiveOpp([{ id: 'i', pipelineId: IN, status: 'open' }, { id: 'o', pipelineId: OUT, status: 'open' }], { outsidePipelineId: OUT, calendarOppIds: ['i'] })
  assert.equal(r.live.id, 'i'); assert.deepEqual(r.copies.map(c => c.id), ['o']); assert.match(r.reason, /calendar job points to it; the other-pipeline copy should be closed/)
  // no calendar job on either → Outside is live
  const nocal = pickLiveOpp([{ id: 'i', pipelineId: IN, status: 'open' }, { id: 'o', pipelineId: OUT, status: 'open' }], { outsidePipelineId: OUT, calendarOppIds: [] })
  assert.equal(nocal.live.id, 'o'); assert.match(nocal.reason, /Inside Sales copy should be closed/)
  const two = pickLiveOpp([{ id: 'a', pipelineId: OUT, status: 'open', createdAt: '2026-08-24' }, { id: 'b', pipelineId: OUT, status: 'open', createdAt: '2026-10-17' }], { outsidePipelineId: OUT, calendarOppIds: ['b'] })
  assert.equal(two.live.id, 'b'); assert.match(two.reason, /calendar job points to it/)
  const lost = pickLiveOpp([{ id: 'x', status: 'lost' }, { id: 'y', status: 'open' }], { outsidePipelineId: OUT })
  assert.equal(lost.live.id, 'y'); assert.deepEqual(lost.copies, [])
  const unresolved = pickLiveOpp([{ id: 'a', pipelineId: OUT, status: 'open' }, { id: 'b', pipelineId: OUT, status: 'open' }], { outsidePipelineId: OUT, calendarOppIds: ['a', 'b'] })
  assert.equal(unresolved.live, null); assert.match(unresolved.reason, /two real jobs on one Project ID/)
  assert.equal(pickLiveOpp([{ id: 'a', pipelineId: OUT, status: 'open' }, { id: 'b', pipelineId: OUT, status: 'open' }], { outsidePipelineId: OUT }).live, null)
})

test('a Project ID stamped on the wrong customer is detected (Courtney Spillers / Aaron Spillers)', () => {
  assert.equal(projectBelongsToOpp({ arcCustomer: 'Aaron Spillers', arcProject: 'Aaron Spiller', oppName: 'Courtney Spillers', contactName: 'Courtney Spillers' }).ok, false)
  assert.equal(projectBelongsToOpp({ arcCustomer: 'Jonathan Kim', oppName: 'Jonathan Kim' }).ok, true)
  assert.equal(projectBelongsToOpp({ arcCustomer: 'Pamela Thompsan', arcProject: 'Pamela', oppName: 'Pamela Thompson' }).ok, true, 'one typo is the same person')
  assert.equal(projectBelongsToOpp({ arcCustomer: 'Rene Sanchez', arcProject: 'Arvonda', oppName: 'Arvonda Ganaway ' }).ok, true, 'project name names the other customer on a shared project')
  for (const [a, b] of [['Conner Coffey', 'Connor Coffey'], ['Brendan Becker', 'Brenden Becker'], ['Mayra Valadez', 'Maira Valadez'], ['Manny Jimenez', 'Emanuel Jiminez'], ['Troy Moretti', 'Tory Moretti'], ['Perla Niebla', 'Perla Niebal'], ['Robert Durwood', 'Robert Durward #2']]) assert.equal(projectBelongsToOpp({ arcCustomer: a, oppName: b }).ok, true, a + ' vs ' + b)
  assert.equal(projectBelongsToOpp({ arcCustomer: 'Jeanie', oppName: 'Larry Ryder' }).ok, false)
})

test('Schedule tab → status: cancelled → abandoned (or a configured stage); rebooked → open + Deal Reviewed; lost untouched', () => {
  const cancelled = { live: [], cancelled: [{ date: '2026-11-27' }] }
  assert.deepEqual(statusPlan({ schedule: scheduleState(cancelled), opp: { status: 'open' }, closedStageId: 'closed' }).write, { status: 'abandoned' })
  assert.deepEqual(statusPlan({ schedule: scheduleState(cancelled), opp: { status: 'open', pipelineStageId: 'x' }, closedStageId: 'closed', cancelledStageId: 'canc' }).write, { pipelineStageId: 'canc' })
  assert.equal(statusPlan({ schedule: scheduleState(cancelled), opp: { status: 'abandoned' }, closedStageId: 'closed' }).action, null)
  assert.equal(statusPlan({ schedule: scheduleState(cancelled), opp: { status: 'lost' }, closedStageId: 'closed' }).action, null)
  const rebooked = { live: [{ date: '2026-12-05' }], cancelled: [{ date: '2026-11-27' }] }
  assert.deepEqual(statusPlan({ schedule: scheduleState(rebooked), opp: { status: 'abandoned' }, closedStageId: 'closed' }).write, { status: 'open', pipelineStageId: 'closed' })
  assert.equal(statusPlan({ schedule: scheduleState(rebooked), opp: { status: 'open' }, closedStageId: 'closed' }).action, null)
  assert.equal(scheduleState({ live: [{ date: '2026-12-03' }, { date: '2026-12-05' }], cancelled: [] }).state, 'ambiguous')
})

test('field plan: install date from the Schedule tab to opp, contact and calendar; PM from the calendar; prices; a hold freezes only the value', () => {
  const cur = { oppInstall: '2026-11-23', contactInstall: null, calendarInstall: '2026-11-23', oppPm: 'Kevin Soto', contactPm: null, oppPrice: 1000, contactJobPrice: 6200, contactNewPrice: null }
  const p = fieldPlan(cur, { install: '2026-12-03', pm: 'Kevin Soto', value: 13896.13 })
  assert.deepEqual(p.opp, { install: '2026-12-03', price: 13896.13 }); assert.deepEqual(p.contact, { install: '2026-12-03', pm: 'Kevin Soto', jobPrice: 13896.13, newPrice: 13896.13 }); assert.deepEqual(p.calendar, { install: '2026-12-03' })
  assert.match(p.reasons.join('; '), /Install Date 2026-11-23 → 2026-12-03 \(Schedule tab\)/)
  const held = fieldPlan(cur, { install: '2026-12-03', pm: 'Kevin Soto', value: 13896.13 }, { held: true })
  assert.deepEqual(held.opp, { install: '2026-12-03' }); assert.deepEqual(held.frozen, ['oppPrice', 'contactJobPrice', 'contactNewPrice'])
  const disputed = fieldPlan(cur, { value: 13896.13 }, { disputed: true }); assert.equal(disputed.any, false)
  assert.equal(fieldPlan({ oppInstall: '2026-12-03', contactInstall: '2026-12-03', calendarInstall: '2026-12-03', oppPm: 'K', contactPm: 'K', oppPrice: 10, contactJobPrice: 10, contactNewPrice: 10 }, { install: '2026-12-03', pm: 'K', value: 10 }).any, false)
})

test('carryover: a contact price with no signed contract on this opp is cleared', () => {
  assert.equal(carryoverPlan({ contactJobPrice: 9164.27, hasSignedContract: false, otherDealValues: [9164.27] }).action, 'clear')
  assert.match(carryoverPlan({ contactJobPrice: 9164.27, hasSignedContract: false, otherDealValues: [9164.27] }).reason, /matches another deal/)
  assert.equal(carryoverPlan({ contactJobPrice: 9164.27, hasSignedContract: true }).action, null)
  assert.equal(carryoverPlan({ contactJobPrice: null, contactNewPrice: null, hasSignedContract: false }).action, null)
})

test('VOID / unsigned Closed deals are named', () => {
  assert.match(unsignedClosed({ isClosedStage: true, signedCount: 0, proposalsCount: 1, voidOnly: true }), /only ArcSite proposal is VOID/)
  assert.match(unsignedClosed({ isClosedStage: true, signedCount: 0, proposalsCount: 2, voidOnly: false, installDate: null }), /no signed ArcSite contract and no install date \(2 proposals, none approved\)/)
  assert.equal(unsignedClosed({ isClosedStage: true, signedCount: 1 }), null)
  assert.equal(unsignedClosed({ isClosedStage: false, signedCount: 0 }), null)
})
