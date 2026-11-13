// Read-back repair for adopted opportunities: writes only what GHL dropped,
// never touches a correct opp, fixes stage for adopted opps only, and reports
// ok:false when the repair did not stick (so fields_ok=false keeps reconciling).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readBackAndRepair, missingFields, fieldValueOf } from '../lib/ghl-opp-readback.mjs'

const PID = 'OEpWsIX1eOfXHqrSI273', PRICE = 'dScpoYWZbeghBsAMBR4o', PAY = 'IpcldbuGsu2HeNCZeZYl'
const planned = [{ id: PID, field_value: '282300044590465' }, { id: PRICE, field_value: 2570.59 }, { id: PAY, field_value: ['Self Pay'] }]
const opp = (fields, stage = 'closed') => ({ opportunity: { id: 'o1', pipelineStageId: stage, customFields: fields } })
const harness = (reads) => {
  const puts = []; let i = 0
  return { puts, get: async () => reads[Math.min(i++, reads.length - 1)], put: async (id, body) => { puts.push(body) } }
}

test('fieldValueOf reads every GHL shape', () => {
  assert.equal(fieldValueOf({ customFields: [{ id: 'a', fieldValueString: 'x' }] }, 'a'), 'x')
  assert.equal(fieldValueOf({ customFields: [{ id: 'a', fieldValueNumber: 5 }] }, 'a'), 5)
  assert.deepEqual(fieldValueOf({ customFields: [{ id: 'a', fieldValueArray: ['p'] }] }, 'a'), ['p'])
  assert.equal(fieldValueOf({ customFields: [{ id: 'a', fieldValue: 'v' }] }, 'a'), 'v')
  assert.equal(fieldValueOf({ customFields: [] }, 'a'), null)
})

test('a correct opportunity is NOT written to at all', async () => {
  const good = opp([{ id: PID, fieldValueString: '282300044590465' }, { id: PRICE, fieldValueNumber: 2570.59 }, { id: PAY, fieldValueArray: ['Self Pay'] }])
  const h = harness([good])
  const r = await readBackAndRepair({ oppId: 'o1', customFields: planned, exactIds: [PID], adopted: true, targetStageId: 'closed', ...h })
  assert.deepEqual(h.puts, []); assert.equal(r.ok, true); assert.equal(r.checked, true); assert.deepEqual(r.reapplied_fields, [])
})

test('Durward case: fields landed but Project ID missing → re-apply the planned set once, verify', async () => {
  const before = opp([{ id: PRICE, fieldValueNumber: 2570.59 }, { id: PAY, fieldValueArray: ['Self Pay'] }])
  const after = opp([{ id: PID, fieldValueString: '282300044590465' }, { id: PRICE, fieldValueNumber: 2570.59 }, { id: PAY, fieldValueArray: ['Self Pay'] }])
  const h = harness([before, after])
  const r = await readBackAndRepair({ oppId: 'o1', customFields: planned, exactIds: [PID], adopted: true, targetStageId: 'closed', ...h })
  assert.deepEqual(h.puts, [{ customFields: planned }])
  assert.equal(r.ok, true); assert.deepEqual(r.reapplied_fields, [PID]); assert.equal(r.stage_fixed, false)
})

test('Sibold case: adopted opp with nothing applied and stage unmoved → fields + stage, both verified', async () => {
  const before = opp([], 'new_leads')
  const after = opp([{ id: PID, fieldValueString: '282300044590465' }, { id: PRICE, fieldValueNumber: 2570.59 }, { id: PAY, fieldValueArray: ['Self Pay'] }], 'closed')
  const h = harness([before, after])
  const r = await readBackAndRepair({ oppId: 'o1', customFields: planned, exactIds: [PID], adopted: true, targetStageId: 'closed', ...h })
  assert.deepEqual(h.puts, [{ customFields: planned }, { pipelineStageId: 'closed' }])
  assert.equal(r.ok, true); assert.equal(r.stage_fixed, true)
})

test('a WRONG Project ID on an adopted opp counts as missing (exact match), a merely-present price does not', () => {
  const o = opp([{ id: PID, fieldValueString: '999' }, { id: PRICE, fieldValueNumber: 1 }]).opportunity
  assert.deepEqual(missingFields(o, planned, { exactIds: [PID] }), [PID, PAY])
})

