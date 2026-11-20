// lib/contract-audit: GHL and the PM calendar are each judged against ArcSite's
// newest signed PDF (recognised by byte size), independently of each other.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ghlContractState, calendarContractState, calendarPushSource, newestSigned, auditSummaryLine, auditItemLine } from '../lib/contract-audit.mjs'

const signed = [
  { proposal_id: '603517', document_number: null, total: 17971.6, pdf_url: 'https://cdn.example/old.pdf' },
  { proposal_id: '638077', document_number: null, total: 19104.9, pdf_url: 'https://cdn.example/new.pdf' },
]
const NEW = 2051785, OLD = 3598475

test('newest signed is the last one', () => { assert.equal(newestSigned(signed).proposal_id, '638077'); assert.equal(newestSigned([]), null) })

test('GHL: fewer files than signings is behind; the newest file missing is behind even with more files (Isaac Rosas)', () => {
  assert.equal(ghlContractState({ signed, entries: [{ url: 'a', size: OLD }], newestSize: NEW }).behind, true)
  // four files, three of them the old one and the fourth the newest → current
  assert.equal(ghlContractState({ signed, entries: [{ size: OLD }, { size: OLD }, { size: OLD }, { size: NEW }], newestSize: NEW }).behind, false)
  // four files, none the newest → behind, and the reason says so
  const r = ghlContractState({ signed, entries: [{ size: OLD }, { size: OLD }, { size: OLD }, { size: OLD }], newestSize: NEW })
  assert.equal(r.behind, true); assert.match(r.reason, /newest signed PDF \(2051785 bytes\) is not among them/)
  // sizes unknown on either side → count rule only
  assert.equal(ghlContractState({ signed, entries: [{ url: 'a' }, { url: 'b' }], newestSize: NEW }).behind, false)
  assert.equal(ghlContractState({ signed, entries: [{ size: OLD }, { size: OLD }], newestSize: null }).behind, false)
})

test('calendar: one file is normal — what matters is whether it is the newest PDF', () => {
  const job = n => ({ jobNumber: 'J-1575', contracts: [{ filename: 'isaac-rosas-contract-3.pdf', sizeBytes: n }] })
  assert.equal(calendarContractState({ signed, newestSize: NEW, job: job(OLD) }).state, 'behind')
  assert.match(calendarContractState({ signed, newestSize: NEW, job: job(OLD) }).reason, /J-1575 holds 1 contract \(3598475 bytes\) but not the newest signed PDF \(2051785 bytes\)/)
  assert.equal(calendarContractState({ signed, newestSize: NEW, job: job(NEW) }).state, 'current')
  assert.equal(calendarContractState({ signed, newestSize: NEW, job: { jobNumber: 'J-1', contracts: [] } }).state, 'no_contract')
  assert.equal(calendarContractState({ signed, newestSize: NEW, job: null }).state, 'no_job')
  assert.equal(calendarContractState({ signed, newestSize: null, job: job(OLD) }).state, 'unverified')
  assert.equal(calendarContractState({ signed, newestSize: NEW, job: { jobNumber: 'J-1', contracts: [{ filename: 'x.pdf' }] } }).state, 'unverified')
  assert.equal(calendarContractState({ signed: [], newestSize: null, job: job(OLD) }).state, 'current')
})

test('push source: GHL\'s hosted copy when GHL has the newest, otherwise ArcSite directly', () => {
  const ghl = calendarPushSource({ entries: [{ url: 'https://ghl/old.pdf', size: OLD }, { url: 'https://ghl/new.pdf', name: 'isaac-rosas-contract-3.pdf', size: NEW }], newestSize: NEW, newest: signed[1], customerName: 'Isaac Rosas' })
  assert.deepEqual(ghl, { source: 'ghl', url: 'https://ghl/new.pdf', name: 'isaac-rosas-contract-3.pdf' })
  const arc = calendarPushSource({ entries: [{ url: 'https://ghl/old.pdf', size: OLD }], newestSize: NEW, newest: signed[1], customerName: 'Isaac Rosas' })
  assert.deepEqual(arc, { source: 'arcsite', url: 'https://cdn.example/new.pdf', name: 'Isaac Rosas - contract 638077.pdf' })
  assert.equal(calendarPushSource({ entries: [], newestSize: NEW, newest: { proposal_id: 'x' } }), null)
})

