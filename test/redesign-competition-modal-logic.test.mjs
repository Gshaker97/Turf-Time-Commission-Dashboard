// Redesign step 7: the Competition modal's WRITE logic must be byte-identical
// to main. Same approach as the deal-modal test: the save payload is built
// inline (handleSubmit), so the region from the BLANK form shape through the
// pick / type / sides / rounds handlers and handleSubmit is compared with the
// copy taken from main. Markup-only edits pass; any payload change fails.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/components/CompetitionModal.jsx', import.meta.url), 'utf8')
const fixture = readFileSync(new URL('./fixtures/competition-modal-save-logic.main.txt', import.meta.url), 'utf8')
function block(s, start, end) {
  const i = s.indexOf(start); assert.ok(i >= 0, `missing marker: ${start}`)
  const j = s.indexOf(end, i); assert.ok(j > i, `missing marker: ${end}`)
  return s.slice(i, j)
}
test('CompetitionModal save logic (BLANK, form state, pick/type/sides/rounds handlers, handleSubmit) is identical to main', () => {
  assert.equal(block(src, 'const BLANK = {', '  const nameOf = (id) =>'), fixture)
})
test('the fixture really holds the payload builder', () => {
  for (const must of ['async function handleSubmit', 'await onSave({', 'credit_split_pct', 'excluded_ids: isTeamAvg', 'autoWeeklyRounds', 'function changeType']) {
    assert.ok(fixture.includes(must), must)
  }
})
