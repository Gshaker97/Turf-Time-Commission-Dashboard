import test from 'node:test'
import assert from 'node:assert/strict'
import { arcJobValue, sheetTotalFor, describeJobValue } from '../lib/arcsite-job-value.mjs'

const P = (id, total, drawing, doc = null) => ({ proposal_id: id, total, drawing_id: drawing, document_number: doc })

test('one signed proposal is the job', () => {
  const v = arcJobValue([P('1', 10505.57, 'A')])
  assert.equal(v.total, 10505.57); assert.equal(v.addons.length, 0); assert.equal(v.main.proposal_id, '1')
})

test('same drawing re-signed: the newest signing wins (April Ottinger, Danielle Fuqua)', () => {
  const v = arcJobValue([P('561515', 8703.59, 'A'), P('583853', 10502.87, 'A')])
  assert.equal(v.total, 10502.87); assert.equal(v.main.proposal_id, '583853'); assert.deepEqual(v.superseded.map(s => s.proposal_id), ['561515'])
})

test('a small proposal on another drawing is an add-on: a SEPARATE job, never summed (Ronald Cortez) — the opp owns the main contract and the add-on is reported as unowned', () => {
  const v = arcJobValue([P('477188', 8546.55, 'A'), P('509718', 800, 'B')])
  assert.equal(v.total, 8546.55); assert.equal(v.main.proposal_id, '477188'); assert.deepEqual(v.addons.map(a => a.proposal_id), ['509718'])
  assert.equal(v.owned.proposal_id, '477188'); assert.equal(v.owned_by, 'main contract'); assert.equal(v.owned_kind, 'original')
  assert.deepEqual(v.unowned.map(u => [u.proposal_id, u.kind]), [['509718', 'add-on']]); assert.deepEqual(v.counted.map(c => c.proposal_id), ['477188']); assert.deepEqual(v.signed.map(s => s.proposal_id), ['477188'])
})

test('Amanda Pogorzelski: the opportunity at $1,802.60 owns the add-on; the $15,895.75 original is a different job, reported, not summed', () => {
  const signed = [P('462238', 15895.75, 'A', '1001'), P('615315', 1802.6, 'B', '1002')]
  const v = arcJobValue(signed, { oppValue: 1802.6 })
  assert.equal(v.total, 1802.6); assert.equal(v.owned.proposal_id, '615315'); assert.equal(v.owned_by, 'opportunity value'); assert.equal(v.owned_kind, 'add-on')
  assert.deepEqual(v.unowned.map(u => [u.proposal_id, u.kind, u.total]), [['462238', 'original', 15895.75]])
  assert.deepEqual(v.signed.map(s => s.proposal_id), ['615315'], "the opp's contracts are judged against its own proposal only")
  assert.equal(describeJobValue(v, n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2 })), "$1,802.60 (proposal 1002, this opportunity's own) — also signed on this project, not counted: original $15,895.75 (proposal 1001)")
  // the same project seen from an opp that holds the ORIGINAL total: it owns the original; the add-on is unowned
  const o = arcJobValue(signed, { oppValue: 15895.75 })
  assert.equal(o.total, 15895.75); assert.equal(o.owned.proposal_id, '462238'); assert.deepEqual(o.unowned.map(u => [u.proposal_id, u.kind]), [['615315', 'add-on']])
  // an opp at the old SUM matches nothing → the main contract, never the sum
  const s = arcJobValue(signed, { oppValue: 17698.35 })
  assert.equal(s.total, 15895.75); assert.equal(s.owned_by, 'main contract')
  // the webhook names the signing: that proposal is the one
  const w = arcJobValue(signed, { ownProposalId: '615315' })
  assert.equal(w.total, 1802.6); assert.equal(w.owned_by, 'signed proposal')
  // a value within $1 still matches (sheet tax rounding)
  assert.equal(arcJobValue(signed, { oppValue: 1803.1 }).owned.proposal_id, '615315')
})

test('a redraw of a comparable size is a revision, not an add-on (Teena Prentice)', () => {
  const v = arcJobValue([P('555028', 8426.48, 'A'), P('558901', 7891.19, 'B')])
  assert.equal(v.total, 7891.19); assert.equal(v.addons.length, 0); assert.equal(v.main.proposal_id, '558901')
})

test('several redraws then an add-on (Israel Castro): the newest big one is the job; the add-on is its own, listed, not added', () => {
  const v = arcJobValue([P('355185', 10300.64, 'A'), P('355393', 11421.23, 'B'), P('357071', 13932.18, 'C'), P('367937', 11147.27, 'D'), P('504068', 1809.34, 'E')])
  assert.equal(v.total, 11147.27); assert.equal(v.main.proposal_id, '367937'); assert.deepEqual(v.addons.map(a => a.proposal_id), ['504068'])
  assert.equal(describeJobValue(v), '$11147.27 (proposal 367937) — also signed on this project, not counted: add-on $1809.34 (proposal 504068)')
  assert.deepEqual(v.superseded.map(s => s.proposal_id), ['355185', '355393', '357071'])
})

test('no drawing ids (fixture shape) still picks the newest comparable total', () => {
  const v = arcJobValue([P('p1', 1500), P('p2', 2000)])
  assert.equal(v.total, 2000); assert.equal(v.main.proposal_id, 'p2')
})

test('the share is adjustable and empty input is safe', () => {
  assert.equal(arcJobValue([P('1', 1000, 'A'), P('2', 600, 'B')], { addonMaxShare: 0.7 }).total, 1000)
  assert.deepEqual(arcJobValue([P('1', 1000, 'A'), P('2', 600, 'B')], { addonMaxShare: 0.7 }).unowned.map(u => u.kind), ['add-on'])
  assert.equal(arcJobValue([P('1', 1000, 'A'), P('2', 600, 'B')], { addonMaxShare: 0.5 }).total, 600, 'at half, the $600 is a redraw and the newest wins')
  assert.equal(arcJobValue([]).total, null); assert.equal(describeJobValue(arcJobValue([])), 'no signed proposal')
})

test('the sheet total covers exactly the counted proposals, or is not final yet', () => {
  const v = arcJobValue([P('477188', 8546.55, 'A'), P('509718', 800, 'B')])
  // counted = the owned proposal only (the main contract here): the add-on's row is not part of this opportunity's figure
  assert.equal(sheetTotalFor(v, [{ proposalId: '477188', jobPrice: 8546.55 }, { proposalId: '509718', jobPrice: 800 }]), 8546.55)
  assert.equal(sheetTotalFor(v, [{ proposalId: '509718', jobPrice: 800 }]), null, 'the owned proposal has no row yet → not final')
  const a = arcJobValue([P('477188', 8546.55, 'A'), P('509718', 800, 'B')], { oppValue: 800 })
  assert.equal(sheetTotalFor(a, [{ proposalId: '477188', jobPrice: 8546.55 }, { proposalId: '509718', jobPrice: 850 }]), 850, "an add-on opportunity's figure is its own row")
})
