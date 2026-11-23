// railway.json has no healthcheck, so a server.js that fails to parse would
// replace the live deployment with one that crash-loops. No other test loads the
// file as code (server-integration reads it as text), so this is the one guard.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('server.js parses', () => {
  const r = spawnSync(process.execPath, ['--check', fileURLToPath(new URL('../server.js', import.meta.url))], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
})