test('same-project (not adopted) update: stage is left alone even when it differs', async () => {
  const before = opp([{ id: PID, fieldValueString: '282300044590465' }, { id: PRICE, fieldValueNumber: 2570.59 }, { id: PAY, fieldValueArray: ['Self Pay'] }], 'pending_payment')
  const h = harness([before])
  const r = await readBackAndRepair({ oppId: 'o1', customFields: planned, exactIds: [PID], adopted: false, targetStageId: 'closed', ...h })
  assert.deepEqual(h.puts, []); assert.equal(r.ok, true); assert.equal(r.stage_wrong, false)
})

test('same-project update with a dropped field re-applies fields only, never the stage', async () => {
  const before = opp([{ id: PID, fieldValueString: '282300044590465' }], 'pending_payment')
  const after = opp([{ id: PID, fieldValueString: '282300044590465' }, { id: PRICE, fieldValueNumber: 2570.59 }, { id: PAY, fieldValueArray: ['Self Pay'] }], 'pending_payment')
  const h = harness([before, after])
  const r = await readBackAndRepair({ oppId: 'o1', customFields: planned, exactIds: [PID], adopted: false, targetStageId: 'closed', ...h })
  assert.deepEqual(h.puts, [{ customFields: planned }]); assert.equal(r.ok, true)
})

test('repair that does not stick → ok:false with what is still missing (caller sets fields_ok=false)', async () => {
  const before = opp([], 'new_leads')
  const h = harness([before, before])
  const r = await readBackAndRepair({ oppId: 'o1', customFields: planned, exactIds: [PID], adopted: true, targetStageId: 'closed', ...h })
  assert.equal(r.ok, false); assert.deepEqual(r.still_missing, [PID, PRICE, PAY]); assert.equal(r.stage_wrong, true)
})

test('read-back or write failures never throw; they report ok:false', async () => {
  const r1 = await readBackAndRepair({ oppId: 'o1', customFields: planned, exactIds: [PID], adopted: true, targetStageId: 'closed', get: async () => { throw new Error('boom') }, put: async () => {} })
  assert.equal(r1.ok, false); assert.match(r1.error, /read-back failed/)
  const r2 = await readBackAndRepair({ oppId: 'o1', customFields: planned, exactIds: [PID], adopted: true, targetStageId: 'closed', get: async () => opp([]), put: async () => { throw new Error('403') } })
  assert.equal(r2.ok, false); assert.match(r2.error, /re-apply failed/)
  const r3 = await readBackAndRepair({ oppId: 'o1', customFields: planned, exactIds: [PID], adopted: true, targetStageId: 'closed', get: async () => null, put: async () => {} })
  assert.equal(r3.ok, false)
})

test('an empty planned set with a correct stage is a no-op', async () => {
  const h = harness([opp([], 'closed')])
  const r = await readBackAndRepair({ oppId: 'o1', customFields: [], exactIds: [PID], adopted: true, targetStageId: 'closed', ...h })
  assert.deepEqual(h.puts, []); assert.equal(r.ok, true)
})

test('server.js wires the read-back into the UPDATE branch with the right inputs', () => {
  const src = readFileSync(new URL('../server.js', import.meta.url), 'utf8')
  const i = src.indexOf('readBack = await readBackAndRepair(')
  assert.ok(i > 0, 'update branch calls readBackAndRepair')
  const slice = src.slice(i, i + 400)
  assert.match(slice, /exactIds: \[F\.project_id\]/)
  assert.match(slice, /adopted: !sameProject/)
  assert.match(slice, /get: id => ghlGet\(`\/opportunities\/\$\{id\}`\)/)
  assert.match(src, /if \(!readBack\.ok\) fieldsOk = false/)
  // the create branch is untouched: it still re-applies customFields itself
  assert.match(src, /oppId = await ghlCreateOpp\(oppBody\)[\s\S]{0,4000}await ghlUpdateOpp\(oppId, \{ customFields \}\)/)
})

test('an adopted lead opportunity counts as a new sale for the text alert (source check)', () => {
  const src = readFileSync(new URL('../server.js', import.meta.url), 'utf8')
  assert.match(src, /const adoptedLead = !!oppId && !!existing && !sameProject && action === 'updated'/)
  assert.match(src, /const isNewSale = \(action === 'created' \|\| adoptedLead\) && !isChangeOrder/)
  // a same-project update (re-fired webhook, change order) is still NOT a new sale
  assert.ok(src.indexOf('const adoptedLead') < src.indexOf('const isNewSale'))
})
