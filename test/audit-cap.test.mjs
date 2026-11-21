// The one-day cap override: ARC_AUDIT_MAX_FIX_ONCE on ARC_AUDIT_MAX_FIX_ONCE_DAY only.
import test from 'node:test'
import assert from 'node:assert/strict'
process.env.ARC_NO_LISTEN = '1'; process.env.ARC_DISABLE_TIMERS = '1'
process.env.ARC_AUDIT_MAX_FIX = '60'; process.env.ARC_AUDIT_MAX_FIX_ONCE = '300'; process.env.ARC_AUDIT_MAX_FIX_ONCE_DAY = '2026-11-21'
const { arcAuditCapForDayForTests } = await import('../server.js')
test('300 on the override day, 60 on every other day', () => {
  assert.equal(arcAuditCapForDayForTests('2026-11-21'), 300)
  assert.equal(arcAuditCapForDayForTests('2026-11-22'), 60)
  assert.equal(arcAuditCapForDayForTests('2026-11-20'), 60)
})
