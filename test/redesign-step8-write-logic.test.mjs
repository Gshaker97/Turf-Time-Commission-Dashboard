// Redesign step 8: every WRITER on Payroll, Import, Admin (People + Settings),
// Requires Audit, Login and Set password must be byte-identical to main.
// Same approach as the deal-modal test: the write logic sits inline in the
// components (no DOM here to drive it), so the regions that hold the handlers,
// payload builders and Supabase calls are cut out of the branch file and
// compared with the copy taken from origin/main (test/fixtures/step8/*).
// The regions are listed in redesign-step8-write-spec.mjs. Markup-only edits
// pass; any change to how a write is computed fails.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SPEC, extract } from './redesign-step8-write-spec.mjs'

for (const { file, fixture, blocks, writers } of SPEC) {
  const src = readFileSync(new URL('../' + file, import.meta.url), 'utf8')
  const fx  = readFileSync(new URL(`./fixtures/step8/${fixture}.main.txt`, import.meta.url), 'utf8')
  test(`${file}: write logic is identical to main`, () => {
    assert.equal(extract(src, blocks), fx)
  })
  test(`${file}: the fixture really holds the writers`, () => {
    for (const w of writers) assert.ok(fx.includes(w), `${fixture} fixture lacks: ${w}`)
  })
}

// The "verify" (gold check) writer lives in DealTable, restyled in step 6.
// The call that flips commission_verified must still be exactly main's.
test('DealTable: the commission_verified toggle call is unchanged from main', () => {
  const src = readFileSync(new URL('../src/components/DealTable.jsx', import.meta.url), 'utf8')
  const call = 'onToggle={() => onUpdate?.(deal.id, { commission_verified: !deal.commission_verified })}'
  assert.ok(src.includes(call))
  const fx = readFileSync(new URL('./fixtures/step8/deal-table-verify.main.txt', import.meta.url), 'utf8')
  assert.equal(fx.trim(), call)
})
