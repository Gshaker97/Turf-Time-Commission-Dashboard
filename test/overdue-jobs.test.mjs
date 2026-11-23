// Every customer here is invented — no real names, phones or addresses.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tabMonth, parseTab, overdueJobs, contactFor, smsText, buildPdf, jobKey, daysBetween } from '../lib/overdue-jobs.mjs'

// A Check List tab as the Sheets API returns it: banner rows above the header.
const OCT = [
  [],
  ['', '', '', '', '', 'MONTHLY TOTAL:', '', '$1,000,000.00'],
  ['Date', 'CLIENT NAME', 'TOTAL AMOUNT', 'PAID', 'AMOUNT STILL DUE'],
  ['10/8', 'Alex And Sam Testone', '$11,760.78', '$5,880.39', '$5,880.39'],
  ['10/13', 'Pat Example', '$18,900.00', '$13,900.00', '$5,000.00'],
  ['10/14', 'Paid Up', '$9,000.00', '$9,000.00', ''],
  ['11/30', 'Typo Date', '$1,000.00', '', '$1,000.00'],   // not this tab's month: dropped
  ['', 'No date', '$5.00', '', '$5.00'],
]

test('tab names: monthly tabs only, PRO and MASTER skipped', () => {
  assert.equal(tabMonth('October 2026'), '2026-10')
  assert.equal(tabMonth('JULY 2026'), '2026-07')
  assert.equal(tabMonth('October 2026 PRO'), null)
  assert.equal(tabMonth('MASTER'), null)
  assert.equal(tabMonth('Nov 25'), null)
})

test('parses a tab under its banner, with the year from the tab name', () => {
  const jobs = parseTab(OCT, '2026-10')
  assert.deepEqual(jobs.map(j => [j.date, j.client, j.due]), [
    ['2026-10-08', 'Alex And Sam Testone', 5880.39],
    ['2026-10-13', 'Pat Example', 5000],
    ['2026-10-14', 'Paid Up', 0],
  ])
})

test('45 days: Oct 8 is overdue on Nov 23, Oct 13 is not yet; paid jobs never are', () => {
  const jobs = parseTab(OCT, '2026-10')
  assert.equal(daysBetween('2026-10-08', '2026-11-23'), 46)
  assert.deepEqual(overdueJobs(jobs, '2026-11-23').map(j => j.client), ['Alex And Sam Testone'])
  // The Oct 13 job crosses on Nov 27 (45 days), not before.
  assert.deepEqual(overdueJobs(jobs, '2026-11-26').map(j => j.client), ['Alex And Sam Testone'])
  assert.deepEqual(overdueJobs(jobs, '2026-11-27').map(j => j.client), ['Alex And Sam Testone', 'Pat Example'])
})

test('installs before Jul 1 2026 are left out (per Garrison)', () => {
  const jobs = [
    { date: '2026-06-30', client: 'June Job', amount: 1500, paid: null, due: 1500 },
    { date: '2026-08-24', client: 'August Job', amount: 2938, paid: 1500, due: 1438 },
  ]
  assert.deepEqual(overdueJobs(jobs, '2026-11-23').map(j => j.client), ['August Job'])
})

test('a job on two tabs counts once, oldest install first', () => {
  const a = { date: '2026-09-21', client: 'Robin', amount: 1, paid: 0, due: 1 }
  const b = { date: '2026-08-25', client: 'Casey Sample', amount: 1, paid: 0, due: 1 }
  const out = overdueJobs([a, b, { ...a, client: 'robin ' }], '2026-11-23')
  assert.deepEqual(out.map(j => j.client), ['Casey Sample', 'Robin'])
  assert.equal(jobKey(a), '2026-09-21|robin')
})

test('contact: partial name matches the calendar job near the install date; nothing found stays blank', () => {
  const cal = [
    { customer: { name: 'Robin Fakename', phone: '6025550101', address: '100 W Example Rd, Phoenix' }, installDate: '2026-09-21', pm: { name: 'PM One' }, jobNumber: 'J-1' },
    { customer: { name: 'Robin Other', phone: '1', address: 'x' }, installDate: '2026-04-01', pm: { name: 'PM Two' } },
    { customer: { name: 'Robin Fakename', phone: '9', address: 'y' }, installDate: '2026-09-21', pm: { name: 'Gone' }, canceledAt: '2026-09-01' },
  ]
  const c = contactFor({ date: '2026-09-21', client: 'Robin' }, cal)
  assert.equal(c.name, 'Robin Fakename'); assert.equal(c.pm, 'PM One'); assert.equal(c.matched, 'calendar')
  const sheet = [{ Customer: 'Dana Placeholder', 'Install Address': '200 E Sample Ln', 'Customer Phone': '' }]
  const t = contactFor({ date: '2026-09-30', client: 'Dana Placeholder' }, cal, sheet)
  assert.equal(t.matched, 'sheet'); assert.equal(t.address, '200 E Sample Ln'); assert.equal(t.pm, '')
  assert.equal(contactFor({ date: '2026-09-30', client: 'Nobody Here' }, cal, sheet).matched, null)
})

test('a one-word name that fits two customers near the date is never guessed', () => {
  const cal = [
    { customer: { name: 'Robin', phone: '1', address: 'a' }, installDate: '2026-09-21', pm: { name: 'PM One' } },
    { customer: { name: 'Robin Second', phone: '2', address: 'b' }, installDate: '2026-09-28', pm: { name: 'PM Two' } },
  ]
  assert.equal(contactFor({ date: '2026-09-21', client: 'Robin' }, cal).pm, 'PM One')             // exact day wins
  assert.equal(contactFor({ date: '2026-09-24', client: 'Robin' }, cal).matched, 'ambiguous')     // neither is the day
  assert.equal(contactFor({ date: '2026-09-26', client: 'Robin Second' }, cal).pm, 'PM Two')      // full name is fine
})

test('text names each job with install date, PM and balance; PDF builds', async () => {
  const rows = [{ date: '2026-10-08', client: 'Testone', amount: 11760.78, paid: 5880.39, due: 5880.39, days: 46, contact: { name: 'Alex And Sam Testone', address: '300 N Fake St', phone: '6025550102', pm: 'PM One' } }]
  const t = smsText(rows, '2026-11-23')
  assert.match(t, /Alex And Sam Testone — installed Oct 8, 2026 — PM PM One — owes \$5,880\.39/)
  const pdf = await buildPdf(rows, '2026-11-23')
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
})