test('log lines name the run and each job with its reason', () => {
  const line = auditSummaryLine({ day: '2026-11-20', dry: true, floor: '2026-10-01', scanned: 10, candidates: 5, checked: 5, ok: 3, gaps: [1, 2], fixed: [], failed: [], skipped_jobs: [1], held: [], would_fix: [1, 2] })
  assert.match(line, /^day=2026-11-20 mode=DRY-RUN \(nothing sent\) since=2026-10-01 scanned=10 candidates=5 checked=5 ok=3 gaps=2 fixed=0 failed=0 skipped=1 held=0 would_fix=2$/)
  assert.equal(auditItemLine('SKIPPED', { customer: 'Isaac Rosas', calendar_job: 'J-1575', project_id: '1', target: 'calendar', reason: 'manual hold' }), 'SKIPPED Isaac Rosas (J-1575) project 1: calendar behind — manual hold')
  assert.equal(auditItemLine('FIXED', { customer: 'A', project_id: '2', target: 'calendar', source: 'arcsite' }), 'FIXED A project 2: calendar behind [pushed from arcsite]')
})

import { newestSizeUnique, entryNamesProposal } from '../lib/contract-audit.mjs'

test('size is only an identity when no older revision shares it', () => {
  assert.equal(newestSizeUnique([OLD, NEW]), true)
  assert.equal(newestSizeUnique([NEW, NEW]), false)
  assert.equal(newestSizeUnique([NEW]), true)
  assert.equal(newestSizeUnique([OLD, null]), false)
})

test('GHL second identity: the proposal id in a file name this server wrote', () => {
  const newest = signed[1]
  assert.equal(entryNamesProposal({ name: 'Isaac Rosas - contract 638077.pdf' }, newest), true)
  assert.equal(entryNamesProposal({ name: 'isaac-rosas-contract-638077.pdf' }, newest), true)   // GHL's slugged spelling
  assert.equal(entryNamesProposal({ name: 'Isaac Rosas - contract 603517.pdf' }, newest), false)
  assert.equal(entryNamesProposal({ name: 'isaac-rosas-contract-3.pdf' }, newest), false)
  // two revisions of the same size: the name proves the newest is there, or it is unverified (never passed, never behind)
  const sameSize = [{ size: NEW }, { size: NEW }]
  const named = ghlContractState({ signed, entries: [{ size: NEW, name: 'Isaac Rosas - contract 603517.pdf' }, { size: NEW, name: 'Isaac Rosas - contract 638077.pdf' }], newestSize: NEW, sizeUnique: false, newest })
  assert.deepEqual([named.behind, named.verified], [false, true])
  const unnamed = ghlContractState({ signed, entries: sameSize, newestSize: NEW, sizeUnique: false, newest })
  assert.deepEqual([unnamed.behind, unnamed.verified], [false, false]); assert.match(unnamed.reason, /older revision has the same size/)
  // a file of a different size, with the count complete: the name still proves it (a re-encoded copy)
  const reenc = ghlContractState({ signed, entries: [{ size: OLD }, { size: OLD + 7, name: 'Isaac Rosas - contract 638077.pdf' }], newestSize: NEW, sizeUnique: true, newest })
  assert.deepEqual([reenc.behind, reenc.verified], [false, true])
})

test('calendar second identity: the push ledger', () => {
  const newest = signed[1]
  const job = n => ({ jobNumber: 'J-1575', contracts: [{ filename: 'isaac-rosas-contract-3.pdf', sizeBytes: n }] })
  // a re-encoded copy (size matches nothing) with the ledger saying the newest was pushed → current, not pushed again
  const led = calendarContractState({ signed, newestSize: NEW, sizeUnique: true, job: job(NEW + 999), ledger: { proposal_id: '638077', job: 'J-1575', at: '2026-11-21T13:00:00Z' }, newest })
  assert.equal(led.state, 'current_by_ledger'); assert.match(led.reason, /proposal 638077 was pushed to calendar job J-1575 on 2026-11-21/)
  // the ledger is for an OLDER proposal → it does not count
  assert.equal(calendarContractState({ signed, newestSize: NEW, sizeUnique: true, job: job(NEW + 999), ledger: { proposal_id: '603517', job: 'J-1575' }, newest }).state, 'behind')
  // the ledger is for another calendar job → it does not count
  assert.equal(calendarContractState({ signed, newestSize: NEW, sizeUnique: true, job: job(NEW + 999), ledger: { proposal_id: '638077', job: 'J-9' }, newest }).state, 'behind')
  // a job with no contract at all is behind even with a ledger entry (someone removed the file)
  assert.equal(calendarContractState({ signed, newestSize: NEW, sizeUnique: true, job: { jobNumber: 'J-1575', contracts: [] }, ledger: { proposal_id: '638077', job: 'J-1575' }, newest }).state, 'no_contract')
  // two revisions share a size and the calendar holds one of them: ambiguous without the ledger, current with it
  assert.equal(calendarContractState({ signed, newestSize: NEW, sizeUnique: false, job: job(NEW), ledger: null, newest }).state, 'ambiguous')
  assert.equal(calendarContractState({ signed, newestSize: NEW, sizeUnique: false, job: job(NEW), ledger: { proposal_id: '638077', job: 'J-1575' }, newest }).state, 'current_by_ledger')
})
