// Redesign step 6b: the Deal modal's WRITE logic must be byte-identical to
// main. The save payload is built inline in the component (handleSubmit →
// saveDeal), so it cannot be exercised without a DOM; instead this test
// extracts the same two regions — the BLANK form shape + defaults, and
// everything from `set()` through `saveDeal()` / the override lists — from the
// branch file and compares them with the copy taken from main
// (test/fixtures/deal-modal-save-logic.main.txt). Any change to how a new or
// edited deal's payload is computed fails here; markup-only edits do not.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/components/DealModal.jsx', import.meta.url), 'utf8')
const fixture = readFileSync(new URL('./fixtures/deal-modal-save-logic.main.txt', import.meta.url), 'utf8')

function block(s, start, end) {
  const i = s.indexOf(start); assert.ok(i >= 0, `missing marker: ${start}`)
  const j = s.indexOf(end, i); assert.ok(j > i, `missing marker: ${end}`)
  return s.slice(i, j)
}
const logic = (s) => [
  block(s, 'const BLANK = {', '// ── Edit history'),
  block(s, '  const set = (k, v) =>', '  return (\n    // Mobile: bottom sheet'),
].join('\n')

test('DealModal save logic (BLANK defaults, form handlers, preview inputs, handleSubmit, saveDeal) is identical to main', () => {
  assert.equal(logic(src), fixture)
})

test('the fixture really holds the payload builders', () => {
  for (const must of ['async function handleSubmit', 'async function saveDeal', 'MONEY_KEYS', 'override_exclusions', 'bonus_split_pct', 'setter_split_pct']) {
    assert.ok(fixture.includes(must), must)
  }
})
