import { planSplit, nextSplitName, nextSplitProjectId } from '../src/utils/splitDeal.js'

let pass = 0, fail = 0
const eq = (what, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++ } else { fail++; console.log(`FAIL ${what}\n  got  ${g}\n  want ${w}`) }
}
const ok = (what, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL ${what}`) } }

// ── naming ──────────────────────────────────────────────────────────────────
eq('name: plain', nextSplitName('Mike Siudzinski'), 'Mike Siudzinski 2')
eq('name: already a 2 → 3', nextSplitName('Todd Vietzen 2'), 'Todd Vietzen 3')
eq('name: 2 taken → 3', nextSplitName('Mike Siudzinski', new Set(['Mike Siudzinski 2'])), 'Mike Siudzinski 3')
eq('name: taken is case-insensitive', nextSplitName('Mike S', new Set(['mike s 2'])), 'Mike S 3')
eq('name: address with digits is not a counter',
   nextSplitName('Whitaker — 9 Birchwood Ct'), 'Whitaker — 9 Birchwood Ct 2')
eq('name: a house number is NOT a counter',
   nextSplitName('Smith 1420'), 'Smith 1420 2')
// A BARE single trailing digit stays a counter — "Todd Vietzen 2" is a real
// name in the data and must split to 3. The multi-digit case above is the one
// that mattered, since house numbers here are 2-4 digits.
eq('name: a bare single digit is still a counter', nextSplitName('Smith 9'), 'Smith 10')
eq('name: blank', nextSplitName(''), 'Deal 2')

// ── project id ──────────────────────────────────────────────────────────────
eq('pid: plain', nextSplitProjectId('282300044660754'), '282300044660754-2')
eq('pid: already -2 → -3', nextSplitProjectId('282300044660754-2'), '282300044660754-3')
eq('pid: -2 taken → -3', nextSplitProjectId('123', new Set(['123-2'])), '123-3')
// A dashed id whose tail is NOT a counter must keep its whole value — reading
// "TT-1003" as stem TT + counter 1003 produced "TT-1004", another job's id.
eq('pid: a dashed real id is not a counter', nextSplitProjectId('TT-1003'), 'TT-1003-2')
eq('pid: and it increments properly after', nextSplitProjectId('TT-1003-2'), 'TT-1003-3')
eq('pid: none stays none', nextSplitProjectId(null), null)
eq('pid: blank stays none', nextSplitProjectId('   '), null)

// ── the real case ───────────────────────────────────────────────────────────
const deal = {
  id: 'd1', deal_name: 'Mike Siudzinski', project_id: '282300044660754',
  sale_date: '2026-09-14', baseline_revenue: 12000, job_price: 15500,
  status: 'Paid', commission_verified: true,
  install_date: '2026-10-02', pay_date: '2026-10-16',
  setter_id: 'u-corbin', closer_id: 'u-keaton', setter_split_pct: 0.5,
  manager_id: 'u-conner', director_id: 'u-garrison', vp_id: 'u-keaton',
  manager_override_pct: 3, director_override_pct: 5, vp_override_pct: 5,
  office: 'Phoenix', payment_method: 'Finance',
  setter_amount: 900, closer_amount: 900, manager_amount: 360,
  deduction_amount: 250, deduction_note: 'dealer fee',
  bonus_company: 100, bonus_recipient: 'setter',
  notes: 'first job notes',
  synced_baseline: 12000, synced_job_price: 15500,
  change_alert: { prev_baseline: 12000, prev_job_price: 15500, baseline: 19400, job_price: 24900, at: '2026-11-09T23:40:00Z', sale_date: '2026-11-07' },
}
const plan = planSplit(deal, { names: [deal.deal_name], projectIds: [deal.project_id] })

eq('new: name',        plan.newDeal.deal_name, 'Mike Siudzinski 2')
eq('new: project id',  plan.newDeal.project_id, '282300044660754-2')
eq('new: sale date from the sheet', plan.newDeal.sale_date, '2026-11-07')
eq('new: baseline',    plan.newDeal.baseline_revenue, 19400)
eq('new: job price',   plan.newDeal.job_price, 24900)
eq('new: status',      plan.newDeal.status, 'Deal Review')
eq('new: setter',      plan.newDeal.setter_id, 'u-corbin')
eq('new: closer',      plan.newDeal.closer_id, 'u-keaton')
eq('new: manager',     plan.newDeal.manager_id, 'u-conner')
eq('new: office',      plan.newDeal.office, 'Phoenix')
eq('new: payment',     plan.newDeal.payment_method, 'Finance')
eq('new: mgr pct',     plan.newDeal.manager_override_pct, 3)

// Nothing of the FIRST job's money, payout or sign-off rides along.
for (const k of ['install_date','pay_date','setter_amount','closer_amount','manager_amount',
                 'director_amount','vp_amount','deduction_amount','deduction_note','notes',
                 'bonus_company','bonus_recipient','change_alert']) {
  eq(`new: ${k} not inherited`, plan.newDeal[k], null)
}
eq('new: not gold-checked', plan.newDeal.commission_verified, false)
eq('new: not hidden',       plan.newDeal.hidden, false)
eq('new: not comp-excluded',plan.newDeal.comp_excluded, false)
eq('new: snapshot stamped', [plan.newDeal.synced_baseline, plan.newDeal.synced_job_price], [19400, 24900])

// The ORIGINAL: only the alert and the snapshot. Its money, status and gold
// check must not appear in the patch at all — that is what "left untouched"
// means, and it is also what keeps the write inside migration 039's allowance
// so a locked pay run accepts it.
eq('orig: patch keys', Object.keys(plan.originalPatch).sort(),
   ['change_alert','synced_baseline','synced_job_price'])
eq('orig: alert cleared', plan.originalPatch.change_alert, null)
eq('orig: snapshot advanced',
   [plan.originalPatch.synced_baseline, plan.originalPatch.synced_job_price], [19400, 24900])

// The dialog's figures come from the same plan, so they cannot disagree.
eq('summary: kept figures', [plan.summary.keptBaseline, plan.summary.keptJobPrice], [12000, 15500])
eq('summary: new figures',  [plan.summary.baseline, plan.summary.jobPrice], [19400, 24900])

// ── sale-date fallbacks ─────────────────────────────────────────────────────
// No sheet date on the alert (every alert written before this feature): fall
// back to the LOCAL day of `at`, never its UTC slice. 23:40Z on the 9th is
// 16:40 on the 9th in Arizona — the slice would say the 9th too, so use an
// hour where the two genuinely differ: 02:00Z on the 10th is 19:00 on the 9th.
const noSheet = { ...deal, change_alert: { ...deal.change_alert, sale_date: undefined, at: '2026-11-10T02:00:00Z' } }
process.env.TZ = 'America/Phoenix'
eq('fallback: local day of at, not the UTC slice',
   planSplit(noSheet).newDeal.sale_date, '2026-11-09')

// No date at all → today, passed in rather than guessed.
const noAt = { ...deal, change_alert: { baseline: 1, job_price: 2 } }
eq('fallback: todayISO', planSplit(noAt, { todayISO: '2026-11-09' }).newDeal.sale_date, '2026-11-09')

// ── guards ──────────────────────────────────────────────────────────────────
eq('no alert → null', planSplit({ ...deal, change_alert: null }), null)
eq('no deal → null', planSplit(null), null)
// A hand-entered deal with no project id: the new one gets none either, which
// is correct — there is no id to derive from and the sync's name fallback only
// adopts a deal with no id, so leaving it blank is the pre-existing behaviour.
ok('no project id → new deal has none',
   planSplit({ ...deal, project_id: null }).newDeal.project_id === null)
// Splitting twice: the second split must not collide with the first.
const after = planSplit(deal, { names: ['Mike Siudzinski', 'Mike Siudzinski 2'], projectIds: ['282300044660754', '282300044660754-2'] })
eq('second split: name',  after.newDeal.deal_name, 'Mike Siudzinski 3')
eq('second split: pid',   after.newDeal.project_id, '282300044660754-3')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
