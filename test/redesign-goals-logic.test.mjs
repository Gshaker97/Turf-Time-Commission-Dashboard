// Redesign step 7: the Goals page's WRITE logic must be byte-identical to
// main. Inline goal edits save through saveGoalField / applySuggestion, which
// live inside the component, so the region from the period/roster setup
// through those two writers and the team rollup is compared with main's copy.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/pages/Goals.jsx', import.meta.url), 'utf8')
const fixture = readFileSync(new URL('./fixtures/goals-save-logic.main.txt', import.meta.url), 'utf8')
function block(s, start, end) {
  const i = s.indexOf(start); assert.ok(i >= 0, `missing marker: ${start}`)
  const j = s.indexOf(end, i); assert.ok(j > i, `missing marker: ${end}`)
  return s.slice(i, j)
}
test('Goals save logic (periods, roster, canEditRep, saveGoalField, applySuggestion, teamRollup) is identical to main', () => {
  assert.equal(block(src, '  const today = todayISO()', '  function RepRow({ rep }) {'), fixture)
})
test('the fixture really holds the goal writers', () => {
  for (const must of ['async function saveGoalField', 'upsertPersonalGoal', 'saveRepGoal', 'async function applySuggestion', 'const canEditRep']) {
    assert.ok(fixture.includes(must), must)
  }
})
