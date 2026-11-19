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

test('a small proposal on another drawing is an add-on and is summed (Ronald Cortez)', () => {
  const v = arcJobValue([P('477188', 8546.55, 'A'), P('509718', 800, 'B')])
  assert.equal(v.total, 9346.55); assert.equal(v.main.proposal_id, '477188'); assert.deepEqual(v.addons.map(a => a.proposal_id), ['509718'])
})

test('a redraw of a comparable size is a revision, not an add-on (Teena Prentice)', () => {
  const v = arcJobValue([P('555028', 8426.48, 'A'), P('558901', 7891.19, 'B')])
  assert.equal(v.total, 7891.19); assert.equal(v.addons.length, 0); assert.equal(v.main.proposal_id, '558901')
})

test('several redraws then an add-on (Israel Castro): newest big one + the add-on', () => {
  const v = arcJobValue([P('355185', 10300.64, 'A'), P('355393', 11421.23, 'B'), P('357071', 13932.18, 'C'), P('367937', 11147.27, 'D'), P('504068', 1809.34, 'E')])
  assert.equal(v.total, 12956.61); assert.equal(v.main.proposal_id, '367937'); assert.deepEqual(v.addons.map(a => a.proposal_id), ['504068'])
  assert.equal(describeJobValue(v), '$12956.61 = $11147.27 + add-on $1809.34 (proposal 504068)')
})

test('no drawing ids (fixture shape) still picks the newest comparable total', () => {
  const v = arcJobValue([P('p1', 1500), P('p2', 2000)])
  assert.equal(v.total, 2000); assert.equal(v.main.proposal_id, 'p2')
})

test('the share is adjustable and empty input is safe', () => {
  assert.equal(arcJobValue([P('1', 1000, 'A'), P('2', 600, 'B')], { addonMaxShare: 0.7 }).total, 1600)
  assert.equal(arcJobValue([]).total, null); assert.equal(describeJobValue(arcJobValue([])), 'no signed proposal')
})

test('the sheet total covers exactly the counted proposals, or is not final yet', () => {
  const v = arcJobValue([P('477188', 8546.55, 'A'), P('509718', 800, 'B')])
  assert.equal(sheetTotalFor(v, [{ proposalId: '477188', jobPrice: 8546.55 }, { proposalId: '509718', jobPrice: 800 }]), 9346.55)
  assert.equal(sheetTotalFor(v, [{ proposalId: '477188', jobPrice: 8546.55 }]), null)
  assert.equal(sheetTotalFor(v, [{ proposalId: '477188', jobPrice: 8546.55 }, { proposalId: '509718', jobPrice: 850 }]), 9396.55)
})
